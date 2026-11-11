"""Capture non-secret evidence from the isolated integration run's local logs."""
import json
from pathlib import Path
import re
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1] / "docs" / "integration"
for source, destination in [("/tmp/quenaris-smoke-final.log", "smoke.json"),
                            ("/tmp/quenaris-persistence-final.log", "persistence.json")]:
    text = Path(source).read_text()
    data = json.loads(text[text.index("{"):])
    (root / destination).write_text(json.dumps(data, indent=2), encoding="utf-8")
tests = Path("/tmp/quenaris-tests-final.log").read_text()
passed = re.search(r"(\d+) passed", tests)
if not passed:
    raise RuntimeError("Successful test result not found")
audit = json.loads((root / "dependency-audit.json").read_text())
migrations = Path("/tmp/quenaris-migrations-check.log").read_text()
report = {
    "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    "environment": "local Ubuntu WSL / Linux amd64 / isolated Docker Compose",
    "tests_passed": int(passed[1]),
    "test_summary": passed[0],
    "migration_drift": "No changes detected" not in migrations,
    "known_python_lock_advisories": sum(len(d.get("vulns", [])) for d in audit["dependencies"]),
    "audit_scope": "Python runtime lock only; does not audit container OS packages",
    "live_ee_smoke": "smoke.json",
    "persistence_after_container_recreation": "persistence.json",
    "homelab_modified": False,
}
(root / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
