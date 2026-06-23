<div align="center">

# 🛰️ Terranode

**Inteligencia geoespacial de precisión para la agricultura y el medio ambiente.**

*El campo no es uniforme. Sus datos tampoco deberían serlo.*

</div>

---

Terranode convierte imágenes satelitales multiespectrales (Sentinel-2) en **decisiones agronómicas por zona**. La plataforma calcula más de 20 índices ecofisiológicos, hídricos y de salinidad, combinándolos dinámicamente en un **Score de Aptitud (0–100) específico para el problema que intentas resolver**. Luego segmenta el terreno en **zonas de manejo diferenciado** mediante algoritmos de machine learning y entrega un informe diagnóstico redactado por IA.

Desarrollado y calibrado con datos del entorno costero y desértico de Arequipa (Perú), está diseñado para maximizar el rendimiento agrícola y minimizar el desperdicio de recursos (agua, fertilizantes, pesticidas).

## ✨ La Ciencia detrás de la Aptitud

En Terranode, la "Aptitud" no es un valor genérico; su fórmula muta radicalmente dependiendo de tu objetivo operativo:

1. **Salud General**: La aptitud castiga el suelo desnudo, la topografía extrema y la salinidad, premiando el vigor de la biomasa (NDVI, EVI). Zonas de baja aptitud sugieren áreas estructuralmente defectuosas.
2. **Estado Hídrico**: Descarta el vigor y se centra exclusivamente en el NDMI y NDWI. La aptitud alta significa un riego perfecto; la aptitud baja indica estrés por sequía inminente o exceso destructivo de agua (encharcamiento).
3. **Alerta Fitosanitaria**: La aptitud rastrea la degradación celular. Castiga severamente caídas súbitas de clorofila (NDRE) y senescencia acelerada (PSRI). Zonas de baja aptitud son epicentros probables de plagas u hongos.
4. **Nutrición (Fertilización)**: Diseñado para Tasa Variable (VRT). La aptitud baja marca sectores vivos pero desnutridos (baja biomasa o clorosis), donde se requiere inyectar N-P-K.
5. **Potencial de Reforestación**: Funciona a la inversa; busca suelo disponible (BSI) y humedad base, descartando zonas salinas. La aptitud alta marca los espacios geográficos más hospitalarios para el prendimiento de plantones.

*(Expansiones futuras: La arquitectura base soportará energía solar, minería y riesgo inmobiliario, pero el núcleo actual es estrictamente agroambiental).*

## 🚀 Características Principales

- **Definición del área** dibujando un polígono en el mapa o cargando un CSV de vértices.
- **+20 índices procesados en la nube**: Vegetación, agua, salinidad profunda, composición de suelo y topografía.
- **Scoring multicriterio escalado**: Cálculo de aptitud (0–100) estirado estadísticamente para maximizar el contraste, transformado inversamente a una **Prioridad de Manejo** (Muy Alta prioridad = urgencia de intervención).
- **Segmentación No Supervisada** con K-Means, DBSCAN o HDBSCAN + silhouette y **XGBoost** para explicabilidad de IA.
- **Mapa de calor temporal y Visor 3D**: Evalúa la coropleta vectorial sobre el relieve real sin distorsión.
- **Informes Ejecutivos Contextuales**: Reportes que adaptan dinámicamente sus glosarios, radares y tablas al tipo de estudio agrícola elegido.
- **Procesamiento asíncrono**: Backend tolerante a fallos soportado por Celery y Redis.

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
Terranode/
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
git clone https://github.com/TU_USUARIO/terranode.git
cd terranode
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
