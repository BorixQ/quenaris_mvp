#!/usr/bin/env bash
# Run interactively as the homelab owner, not as root. The release is a git
# archive made from the exact main commit that passed CI.
set -Eeuo pipefail
umask 077

app_dir=${QUENARIS_APP_DIR:-/home/bq/quenaris}
release=${1:?Uso: bash deploy-homelab.sh /ruta/version.tar SHA256_DE_ARCHIVO SHA_DEL_COMMIT}
expected_archive_hash=${2:?Falta SHA256 del archivo}
commit=${3:?Falta SHA completo del commit de main}
[[ "$expected_archive_hash" =~ ^[0-9a-f]{64}$ && "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Identificador inválido.' >&2; exit 1; }
[[ -f "$release" && -d "$app_dir/.git" && -f "$app_dir/.env" ]] || { echo 'Falta la versión o la instalación esperada.' >&2; exit 1; }
[[ "$(sha256sum "$release" | cut -d ' ' -f 1)" == "$expected_archive_hash" ]] || { echo 'El archivo no coincide con su SHA256.' >&2; exit 1; }
if tar -tf "$release" | grep -Eq '(^/|(^|/)\.\.(/|$)|(^|/)(\.git|\.env|credentials|compose\.override\.yml)(/|$))'; then
  echo 'El archivo contiene rutas no permitidas.' >&2; exit 1
fi

cd "$app_dir"
git fetch --quiet origin main
[[ "$(git rev-parse refs/remotes/origin/main)" == "$commit" ]] || { echo 'La versión no coincide con main en GitHub.' >&2; exit 1; }
previous_commit=$(git rev-parse HEAD)
backup_root="${QUENARIS_BACKUP_DIR:-$HOME/quenaris-deploy-backups}"
backup="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}"
mkdir -p "$backup"
compose=(sudo docker compose)

echo 'Se necesita sudo para respaldar y actualizar Docker. Introduce la contraseña solo en esta terminal.'
sudo -v
"${compose[@]}" config --quiet
count_active() {
  "${compose[@]}" exec -T db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"' sh "SELECT count(*) FROM analysis_analysisrequest WHERE status IN ('PENDING','PROCESSING')"
}
[[ "$(count_active)" == 0 ]] || { echo 'Hay análisis pendientes o en proceso. Espera a que terminen.' >&2; exit 1; }

echo 'Guardando configuración de código e imágenes actuales...'
tar -C "$app_dir" -czf "$backup/source-before.tar.gz" --exclude='./.git' --exclude='./.env*' --exclude='./credentials' --exclude='node_modules' --exclude='__pycache__' .
printf '%s\n' "$previous_commit" > "$backup/commit-before.txt"
{
  echo 'services:'
  for service in web worker admin beat frontend; do
    container=$("${compose[@]}" ps -q "$service")
    [[ -n "$container" ]] || { echo "No se encontró el contenedor $service." >&2; exit 1; }
    image=$(sudo docker inspect --format '{{.Image}}' "$container")
    tag="quenaris-rollback-${service}:$(basename "$backup" | tr '[:upper:]' '[:lower:]')"
    sudo docker image tag "$image" "$tag"
    printf '  %s:\n    image: %s\n' "$service" "$tag"
  done
} > "$backup/rollback-images.yml"

on_error() {
  echo "La actualización no terminó. La copia previa está en $backup" >&2
  echo 'Restaurando código y arrancando las imágenes anteriores; la base no se restaura automáticamente.' >&2
  tar -C "$app_dir" -xzf "$backup/source-before.tar.gz" || true
  git reset --mixed "$previous_commit" >/dev/null || true
  "${compose[@]}" -f docker-compose.yml -f compose.override.yml -f "$backup/rollback-images.yml" up -d --no-build --no-deps web worker admin beat frontend || true
  echo 'Comprueba el estado de los servicios y el sitio antes de volver a intentarlo.' >&2
}
trap on_error ERR

echo 'Pausando el acceso público para comprobar de nuevo los trabajos...'
"${compose[@]}" stop frontend
if [[ "$(count_active)" != 0 ]]; then
  "${compose[@]}" start frontend
  trap - ERR
  echo 'Entró un análisis durante la pausa. Espera a que termine y vuelve a intentarlo.' >&2
  exit 1
fi
"${compose[@]}" stop worker beat

echo 'Guardando la base y comprobando que el respaldo se pueda leer...'
"${compose[@]}" exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database-before.dump"
sudo docker exec -i "$("${compose[@]}" ps -q db)" pg_restore --list < "$backup/database-before.dump" > "$backup/database-contents.txt"

echo 'Instalando y compilando la versión verificada...'
git reset --mixed "$commit" >/dev/null
tar -C "$app_dir" -xf "$release"
"${compose[@]}" build web worker admin beat frontend
"${compose[@]}" up -d --no-deps --wait web
"${compose[@]}" up -d --no-deps worker admin beat frontend
curl --fail --silent --show-error --retry 8 --retry-delay 2 --retry-connrefused http://127.0.0.1:8080/api/health/ > /dev/null
trap - ERR
echo "Actualización terminada. Versión: $commit"
echo "Copia local y referencias de reversión: $backup"
echo 'Comprueba https://quenaris.tech y el acceso privado al administrador.'
