"""
Modelos GeoDjango — almacenan el AOI del usuario, el ciclo de vida de la
tarea asíncrona y los resultados (clusters GeoJSON, estadísticas, informe LLM).
"""
import uuid

from django.conf import settings
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
        geom = self.aoi.transform(3857, clone=True)
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
