#!/usr/bin/env bash
# Offline safety checks: all docker/sudo/curl operations below are simulated.
set -Eeuo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/bin" "$temp/source" "$temp/backups"

cat > "$temp/bin/sudo" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == -v ]]; then exit 0; fi
exec "$@"
EOF
cat > "$temp/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$1" == inspect ]]; then echo sha256:existing; exit 0; fi
if [[ "$1" == exec ]]; then cat >/dev/null; echo dump-readable; exit 0; fi
if [[ "$1" != compose ]]; then exit 0; fi
case " $* " in
  *' ps -q '*) echo container-1 ;;
  *' exec -T db '*psql*) echo "${FAKE_ACTIVE:-0}" ;;
  *' exec -T db '*pg_dump*) echo mock-database ;;
  *' build '*) [[ "${FAKE_FAIL_BUILD:-0}" != 1 ]] ;;
esac
EOF
cat > "$temp/bin/curl" <<'EOF'
#!/usr/bin/env bash
count=0
[[ ! -f "$FAKE_CURL_COUNTER" ]] || count=$(cat "$FAKE_CURL_COUNTER")
count=$((count + 1))
printf '%s\n' "$count" > "$FAKE_CURL_COUNTER"
[[ "$count" -gt "${FAKE_CURL_FAILURES:-0}" ]] || exit 56
EOF
chmod +x "$temp/bin/"*
export PATH="$temp/bin:$PATH" FAKE_DOCKER_LOG="$temp/docker.log" FAKE_CURL_COUNTER="$temp/curl-count"
git -C "$temp/source" init -q -b main
git -C "$temp/source" config user.email test@example.invalid
git -C "$temp/source" config user.name Test
printf 'old\n' > "$temp/source/app.txt"
git -C "$temp/source" add app.txt
git -C "$temp/source" commit -qm old
git clone -q --bare "$temp/source" "$temp/origin.git"
git clone -q "$temp/origin.git" "$temp/app"
git -C "$temp/source" remote add origin "$temp/origin.git"
printf 'new\n' > "$temp/source/app.txt"
git -C "$temp/source" commit -qam new
git -C "$temp/source" push -q origin main
commit=$(git -C "$temp/source" rev-parse HEAD)
git -C "$temp/source" archive --format=tar -o "$temp/release.tar" "$commit"
hash=$(sha256sum "$temp/release.tar" | cut -d' ' -f1)
printf 'private-config\n' > "$temp/app/.env"
printf 'local-override\n' > "$temp/app/compose.override.yml"
mkdir -p "$temp/app/credentials"
printf 'private-credential\n' > "$temp/app/credentials/key"
export QUENARIS_APP_DIR="$temp/app" QUENARIS_BACKUP_DIR="$temp/backups"

# Existing jobs must block before stopping the frontend or changing code.
if FAKE_ACTIVE=1 bash "$repo/scripts/deploy-homelab.sh" "$temp/release.tar" "$hash" "$commit" > "$temp/active.out" 2>&1; then
  echo 'Expected active analysis to block deployment' >&2; exit 1
fi
[[ "$(cat "$temp/app/app.txt")" == old ]]
! grep -q 'stop frontend' "$FAKE_DOCKER_LOG"

# A failed build must restore previous source and use the rollback images.
if FAKE_FAIL_BUILD=1 bash "$repo/scripts/deploy-homelab.sh" "$temp/release.tar" "$hash" "$commit" > "$temp/fail.out" 2>&1; then
  echo 'Expected simulated build failure' >&2; exit 1
fi
[[ "$(cat "$temp/app/app.txt")" == old ]]
grep -q 'rollback-images.yml up -d --no-build' "$FAKE_DOCKER_LOG"

# A good deployment must preserve server-only configuration and credentials.
sleep 1
FAKE_CURL_FAILURES=2 bash "$repo/scripts/deploy-homelab.sh" "$temp/release.tar" "$hash" "$commit" > "$temp/success.out" 2>&1 || { cat "$temp/success.out"; exit 1; }
[[ "$(cat "$temp/app/app.txt")" == new ]]
[[ "$(cat "$FAKE_CURL_COUNTER")" -eq 3 ]]
[[ "$(cat "$temp/app/.env")" == private-config ]]
[[ "$(cat "$temp/app/compose.override.yml")" == local-override ]]
[[ "$(cat "$temp/app/credentials/key")" == private-credential ]]
echo 'Deployment simulations passed: active job, rollback, transient connection errors and successful update.'
