from django.contrib.gis import admin

from .models import AnalysisRequest, AnalysisResult


@admin.register(AnalysisRequest)
class AnalysisRequestAdmin(admin.GISModelAdmin):
    list_display = ("id", "user", "status", "date_start", "date_end", "created_at")
    list_filter = ("status", "algorithm")
    readonly_fields = ("celery_task_id", "created_at", "started_at", "finished_at")


@admin.register(AnalysisResult)
class AnalysisResultAdmin(admin.GISModelAdmin):
    list_display = ("request", "images_used", "processing_seconds", "created_at")
