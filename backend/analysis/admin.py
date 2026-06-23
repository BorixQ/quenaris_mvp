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


from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.models import User
from .models import UserQuota

class UserQuotaInline(admin.StackedInline):
    model = UserQuota
    can_delete = False
    verbose_name_plural = 'Límites y Cuotas de Uso'

class CustomUserAdmin(UserAdmin):
    inlines = (UserQuotaInline,)

# Re-registrar el UserAdmin
admin.site.unregister(User)
admin.site.register(User, CustomUserAdmin)

@admin.register(UserQuota)
class UserQuotaAdmin(admin.ModelAdmin):
    list_display = ("user", "analyses_used", "analyses_allowed", "max_area_ha")
    search_fields = ("user__username", "user__email")
