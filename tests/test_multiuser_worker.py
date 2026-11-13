"""Exercise real broker/worker scheduling without Earth Engine or production data."""
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

import pytest
from celery.contrib.testing.worker import start_worker
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.test import APIClient

from analysis.models import AnalysisRequest
from analysis.lifecycle import claim_attempt
from analysis.tasks import run_geospatial_analysis
from config.celery import app
from test_backend import payload


@pytest.mark.django_db(transaction=True)
def test_one_worker_processes_simultaneous_users_serially():
    queue = f"test-multiuser-{uuid.uuid4()}"
    users = [get_user_model().objects.create_user(username=f"worker-user-{i}") for i in range(10)]
    for user in users:
        user.quota.max_area_ha = 100
        user.quota.area_allowance_ha = 100
        user.quota.save(update_fields=["max_area_ha", "area_allowance_ha"])

    started, release = threading.Event(), threading.Event()
    running, peak = 0, 0
    claims = []
    lock = threading.Lock()

    def simulated_pipeline(**_kwargs):
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        started.set()
        try:
            if not release.wait(30):
                raise TimeoutError("Simulated processing was not released")
            return {"statistics": {"scoring_reference": {"profiles": {}}},
                    "clusters_geojson": {"type": "FeatureCollection", "features": []},
                    "images_used": 1, "processing_seconds": 0.0}
        finally:
            with lock:
                running -= 1

    publish = run_geospatial_analysis.apply_async
    def publish_to_test_queue(*args, **kwargs):
        return publish(*args, **kwargs, queue=queue)

    def recorded_claim(analysis_id):
        result = claim_attempt(analysis_id)
        with lock:
            claims.append((analysis_id, result[0] is not None))
        return result

    def submit(user_id):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(get_user_model().objects.get(pk=user_id))
            return client.post("/api/analyses/", payload(), format="json").status_code
        finally:
            close_old_connections()

    with patch("analysis.views.run_geospatial_analysis.apply_async", side_effect=publish_to_test_queue), \
         patch("analysis.tasks.run_pipeline", side_effect=simulated_pipeline), \
         patch("analysis.tasks.claim_attempt", side_effect=recorded_claim), \
         patch("analysis.tasks.generate_report", return_value=""), \
         patch("analysis.tasks.generate_heatmaps", return_value=None):
        with ThreadPoolExecutor(max_workers=10) as pool:
            assert list(pool.map(submit, [user.pk for user in users])) == [202] * len(users)

        try:
            with start_worker(app, pool="solo", concurrency=1, queues=[queue], perform_ping_check=False):
                assert started.wait(10), "The isolated worker did not start a task"
                states = list(AnalysisRequest.objects.filter(user__in=users).values_list("status", flat=True))
                assert sorted(states) == ["PENDING"] * 9 + ["PROCESSING"]
                queued = AnalysisRequest.objects.filter(user__in=users, status="PENDING").first()
                old = timezone.now() - timedelta(minutes=40)
                AnalysisRequest.objects.filter(pk=queued.pk).update(created_at=old, last_enqueued_at=old)
                call_command("recover_stale_analyses")
                queued.refresh_from_db()
                assert queued.status == "PENDING" and queued.quota_charged
                assert queued.last_enqueued_at > old
                release.set()
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    if AnalysisRequest.objects.filter(user__in=users, status="COMPLETED").count() == len(users) and len(claims) >= len(users) + 1:
                        break
                    time.sleep(.05)
                assert AnalysisRequest.objects.filter(user__in=users, status="COMPLETED").count() == len(users)
                assert sum(1 for analysis_id, acquired in claims if analysis_id == str(queued.pk) and acquired) == 1
                assert sum(1 for analysis_id, _ in claims if analysis_id == str(queued.pk)) == 2
                assert peak == 1
        finally:
            release.set()
