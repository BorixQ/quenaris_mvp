# 🚀 Despliegue en un VPS Ubuntu

Guía paso a paso para publicar Quenaris en un servidor Ubuntu con Docker, un dominio y HTTPS automático (Caddy). Tiempo estimado: 30–45 min.

---

## 0 · Requisitos

- Un **VPS con Ubuntu 22.04/24.04** (Hetzner, DigitalOcean, Vultr, Linode…).
  Recomendado: **2 vCPU / 4 GB RAM** mínimo (el worker procesa rásters y entrena XGBoost; con 2 GB puede quedarse corto). Disco ≥ 25 GB.
- Un **dominio** apuntando al VPS (un registro `A` con la IP del servidor). Ej: `quenaris.tudominio.com`.
- La **clave JSON** de tu service account de Google Earth Engine.
- Tu **API key** de DeepSeek (o el proveedor LLM que uses).

---

## 1 · Conectarse y preparar el sistema

```bash
ssh root@TU_IP_DEL_VPS

# Actualizar e instalar utilidades
apt update && apt upgrade -y
apt install -y git ufw

# (Opcional pero recomendado) crear un usuario no-root
adduser quenaris
usermod -aG sudo quenaris
# Repetir el resto como ese usuario si lo prefieres
```

---

## 2 · Instalar Docker y Docker Compose

```bash
curl -fsSL https://get.docker.com | sh
# Permitir usar docker sin sudo (si usas un usuario no-root)
usermod -aG docker $USER
newgrp docker

docker --version
docker compose version
```

---

## 3 · Firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

> No abras el 8000 ni el 8080 al exterior: en producción todo el tráfico entra por Caddy (80/443).

---

## 4 · Clonar el proyecto

```bash
cd /opt
git clone https://github.com/TU_USUARIO/quenaris.git
cd quenaris
```

---

## 5 · Configurar secretos

```bash
cp .env.example .env
nano .env
```

Completa con valores de **producción**:

```env
DJANGO_SECRET_KEY=<clave-aleatoria-larga>      # genera una nueva
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=quenaris.tudominio.com

POSTGRES_DB=quenaris
POSTGRES_USER=quenaris
POSTGRES_PASSWORD=<password-fuerte>

GEE_SERVICE_ACCOUNT=sa@proyecto.iam.gserviceaccount.com
GEE_PRIVATE_KEY_FILE=/credentials/gee-sa-key.json
GEE_PROJECT=<id-proyecto-gcp>

LLM_API_KEY=<tu-api-key>
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
```

Coloca la clave de Earth Engine:

```bash
mkdir -p credentials
nano credentials/gee-sa-key.json   # pega el contenido del JSON, guarda
```

Genera una `DJANGO_SECRET_KEY` segura:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

---

## 6 · Ajustar dominio en la configuración

Edita `backend/config/settings.py` y añade tu dominio a los orígenes de confianza (o hazlo por variables si las parametrizaste):

```python
CSRF_TRUSTED_ORIGINS = ["https://quenaris.tudominio.com"]
CORS_ALLOWED_ORIGINS = ["https://quenaris.tudominio.com"]
```

---

## 7 · HTTPS con Caddy (reverse proxy)

Caddy obtiene y renueva el certificado TLS automáticamente. Crea dos archivos.

**`Caddyfile`** (en la raíz del proyecto):

```
quenaris.tudominio.com {
    reverse_proxy frontend:80
}
```

**`docker-compose.prod.yml`** (override para producción):

```yaml
services:
  # Caddy termina TLS y enruta al frontend (que ya proxya /api y /media)
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [frontend]
    networks: [backend_net]

  # El frontend deja de exponer el puerto al host (Caddy entra por delante)
  frontend:
    ports: !reset []

volumes:
  caddy_data:
  caddy_config:
```

> El `!reset []` quita el `ports` del frontend definido en el compose base, para que solo Caddy escuche en 80/443.

---

## 8 · Levantar todo

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec web python manage.py makemigrations analysis
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser
```

Valida las credenciales de GEE:

```bash
docker compose exec worker python manage.py check_gee
```

Visita **https://quenaris.tudominio.com** — Caddy ya debería haber emitido el certificado.

---

## 9 · Comprobaciones

```bash
docker compose ps                          # los 6 servicios Up (incl. caddy)
docker compose logs --tail=50 web
docker compose logs --tail=50 worker
```

---

## 🔧 Mantenimiento

**Actualizar a una versión nueva del repo:**

```bash
cd /opt/quenaris
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec web python manage.py migrate
docker compose restart frontend            # ⚠️ ver nota sobre IP de nginx abajo
```

**Backup de la base de datos:**

```bash
docker compose exec db pg_dump -U quenaris quenaris > backup_$(date +%F).sql
```

**Restaurar:**

```bash
cat backup.sql | docker compose exec -T db psql -U quenaris quenaris
```

---

## 🩺 Problemas frecuentes (aprendidos en el MVP)

| Síntoma | Causa | Solución |
|---|---|---|
| **502 Bad Gateway** tras recrear `web` | nginx cacheó la IP vieja del contenedor | `docker compose restart frontend` |
| **500** al crear análisis, `relation ... does not exist` | falta migrar | `migrate` (y `makemigrations analysis` si añadiste modelos) |
| **password authentication failed** tras cambiar `POSTGRES_PASSWORD` | Postgres solo aplica la pass al **inicializar** el volumen | `ALTER USER` en el contenedor `db`, o recrear el volumen si no hay datos |
| **Project not registered to use Earth Engine** | falta registrar el proyecto en EE | [code.earthengine.google.com/register](https://code.earthengine.google.com/register) |
| **Caller does not have permission** (GEE) | falta rol IAM | añadir *Service Usage Consumer* a la service account |
| El `.env` cambió pero no surte efecto | `restart` no relee `.env` | `docker compose up -d --force-recreate <servicio>` |
| Análisis sin panel de índices | la generación de heatmaps falló | revisar `docker compose logs worker` |

---

## ✅ Checklist de producción

- [ ] `DJANGO_DEBUG=0`
- [ ] `DJANGO_ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` y `CORS_ALLOWED_ORIGINS` con el dominio real
- [ ] `DJANGO_SECRET_KEY` y `POSTGRES_PASSWORD` fuertes y únicos
- [ ] HTTPS activo (Caddy) — nunca exponer el login por HTTP plano
- [ ] Firewall: solo 22/80/443
- [ ] `.env` y `credentials/` **fuera** de git
- [ ] Cuotas vigiladas: Earth Engine y API del LLM tienen costo por uso
- [ ] Backups periódicos de PostGIS
