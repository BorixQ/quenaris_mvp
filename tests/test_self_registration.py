import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.db import close_old_connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from analysis.models import EmailIdentity, EmailLoginChallenge, GoogleAccessGrant, GoogleIdentity

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def registration_settings():
    with override_settings(
        PUBLIC_SIGNUP_ENABLED=True, EMAIL_LOGIN_ENABLED=True,
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", EMAIL_HOST="smtp.example.invalid",
        DEFAULT_FROM_EMAIL="access@example.invalid", EMAIL_USE_TLS=True, EMAIL_USE_SSL=False,
    ):
        yield


def request_code(client, email="person@example.com"):
    response = client.post("/api/auth/email/request/", {"email": email}, format="json")
    assert response.status_code == 200
    return re.search(r"\b\d{8}\b", mail.outbox[-1].body).group()


def verify(client, email, code):
    return client.post("/api/auth/email/verify/", {"email": email, "code": code}, format="json")


def test_email_signup_and_returning_login_are_single_use():
    client = APIClient()
    code = request_code(client, "Person@Example.com")
    challenge = EmailLoginChallenge.objects.get(email="person@example.com")
    assert code not in challenge.code_digest
    response = verify(client, "person@example.com", code)
    assert response.status_code == 200 and response.data["token"]
    identity = EmailIdentity.objects.select_related("user").get(email="person@example.com")
    assert not identity.user.has_usable_password()
    assert (identity.user.quota.max_area_ha, identity.user.quota.max_date_range_days) == (10, 123)
    assert verify(client, "person@example.com", code).status_code == 400
    next_code = request_code(client, "person@example.com")
    assert verify(client, "PERSON@example.com", next_code).status_code == 200
    assert EmailIdentity.objects.count() == 1 and get_user_model().objects.count() == 1


def test_email_wrong_attempts_expiry_and_rate_limits():
    client = APIClient()
    code = request_code(client)
    wrong = "00000000" if code != "00000000" else "11111111"
    for _ in range(5):
        assert verify(client, "person@example.com", wrong).status_code == 400
    assert verify(client, "person@example.com", code).status_code == 400
    assert EmailLoginChallenge.objects.get(email="person@example.com").attempts == 5
    EmailLoginChallenge.objects.filter(email="person@example.com").update(last_sent_at=timezone.now()-timedelta(minutes=2))
    new_code = request_code(client)
    EmailLoginChallenge.objects.filter(email="person@example.com").update(expires_at=timezone.now()-timedelta(seconds=1))
    assert verify(client, "person@example.com", new_code).status_code == 400
    assert not EmailIdentity.objects.exists()


def test_email_request_has_cooldown_and_per_address_limit():
    client = APIClient()
    for _ in range(5):
        assert client.post("/api/auth/email/request/", {"email": "person@example.com"}, format="json").status_code == 200
    assert len(mail.outbox) == 1
    assert client.post("/api/auth/email/request/", {"email": "person@example.com"}, format="json").status_code == 429


@pytest.mark.parametrize("staff", [False, True])
def test_email_cannot_take_over_existing_local_accounts(staff):
    user = get_user_model().objects.create_user(username="old", email="person@example.com", is_staff=staff)
    client = APIClient()
    assert client.post("/api/auth/email/request/", {"email": user.email}, format="json").status_code == 200
    assert not re.search(r"\b\d{8}\b", mail.outbox[-1].body)
    assert verify(client, user.email, "12345678").status_code == 400
    assert not EmailIdentity.objects.exists()


def test_disabled_user_cannot_use_an_existing_email_identity():
    user = get_user_model().objects.create_user(username="disabled", email="person@example.com", is_active=False)
    EmailIdentity.objects.create(user=user, email=user.email)
    client = APIClient()
    assert client.post("/api/auth/email/request/", {"email": user.email}, format="json").status_code == 200
    assert EmailLoginChallenge.objects.get(email=user.email).attempts == 5
    assert verify(client, user.email, "12345678").status_code == 400


def test_email_origin_disabled_and_mail_failure_do_not_issue_codes():
    client = APIClient()
    assert client.post("/api/auth/email/request/", {"email": "a@example.com"}, format="json", HTTP_ORIGIN="https://evil.invalid").status_code == 403
    with override_settings(EMAIL_LOGIN_ENABLED=False):
        assert client.post("/api/auth/email/request/", {"email": "a@example.com"}, format="json").status_code == 503
    with patch("analysis.email_auth.send_mail", side_effect=OSError):
        assert client.post("/api/auth/email/request/", {"email": "a@example.com"}, format="json").status_code == 503
    assert not EmailLoginChallenge.objects.exists()


def test_concurrent_code_use_creates_only_one_session():
    email = "person@example.com"
    code = request_code(APIClient(), email)
    def run(_):
        close_old_connections()
        try:
            return verify(APIClient(), email, code).status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(run, range(2)))
    assert sorted(statuses) == [200, 400]
    assert EmailIdentity.objects.count() == 1


@pytest.mark.parametrize("email,hd", [("ana@gmail.com", None), ("ana@unsa.edu.pe", "unsa.edu.pe"), ("ana@stex.edu.pe", "stex.edu.pe")])
def test_google_self_signup_is_tied_to_subject(email, hd, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test.apps.googleusercontent.com")
    info = {"sub": "google-subject", "email": email, "email_verified": True}
    if hd:
        info["hd"] = hd
    client = APIClient()
    with patch("analysis.views.id_token.verify_oauth2_token", return_value=info):
        first = client.post("/api/auth/oauth/", {"credential": "signed"}, format="json")
        second = client.post("/api/auth/oauth/", {"credential": "signed"}, format="json")
    assert first.status_code == second.status_code == 200
    identity = GoogleIdentity.objects.select_related("user").get(subject="google-subject")
    assert GoogleAccessGrant.objects.filter(user=identity.user, enabled=True).exists()
    assert not identity.user.has_usable_password() and GoogleIdentity.objects.count() == 1
    assert identity.user.quota.max_date_range_days == 123


def test_google_unhosted_email_uses_email_code_instead(monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test.apps.googleusercontent.com")
    info = {"sub": "unhosted", "email": "ana@work.example", "email_verified": True}
    client = APIClient()
    with patch("analysis.views.id_token.verify_oauth2_token", return_value=info):
        response = client.post("/api/auth/oauth/", {"credential": "signed"}, format="json")
    assert response.status_code == 403 and "código por correo" in response.data["detail"]
    assert not GoogleIdentity.objects.exists()
    code = request_code(client, "ana@work.example")
    assert verify(client, "ana@work.example", code).status_code == 200


def test_google_unhosted_email_without_email_login_suggests_available_options(monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test.apps.googleusercontent.com")
    info = {"sub": "unhosted", "email": "ana@work.example", "email_verified": True}
    with override_settings(EMAIL_LOGIN_ENABLED=False), patch("analysis.views.id_token.verify_oauth2_token", return_value=info):
        response = APIClient().post("/api/auth/oauth/", {"credential": "signed"}, format="json")
    assert response.status_code == 403 and "otra cuenta de Google" in response.data["detail"]
    assert "código" not in response.data["detail"] and not GoogleIdentity.objects.exists()


def test_google_will_not_take_over_self_registered_email(monkeypatch):
    client = APIClient()
    code = request_code(client, "person@gmail.com")
    assert verify(client, "person@gmail.com", code).status_code == 200
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test.apps.googleusercontent.com")
    info = {"sub": "new-subject", "email": "person@gmail.com", "email_verified": True}
    with patch("analysis.views.id_token.verify_oauth2_token", return_value=info):
        response = client.post("/api/auth/oauth/", {"credential": "signed"}, format="json")
    assert response.status_code == 403 and not GoogleIdentity.objects.exists()


def test_signup_can_be_disabled_without_disabling_existing_email_login():
    client = APIClient()
    code = request_code(client)
    assert verify(client, "person@example.com", code).status_code == 200
    with override_settings(PUBLIC_SIGNUP_ENABLED=False):
        code = request_code(client)
        assert verify(client, "person@example.com", code).status_code == 200


def test_concurrent_google_registration_creates_one_identity(monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test.apps.googleusercontent.com")
    info = {"sub": "concurrent-subject", "email": "ana@unsa.edu.pe", "email_verified": True, "hd": "unsa.edu.pe"}
    def run(_):
        close_old_connections()
        try:
            return APIClient().post("/api/auth/oauth/", {"credential": "signed"}, format="json").status_code
        finally:
            close_old_connections()
    with patch("analysis.views.id_token.verify_oauth2_token", return_value=info):
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert list(pool.map(run, range(2))) == [200, 200]
    assert GoogleIdentity.objects.count() == 1 and get_user_model().objects.count() == 1


def test_expired_codes_are_removed_by_periodic_cleanup():
    from analysis.tasks import recover_stale_requests
    request_code(APIClient())
    EmailLoginChallenge.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
    with patch("django.core.management.call_command"):
        recover_stale_requests.run()
    assert not EmailLoginChallenge.objects.exists()
