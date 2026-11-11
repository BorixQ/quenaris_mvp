"""Persist only version and migration metadata, never environment or credentials."""
import importlib.metadata
import json
import os
import platform
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.contrib.gis.gdal import gdal_version

with connection.cursor() as cursor:
    cursor.execute("SELECT version(), postgis_full_version()")
    postgres, postgis = cursor.fetchone()
packages = ["Django", "djangorestframework", "djangorestframework-gis", "celery", "redis", "psycopg",
            "numpy", "scikit-learn", "rasterio", "geopandas", "Pillow", "earthengine-api", "xgboost-cpu"]
print(json.dumps({"timestamp_utc":datetime.now(timezone.utc).isoformat(),"python":platform.python_version(),
    "packages":{name:importlib.metadata.version(name) for name in packages}, "postgres":postgres,
    "postgis":postgis,"gdal_client":gdal_version().decode(),
    "applied_analysis_migrations":list(MigrationRecorder.Migration.objects.filter(app="analysis")
                                       .order_by("name").values_list("name",flat=True))},indent=2))
