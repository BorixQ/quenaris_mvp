from datetime import timedelta
from unittest.mock import patch, Mock
import pytest
from celery.exceptions import Retry
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Polygon
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient
from analysis.models import AnalysisRequest, AnalysisResult
from analysis.lifecycle import mark_failed
from analysis.tasks import run_geospatial_analysis

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def user():
    user = get_user_model().objects.create_user(username="integration", password="test-only-password")
    quota = user.quota
    quota.analyses_allowed = 5
    quota.max_area_ha = 100
    quota.save()
    return user


def payload():
    return {"name":"test","aoi":{"type":"Polygon","coordinates":[[
        [-72.142,-16.322],[-72.138,-16.322],[-72.138,-16.318],[-72.142,-16.318],[-72.142,-16.322]]]},
        "date_start":"2025-06-01","date_end":"2025-06-15","study_type":"agro","n_clusters":3}


def charged_request(user):
    data = payload()
    data.pop("aoi")
    obj = AnalysisRequest.objects.create(user=user, aoi=Polygon.from_bbox((-72.142,-16.322,-72.138,-16.318)),
                                         quota_charged=True, **data)
    quota = user.quota
    quota.analyses_used += 1
    quota.save()
    return obj


def test_login_health_and_access(user):
    client = APIClient()
    assert client.get("/api/health/").status_code == 200
    assert client.get("/api/analyses/").status_code == 401
    response = client.post("/api/auth/token/", {"username":user.username,"password":"test-only-password"})
    assert response.status_code == 200
    client.credentials(HTTP_AUTHORIZATION="Token "+response.data["token"])
    assert client.get("/api/analyses/").status_code == 200


def test_publish_failure_refunds_once(user):
    client = APIClient()
    client.force_authenticate(user)
    with patch("analysis.views.run_geospatial_analysis.apply_async", side_effect=ConnectionError):
        response = client.post("/api/analyses/",payload(),format="json")
    assert response.status_code == 503
    obj = AnalysisRequest.objects.get(pk=response.data["id"])
    mark_failed(obj.pk,"repeat")
    user.quota.refresh_from_db()
    assert obj.status == "FAILED" and user.quota.analyses_used == 0


def test_created_request_is_visible_before_publish_and_charges_once(user):
    client = APIClient()
    client.force_authenticate(user)
    def publish(*, args, task_id, retry):
        assert AnalysisRequest.objects.get(pk=args[0]).celery_task_id == task_id
    with patch("analysis.views.run_geospatial_analysis.apply_async",side_effect=publish):
        response = client.post("/api/analyses/",payload(),format="json")
    assert response.status_code == 202
    user.quota.refresh_from_db()
    assert user.quota.analyses_used == 1


def test_retry_keeps_reservation_and_terminal_failure_refunds(user):
    obj = charged_request(user)
    with patch("analysis.tasks.run_pipeline",side_effect=ConnectionError), \
         patch.object(run_geospatial_analysis,"retry",side_effect=Retry):
        with pytest.raises(Retry): run_geospatial_analysis.run(str(obj.pk))
    obj.refresh_from_db()
    user.quota.refresh_from_db()
    assert obj.status == "PENDING" and obj.quota_charged and user.quota.analyses_used == 1
    with patch("analysis.tasks.run_pipeline",side_effect=ValueError):
        with pytest.raises(ValueError): run_geospatial_analysis.run(str(obj.pk))
    obj.refresh_from_db()
    user.quota.refresh_from_db()
    assert obj.status == "FAILED" and not obj.quota_charged and user.quota.analyses_used == 0
    assert run_geospatial_analysis.run(str(obj.pk)) == "IGNORED"


def test_result_persists_and_duplicate_task_is_ignored(user):
    obj = charged_request(user)
    result = {"statistics":{"scoring_reference":{"profiles":{}},"clusters":[]},
        "clusters_geojson":{"type":"FeatureCollection","features":[]},"images_used":2,"processing_seconds":1.2}
    with patch("analysis.tasks.run_pipeline",return_value=result), patch("analysis.tasks.generate_heatmaps",return_value=None):
        assert run_geospatial_analysis.run(str(obj.pk)) == "COMPLETED"
        assert run_geospatial_analysis.run(str(obj.pk)) == "IGNORED"
    assert AnalysisResult.objects.filter(request=obj).count() == 1
    mark_failed(obj.pk,"late error")
    obj.refresh_from_db()
    assert obj.status == "COMPLETED"


def test_user_cannot_read_another_users_request(user):
    obj = charged_request(user)
    other = get_user_model().objects.create_user(username="other")
    client = APIClient()
    client.force_authenticate(other)
    assert client.get(f"/api/analyses/{obj.pk}/").status_code == 404


def test_stale_worker_recovery_is_idempotent(user):
    stale = charged_request(user)
    recent = charged_request(user)
    AnalysisRequest.objects.filter(pk=stale.pk).update(status="PROCESSING",started_at=timezone.now()-timedelta(minutes=40))
    AnalysisRequest.objects.filter(pk=recent.pk).update(status="PROCESSING",started_at=timezone.now())
    call_command("recover_stale_analyses")
    call_command("recover_stale_analyses")
    stale.refresh_from_db()
    recent.refresh_from_db()
    user.quota.refresh_from_db()
    assert stale.status == "FAILED" and recent.status == "PROCESSING"
    assert user.quota.analyses_used == 1


def test_exhausted_transient_retry_refunds_once(user):
    obj = charged_request(user)
    run_geospatial_analysis.push_request(retries=2)
    try:
        with patch("analysis.tasks.run_pipeline",side_effect=ConnectionError):
            with pytest.raises(ConnectionError): run_geospatial_analysis.run(str(obj.pk))
    finally:
        run_geospatial_analysis.pop_request()
    obj.refresh_from_db()
    user.quota.refresh_from_db()
    assert obj.status == "FAILED" and user.quota.analyses_used == 0


def test_concurrent_creation_cannot_exceed_quota(user):
    from concurrent.futures import ThreadPoolExecutor
    from django.db import close_old_connections
    quota = user.quota
    quota.analyses_allowed = 1
    quota.save()
    def create():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(get_user_model().objects.get(pk=user.pk))
            return client.post("/api/analyses/",payload(),format="json").status_code
        finally:
            close_old_connections()
    with patch("analysis.views.run_geospatial_analysis.apply_async",return_value=Mock()):
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _:create(),range(2)))
    quota.refresh_from_db()
    assert sorted(statuses) == [202,400]
    assert quota.analyses_used == 1 and AnalysisRequest.objects.filter(user=user).count() == 1
