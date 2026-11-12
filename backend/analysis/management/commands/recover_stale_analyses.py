import logging
import uuid

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models.functions import Coalesce
from django.utils import timezone

from analysis.lifecycle import ATTEMPT_TIMEOUT, mark_failed
from analysis.models import AnalysisRequest

logger = logging.getLogger(__name__)


def requeue_pending(analysis_id, cutoff):
    """Republish a potentially lost task without treating a long queue as failure."""
    from analysis.tasks import run_geospatial_analysis

    try:
        with transaction.atomic():
            obj = AnalysisRequest.objects.select_for_update().filter(pk=analysis_id).first()
            if obj is None or obj.status != AnalysisRequest.Status.PENDING:
                return False
            last = max(value for value in (obj.created_at, obj.attempt_started_at, obj.last_enqueued_at) if value is not None)
            if last >= cutoff:
                return False
            obj.celery_task_id = obj.celery_task_id or str(uuid.uuid4())
            obj.last_enqueued_at = timezone.now()
            obj.save(update_fields=["celery_task_id", "last_enqueued_at"])
            # Repeated deliveries are safe: the worker claims attempts atomically.
            # Holding the row lock prevents concurrent recovery from publishing twice.
            run_geospatial_analysis.apply_async(args=[str(obj.pk)], task_id=obj.celery_task_id, retry=False)
        return True
    except Exception:
        logger.exception("No se pudo reencolar el análisis pendiente %s", analysis_id)
        return False


class Command(BaseCommand):
    help = "Recover stalled processing attempts and republish old pending analyses."

    def handle(self, *args, **options):
        cutoff = timezone.now() - ATTEMPT_TIMEOUT
        processing = list(AnalysisRequest.objects.filter(status=AnalysisRequest.Status.PROCESSING)
            .annotate(last_activity=Coalesce("attempt_started_at", "started_at", "created_at"))
            .filter(last_activity__lt=cutoff).values_list("pk", flat=True))
        failed = sum(mark_failed(pk, "El análisis agotó el plazo de recuperación.",
                                 processing_only=True, stale_before=cutoff) for pk in processing)
        pending = list(AnalysisRequest.objects.filter(status=AnalysisRequest.Status.PENDING)
            .annotate(last_publication=Coalesce("last_enqueued_at", "attempt_started_at", "created_at"))
            .filter(last_publication__lt=cutoff).values_list("pk", flat=True))
        requeued = sum(requeue_pending(pk, cutoff) for pk in pending)
        self.stdout.write(f"Recovered {failed} processing analyses; republished {requeued} pending analyses.")
