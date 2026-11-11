"""Real HTTP → Redis → Celery → EE → PostGIS smoke test inside integration Compose."""
import argparse
import json
import os
import secrets
import sys
import time
import uuid
from datetime import datetime, timezone

if os.environ.get("INTEGRATION_TEST_ENV") != "1":
    raise SystemExit("Use only the isolated compose.integration.yml tests service.")

sys.path.insert(0, "/app")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
import requests
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from analysis.models import AnalysisRequest

BASE = os.environ.get("INTEGRATION_BASE_URL", "http://frontend")


def wait(session, analysis_id):
    deadline = time.monotonic() + 360
    while time.monotonic() < deadline:
        response = session.get(f"{BASE}/api/analyses/{analysis_id}/", timeout=10)
        response.raise_for_status()
        data = response.json()
        if data["status"] in ("COMPLETED", "FAILED"):
            return data
        time.sleep(1)
    raise TimeoutError("Analysis did not reach terminal state in 360 seconds")


def verify(session, analysis_id):
    data = wait(session, analysis_id)
    assert data["status"] == "COMPLETED", data.get("error_message")
    result = data["result"]
    assert result["statistics"]["calibrated"] is False
    assert "Sin calibración de campo" in result["report_markdown"]
    assert all(c["differential"] == [] for c in result["statistics"]["clusters"])
    layers = result["heatmap_layers"]
    assert layers and layers["scoring_reference"] == result["statistics"]["scoring_reference"]
    url = layers["url_template"].replace("{index}","suitability").replace("{timestep}",layers["timesteps"][0])
    png = session.get(BASE+url, timeout=10)
    assert png.status_code == 200 and png.content.startswith(b"\x89PNG")
    assert session.get(BASE+"/admin/",timeout=10).status_code == 404
    assert session.get(BASE+"/static/admin/css/base.css",timeout=10).status_code == 404
    admin_url = os.environ.get("INTEGRATION_ADMIN_URL","http://admin:8000")
    assert session.get(admin_url+"/static/admin/css/base.css",timeout=10).status_code == 200
    assert requests.get(BASE+url,timeout=10).status_code == 401
    assert "no-store" in png.headers.get("Cache-Control","")
    return {"analysis_id":analysis_id,"status":data["status"],"png_bytes":len(png.content),
            "images_used":result["images_used"],"clusters":result["statistics"]["n_clusters"],
            "heatmap_indices":layers["indices"],"legend_layers":len(layers.get("legends",{})),"science_version":result["statistics"]["science_version"],"private_media_enforced":True,"public_admin_blocked":True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", help="Verify a previous smoke analysis after container recreation")
    args = parser.parse_args()
    session = requests.Session()
    assert session.get(BASE+"/api/health/", timeout=10).status_code == 200
    assert session.get(BASE+"/api/analyses/",timeout=10).status_code == 401
    assert "Quenaris" in session.get(BASE+"/login",timeout=10).text
    if args.verify:
        analysis = AnalysisRequest.objects.get(pk=args.verify)
        token = Token.objects.get(user=analysis.user)
        session.headers["Authorization"] = "Token " + token.key
        report = verify(session,args.verify)
        report["persistence_after_recreation"] = True
    else:
        username, password = "smoke_"+uuid.uuid4().hex[:12], secrets.token_urlsafe(24)
        user = get_user_model().objects.create_user(username=username,password=password)
        quota = user.quota
        quota.analyses_allowed, quota.max_area_ha = 2, 100
        quota.save()
        login = session.post(BASE+"/api/auth/token/",json={"username":username,"password":password},timeout=10)
        assert login.status_code == 200
        session.headers["Authorization"] = "Token "+login.json()["token"]
        def submit(lon,lat):
            ring = [[lon-.001,lat-.001],[lon+.001,lat-.001],[lon+.001,lat+.001],[lon-.001,lat+.001],[lon-.001,lat-.001]]
            response = session.post(BASE+"/api/analyses/",json={"name":"integration-smoke",
                "aoi":{"type":"Polygon","coordinates":[ring]},"date_start":"2025-06-01",
                "date_end":"2025-06-15","study_type":"agro","n_clusters":3},timeout=15)
            assert response.status_code == 202, response.text[:300]
            return response.json()["id"]
        analysis_id = submit(-72.14,-16.32)
        report = verify(session,analysis_id)
        assert report["legend_layers"] == len(report["heatmap_indices"])
        failed = wait(session,submit(-72.10,-17.15))
        assert failed["status"] == "FAILED"
        quota.refresh_from_db()
        assert quota.analyses_used == 1, quota.analyses_used
        report.update(ocean_rejected=True, quota_after_failure=quota.analyses_used)
        # Leave only these isolated test records to verify persistence after restart.
    report["timestamp_utc"] = datetime.now(timezone.utc).isoformat()
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == "__main__":
    main()
