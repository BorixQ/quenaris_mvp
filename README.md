<div align="center">

# Quenaris

**Exploración geoespacial para la agricultura y el territorio.**

*El campo no es uniforme. Sus datos tampoco deberían serlo.*

</div>

---

Quenaris procesa imágenes satelitales multiespectrales (Sentinel-2) para explorar diferencias entre zonas. La plataforma calcula índices espectrales y topográficos, los combina en una **puntuación relativa (0–100)** según el estudio, segmenta el terreno mediante algoritmos de machine learning y genera un informe factual de sus estadísticas.

**Los resultados son exploratorios:** los índices, umbrales y recomendaciones deben validarse con datos de campo antes de tomar decisiones agronómicas. Un indicador satelital por sí solo no confirma una plaga, una deficiencia nutricional ni una condición de riego.

Desarrollado con el entorno costero y desértico de Arequipa (Perú) como contexto, busca apoyar la gestión agrícola. La calibración y su efecto sobre el rendimiento o el uso de recursos aún deben verificarse con datos de campo.

## Ciencia y resultados exploratorios

La versión científica `relative-percentiles-v2` prioriza salud general y reforestación como exploración del terreno. La puntuación compara índices dentro del AOI y periodo; no mide salud, fertilidad, salinidad ni viabilidad de plantación absolutas. Los pesos son hipótesis, no parámetros calibrados para cultivos o comunidades de puna.

- Máscara terrestre SCL, control de nodata, cobertura y observaciones válidas registradas.
- Cuadrícula de salida de 20 m; bandas ópticas nativas de 10/20 m y DSM de unos 30 m.
- Agrupaciones espectrales con etiquetas descriptivas; el ruido y la falta de heterogeneidad se mantienen visibles.
- Mapas mensuales con los mismos índices, pesos y referencia del composite principal, recortados al intervalo solicitado.
- Diagnósticos causales no validados retirados. Los informes deterministas muestran límites y verificaciones de campo, sin prescripciones ni llamadas al LLM en esta versión.
- LAI/WDI no seleccionables mientras no exista una fórmula y procedencia justificadas. NDSI/SI2 no se usan como diagnóstico de salinidad.

El informe de [auditoría científica](docs/science/AUDIT.md) contiene la matriz completa de fórmulas/fuentes, cambios de semántica, pruebas, límites y protocolo de campo. Los análisis históricos deben recalcularse para usar esta versión. Riego, fitosanidad y fertilización siguen siendo experimentales.

## 🏗️ Arquitectura

El frontend actual es una SPA React/TypeScript con tema claro, asistente de análisis, historial y resultados adaptables. Vite genera archivos estáticos que sirve Nginx; Node solo se utiliza al construir. La [documentación del rediseño](docs/frontend/README.md) incluye arquitectura, pruebas, capturas y reversión local. Los HTML anteriores se conservan como fuente histórica y sus URLs redirigen a las rutas nuevas.

```
┌────────────┐   POST /api/analyses (202)    ┌─────────────┐
│  Frontend  │ ─────────────────────────────▶│   Django    │
│  MapLibre  │ ◀──────── polling GET ─────────│  (web/API)  │
└─────┬──────┘                                └──────┬──────┘
      │ Vista 3D / heatmap / informe                 │ .delay()
      ▼                                              ▼
  /media (PNG privado vía Django)             ┌────────────┐   ┌─────────┐
                                              │   Redis    │◀──│ Celery  │
                                              │  (broker)  │   │ worker  │
                                              └────────────┘   └────┬────┘
                                                                    │
                  GEE (Sentinel-2) → índices → scoring → clustering →
                  GeoJSON + heatmaps + informe factual → PostGIS
```

Servicios (`docker-compose.yml`): **db** (PostGIS) · **redis** · **web** (Django + Gunicorn) · **worker** (Celery) · **frontend** (Nginx) · **admin** (privado) · **beat** (recuperación de tareas).

## 🧰 Stack

| Capa | Tecnología |
|---|---|
| Backend | Django 5.2 LTS + GeoDjango + Django REST Framework |
| Asíncrono | Celery + Redis |
| Base de datos | PostgreSQL + PostGIS |
| Data science | Google Earth Engine, geopandas, rasterio, scikit-learn, XGBoost |
| Informes | Resumen determinista; configuración LLM legacy reservada |
| Frontend | React, TypeScript, Vite, React Router, TanStack Query, MapLibre GL JS y Chart.js |
| Infra | Docker + docker-compose |

## 📁 Estructura

```
Terranode/
├── docker-compose.yml          # Servicios y redes separadas
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
│       ├── llm_report.py       # Informe factual sin llamadas al LLM
│       └── management/commands/check_gee.py   # Diagnóstico de credenciales GEE
└── frontend/
    ├── app/                    # Frontend actual React/TypeScript; Docker construye y sirve dist
    ├── inicio.html geoanalisis.html informes.html viewer3d.html login.html
    ├── app.css                 # Sistema de diseño "aeroespacial/oscuro"
    ├── auth.js nav.js geoanalisis.js informes.js viewer3d.js
    └── ejemplo_aoi.csv
```

## 🚀 Puesta en marcha (local)

Requisitos: Docker + Docker Compose. Para desarrollar y probar el stack completo de forma aislada, ver [Integración y dependencias](docs/integration/README.md).

```bash
git clone https://github.com/BorixQ/quenaris_mvp.git
cd quenaris_mvp
cp .env.example .env            # completar variables (ver abajo)
python3 -c 'import secrets; print(secrets.token_urlsafe(50))' # usar como DJANGO_SECRET_KEY

# Clave de Google Earth Engine (service account)
mkdir credentials
# copiar gee-sa-key.json dentro de ./credentials/

docker compose up -d --build
docker compose exec web python manage.py createsuperuser
```

- **Aplicación:** http://localhost:8080/analisis
- **API:** http://localhost:8080/api/ (token del usuario)
- **Administrador privado:** http://localhost:8001/admin/ (loopback o túnel SSH)

Por defecto el puerto solo escucha en la propia máquina; el túnel Cloudflare es opcional. Para preparar una laptop y entender las limitaciones de seguridad, consulta **[HOMELAB.md](HOMELAB.md)**.

Los mapas y resultados requieren autenticación del propietario. La API y el administrador tienen rutas separadas; las cookies del administrador no autorizan la API pública. Tokens de 24 horas, cuotas atómicas, límites operativos y recuperación de trabajos se describen en **[Seguridad y acceso privado](docs/security/README.md)**.

Valida las credenciales de Earth Engine de forma aislada:

```bash
docker compose exec worker python manage.py check_gee
```

## ⚙️ Configuración (`.env`)

```env
# Django
DJANGO_SECRET_KEY=<clave-aleatoria-generada-de-al-menos-50-caracteres>
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

# Login Google opcional; distinto de la autenticación de Earth Engine
GOOGLE_OAUTH_CLIENT_ID=
```

**Requisitos previos de Google Earth Engine:** crear un proyecto en Google Cloud, habilitar la *Earth Engine API*, **registrar el proyecto** en [code.earthengine.google.com/register](https://code.earthengine.google.com/register), crear una *service account* con el rol *Earth Engine Resource Writer* **y** *Service Usage Consumer*, y descargar su clave JSON.

## 🔄 Flujo de uso

1. En **Geoanálisis**: nombra el análisis, elige el tipo de estudio (que preselecciona los índices), define el AOI (dibujo o CSV), el rango de fechas y el algoritmo, y procesa.
2. El backend encola la tarea y responde de inmediato; el frontend muestra el progreso.
3. Al completar: el mapa muestra las **zonas por prioridad** y un panel de **mapa de calor** navegable por índice y por mes.
4. **Informes** muestra estadísticas, grupos, calidad y límites de interpretación.
5. **Vista 3D** drapea las zonas y los índices sobre el relieve real.

## 🗺️ Hoja de ruta

- Presets de **Energía solar** (albedo MODIS, LST Landsat, ERA5-Land) y **Minería greenfield** (cocientes de banda Sentinel-2).
- Modelos **supervisados** (KNN / Random Forest) para predecir salinidad/EC con datos de campo.
- Integración de **ortomosaicos de dron** (RGB → multiespectral) para análisis de altísima resolución.
- **InSAR (Sentinel-1)** para monitoreo geotécnico de relaves.

## ⚠️ Notas

- Cada análisis consume recursos de **Earth Engine** y del worker; revisar la cuota y condiciones del proyecto. El informe actual no llama a un LLM.
- No commitear `.env`, `credentials/` ni la clave de GEE (ya excluidos en `.gitignore`).
- Los mapas de calor bajo `/media/` requieren token y propiedad del análisis; no habilitar caché pública de esos endpoints.
- La guía histórica para VPS **[DEPLOY.md](DEPLOY.md)** requiere revisión antes de utilizarla en internet.

---

<div align="center"><sub>"Los datos son el fertilizante más poderoso del siglo XXI."</sub></div>
