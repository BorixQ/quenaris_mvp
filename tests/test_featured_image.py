import io
import pytest
from PIL import Image
from rest_framework.test import APIClient
from django.core.files.uploadedfile import SimpleUploadedFile

from analysis.models import FeaturedAnalysis
from test_backend import user
from test_sharing import completed, enable, owner_client
from test_discovery import admin, reader

pytestmark = pytest.mark.django_db(transaction=True)


def picture():
    output = io.BytesIO()
    Image.new("RGB", (80, 60), "green").save(output, "PNG")
    return SimpleUploadedFile("sample.png", output.getvalue(), content_type="image/png")


def test_upload_public_thumbnail_replace_remove_and_revoke(user, admin, reader, completed):
    obj, _ = completed
    shared, _ = enable(user, obj)
    client = owner_client(admin)
    assert client.post(shared + "featured/", {"enabled": True, "description": "Proyecto"}, format="json").status_code == 200
    path = shared + "featured-image/"
    assert owner_client(reader).post(path, {"image": picture()}, format="multipart").status_code == 403
    assert APIClient().post(path, {"image": picture()}, format="multipart").status_code == 401
    response = client.post(path, {"image": picture()}, format="multipart")
    assert response.status_code == 200
    url = response.data["thumbnail_url"]
    image = APIClient().get(url)
    assert image.status_code == 200 and image["Content-Type"] == "image/webp" and "no-store" in image["Cache-Control"]
    assert Image.open(io.BytesIO(image.content)).size == (80, 60)
    assert APIClient().get('/api/featured/').data['results'][0]['thumbnail_url'] == url
    assert owner_client(user).get(f"/api/analyses/{obj.pk}/").data['thumbnail_url'] == url
    second = client.post(path, {"image": picture()}, format="multipart").data['thumbnail_url']
    assert second != url and APIClient().get(url).status_code == 404
    assert client.delete(path).data['thumbnail_url'] is None
    assert APIClient().get(second).status_code == 404
    third = client.post(path, {"image": picture()}, format="multipart").data['thumbnail_url']
    owner_client(user).post(f"/api/analyses/{obj.pk}/sharing/", {"enabled": False}, format="json")
    assert APIClient().get(third).status_code == 404
    assert not FeaturedAnalysis.objects.exists()


def test_reject_invalid_images_and_require_feature(user, admin, completed):
    obj, _ = completed
    shared, _ = enable(user, obj)
    client = owner_client(admin)
    path = shared + 'featured-image/'
    assert client.post(path, {'image': picture()}, format='multipart').status_code == 404
    client.post(shared + 'featured/', {'enabled': True}, format='json')
    bad = SimpleUploadedFile('photo.png', b'not an image', content_type='image/png')
    assert client.post(path, {'image': bad}, format='multipart').status_code == 400
    huge = SimpleUploadedFile('huge.png', b'x' * (2 * 1024 * 1024 + 1), content_type='image/png')
    assert client.post(path, {'image': huge}, format='multipart').status_code == 400
    assert FeaturedAnalysis.objects.get().thumbnail_data is None


def test_admin_can_upload_to_own_feature(user, completed):
    obj, _ = completed
    user.is_staff = True
    user.save(update_fields=['is_staff'])
    enable(user, obj)
    client = owner_client(user)
    client.post(f'/api/analyses/{obj.pk}/featured/', {'enabled': True}, format='json')
    result = client.post(f'/api/analyses/{obj.pk}/featured-image/', {'image': picture()}, format='multipart')
    assert result.status_code == 200 and APIClient().get(result.data['thumbnail_url']).status_code == 200
