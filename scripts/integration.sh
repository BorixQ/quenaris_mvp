#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Compose reads GEE_OAUTH_DIRECTORY and the public Google client ID from .env or
# the shell environment; the volume definition checks that the OAuth path exists.
compose=(docker compose -f compose.integration.yml)
case "${1:-unit}" in
  build) "${compose[@]}" build web tests frontend ;;
  start) "${compose[@]}" up -d --wait db redis web worker frontend admin beat ;;
  unit)
    "${compose[@]}" up -d --wait db redis
    "${compose[@]}" run --rm --no-deps tests python -m pytest -q -o cache_dir=/tmp/pytest-cache
    ;;
  smoke)
    "${compose[@]}" up -d --wait db redis web worker frontend admin beat
    "${compose[@]}" run --rm --no-deps tests python scripts/integration_smoke.py
    ;;
  verify)
    "${compose[@]}" run --rm --no-deps tests python scripts/integration_smoke.py --verify "${2:?Pass previous analysis UUID}"
    ;;
  audit)
    "${compose[@]}" run --rm --no-deps tests pip-audit --disable-pip --no-deps -r /app/requirements.txt -f json
    ;;
  stop) "${compose[@]}" down ;;
  *) echo "Usage: bash scripts/integration.sh {build|start|unit|smoke|verify UUID|audit|stop}" >&2; exit 2 ;;
esac
