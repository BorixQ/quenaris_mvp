"""Synthetic sharing preview; only runs in the isolated integration service."""
import json
import os
import secrets
import sys
import uuid
from pathlib import Path

if os.environ.get("INTEGRATION_TEST_ENV") != "1":
    raise SystemExit("Use only compose.integration.yml tests; this creates synthetic local data.")

sys.path.insert(0, "/app")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Polygon
from PIL import Image
from analysis.models import AnalysisRequest, AnalysisResult

password = secrets.token_urlsafe(24)
owner = get_user_model().objects.create_user(
    username="compartir_" + uuid.uuid4().hex[:10], password=password, first_name="Demostración local",
)
bounds = [-72.1404, -16.3204, -72.1396, -16.3196]
aoi = Polygon.from_bbox(bounds)
aoi.srid = 4326
obj = AnalysisRequest.objects.create(
    user=owner, name="Demostración · compartir análisis", aoi=aoi,
    date_start="2025-06-01", date_end="2025-08-01", status="COMPLETED", study_type="agro",
)
clusters = []
for cluster_id, (west, east, score) in enumerate([(bounds[0], -72.14, 35), (-72.14, bounds[2], 65)]):
    clusters.append({
        "type": "Feature", "geometry": {"type": "Polygon", "coordinates": [
            [[west, bounds[1]], [east, bounds[1]], [east, bounds[3]], [west, bounds[3]], [west, bounds[1]]],
        ]},
        "properties": {"cluster_id": cluster_id, "label": f"Grupo {cluster_id + 1}", "suitability_mean": score},
    })
area = obj.area_ha
AnalysisResult.objects.create(
    request=obj, clusters_geojson={"type": "FeatureCollection", "features": clusters}, images_used=0,
    statistics={
        "calibrated": False, "science_version": "demo-sharing-v1", "area_geometry_clipped": True,
        "warnings": ["Datos simulados para probar compartir. No corresponden a un análisis real de Seal."],
        "n_clusters": 2, "total_area_ha": area, "suitability_global_mean": 50, "analysis_scale_m": 20,
        "quality": {"valid_fraction": 1, "valid_pixels": 20}, "indices_used": ["NDVI"],
        "clusters": [
            {"cluster_id": i, "area_ha": area / 2, "suitability_mean": score, "ndvi_mean": ndvi, "priority": "Media"}
            for i, score, ndvi in [(0, 35, .3), (1, 65, .6)]
        ],
    },
    report_markdown="## Demostración local\n\nDatos simulados para comprobar el acceso por enlace y su desactivación.\n\nNo representan un estudio real de Seal ni una evaluación agronómica.",
    heatmap_layers={
        "indices": ["ndvi"], "timesteps": ["2025-06", "2025-07"], "bounds": bounds,
        "url_template": f"/media/heatmaps/{obj.id}/{{index}}/{{timestep}}.png",
        "ranges": {"ndvi": {"vmin": -1, "vmax": 1}},
        "legends": {"ndvi": {"vmin": -1, "vmax": 1, "colors": ["#a50026", "#ffffbf", "#006837"]}},
    },
)
for month in ["2025-06", "2025-07"]:
    path = Path(settings.MEDIA_ROOT) / "heatmaps" / str(obj.id) / "ndvi" / (month + ".png")
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (96, 96))
    image.putdata([(55 + x, 110 + y, 65, 255) for y in range(96) for x in range(96)])
    image.save(path)
payload = {"username": owner.username, "password": password, "analysis_id": str(obj.id)}
if "--discovery" in sys.argv:
    import copy
    admin_password, reader_password = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    admin = get_user_model().objects.create_user(
        username="curador_" + uuid.uuid4().hex[:10], password=admin_password,
        first_name="Administración local", is_staff=True,
    )
    reader = get_user_model().objects.create_user(
        username="visitante_" + uuid.uuid4().hex[:10], password=reader_password, first_name="Visitante local",
    )
    suffix = owner.username[-4:]
    obj.name = f"Demostración · territorio compartido {suffix}"
    obj.save(update_fields=["name"])
    own = AnalysisRequest.objects.create(
        user=admin, name=f"Demostración · proyecto administrativo {suffix}", aoi=aoi,
        date_start=obj.date_start, date_end=obj.date_end, status="COMPLETED", study_type="reforestacion",
    )
    result = obj.result
    layers = copy.deepcopy(result.heatmap_layers)
    layers["url_template"] = layers["url_template"].replace(str(obj.id), str(own.id))
    AnalysisResult.objects.create(
        request=own, clusters_geojson=copy.deepcopy(result.clusters_geojson),
        statistics=copy.deepcopy(result.statistics), heatmap_layers=layers,
        report_markdown=result.report_markdown, images_used=0,
    )
    for month in layers["timesteps"]:
        target = Path(settings.MEDIA_ROOT) / "heatmaps" / str(own.id) / "ndvi" / (month + ".png")
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target)
    payload.update({"analysis_name": obj.name,
                    "admin": {"username": admin.username, "password": admin_password, "analysis_id": str(own.id), "analysis_name": own.name},
                    "reader": {"username": reader.username, "password": reader_password}})
print(json.dumps(payload))
