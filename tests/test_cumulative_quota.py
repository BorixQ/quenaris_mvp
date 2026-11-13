import json
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

import pytest
from celery.exceptions import Retry
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Polygon
from django.db import close_old_connections
from rest_framework.test import APIClient

from analysis.lifecycle import mark_failed
from analysis.models import AnalysisRequest
from analysis.tasks import run_geospatial_analysis

pytestmark = pytest.mark.django_db(transaction=True)


def area_payload(width, height):
    polygon = Polygon.from_bbox((0, 0, width, height))
    polygon.srid = 6933
    polygon.transform(4326)
    return {"name": "saldo", "aoi": json.loads(polygon.geojson), "date_start": "2025-01-01",
            "date_end": "2025-05-05", "study_type": "agro", "n_clusters": 3}


def test_area_accumulates_across_analyses_and_completed_delete_does_not_refund():
    user = get_user_model().objects.create_user(username="area-user")
    client = APIClient(); client.force_authenticate(user)
    with patch("analysis.views.run_geospatial_analysis.apply_async", return_value=Mock()):
        first = client.post('/api/analyses/', area_payload(100, 300), format='json')
        assert first.status_code == 202
        entry = AnalysisRequest.objects.get(pk=first.data['id'])
        user.quota.refresh_from_db()
        assert user.quota.area_used_ha == Decimal('3.0000')
        assert entry.charged_area_ha == user.quota.area_used_ha
        response = client.get('/api/auth/quota/')
        assert response.data['area_remaining_ha'] == 7.0
        assert response.data['max_date_range_days'] == 124
        AnalysisRequest.objects.filter(pk=entry.pk).update(status='COMPLETED')
        second = client.post('/api/analyses/', area_payload(100, 300), format='json')
        assert second.status_code == 202  # same terrain is charged on each use
        second_entry = AnalysisRequest.objects.get(pk=second.data['id'])
        user.quota.refresh_from_db()
        assert user.quota.analyses_used == 2
        assert user.quota.area_used_ha == entry.charged_area_ha + second_entry.charged_area_ha
        AnalysisRequest.objects.filter(pk=second_entry.pk).update(status='COMPLETED')
        assert client.delete(f'/api/analyses/{entry.pk}/').status_code == 204
        user.quota.refresh_from_db()
        assert user.quota.area_used_ha == entry.charged_area_ha + second_entry.charged_area_ha
        too_much = client.post('/api/analyses/', area_payload(200, 300), format='json')
        assert too_much.status_code == 400 and 'saldo disponible' in str(too_much.data)


def test_failure_refunds_area_exactly_once_and_retry_keeps_budget():
    user = get_user_model().objects.create_user(username="area-refund")
    client = APIClient(); client.force_authenticate(user)
    with patch("analysis.views.run_geospatial_analysis.apply_async", return_value=Mock()):
        result = client.post('/api/analyses/', area_payload(100, 300), format='json')
    assert result.status_code == 202
    entry = AnalysisRequest.objects.get(pk=result.data['id'])
    user.quota.refresh_from_db(); assert user.quota.area_used_ha == entry.charged_area_ha
    with patch('analysis.tasks.run_pipeline', side_effect=ConnectionError), patch.object(run_geospatial_analysis, 'retry', side_effect=Retry):
        with pytest.raises(Retry):
            run_geospatial_analysis.run(str(entry.pk))
    entry.refresh_from_db(); user.quota.refresh_from_db()
    assert entry.status == 'PENDING' and entry.quota_charged and user.quota.area_used_ha == entry.charged_area_ha
    assert mark_failed(entry.pk, 'fallo temporal agotado') is True
    assert mark_failed(entry.pk, 'duplicado') is False
    user.quota.refresh_from_db()
    assert user.quota.area_used_ha == 0 and user.quota.analyses_used == 0
    with patch("analysis.views.run_geospatial_analysis.apply_async", side_effect=ConnectionError):
        failed = client.post('/api/analyses/', area_payload(100, 300), format='json')
    assert failed.status_code == 503
    user.quota.refresh_from_db(); assert user.quota.area_used_ha == 0


def test_failure_of_a_pre_migration_request_does_not_refund_the_new_balance():
    user = get_user_model().objects.create_user(username="old-request")
    user.quota.area_used_ha = Decimal('3'); user.quota.analyses_used = 1
    user.quota.save(update_fields=['area_used_ha', 'analyses_used'])
    data = area_payload(100, 300)
    polygon = Polygon.from_bbox((0, 0, .001, .001)); polygon.srid = 4326
    data.pop('aoi')
    entry = AnalysisRequest.objects.create(user=user, aoi=polygon, quota_charged=True, charged_area_ha=None, **data)
    assert mark_failed(entry.pk, 'fallo de trabajo previo')
    user.quota.refresh_from_db()
    assert user.quota.area_used_ha == Decimal('3') and user.quota.analyses_used == 0


def test_tiny_area_reserves_at_least_one_square_metre():
    from analysis.quota import chargeable_area
    polygon = Polygon.from_bbox((0, 0, 1, .4)); polygon.srid = 6933; polygon.transform(4326)
    assert chargeable_area(polygon) == Decimal('0.0001')


def test_missing_admin_quota_is_recreated_without_trial_area_limit():
    user = get_user_model().objects.create_superuser(username='admin-without-quota', password='test-password-long')
    user.quota.delete()
    client = APIClient(); client.force_authenticate(user)
    response = client.get('/api/auth/quota/')
    assert response.status_code == 200 and response.data['area_allowance_ha'] is None


def test_concurrent_failure_refunds_one_area_reservation_once():
    user = get_user_model().objects.create_user(username="area-refund-race")
    client = APIClient(); client.force_authenticate(user)
    with patch("analysis.views.run_geospatial_analysis.apply_async", return_value=Mock()):
        result = client.post('/api/analyses/', area_payload(100, 300), format='json')
    assert result.status_code == 202
    def fail():
        close_old_connections()
        try:
            return mark_failed(result.data['id'], 'fallo concurrente')
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: fail(), range(2)))
    user.quota.refresh_from_db()
    assert sorted(outcomes) == [False, True]
    assert user.quota.area_used_ha == 0 and user.quota.analyses_used == 0


def test_parallel_submissions_cannot_spend_area_twice():
    user = get_user_model().objects.create_user(username="area-concurrent")
    user.quota.area_allowance_ha = Decimal('5'); user.quota.save(update_fields=['area_allowance_ha'])
    def submit():
        close_old_connections()
        try:
            client = APIClient(); client.force_authenticate(get_user_model().objects.get(pk=user.pk))
            return client.post('/api/analyses/', area_payload(100, 300), format='json').status_code
        finally:
            close_old_connections()
    with patch("analysis.views.run_geospatial_analysis.apply_async", return_value=Mock()):
        with ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(lambda _: submit(), range(2)))
    user.quota.refresh_from_db()
    assert sorted(result) == [202, 400]
    assert user.quota.area_used_ha <= Decimal('5')
