<div align="center">

# 🛰️ Quenaris

**Inteligencia geoespacial para agricultura de precisión, energía solar y minería.**

*El campo no es uniforme. Sus datos tampoco deberían serlo.*

</div>

---

Quenaris convierte imágenes satelitales multiespectrales (Sentinel-2) en **decisiones por zona**: calcula más de 20 índices ecofisiológicos, topográficos y de salinidad, los combina en un **score de aptitud multicriterio (0–100)**, segmenta el terreno en **zonas priorizadas** mediante machine learning, y entrega un **informe ejecutivo redactado por IA** — todo visualizado sobre un mapa de calor temporal y una vista 3D sobre el relieve real.

Es un MVP funcional desarrollado para el desierto costero de Arequipa (Perú), pensado como una sola infraestructura geoespacial adaptable a múltiples industrias.

## ✨ Características

- **Definición del área** dibujando un polígono en el mapa (base satelital) o **cargando un CSV** de vértices (WGS84).
- **+20 índices** de vegetación (NDVI, EVI, NDRE, MSAVI…), agua (NDMI, NDWI…), **salinidad (NDSI, SI2)**, suelo (BSI, NBR, PSRI) y topografía (pendiente, orientación, TPI, TRI, exposición solar).
- **Scoring multicriterio** → SuitabilityScore 0–100 y prioridad por zona (Muy Alta / Alta / Media / Baja).
- **Clasificación validada** con K-Means, DBSCAN o HDBSCAN + silhouette + **importancia de variables (XGBoost)** + **PCA** opcional.
- **Presets por tipo de estudio** (Agricultura activo; Solar y Minería en hoja de ruta).
- **Mapa de calor temporal**: evolución mes a mes de cada índice y de la aptitud.
- **Vista 3D**: coropleta vectorial drapeada sobre el relieve + detalle ráster por píxel.
- **Informes** estilo ejecutivo con gráficas (Chart.js) y diagnóstico por IA.
- **Procesamiento asíncrono** (no bloquea): la petición se encola y el frontend hace polling.

## 🏗️ Arquitectura

```
┌────────────┐   POST /api/analyses (202)    ┌─────────────┐
│  Frontend  │ ─────────────────────────────▶│   Django    │
│  MapLibre  │ ◀──────── polling GET ─────────│  (web/API)  │
└─────┬──────┘                                └──────┬──────┘
      │ Vista 3D / heatmap / informe                 │ .delay()
      ▼                                              ▼
  /media (PNG, nginx)                         ┌────────────┐   ┌─────────┐
                                              │   Redis    │◀──│ Celery  │
                                              │  (broker)  │   │ worker  │
                                              └────────────┘   └────┬────┘
                                                                    │
                  GEE (Sentinel-2) → índices → scoring → clustering →
                  GeoJSON + heatmaps + LLM → PostGIS
```

Servicios (`docker-compose.yml`): **db** (PostGIS) · **redis** · **web** (Django + Gunicorn) · **worker** (Celery) · **frontend** (Nginx).

## 🧰 Stack

| Capa | Tecnología |
|---|---|
| Backend | Django 5 + GeoDjango + Django REST Framework |
| Asíncrono | Celery + Redis |
| Base de datos | PostgreSQL + PostGIS |
| Data science | Google Earth Engine, geopandas, rasterio, scikit-learn, XGBoost |
| LLM | API compatible OpenAI (DeepSeek por defecto) |
| Frontend | MapLibre GL JS, Chart.js, HTML/CSS/JS estático (sin framework) |
| Infra | Docker + docker-compose |

## 📁 Estructura

```
Quenaris/
├── docker-compose.yml          # Orquestación de los 5 servicios
├── .env.example                # Plantilla de variables (copiar a .env)
├── deploy/nginx.conf           # Nginx: sirve frontend + proxy /api y /media
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── manage.py
│   ├── config/                 # settings, urls, wsgi, celery
│   └── analysis/
│       ├── models.py           # AnalysisRequest / AnalysisResult (GeoDjango)
│       ├── views.py serializers.py urls.py
│       ├── tasks.py            # Tarea Celery que orquesta el pipeline
│       ├── indices.py          # Índices + registro + presets por estudio
│       ├── scoring.py          # Scoring multicriterio + prioridad
│       ├── gee_pipeline.py     # GEE + clustering (KMeans/DBSCAN/HDBSCAN) + PCA + XGBoost
│       ├── heatmap.py          # Rásters PNG por índice/mes
│       ├── llm_report.py       # Informe ejecutivo por LLM
│       └── management/commands/check_gee.py   # Diagnóstico de credenciales GEE
└── frontend/
    ├── inicio.html geoanalisis.html informes.html viewer3d.html login.html
    ├── app.css                 # Sistema de diseño "aeroespacial/oscuro"
    ├── auth.js nav.js geoanalisis.js informes.js viewer3d.js
    └── ejemplo_aoi.csv
```

## 🚀 Puesta en marcha (local)

Requisitos: Docker + Docker Compose.

```bash
git clone https://github.com/TU_USUARIO/quenaris.git
cd quenaris
cp .env.example .env            # completar variables (ver abajo)

# Clave de Google Earth Engine (service account)
mkdir credentials
# copiar gee-sa-key.json dentro de ./credentials/

docker compose up -d --build
docker compose exec web python manage.py makemigrations analysis
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser
```

- **Dashboard:** http://localhost:8080
- **Admin / API:** http://localhost:8000/admin

Valida las credenciales de Earth Engine de forma aislada:

```bash
docker compose exec worker python manage.py check_gee
```

## ⚙️ Configuración (`.env`)

```env
# Django
DJANGO_SECRET_KEY=clave-aleatoria-larga
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,tu-dominio.com

# PostgreSQL / PostGIS
POSTGRES_DB=quenaris
POSTGRES_USER=quenaris
POSTGRES_PASSWORD=password-seguro

# Google Earth Engine (service account)
GEE_SERVICE_ACCOUNT=sa@proyecto.iam.gserviceaccount.com
GEE_PRIVATE_KEY_FILE=/credentials/gee-sa-key.json
GEE_PROJECT=id-de-tu-proyecto-gcp

# LLM (API compatible OpenAI — DeepSeek por defecto)
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
```

**Requisitos previos de Google Earth Engine:** crear un proyecto en Google Cloud, habilitar la *Earth Engine API*, **registrar el proyecto** en [code.earthengine.google.com/register](https://code.earthengine.google.com/register), crear una *service account* con el rol *Earth Engine Resource Writer* **y** *Service Usage Consumer*, y descargar su clave JSON.

## 🔄 Flujo de uso

1. En **Geoanálisis**: nombra el análisis, elige el tipo de estudio (que preselecciona los índices), define el AOI (dibujo o CSV), el rango de fechas y el algoritmo, y procesa.
2. El backend encola la tarea y responde de inmediato; el frontend muestra el progreso.
3. Al completar: el mapa muestra las **zonas por prioridad** y un panel de **mapa de calor** navegable por índice y por mes.
4. **Informes** rinde el diagnóstico ejecutivo con KPIs, tabla de zonas, gráficas e informe IA.
5. **Vista 3D** drapea las zonas y los índices sobre el relieve real.

## 🗺️ Hoja de ruta

- Presets de **Energía solar** (albedo MODIS, LST Landsat, ERA5-Land) y **Minería greenfield** (cocientes de banda Sentinel-2).
- Modelos **supervisados** (KNN / Random Forest) para predecir salinidad/EC con datos de campo.
- Integración de **ortomosaicos de dron** (RGB → multiespectral) para análisis de altísima resolución.
- **InSAR (Sentinel-1)** para monitoreo geotécnico de relaves.

## ⚠️ Notas

- Cada análisis consume cuota de **Earth Engine** y la API de **DeepSeek** (costos asociados).
- No commitear `.env`, `credentials/` ni la clave de GEE (ya excluidos en `.gitignore`).
- Para desplegar en un VPS, ver **[DEPLOY.md](DEPLOY.md)**.

---

<div align="center"><sub>"Los datos son el fertilizante más poderoso del siglo XXI."</sub></div>
