"""Atomic ownership of attempts and one-time quota refunds."""
import uuid
from datetime import timedelta
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from .models import AnalysisRequest, UserQuota

ATTEMPT_TIMEOUT = timedelta(minutes=35)  # hard limit is 30 minutes


def claim_attempt(analysis_id):
    with transaction.atomic():
        obj = AnalysisRequest.objects.select_for_update().filter(pk=analysis_id).first()
        if obj is None or obj.status in ("COMPLETED","FAILED"):
            return None, None
        last = obj.attempt_started_at or obj.started_at or obj.created_at
        if obj.status == "PROCESSING" and last > timezone.now()-ATTEMPT_TIMEOUT:
            return None, None
        token = uuid.uuid4()
        obj.status, obj.attempt_token = "PROCESSING", token
        obj.attempt_started_at = timezone.now()
        obj.started_at = obj.started_at or obj.attempt_started_at
        obj.error_message = ""
        obj.save(update_fields=["status","attempt_token","attempt_started_at","started_at","error_message"])
        return obj, token


def mark_failed(analysis_id, message, *, attempt_token=None, pending_only=False, processing_only=False, stale_before=None):
    with transaction.atomic():
        obj = AnalysisRequest.objects.select_for_update().filter(pk=analysis_id).first()
        if obj is None or obj.status in ("COMPLETED","FAILED"):
            return False
        if attempt_token is not None and obj.attempt_token != attempt_token:
            return False
        if pending_only and obj.status != "PENDING":
            return False
        if processing_only and obj.status != "PROCESSING":
            return False
        last = obj.attempt_started_at or obj.started_at or obj.created_at
        if stale_before is not None and last >= stale_before:
            return False
        if obj.quota_charged:
            UserQuota.objects.filter(user_id=obj.user_id,analyses_used__gt=0).update(analyses_used=F("analyses_used")-1)
            obj.quota_charged = False
        obj.status, obj.error_message = "FAILED", message
        obj.finished_at, obj.attempt_token = timezone.now(), None
        obj.save(update_fields=["status","error_message","finished_at","quota_charged","attempt_token"])
        return True
