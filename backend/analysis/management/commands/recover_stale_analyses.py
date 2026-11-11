from django.core.management.base import BaseCommand
from django.db.models.functions import Coalesce
from django.utils import timezone
from analysis.models import AnalysisRequest
from analysis.lifecycle import mark_failed, ATTEMPT_TIMEOUT


class Command(BaseCommand):
    help = "Recover stale pending/processing requests, after 35 minutes without a fresh attempt."
    def handle(self,*args,**options):
        cutoff = timezone.now()-ATTEMPT_TIMEOUT
        ids = list(AnalysisRequest.objects.filter(status__in=["PENDING","PROCESSING"])
            .annotate(last_activity=Coalesce("attempt_started_at","started_at","created_at"))
            .filter(last_activity__lt=cutoff).values_list("pk",flat=True))
        recovered = sum(mark_failed(pk,"El análisis agotó el plazo de recuperación.",stale_before=cutoff) for pk in ids)
        self.stdout.write(f"Recovered {recovered} stale analyses.")
