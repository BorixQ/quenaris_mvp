import math
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from analysis.authentication import LoginIPThrottle, LoginAccountThrottle
from analysis.admin import LocalUserCreationForm, GoogleAccessGrantForm
from analysis.models import AnalysisRequest, AnalysisResult, GoogleIdentity, GoogleAccessGrant
from analysis.lifecycle import claim_attempt, mark_failed
from analysis.tasks import run_geospatial_analysis
from test_backend import user, payload, charged_request

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def image(user, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    analysis = charged_request(user)
    analysis.status = "COMPLETED"
    analysis.save()
    AnalysisResult.objects.create(request=analysis,clusters_geojson={},statistics={},
        heatmap_layers={"indices":["ndvi"],"timesteps":["2025-06"]})
    path = tmp_path/"heatmaps"/str(analysis.pk)/"ndvi"/"2025-06.png"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\nprivate")
    return analysis,path,f"/media/heatmaps/{analysis.pk}/ndvi/2025-06.png"


def test_private_media_owner_only_and_not_cached(user, image):
    obj,path,url = image
    client = APIClient()
    anonymous = client.get(url)
    assert anonymous.status_code == 401 and "no-store" in anonymous["Cache-Control"]
    client.force_authenticate(user)
    response = client.get(url)
    assert response.status_code == 200 and b"private" in b"".join(response.streaming_content)
    assert "no-store" in response["Cache-Control"] and "Authorization" in response["Vary"]
    response.close()
    other = get_user_model().objects.create_superuser(username="other-admin",password="test-password-long")
    client.force_authenticate(other)
    assert client.get(url).status_code == 404
    assert client.get(f"/api/analyses/{obj.pk}/").status_code == 404


@pytest.mark.parametrize("suffix", ["../2025-06.png","secret/2025-06.png","ndvi/2024-01.png","ndvi/../../secret.png"])
def test_arbitrary_paths_not_served(user,image,suffix):
    obj,_,_ = image
    client = APIClient()
    client.force_authenticate(user)
    assert client.get(f"/media/heatmaps/{obj.pk}/{suffix}").status_code == 404


def test_symlink_cannot_escape_analysis_directory(user,image,tmp_path):
    _,path,url = image
    outside = tmp_path/"other-private.png"
    outside.write_bytes(b"secret")
    path.unlink()
    path.symlink_to(outside)
    client = APIClient()
    client.force_authenticate(user)
    assert client.get(url).status_code == 404


def test_only_committed_attempt_artifacts_can_be_read(user,image):
    obj,path,old_url = image
    attempt = uuid.uuid4()
    layers = obj.result.heatmap_layers
    layers["artifact_attempt"] = str(attempt)
    obj.result.heatmap_layers = layers
    obj.result.save()
    target = path.parents[1]/str(attempt)/"ndvi"/"2025-06.png"
    target.parent.mkdir(parents=True)
    target.write_bytes(path.read_bytes())
    client = APIClient()
    client.force_authenticate(user)
    assert client.get(old_url).status_code == 404
    assert client.get(f"/media/heatmaps/{obj.pk}/{uuid.uuid4()}/ndvi/2025-06.png").status_code == 404
    response = client.get(f"/media/heatmaps/{obj.pk}/{attempt}/ndvi/2025-06.png")
    assert response.status_code == 200
    response.close()


def test_expiry_login_refresh_and_logout_revocation(user):
    token = Token.objects.create(user=user)
    old = token.key
    Token.objects.filter(pk=token.pk).update(created=timezone.now()-timedelta(hours=25))
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Token "+old)
    assert client.get("/api/analyses/").status_code == 401
    response = client.post("/api/auth/token/",{"username":user.username,"password":"test-only-password"})
    assert response.status_code == 200 and response.data["token"] != old
    client.credentials(HTTP_AUTHORIZATION="Token "+response.data["token"])
    assert client.post("/api/auth/logout/").status_code == 204
    assert client.get("/api/analyses/").status_code == 401


def test_django_sessions_do_not_authenticate_public_api(user):
    client = APIClient()
    client.force_login(user)
    assert client.get("/api/analyses/").status_code == 401
    assert client.get("/admin/").status_code == 404


def test_login_is_throttled_in_shared_redis():
    client = APIClient()
    with patch.object(LoginIPThrottle,"rate","2/min",create=True):
        responses = [client.post("/api/auth/token/",{"username":"missing","password":"wrong"}) for _ in range(3)]
    assert [r.status_code for r in responses] == [400,400,429]
    assert "Retry-After" in responses[-1]


def test_login_array_body_returns_validation_error():
    assert APIClient().post("/api/auth/token/",[],format="json").status_code == 400


def test_local_login_accepts_email_or_username_and_rejects_ambiguous_matches(user):
    user.email = 'person@example.com'
    user.save()
    client = APIClient()
    for identifier in [user.username, 'PERSON@example.com']:
        assert client.post('/api/auth/token/', {'username': identifier, 'password': 'test-only-password'}).status_code == 200
    get_user_model().objects.create_user(username='second', email='PERSON@example.com', password='another-password')
    assert client.post('/api/auth/token/', {'username': user.email, 'password': 'test-only-password'}).status_code == 400


def test_password_throttle_shares_limit_between_username_and_email(user):
    user.email = 'person@example.com'
    user.save()
    client = APIClient()
    with patch.object(LoginAccountThrottle, 'rate', '2/min', create=True):
        replies = [client.post('/api/auth/token/', {'username': identity, 'password': 'wrong'})
                   for identity in [user.username, user.email, user.username]]
    assert [reply.status_code for reply in replies] == [400, 400, 429]


def test_admin_creates_user_with_contact_details_and_rejects_duplicate_email(user):
    values = {'username': 'new-user', 'email': 'new@example.com', 'first_name': 'Ana',
              'last_name': 'Prueba', 'password1': 'a-secure-password-123', 'password2': 'a-secure-password-123'}
    form = LocalUserCreationForm(values)
    assert form.is_valid(), form.errors
    created = form.save()
    assert (created.email, created.first_name, created.last_name) == ('new@example.com', 'Ana', 'Prueba')
    values.update(username='another', email='NEW@example.com')
    assert not LocalUserCreationForm(values).is_valid()
    user.email = 'NEW@example.com'
    user.save()
    grant = GoogleAccessGrantForm({'user': created.pk, 'enabled': True})
    assert not grant.is_valid()


def test_google_cannot_take_over_local_email(user,monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID","test.apps.googleusercontent.com")
    user.email = "owner@example.com"
    user.save()
    with patch("analysis.views.id_token.verify_oauth2_token",return_value={"sub":"unlinked","email":user.email,"email_verified":True}):
        response = APIClient().post("/api/auth/oauth/",{"credential":"signed"},format="json")
    assert response.status_code == 403 and not Token.objects.filter(user=user).exists()


def test_google_cannot_take_over_unlinked_generated_username(user,monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID","test.apps.googleusercontent.com")
    user.username = "google_"+hashlib.sha256(b"unlinked").hexdigest()
    user.save()
    with patch("analysis.views.id_token.verify_oauth2_token",return_value={"sub":"unlinked","email":"new@example.com","email_verified":True}):
        response = APIClient().post("/api/auth/oauth/",{"credential":"signed"},format="json")
    assert response.status_code == 403 and not GoogleIdentity.objects.exists()
    assert not Token.objects.filter(user=user).exists()


def test_google_requires_admin_approval_and_uses_subject(user,monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID","test.apps.googleusercontent.com")
    user.email = 'approved@gmail.com'
    user.save()
    info = {"sub":"stable","email":user.email,"email_verified":False}
    client = APIClient()
    with patch("analysis.views.id_token.verify_oauth2_token",return_value=info):
        assert client.post("/api/auth/oauth/",{"credential":"signed"},format="json").status_code == 400
        info["email_verified"] = True
        assert client.post("/api/auth/oauth/",{"credential":"signed"},format="json").status_code == 403
        GoogleAccessGrant.objects.create(user=user)
        first = client.post("/api/auth/oauth/",{"credential":"signed"},format="json")
        assert first.status_code == 200
        identity = GoogleIdentity.objects.get(subject="stable")
        assert identity.user == user and identity.user.has_usable_password()
        info["email"] = "changed@example.com"
        second = client.post("/api/auth/oauth/",{"credential":"signed"},format="json")
        assert second.data["token"] == first.data["token"] and GoogleIdentity.objects.count() == 1
        user.google_access_grant.enabled = False
        user.google_access_grant.save()
        assert client.post("/api/auth/oauth/",{"credential":"signed"},format="json").status_code == 403
        user.google_access_grant.enabled = True
        user.google_access_grant.save()
        identity.user.is_active = False
        identity.user.save()
        assert client.post("/api/auth/oauth/",{"credential":"signed"},format="json").status_code == 403


def test_google_will_not_link_non_authoritative_or_ambiguous_email(user, monkeypatch):
    monkeypatch.setenv('GOOGLE_OAUTH_CLIENT_ID', 'test.apps.googleusercontent.com')
    user.email = 'person@example.com'
    user.save()
    GoogleAccessGrant.objects.create(user=user)
    info = {'sub': 'stable', 'email': user.email, 'email_verified': True}
    client = APIClient()
    with patch('analysis.views.id_token.verify_oauth2_token', return_value=info):
        assert client.post('/api/auth/oauth/', {'credential': 'signed'}, format='json').status_code == 403
        info['hd'] = 'example.com'
        get_user_model().objects.create_user(username='second', email='PERSON@example.com', password='another-password')
        assert client.post('/api/auth/oauth/', {'credential': 'signed'}, format='json').status_code == 403
    assert not GoogleIdentity.objects.exists()


def test_google_cross_origin_and_form_posts_rejected(monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID","test.apps.googleusercontent.com")
    client = APIClient()
    assert client.post("/api/auth/oauth/",{"credential":"x"},format="json",HTTP_ORIGIN="https://attacker.example").status_code == 403
    assert client.post("/api/auth/oauth/",{"credential":"x"}).status_code == 415


def test_duplicate_attempt_cannot_run_or_refund_new_attempt(user):
    obj = charged_request(user)
    _,first = claim_attempt(obj.pk)
    assert claim_attempt(obj.pk) == (None,None)
    AnalysisRequest.objects.filter(pk=obj.pk).update(attempt_started_at=timezone.now()-timedelta(minutes=40))
    _,second = claim_attempt(obj.pk)
    assert first != second and not mark_failed(obj.pk,"late old error",attempt_token=first)
    user.quota.refresh_from_db()
    assert user.quota.analyses_used == 1


def test_pending_crash_recovery_and_fresh_retry(user):
    orphan, retry = charged_request(user), charged_request(user)
    old = timezone.now()-timedelta(minutes=40)
    AnalysisRequest.objects.filter(pk=orphan.pk).update(created_at=old)
    AnalysisRequest.objects.filter(pk=retry.pk).update(started_at=old,attempt_started_at=timezone.now())
    with patch("analysis.tasks.run_geospatial_analysis.apply_async") as publish:
        call_command("recover_stale_analyses")
        call_command("recover_stale_analyses")
        assert publish.call_count == 1
    orphan.refresh_from_db()
    retry.refresh_from_db()
    user.quota.refresh_from_db()
    assert orphan.status == "PENDING" and retry.status == "PENDING" and user.quota.analyses_used == 2
    assert orphan.last_enqueued_at is not None and orphan.celery_task_id


def test_pending_recovery_preserves_quota_when_broker_is_unavailable(user):
    pending = charged_request(user)
    AnalysisRequest.objects.filter(pk=pending.pk).update(created_at=timezone.now()-timedelta(minutes=40))
    with patch("analysis.tasks.run_geospatial_analysis.apply_async", side_effect=ConnectionError):
        call_command("recover_stale_analyses")
    pending.refresh_from_db()
    user.quota.refresh_from_db()
    assert pending.status == "PENDING" and pending.last_enqueued_at is None
    assert pending.quota_charged and user.quota.analyses_used == 1


def test_old_attempt_cannot_commit_result(user):
    obj = charged_request(user)
    def pipeline(**kwargs):
        AnalysisRequest.objects.filter(pk=obj.pk).update(attempt_token=uuid.uuid4())
        return {"statistics":{"scoring_reference":{}},"clusters_geojson":{"features":[]},"images_used":1,"processing_seconds":1}
    with patch("analysis.tasks.run_pipeline",side_effect=pipeline),patch("analysis.tasks.generate_heatmaps",return_value=None):
        assert run_geospatial_analysis.run(str(obj.pk)) == "IGNORED"
    assert not AnalysisResult.objects.filter(request=obj).exists()


def test_active_delete_and_parallel_active_submission_rejected(user):
    obj = charged_request(user)
    client = APIClient()
    client.force_authenticate(user)
    assert client.delete(f"/api/analyses/{obj.pk}/").status_code == 409
    assert client.delete("/api/analyses/not-a-uuid/").status_code == 404
    assert client.post("/api/analyses/",payload(),format="json").status_code == 400


@pytest.mark.parametrize("kind",["invalid_geometry","long_bbox","long_period","many_vertices"])
def test_resource_limits_reject_before_enqueue(user,kind):
    data = payload()
    if kind == "invalid_geometry":
        data["aoi"]["coordinates"] = [[[0,0],[.001,.001],[0,.001],[.001,0],[0,0]]]
    if kind == "long_bbox":
        data["aoi"]["coordinates"] = [[[-10,0],[10,0],[10,.00000001],[-10,.00000001],[-10,0]]]
    if kind == "long_period": data["date_end"] = "2027-01-01"
    if kind == "many_vertices":
        ring = [[-72+.0001*math.cos(i*.00628),-16+.0001*math.sin(i*.00628)] for i in range(1001)]
        data["aoi"]["coordinates"] = [ring+[ring[0]]]
    client = APIClient()
    client.force_authenticate(user)
    with patch("analysis.views.run_geospatial_analysis.apply_async") as publish:
        assert client.post("/api/analyses/",data,format="json").status_code == 400
        publish.assert_not_called()


def test_private_admin_exists_only_in_private_urlconf(user):
    client = APIClient(enforce_csrf_checks=True)
    assert client.get("/admin/login/").status_code == 404
    with override_settings(ROOT_URLCONF="config.admin_urls",STORAGES={"default":{"BACKEND":"django.core.files.storage.FileSystemStorage"},"staticfiles":{"BACKEND":"django.contrib.staticfiles.storage.StaticFilesStorage"}}):
        assert client.get("/admin/login/").status_code == 200
        assert client.get("/api/analyses/").status_code == 404
        assert client.post("/admin/login/",{"username":user.username,"password":"test-only-password"}).status_code == 403


def test_weak_secret_fails_closed():
    env = dict(os.environ,DJANGO_SECRET_KEY="weak")
    process = subprocess.run([sys.executable,"-c","import config.settings"],env=env,capture_output=True,text=True)
    assert process.returncode != 0 and "ImproperlyConfigured" in process.stderr
