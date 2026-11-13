import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from analysis.models import AnalysisRequest, AnalysisResult
from test_backend import charged_request, user

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def completed(user, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    obj = charged_request(user)
    obj.status = "COMPLETED"
    obj.save(update_fields=["status"])
    AnalysisResult.objects.create(
        request=obj, clusters_geojson={"type": "FeatureCollection", "features": []},
        statistics={"calibrated": False, "warnings": ["Sin calibración de campo."]},
        report_markdown="Resultado exploratorio.",
        heatmap_layers={"indices": ["ndvi"], "timesteps": ["2025-06"],
                        "url_template": f"/media/heatmaps/{obj.id}/{{index}}/{{timestep}}.png"},
    )
    path = tmp_path / "heatmaps" / str(obj.id) / "ndvi" / "2025-06.png"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\nshared-test")
    return obj, path


def owner_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def enable(user, obj):
    response = owner_client(user).post(f"/api/analyses/{obj.id}/sharing/", {"enabled": True}, format="json")
    assert response.status_code == 200
    obj.refresh_from_db()
    return f"/api/shared/{obj.share_token}/", response


def test_default_private_and_only_owner_can_toggle(user, completed):
    obj, _ = completed
    endpoint = f"/api/analyses/{obj.id}/sharing/"
    assert obj.share_token is None
    assert APIClient().post(endpoint, {"enabled": True}, format="json").status_code == 401
    assert APIClient().get(f"/api/shared/{obj.id}/").status_code == 404
    other = get_user_model().objects.create_superuser(username="other", password="test-only-password")
    assert owner_client(other).post(endpoint, {"enabled": True}, format="json").status_code == 404
    obj.refresh_from_db()
    assert obj.share_token is None
    private = owner_client(user).get(f"/api/analyses/{obj.id}/").data
    assert private["sharing_enabled"] is False and private["share_path"] is None


def test_anonymous_read_allowlist_and_no_cache(user, completed):
    obj, _ = completed
    url, enabled = enable(user, obj)
    assert enabled.data == {"sharing_enabled": True, "share_path": f"/compartido/{obj.share_token}"}
    assert obj.share_token != obj.id
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Token expired-or-invalid")
    response = client.get(url)
    assert response.status_code == 200
    assert set(response.data) == {
        "id", "name", "aoi", "area_ha", "date_start", "date_end", "n_clusters", "algorithm",
        "study_type", "indices", "use_pca", "status", "created_at", "finished_at", "result",
    }
    assert response.data["result"]["statistics"]["calibrated"] is False
    assert response.data["result"]["heatmap_layers"]["url_template"] == url + "heatmaps/{index}/{timestep}.png"
    assert "no-store" in response["Cache-Control"]
    assert "noindex" in response["X-Robots-Tag"]
    assert response["Referrer-Policy"] == "no-referrer"
    assert client.get(f"/api/analyses/{obj.id}/").status_code == 401


def test_revocation_also_blocks_png_and_reenable_rotates(user, completed):
    obj, _ = completed
    url, _ = enable(user, obj)
    image_url = url + "heatmaps/ndvi/2025-06.png"
    response = APIClient().get(image_url)
    assert response.status_code == 200
    assert "no-store" in response["Cache-Control"]
    assert b"shared-test" in b"".join(response.streaming_content)
    response.close()
    endpoint = f"/api/analyses/{obj.id}/sharing/"
    owner = owner_client(user)
    disabled = owner.post(endpoint, {"enabled": False}, format="json")
    assert disabled.data == {"sharing_enabled": False, "share_path": None}
    assert APIClient().get(url).status_code == 404
    assert APIClient().get(image_url).status_code == 404
    new_url, _ = enable(user, obj)
    assert new_url != url and APIClient().get(new_url).status_code == 200
    assert APIClient().get(url).status_code == 404
    assert APIClient().get(image_url).status_code == 404
    # Retiring the shared link does not change the owner's private access.
    assert owner.get(f"/media/heatmaps/{obj.id}/ndvi/2025-06.png").status_code == 200


def test_enable_is_idempotent_and_does_not_charge_quota(user, completed):
    obj, _ = completed
    before = (user.quota.analyses_used, user.quota.area_used_ha)
    first, _ = enable(user, obj)
    second, _ = enable(user, obj)
    assert first == second
    user.quota.refresh_from_db()
    assert (user.quota.analyses_used, user.quota.area_used_ha) == before


@pytest.mark.parametrize("state", ["PENDING", "PROCESSING", "FAILED", "COMPLETED"])
def test_cannot_enable_incomplete_or_missing_result(user, state):
    obj = charged_request(user)
    obj.status = state
    obj.save()
    response = owner_client(user).post(f"/api/analyses/{obj.id}/sharing/", {"enabled": True}, format="json")
    assert response.status_code == 409
    obj.refresh_from_db()
    assert obj.share_token is None


@pytest.mark.parametrize("body", [{}, {"enabled": None}, {"enabled": "invalid"}])
def test_toggle_requires_valid_explicit_value(user, completed, body):
    obj, _ = completed
    assert owner_client(user).post(f"/api/analyses/{obj.id}/sharing/", body, format="json").status_code == 400


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_shared_routes_are_read_only(user, completed, method):
    obj, _ = completed
    url, _ = enable(user, obj)
    client = APIClient()
    assert getattr(client, method)(url, {}, format="json").status_code == 405
    assert getattr(client, method)(url + "heatmaps/ndvi/2025-06.png", {}, format="json").status_code == 405
    obj.refresh_from_db()
    assert obj.status == "COMPLETED" and obj.share_token is not None


@pytest.mark.parametrize("attempt", [None, "new"])
def test_shared_png_validates_manifest_and_attempt(user, completed, attempt):
    obj, path = completed
    if attempt:
        token = str(uuid.uuid4())
        result = obj.result
        result.heatmap_layers["artifact_attempt"] = token
        result.save()
        new_path = path.parents[1] / token / "ndvi" / path.name
        new_path.parent.mkdir(parents=True)
        path.rename(new_path)
    url, _ = enable(user, obj)
    client = APIClient()
    response = client.get(url + "heatmaps/ndvi/2025-06.png")
    assert response.status_code == 200
    response.close()
    for suffix in ["ndvi/2024-01.png", "other/2025-06.png", "ndvi/../../secret.png"]:
        assert client.get(url + "heatmaps/" + suffix).status_code == 404
    assert client.get(f"/media/heatmaps/{obj.id}/ndvi/2025-06.png").status_code == 401


def test_link_stops_after_owner_deactivation_or_analysis_deletion(user, completed):
    obj, _ = completed
    url, _ = enable(user, obj)
    user.is_active = False
    user.save()
    assert APIClient().get(url).status_code == 404
    user.is_active = True
    user.save()
    assert owner_client(user).delete(f"/api/analyses/{obj.id}/").status_code == 204
    assert not AnalysisRequest.objects.filter(pk=obj.id).exists()
    assert APIClient().get(url).status_code == 404
