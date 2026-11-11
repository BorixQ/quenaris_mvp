"""
Tarea Celery — recibe el ID de la petición, ejecuta el pipeline GEE,
genera el informe factual y persiste el resultado. El frontend hace polling
sobre /api/analyses/<id>/ hasta ver status=COMPLETED.
"""
import json
import logging

from celery import shared_task
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from django.utils import timezone

from django.conf import settings
from django.db import transaction

from .gee_pipeline import run_pipeline
from .heatmap import generate_heatmaps
from .llm_report import generate_report
from .models import AnalysisRequest, AnalysisResult
from .lifecycle import mark_failed, claim_attempt

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
)
def run_geospatial_analysis(self, analysis_id: str) -> str:
    analysis, attempt = claim_attempt(analysis_id)
    if analysis is None:
        return "IGNORED"

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

        # 5. Informe factual. Si el informe falla, no perdemos el análisis.
        try:
            report_md = generate_report(result_data["statistics"])
        except Exception:
            logger.exception("Fallo en la generación del informe factual")
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
                study_type=analysis.study_type,
                indices=analysis.indices,
                scoring_reference=result_data["statistics"]["scoring_reference"],
                artifact_attempt=str(attempt),
            )
        except Exception:
            logger.exception("Fallo generando los mapas de calor")
            heatmap_layers = None

        # Geometría disuelta de clusters para consultas PostGIS
        clusters_geom = _featurecollection_to_multipolygon(result_data["clusters_geojson"])

        with transaction.atomic():
            analysis = AnalysisRequest.objects.select_for_update().filter(pk=analysis_id).first()
            if analysis is None or analysis.status != "PROCESSING" or analysis.attempt_token != attempt:
                return "IGNORED"
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
            analysis.attempt_token = None
            analysis.save(update_fields=["status", "finished_at", "attempt_token"])
        return "COMPLETED"

    except (ConnectionError, TimeoutError) as exc:
        if self.request.retries < self.max_retries:
            AnalysisRequest.objects.filter(pk=analysis_id,attempt_token=attempt,status="PROCESSING").update(
                status=AnalysisRequest.Status.PENDING, attempt_token=None, error_message="Error temporal; reintentando.")
            raise self.retry(exc=exc, countdown=getattr(settings, "ANALYSIS_RETRY_DELAY", 30))
        mark_failed(analysis_id, "Falló el análisis tras agotar los reintentos.", attempt_token=attempt)
        raise
    except Exception:
        logger.exception("Pipeline falló para %s", analysis_id)
        mark_failed(analysis_id, "No se pudo completar el análisis. Revisa datos y configuración.", attempt_token=attempt)
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


@shared_task(ignore_result=True)
def recover_stale_requests():
    from django.core.management import call_command
    call_command("recover_stale_analyses")
