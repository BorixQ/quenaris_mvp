"""
Modelos GeoDjango — almacenan el AOI del usuario, el ciclo de vida de la
tarea asíncrona y los resultados (clusters GeoJSON, estadísticas, informe LLM).
"""
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.contrib.gis.db import models as gis_models
from django.db import models


class AnalysisRequest(models.Model):
    """Una petición de análisis: polígono + rango de fechas + estado de la tarea."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pendiente"
        PROCESSING = "PROCESSING", "Procesando"
        COMPLETED = "COMPLETED", "Completado"
        FAILED = "FAILED", "Fallido"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="analysis_requests",
    )

    # Nombre dado por el usuario para identificar/reutilizar el análisis.
    name = models.CharField(max_length=120, blank=True, default="")

    # Null means private. Revoking removes the capability; enabling again issues
    # a fresh link so a previously shared URL never silently becomes valid again.
    share_token = models.UUIDField(null=True, unique=True, editable=False)

    # Área de Interés. SRID 4326 (WGS84) — el estándar de GeoJSON.
    aoi = gis_models.PolygonField(srid=4326, help_text="Polígono GeoJSON dibujado por el usuario")

    date_start = models.DateField()
    date_end = models.DateField()

    # Parámetros del pipeline (opcionales, con defaults sensatos)
    n_clusters = models.PositiveSmallIntegerField(default=4)
    algorithm = models.CharField(
        max_length=16,
        choices=[("kmeans", "K-Means"), ("dbscan", "DBSCAN"), ("hdbscan", "HDBSCAN")],
        default="kmeans",
    )
    # Tipo de estudio (preset de índices) y override opcional de índices.
    study_type = models.CharField(max_length=20, default="agro")
    indices = models.JSONField(null=True, blank=True)
    use_pca = models.BooleanField(default=False)  # reduce colinealidad pre-clustering

    # Ciclo de vida
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    celery_task_id = models.CharField(max_length=64, blank=True, default="")
    last_enqueued_at = models.DateTimeField(null=True, editable=False)
    quota_charged = models.BooleanField(default=False)
    charged_area_ha = models.DecimalField(max_digits=14, decimal_places=4, null=True, editable=False)
    attempt_token = models.UUIDField(null=True, editable=False)
    attempt_started_at = models.DateTimeField(null=True, editable=False)
    error_message = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "status"])]

    def __str__(self):
        return f"Analysis {self.id} [{self.status}]"

    @property
    def area_ha(self) -> float:
        """Área aproximada en hectáreas (transforma a proyección métrica)."""
        geom = self.aoi.transform(6933, clone=True)
        return round(geom.area / 10_000, 2)


class AnalysisResult(models.Model):
    """Resultado del pipeline: clusters vectoriales + estadísticas + informe."""

    request = models.OneToOneField(
        AnalysisRequest, on_delete=models.CASCADE, related_name="result"
    )

    # Zonas clasificadas. Cada feature lleva properties: cluster_id, label,
    # ndvi_mean, area_ha... Se guarda como JSONB para servirlo tal cual al frontend.
    clusters_geojson = models.JSONField(help_text="FeatureCollection con las zonas clusterizadas")

    # También se persiste la geometría disuelta por cluster para poder hacer
    # consultas espaciales en PostGIS (ej. intersección con otras capas).
    clusters_geom = gis_models.MultiPolygonField(srid=4326, null=True, blank=True)

    # JSON estadístico resumido — el que se inyecta al LLM.
    statistics = models.JSONField(help_text="Estadísticas resumidas por cluster e índice")

    # Informe ejecutivo redactado por el LLM (markdown).
    report_markdown = models.TextField(blank=True, default="")

    # Capas de mapa de calor temporal: {bounds, indices, timesteps, url_template, ranges}
    # Los PNG colorizados se guardan en MEDIA_ROOT/heatmaps/<id>/<index>/<YYYY-MM>.png
    heatmap_layers = models.JSONField(null=True, blank=True)

    # Metadatos de procedencia
    satellite_collection = models.CharField(max_length=64, default="COPERNICUS/S2_SR_HARMONIZED")
    images_used = models.PositiveIntegerField(default=0)
    cloud_cover_max = models.FloatField(default=20.0)
    processing_seconds = models.FloatField(default=0.0)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Result for {self.request_id}"


class ReceivedAnalysis(models.Model):
    """A link explicitly saved by its recipient; saving never extends access."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="received_analyses")
    analysis = models.ForeignKey(AnalysisRequest, on_delete=models.CASCADE, related_name="recipients")
    share_token = models.UUIDField(editable=False)
    name = models.CharField(max_length=120, blank=True, default="")
    saved_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-saved_at", "-pk"]
        constraints = [models.UniqueConstraint(fields=["user", "analysis"], name="received_user_analysis_unique")]


class FeaturedAnalysis(models.Model):
    """An administrator's public selection, bound to the current shared link."""
    analysis = models.OneToOneField(AnalysisRequest, on_delete=models.CASCADE, related_name="feature")
    share_token = models.UUIDField(editable=False)
    description = models.CharField(max_length=320, blank=True, default="")
    thumbnail_data = models.BinaryField(null=True, editable=False)
    thumbnail_version = models.UUIDField(null=True, editable=False)
    featured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, editable=False)
    featured_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-featured_at", "-pk"]


class UserQuota(models.Model):
    """Límites de uso y cuotas asignadas a un usuario."""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="quota"
    )
    analyses_allowed = models.PositiveIntegerField(default=1, help_text="Solo se aplica si el saldo de hectáreas está vacío")
    analyses_used = models.PositiveIntegerField(default=0, help_text="Número histórico de análisis completados o reservados")
    max_area_ha = models.FloatField(default=10.0, help_text="Área máxima permitida por análisis en hectáreas")
    max_date_range_days = models.PositiveIntegerField(default=124, help_text="Rango máximo de fechas en días")
    area_allowance_ha = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True, default=Decimal("10"), validators=[MinValueValidator(Decimal("0"))], help_text="Saldo total de hectáreas; vacío conserva la cuota por cantidad de análisis")
    area_used_ha = models.DecimalField(max_digits=14, decimal_places=4, default=Decimal("0"), editable=False, help_text="Hectáreas consumidas o reservadas")

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(area_allowance_ha__gte=0) | models.Q(area_allowance_ha__isnull=True), name="quota_area_allowance_nonnegative"),
            models.CheckConstraint(condition=models.Q(area_used_ha__gte=0), name="quota_area_used_nonnegative"),
        ]

    def __str__(self):
        return f"Quota for {self.user.username}: {self.analyses_used}/{self.analyses_allowed}"

# Señal para crear UserQuota automáticamente cuando se crea un User
from django.db.models.signals import post_save
from django.dispatch import receiver

@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_quota(sender, instance, created, **kwargs):
    if created:
        UserQuota.objects.get_or_create(user=instance, defaults={"area_allowance_ha": None} if instance.is_staff or instance.is_superuser else {})


class GoogleIdentity(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="google_identity")
    subject = models.CharField(max_length=255, unique=True)


class GoogleAccessGrant(models.Model):
    """Explicit administrator approval for a local user to link Google."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="google_access_grant")
    enabled = models.BooleanField(default=True, verbose_name="Acceso habilitado")

    class Meta:
        verbose_name = "autorización de acceso con Google"
        verbose_name_plural = "autorizaciones de acceso con Google"

    def __str__(self):
        return f"Google: {self.user}"


class EmailIdentity(models.Model):
    """An email address verified specifically for passwordless sign-in."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="email_identity")
    email = models.CharField(max_length=254, unique=True)


class EmailLoginChallenge(models.Model):
    """A short-lived, single-use email code; the code itself is never stored."""
    email = models.CharField(max_length=254, unique=True)
    code_digest = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    last_sent_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
