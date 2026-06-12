"""
Tarea Celery — recibe el ID de la petición, ejecuta el pipeline GEE,
genera el informe LLM y persiste el resultado. El frontend hace polling
sobre /api/analyses/<id>/ hasta ver status=COMPLETED.
"""
import json
import logging

from celery import shared_task
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from django.utils import timezone

from django.conf import settings

from .gee_pipeline import run_pipeline
from .heatmap import generate_heatmaps
from .llm_report import generate_report
from .models import AnalysisRequest, AnalysisResult

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    autoretry_for=(ConnectionError, TimeoutError),
    retry_backoff=30,
    max_retries=2,
)
def run_geospatial_analysis(self, analysis_id: str) -> str:
    analysis = AnalysisRequest.objects.get(id=analysis_id)
    analysis.status = AnalysisRequest.Status.PROCESSING
    analysis.started_at = timezone.now()
    analysis.save(update_fields=["status", "started_at"])

    try:
        # 1-4. Pipeline GEE + clustering
        aoi_geojson = json.loads(analysis.aoi.geojson)
        result_data = run_pipeline(
            aoi_geojson=aoi_geojson,
            date_start=analysis.date_start.isoformat(),
            date_end=analysis.date_end.isoformat(),
            algorithm=analysis.algorithm,
            n_clusters=analysis.n_clusters,
            study_type=analysis.study_type,
            indices=analysis.indices,
            use_pca=analysis.use_pca,
        )

        # 5. Informe ejecutivo (LLM). Si el LLM falla, no perdemos el análisis.
        try:
            report_md = generate_report(result_data["statistics"])
        except Exception:
            logger.exception("Fallo en la generación del informe LLM")
            report_md = ""

        # Mapa de calor temporal de índices (rásters PNG). No es crítico: si falla,
        # el análisis se completa igualmente sin la capa de heatmap.
        try:
            heatmap_layers = generate_heatmaps(
                aoi_geojson=aoi_geojson,
                date_start=analysis.date_start.isoformat(),
                date_end=analysis.date_end.isoformat(),
                analysis_id=str(analysis.id),
                media_root=settings.MEDIA_ROOT,
            )
        except Exception:
            logger.exception("Fallo generando los mapas de calor")
            heatmap_layers = None

        # Geometría disuelta de clusters para consultas PostGIS
        clusters_geom = _featurecollection_to_multipolygon(result_data["clusters_geojson"])

        AnalysisResult.objects.update_or_create(
            request=analysis,
            defaults={
                "clusters_geojson": result_data["clusters_geojson"],
                "clusters_geom": clusters_geom,
                "statistics": result_data["statistics"],
                "report_markdown": report_md,
                "heatmap_layers": heatmap_layers,
                "images_used": result_data["images_used"],
                "processing_seconds": result_data["processing_seconds"],
            },
        )

        analysis.status = AnalysisRequest.Status.COMPLETED
        analysis.finished_at = timezone.now()
        analysis.save(update_fields=["status", "finished_at"])
        return "COMPLETED"

    except Exception as exc:
        logger.exception("Pipeline falló para %s", analysis_id)
        analysis.status = AnalysisRequest.Status.FAILED
        analysis.error_message = str(exc)[:2000]
        analysis.finished_at = timezone.now()
        analysis.save(update_fields=["status", "error_message", "finished_at"])
        raise


def _featurecollection_to_multipolygon(fc: dict) -> MultiPolygon | None:
    """Une todas las geometrías de la FeatureCollection en un MultiPolygon."""
    polys = []
    for feature in fc.get("features", []):
        geom = GEOSGeometry(json.dumps(feature["geometry"]), srid=4326)
        if geom.geom_type == "Polygon":
            polys.append(geom)
        elif geom.geom_type == "MultiPolygon":
            polys.extend(list(geom))
    return MultiPolygon(polys, srid=4326) if polys else None
