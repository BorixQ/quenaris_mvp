"""Ephemeral browser fixtures. Output is piped to the test process, never saved."""
import json
import os
import secrets
import sys
import uuid
from pathlib import Path

if os.environ.get("INTEGRATION_TEST_ENV") != "1":
    raise SystemExit("Use only the isolated compose.integration.yml tests service.")

sys.path.insert(0,"/app")
os.environ.setdefault("DJANGO_SETTINGS_MODULE","config.settings")
import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Polygon
from rest_framework.authtoken.models import Token
from analysis.models import AnalysisRequest, AnalysisResult
from PIL import Image

if "--reset-login-throttle" in sys.argv:
    # Repeated UI suites share one proxy IP. Reset only its login-IP counters
    # inside the isolated cache DB, without touching tokens or Celery queues.
    from django.core.cache import cache
    from redis import Redis
    client = Redis.from_url(settings.CACHES["default"]["LOCATION"])
    for key in client.scan_iter(match=cache.make_key("throttle_login_ip_*")):
        client.delete(key)
    client.close()

password = secrets.token_urlsafe(24)
owner = get_user_model().objects.create_user(username="browser_"+uuid.uuid4().hex[:12],password=password)
other = get_user_model().objects.create_user(username="other_"+uuid.uuid4().hex[:12],password=secrets.token_urlsafe(24))
staff_password = secrets.token_urlsafe(24)
staff = get_user_model().objects.create_superuser(username="admin_"+uuid.uuid4().hex[:12],password=staff_password)
request = AnalysisRequest.objects.create(user=owner,name='<img src=x onerror="window.__storedXss=1">',
    aoi=Polygon.from_bbox((-72.141,-16.321,-72.139,-16.319)),date_start="2025-06-01",date_end="2025-06-15",status="COMPLETED")
url = f"/media/heatmaps/{request.pk}/ndvi/2025-06.png"
AnalysisResult.objects.create(request=request,clusters_geojson={"type":"FeatureCollection","features":[]},
    statistics={"calibrated":False,"science_version":"browser-test","clusters":[],"indices_used":["NDVI"]},
    heatmap_layers={"indices":["ndvi"],"timesteps":["2025-06"],"url_template":f"/media/heatmaps/{request.pk}/{{index}}/{{timestep}}.png",
                    "bounds":[-72.141,-16.321,-72.139,-16.319]})
path = Path(settings.MEDIA_ROOT)/"heatmaps"/str(request.pk)/"ndvi"/"2025-06.png"
path.parent.mkdir(parents=True,exist_ok=True)
Image.new("RGBA",(64,64),(40,120,80,255)).save(path)
print(json.dumps({"username":owner.username,"password":password,"image_url":url,"analysis_id":str(request.pk),
    "other_token":Token.objects.create(user=other).key,"admin_username":staff.username,"admin_password":staff_password}))
