from django import forms
from django.contrib.gis import admin

from .models import AnalysisRequest, AnalysisResult


@admin.register(AnalysisRequest)
class AnalysisRequestAdmin(admin.GISModelAdmin):
    list_display = ("id", "user", "status", "date_start", "date_end", "created_at")
    list_filter = ("status", "algorithm")
    readonly_fields = ("celery_task_id", "last_enqueued_at", "created_at", "started_at", "finished_at", "status", "quota_charged", "charged_area_ha", "attempt_token", "attempt_started_at")


@admin.register(AnalysisResult)
class AnalysisResultAdmin(admin.GISModelAdmin):
    list_display = ("request", "images_used", "processing_seconds", "created_at")


from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from .models import GoogleAccessGrant, UserQuota


class LocalUserCreationForm(UserCreationForm):
    email = forms.EmailField(required=True, label="Correo electrónico")
    first_name = forms.CharField(max_length=150, required=True, label="Nombres")
    last_name = forms.CharField(max_length=150, required=True, label="Apellidos")

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("username", "email", "first_name", "last_name")

    def clean_username(self):
        username = super().clean_username()
        if User.objects.filter(email__iexact=username).exists():
            raise forms.ValidationError("Este usuario coincide con el correo de otra cuenta.")
        return username

    def clean_email(self):
        email = self.cleaned_data["email"].strip()
        if User.objects.filter(email__iexact=email).exists() or User.objects.filter(username__iexact=email).exists():
            raise forms.ValidationError("Este correo ya está asociado a otra cuenta.")
        return email

class UserQuotaInline(admin.StackedInline):
    model = UserQuota
    can_delete = False
    readonly_fields = ("area_used_ha",)
    verbose_name_plural = 'Límites y Cuotas de Uso'

class CustomUserAdmin(UserAdmin):
    add_form = LocalUserCreationForm
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("username", "email", "first_name", "last_name", "password1", "password2")}),)

    def get_inlines(self, request, obj=None):
        return (UserQuotaInline,) if obj else ()

# Re-registrar el UserAdmin
admin.site.unregister(User)
admin.site.register(User, CustomUserAdmin)

@admin.register(UserQuota)
class UserQuotaAdmin(admin.ModelAdmin):
    list_display = ("user", "area_used_ha", "area_allowance_ha", "analyses_used", "legacy_analysis_limit", "max_area_ha")
    readonly_fields = ("area_used_ha",)
    search_fields = ("user__username", "user__email")

    @admin.display(description="Límite por cantidad")
    def legacy_analysis_limit(self, obj):
        return obj.analyses_allowed if obj.area_allowance_ha is None else "No aplica"


from .models import GoogleIdentity
admin.site.register(GoogleIdentity)


class GoogleAccessGrantForm(forms.ModelForm):
    class Meta:
        model = GoogleAccessGrant
        fields = "__all__"

    def clean_user(self):
        user = self.cleaned_data["user"]
        if not user.email:
            raise forms.ValidationError("Primero registra el correo del usuario.")
        if User.objects.filter(email__iexact=user.email).exclude(pk=user.pk).exists():
            raise forms.ValidationError("El correo está duplicado; corrígelo antes de autorizar el acceso.")
        return user


@admin.register(GoogleAccessGrant)
class GoogleAccessGrantAdmin(admin.ModelAdmin):
    form = GoogleAccessGrantForm
    list_display = ("user", "email", "enabled")
    search_fields = ("user__username", "user__email")
    list_filter = ("enabled",)

    @admin.display(description="Correo")
    def email(self, obj):
        return obj.user.email
