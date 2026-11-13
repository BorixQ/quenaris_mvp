import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from analysis.models import AnalysisRequest, AnalysisResult, FeaturedAnalysis, ReceivedAnalysis
from test_backend import user
from test_sharing import completed, enable, owner_client

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def reader():
    return get_user_model().objects.create_user(username="reader", password="test-only-password")


@pytest.fixture
def admin():
    return get_user_model().objects.create_user(username="curator", is_staff=True, password="test-only-password")


def share(user, completed):
    obj, _ = completed
    url, _ = enable(user, obj)
    return obj, url


def test_received_is_explicit_private_and_idempotent(user, reader, completed):
    obj, url = share(user, completed)
    client = owner_client(reader)
    assert APIClient().get(url).status_code == 200
    assert ReceivedAnalysis.objects.count() == 0  # Merely opening a link saves nothing.
    assert client.get("/api/received/").data["results"] == []
    before = (reader.quota.analyses_used, reader.quota.area_used_ha)
    first = client.post(url + "account/", {}, format="json")
    assert first.status_code == 201
    assert client.post(url + "account/", {}, format="json").status_code == 200
    assert ReceivedAnalysis.objects.count() == 1
    account = client.get(url + "account/").data
    assert account["is_saved"] is True and account["is_owner"] is False and account["can_feature"] is False
    received = client.get("/api/received/").data
    assert received["count"] == 1 and received["results"][0]["available"] is True
    assert received["results"][0]["share_path"] == f"/compartido/{obj.share_token}"
    assert "user_email" not in received["results"][0]
    assert owner_client(user).get("/api/received/").data["count"] == 0
    reader.quota.refresh_from_db()
    assert (reader.quota.analyses_used, reader.quota.area_used_ha) == before


def test_received_requires_login_and_rejects_own_analysis(user, completed):
    obj, url = share(user, completed)
    anon = APIClient()
    assert anon.get("/api/received/").status_code == 401
    assert anon.get(url + "account/").status_code == 401
    assert anon.post(url + "account/", {}, format="json").status_code == 401
    assert owner_client(user).post(url + "account/", {}, format="json").status_code == 400
    assert owner_client(user).get(url + "account/").data["is_owner"] is True
    assert not ReceivedAnalysis.objects.exists()


def test_remove_received_never_deletes_source_and_is_owner_only(user, reader, completed):
    obj, url = share(user, completed)
    client = owner_client(reader)
    saved = client.post(url + "account/", {}, format="json").data["id"]
    remove_url = f"/api/received/{saved}/"
    assert owner_client(user).delete(remove_url).status_code == 404
    assert client.delete(remove_url).status_code == 204
    assert not ReceivedAnalysis.objects.exists()
    assert AnalysisRequest.objects.filter(pk=obj.pk).exists()
    assert APIClient().get(url).status_code == 200


def test_revocation_does_not_regrant_saved_access_or_reveal_new_metadata(user, reader, completed):
    obj, url = share(user, completed)
    client = owner_client(reader)
    original_name = obj.name
    saved_id = client.post(url + "account/", {}, format="json").data["id"]
    owner = owner_client(user)
    owner.post(f"/api/analyses/{obj.id}/sharing/", {"enabled": False}, format="json")
    obj.name = "Private name after revocation"
    obj.save(update_fields=["name"])
    row = client.get("/api/received/").data["results"][0]
    assert row["available"] is False and row["share_path"] is None and row["name"] == original_name
    assert "aoi" not in row and "area_ha" not in row
    new_url, _ = enable(user, obj)
    assert new_url != url
    assert client.get("/api/received/").data["results"][0]["available"] is False
    assert client.post(url + "account/", {}, format="json").status_code == 404
    assert client.post(new_url + "account/", {}, format="json").status_code == 200
    row = client.get("/api/received/").data["results"][0]
    assert row["id"] == saved_id and row["available"] is True and row["name"] == obj.name


@pytest.mark.parametrize("is_staff,is_superuser", [(True, False), (True, True), (False, True)])
def test_any_admin_can_feature_received_project(user, completed, is_staff, is_superuser):
    obj, url = share(user, completed)
    admin = get_user_model().objects.create_user(username="admin-flags", is_staff=is_staff, is_superuser=is_superuser)
    client = owner_client(admin)
    assert client.get(url + "account/").data["can_feature"] is True
    response = client.post(url + "featured/", {"enabled": True, "description": "Proyecto para explorar"}, format="json")
    assert response.status_code == 200 and response.data["is_featured"] is True
    assert FeaturedAnalysis.objects.get(analysis=obj).featured_by == admin
    gallery = APIClient().get("/api/featured/")
    assert gallery.status_code == 200 and gallery.data["count"] == 1
    project = gallery.data["results"][0]
    assert project["description"] == "Proyecto para explorar" and project["share_path"] == f"/compartido/{obj.share_token}"
    assert "user_email" not in project and "featured_by" not in project and "user" not in project
    assert "no-store" in gallery["Cache-Control"]
    assert client.get(f"/api/analyses/{obj.id}/").status_code == 404
    assert client.post(f"/api/analyses/{obj.id}/sharing/", {"enabled": False}, format="json").status_code == 404
    assert owner_client(user).get(f"/api/analyses/{obj.id}/").data["is_featured"] is True


def test_regular_user_cannot_feature_even_as_owner(user, reader, completed):
    obj, url = share(user, completed)
    for client, endpoint in [(owner_client(user), f"/api/analyses/{obj.id}/featured/"), (owner_client(reader), url + "featured/")]:
        assert client.post(endpoint, {"enabled": True}, format="json").status_code == 403
    assert APIClient().post(url + "featured/", {"enabled": True}, format="json").status_code == 401
    assert not FeaturedAnalysis.objects.exists()


def test_admin_own_project_requires_explicit_active_link(user, completed):
    obj, _ = completed
    user.is_staff = True
    user.save(update_fields=["is_staff"])
    client = owner_client(user)
    endpoint = f"/api/analyses/{obj.id}/featured/"
    assert client.post(endpoint, {"enabled": True}, format="json").status_code == 409
    assert APIClient().get("/api/featured/").data["count"] == 0
    enable(user, obj)
    assert client.post(endpoint, {"enabled": True}, format="json").status_code == 200
    assert client.post(endpoint, {"enabled": True, "description": "Editado"}, format="json").status_code == 200
    assert FeaturedAnalysis.objects.count() == 1 and FeaturedAnalysis.objects.get().description == "Editado"


def test_any_admin_can_remove_a_selection_and_public_link_remains(user, admin, completed):
    obj, url = share(user, completed)
    client = owner_client(admin)
    client.post(url + "featured/", {"enabled": True}, format="json")
    other = get_user_model().objects.create_user(username="second-admin", is_staff=True)
    assert owner_client(other).post(url + "featured/", {"enabled": False}, format="json").status_code == 200
    assert APIClient().get("/api/featured/").data["count"] == 0
    assert APIClient().get(url).status_code == 200


def test_owner_switch_withdraws_selection_without_republishing_on_reenable(user, admin, completed):
    obj, url = share(user, completed)
    owner_client(admin).post(url + "featured/", {"enabled": True}, format="json")
    assert APIClient().get("/api/featured/").data["count"] == 1
    owner_client(user).post(f"/api/analyses/{obj.id}/sharing/", {"enabled": False}, format="json")
    assert not FeaturedAnalysis.objects.exists()
    assert APIClient().get("/api/featured/").data["results"] == []
    enable(user, obj)
    assert APIClient().get("/api/featured/").data["results"] == []


@pytest.mark.parametrize("data", [{}, {"enabled": None}, {"enabled": True, "description": "x" * 321}])
def test_feature_payload_validation(user, admin, completed, data):
    obj, url = share(user, completed)
    assert owner_client(admin).post(url + "featured/", data, format="json").status_code == 400
    assert not FeaturedAnalysis.objects.exists()


def test_private_and_stale_capabilities_cannot_be_used_to_curate(user, admin, completed):
    obj, url = share(user, completed)
    client = owner_client(admin)
    assert client.post(f"/api/shared/{obj.id}/featured/", {"enabled": True}, format="json").status_code == 404
    owner_client(user).post(f"/api/analyses/{obj.id}/sharing/", {"enabled": False}, format="json")
    assert client.post(url + "featured/", {"enabled": True}, format="json").status_code == 404


def test_public_gallery_paginates_and_filters_stale_selection(user, admin, completed):
    source, url = share(user, completed)
    for i in range(11):
        obj = AnalysisRequest.objects.create(user=user, name=f"Project {i}", aoi=source.aoi, date_start=source.date_start,
                                             date_end=source.date_end, status="COMPLETED", share_token=uuid.uuid4())
        AnalysisResult.objects.create(request=obj, clusters_geojson={}, statistics={})
        FeaturedAnalysis.objects.create(analysis=obj, share_token=obj.share_token, featured_by=admin)
    # Even a stale record created outside the sharing service cannot expose a private analysis.
    FeaturedAnalysis.objects.create(analysis=source, share_token=uuid.uuid4(), featured_by=admin)
    anonymous = APIClient()
    anonymous.credentials(HTTP_AUTHORIZATION="Token invalid-expired")
    first = anonymous.get("/api/featured/").data
    second = anonymous.get("/api/featured/?page=2").data
    assert first["count"] == 11 and len(first["results"]) == 9 and len(second["results"]) == 2
    assert {row["analysis_id"] for row in first["results"]}.isdisjoint(row["analysis_id"] for row in second["results"])
    assert source.pk not in [uuid.UUID(row["analysis_id"]) for row in first["results"] + second["results"]]


def test_deactivated_owner_and_missing_result_disappear(user, reader, admin, completed):
    obj, url = share(user, completed)
    owner_client(reader).post(url + "account/", {}, format="json")
    owner_client(admin).post(url + "featured/", {"enabled": True}, format="json")
    user.is_active = False
    user.save()
    assert APIClient().get("/api/featured/").data["count"] == 0
    assert owner_client(reader).get("/api/received/").data["results"][0]["available"] is False
    user.is_active = True
    user.save()
    obj.result.delete()
    assert APIClient().get("/api/featured/").data["count"] == 0
    assert owner_client(reader).get("/api/received/").data["results"][0]["available"] is False


def test_account_metadata_advertises_staff_without_superuser(admin):
    response = owner_client(admin).get("/api/auth/quota/")
    assert response.data["is_staff"] is True and response.data["is_superuser"] is False
