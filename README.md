# GeoInsight — SaaS de análisis geoespacial

Plataforma web donde un usuario autenticado dibuja un Área de Interés (AOI) sobre un
mapa, elige un rango de fechas, y recibe un informe ejecutivo generado por un LLM,
respaldado por clustering satelital (Sentinel-2 vía Google Earth Engine) y una vista
3D con relieve, ortomosaico de dron y las zonas clasificadas superpuestas.

## Arquitectura

```
┌────────────┐    POST /api/analyses (202)   ┌─────────────┐
│  Frontend  │ ─────────────────────────────▶│   Django    │
│  MapLibre  │ ◀───── polling GET ───────────│  (web/API)  │
└────────────┘                               └──────┬──────┘
      │ vista 3D (viewer3d.html)                     │ .delay()
      ▼                                              ▼
  relieve + ortomosaico + clusters          ┌─────────────┐   ┌─────────┐
                                            │   Redis     │◀──│ Celery  │
                                            │  (broker)   │   │ worker  │
                                            └─────────────┘   └────┬────┘
                                                                   │
                              GEE (Sentinel-2) → NDVI/EVI/pendiente/irradiación
                              → scikit-learn (K-Means/DBSCAN) → GeoJSON + stats
                              → LLM → informe → PostGIS
```

Servicios en `docker-compose.yml`: **db** (PostGIS), **redis**, **web** (Django+Gunicorn),
**worker** (Celery), **frontend** (Nginx).

## Puesta en marcha

```bash
cp .env.example .env          # completar credenciales
# Colocar la service-account de GEE:
docker volume create gee_credentials
# copiar gee-sa-key.json dentro del volumen (o montar un bind en docker-compose)

docker compose up --build -d
docker compose exec web python manage.py createsuperuser
```

- Dashboard: http://localhost:8080
- API / admin: http://localhost:8000/admin

## Entregables y dónde están

| # | Entregable | Archivo |
|---|------------|---------|
| 1 | Infraestructura | `docker-compose.yml`, `backend/Dockerfile`, `deploy/nginx.conf` |
| 2 | Modelos BD | `backend/analysis/models.py` (GeoDjango + PostGIS) |
| 3 | Pipeline DS (worker) | `backend/analysis/gee_pipeline.py`, `backend/analysis/tasks.py` |
| 4 | LLM | `backend/analysis/llm_report.py` |
| 5 | Integración 3D | `frontend/viewer3d.js` (+ `viewer3d.html`) |

## Notas de producción

- **Cuota GEE**: el AOI está limitado a 50 km² (validación en el serializer) y la
  concurrencia del worker es baja; ajusta según tu cuota de Earth Engine.
- **Ortomosaico de dron**: genera teselas XYZ con `gdal2tiles.py orthomosaic.tif`
  y sírvelas en `/media/tiles/ortho/{z}/{x}/{y}.png` (ya referenciado en el viewer).
- **DEM**: el viewer usa Terrarium públicos como demo; sustituye por tu DEM (p. ej.
  un DSM del propio vuelo de dron) para máxima fidelidad.
- **Auth**: el frontend asume un Token DRF en `window.API_TOKEN`. Implementa el login
  (TokenAuth o sesión) según tu flujo. En producción, Nginx ya proxya `/api` al mismo
  origen para evitar CORS.
- **Seguridad**: nunca commitees `.env` ni la clave de la service account.
```
