"""Small opt-in live EE audit; no LLM calls, database writes or credential copies."""
import argparse
import json
import os
import re
from pathlib import Path
import sys
import time
from datetime import datetime, timezone
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

# Public coordinate probes, NOT labelled ground truth or ecological inventories.
CASES = [
    ("agricultural_context_majes", -72.14, -16.32, "agro"),
    ("highland_context_chiguata", -71.39, -16.41, "reforestacion"),
    ("ocean_context", -72.10, -17.15, "agro"),
    ("misti_rock_context", -71.409, -16.294, "reforestacion"),
    ("urban_context_arequipa", -71.536, -16.398, "agro"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--start", default="2025-06-01")
    parser.add_argument("--end", default="2025-07-01", help="Exclusive date")
    args = parser.parse_args()
    report = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "status": "unavailable",
              "calibrated": False, "date_start": args.start, "date_end_exclusive": args.end,
              "scale_m": 20, "max_counted_requests": 30, "counted_requests": 0,
              "request_definition": "EE computeValue + getDownloadId; excludes auth, algorithm discovery and byte transfers",
              "cases": [], "note": "Coordinate contexts are unlabelled probes, not measured truth. No claim of agronomic accuracy."}
    key = os.environ.get("GEE_PRIVATE_KEY_FILE", "")
    project = os.environ.get("GEE_PROJECT", "quenaris-499120")
    account = os.environ.get("GEE_SERVICE_ACCOUNT", "")
    import ee
    has_service_key = bool(key and Path(key).is_file() and account)
    has_local_oauth = Path(ee.oauth.get_credentials_path()).is_file()
    if not project or not (has_service_key or has_local_oauth):
        report["reason"] = "Missing local Earth Engine OAuth credentials or service account key; no EE requests made."
        Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print("Earth Engine unavailable: local credentials/project not configured. Report written.")
        return 2
    from django.conf import settings
    if not settings.configured:
        settings.configure(GEE_PRIVATE_KEY_FILE=key, GEE_PROJECT=project, GEE_SERVICE_ACCOUNT=account if has_service_key else "")
    from analysis.gee_pipeline import run_pipeline
    original_value, original_download = ee.data.computeValue, ee.data.getDownloadId

    def counted(function):
        def call(*a, **kw):
            if report["counted_requests"] >= report["max_counted_requests"]:
                raise RuntimeError("Local EE request budget exhausted")
            report["counted_requests"] += 1
            return function(*a, **kw)
        return call

    with patch.object(ee.data, "computeValue", counted(original_value)), patch.object(ee.data, "getDownloadId", counted(original_download)):
        for name, lon, lat, study in CASES:
            # ~0.4 km wide; bounded transfers, no monthly raster generation.
            ring = [[lon-.002,lat-.002],[lon+.002,lat-.002],[lon+.002,lat+.002],[lon-.002,lat+.002],[lon-.002,lat-.002]]
            aoi = {"type": "Polygon", "coordinates": [ring]}
            row = {"name": name, "aoi": aoi, "study": study, "ground_truth": False}
            before, started = report["counted_requests"], time.monotonic()
            try:
                result = run_pipeline(aoi,args.start,args.end,n_clusters=3,study_type=study)
                row.update(status="completed", statistics=result["statistics"])
            except Exception as exc:
                # Avoid leaking key paths, tokens or signed URLs in persisted errors.
                message = re.sub(r"https?://\S+", "[URL omitted]", str(exc))
                if key:
                    message = message.replace(key, "[credential path omitted]")
                row.update(status="failed", error_type=type(exc).__name__, error_message=message[:1000])
            row.update(counted_requests=report["counted_requests"]-before, elapsed_seconds=round(time.monotonic()-started,2))
            report["cases"].append(row)
    report["status"] = "executed"  # individual failures remain visible
    Path(args.output).write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print("Live cases recorded. Inspect per-case status; execution is not validation of accuracy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
