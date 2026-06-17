# 🧭 Quenaris — Handoff para rearranque con arquitectura limpia

> Documento único de traspaso. Contiene **todo lo aprendido en el MVP**: qué hace
> la app, la ciencia (índices, scoring, algoritmos), una arquitectura **de referencia**,
> el modelo de datos, y **todas las correcciones de los errores que encontramos** para
> no repetirlos. Pensado para abrir chats nuevos y construir la v2 sobre Docker.
>
> **Estado / decisiones aún abiertas:**
> - La **arquitectura y el patrón de diseño NO están decididos** (§3 es solo una opción
>   de referencia). Lo definirá el chat **Arquitecto de App**.
> - El **motor científico falta pulirlo** y, sobre todo, **validar el clustering con
>   casos límite** (océano, volcán, edificios de ciudad, etc. — ver §4.6). Lo hará el
>   chat **Arquitecto de la Ciencia**.
> - La **implementación** se hace recién cuando ambos arquitectos terminen (§10).

---

## 1 · Qué es Quenaris (y qué validó el MVP)

SaaS de **inteligencia geoespacial** multi-dominio (agricultura de precisión, energía
solar PV, suelos/minería). Cliente en Arequipa, Perú. Lema: *"Los datos son el
fertilizante más poderoso del siglo XXI"*.

El MVP **validó la idea**: el usuario dibuja/carga un Área de Interés, el sistema
descarga Sentinel-2, calcula índices, los combina en un **SuitabilityScore 0–100**,
segmenta el terreno en **zonas priorizadas**, genera **mapas de calor temporales**,
una **vista 3D** y un **informe ejecutivo por IA**. Procesamiento **asíncrono**
(no bloquea). Funcionó de extremo a extremo.

La v2 NO cambia el alcance ni la ciencia; cambia la **arquitectura del código** para
hacerlo mantenible, testeable y desplegable con confianza.

---

## 2 · Decisiones de stack (se mantienen)

- **Docker + docker-compose** (el usuario quiere seguir con Docker por el deployment).
- Backend **Django 5 + GeoDjango + DRF**, **Celery + Redis**, **PostgreSQL + PostGIS**.
- Data science: **Google Earth Engine** (Sentinel-2), geopandas, rasterio, scikit-learn,
  XGBoost, matplotlib/Pillow (colorizar PNG).
- LLM: **API compatible OpenAI** (DeepSeek por defecto, configurable por env).
- Frontend: **MapLibre GL JS** + Chart.js. (Ver §6 para la decisión de framework.)
- Auth: **Token DRF**.

---

## 3 · Arquitectura de REFERENCIA (pendiente de decidir)

> ⚠️ Esto **no es la decisión final** — es una opción de partida para que el chat
> **Arquitecto de App** la evalúe, compare con otras (hexagonal, clean architecture,
> modular monolith, etc.) y decida. El **único principio firme** que recomiendo conservar
> es: **separar la CIENCIA (pura, sin Django) de la capa WEB**, porque en el MVP todo
> vivía mezclado en `analysis/` y eso impidió testear el motor de forma aislada.

```
quenaris/
├── docker-compose.yml              # dev (bind mounts)
├── docker-compose.prod.yml         # override: Caddy + sin puertos host
├── Caddyfile                       # HTTPS automático
├── .env.example
├── backend/
│   ├── Dockerfile                  # multi-stage
│   ├── requirements/
│   │   ├── base.txt  dev.txt  prod.txt
│   ├── manage.py
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py             # común
│   │   │   ├── local.py            # DEBUG, sqlite/postgis local
│   │   │   └── production.py       # seguridad, orígenes por env
│   │   ├── urls.py  wsgi.py  asgi.py  celery.py
│   ├── apps/                       # capa WEB (Django)
│   │   ├── accounts/               # usuarios, tokens, endpoint de login
│   │   └── analyses/               # modelos, serializers, views, tasks, admin
│   ├── engine/                     # CIENCIA pura (sin Django, sin DB) ← testeable
│   │   ├── gee.py                  # auth GEE, composite sin nubes, descarga GeoTIFF
│   │   ├── indices.py              # índices + registro + presets
│   │   ├── scoring.py              # scoring multicriterio + prioridad
│   │   ├── clustering.py           # KMeans/DBSCAN/HDBSCAN + PCA + silhouette + XGBoost
│   │   ├── heatmap.py              # rásters PNG por índice/mes
│   │   ├── report.py               # informe LLM
│   │   └── pipeline.py             # orquesta engine.* → dict de resultados
│   └── tests/
│       ├── test_indices.py  test_scoring.py  test_clustering.py
│       └── conftest.py
└── frontend/
    ├── (ver §6)
    └── ...
```

**Principios:**
- `engine/` no importa Django ni toca la DB. Recibe geometrías/arrays, devuelve dicts.
  → se testea con pytest sin levantar nada. (En el MVP el scoring se validó así con
  numpy; formalizarlo como tests.)
- `apps/analyses/tasks.py` (Celery) llama a `engine.pipeline.run(...)` y persiste.
- **Settings por entorno** con `django-environ`: nunca hardcodear orígenes/secretos.
- **Config 12-factor**: TODO por variables de entorno, incluido el dominio público.

---

## 4 · La ciencia a preservar (no perder ningún detalle)

### 4.1 Índices (Sentinel-2 S2_SR_HARMONIZED)
Bandas: B2 azul, B3 verde, B4 rojo, B5 red-edge1, B8 NIR, B11 SWIR1, B12 SWIR2.

- **Vegetación:** NDVI=(B8-B4)/(B8+B4); EVI=2.5·(NIR-RED)/(NIR+6·RED-7.5·BLUE+1) (reflectancia/10000);
  **MSAVI**=(2·NIR+1−√((2·NIR+1)²−8·(NIR−RED)))/2 (sustituye a SAVI, sin factor L manual);
  NDRE=(B8-B5)/(B8+B5); + GNDVI, CIre, ARVI, SIPI, LAI, SAVI (disponibles).
- **Agua:** NDMI=(B8-B11)/(B8+B11); NDWI=(B3-B8)/(B3+B8). (MSI y MoistureStress existen
  pero se EXCLUYEN del preset agro por colinealidad.)
- **Salinidad (clave en Arequipa, antes ausente):** **NDSI**=(B11-B12)/(B11+B12);
  **SI2**=√(NIR²+Green²+Red²).
- **Suelo:** BSI, NBR, NDBI, PSRI.
- **Topografía (DEM Copernicus GLO-30):** Elevation, Slope, **Aspect**, **TPI**
  (elev − media local), **TRI** (desv. local), **SolarExposure** (northness para
  hemisferio sur; 0.5 en terreno plano).

### 4.2 Scoring multicriterio (preset Agro)
Z-score de cada índice → sigmoide `1/(1+exp(-k·z))` (índices "malos" invertidos) →
suma ponderada **normalizada por los índices presentes** → 0–100. Criterios:

| Criterio | Términos (feature, pts, invertido) | Peso |
|---|---|---|
| Vigor | NDVI(10,F), EVI(8,F), NDRE(7,F) | 0.25 |
| Hídrica | NDMI(12,F), NDWI(8,F) | 0.20 |
| Mitigación suelo | MSAVI(8,F), BSI(7,**T**) | 0.15 |
| **Salinidad** | NDSI(8,**T**), SI2(7,**T**) | 0.15 |
| Topografía | slope_opt(8,F), SolarExposure(7,F) | 0.15 |
| Bajo estrés | PSRI(5,**T**), NBR(5,F) | 0.10 |

`slope_opt` = gaussiana de la pendiente (óptimo ~4°, σ=9). Prioridad: Muy Alta ≥75,
Alta ≥50, Media ≥25, Baja <25. **Importante:** normalizar por puntos presentes (validado:
óptimo→88, pésimo→12, y con solo 5 índices también→88).

### 4.3 Clustering y validación (M3)
- Algoritmos: **K-Means** (n_clusters), **DBSCAN** (eps=1.2, min_samples=30),
  **HDBSCAN** (min_cluster_size adaptativo; ruido=-1).
- **PCA** opcional pre-clustering (n_components=0.95) para mitigar colinealidad.
- **Silhouette** sobre muestra (≤5000) como calidad de separación.
- **XGBoost pseudo-supervisado:** entrena un regresor sobre el SuitabilityScore →
  **feature_importance** (qué índices explican la aptitud). Con `try/except` y fallback
  a importancia por centroides si XGBoost no está.
- Etiquetado semántico por aptitud media del cluster: No apto / Marginal / Moderado /
  Bueno / Óptimo.

### 4.4 Presets por tipo de estudio
- **agro** (activo): NDVI, EVI, NDRE, MSAVI, NDMI, NDWI, NDSI, SI2, BSI, NBR, PSRI,
  Slope, Aspect, TPI, TRI, SolarExposure, Elevation.
- **solar** (futuro): Slope, Aspect, SolarExposure, Elevation, TPI, BSI + (albedo MODIS,
  LST Landsat, ERA5-Land temp/viento — requiere multi-fuente).
- **mineria** (futuro): cocientes de banda Sentinel-2 (óxido férrico B4/B2, ferroso
  FEI=(B12/B4)+(B7/B3), arcillas) + InSAR Sentinel-1 para relaves.

### 4.5 Mapa de calor temporal + 3D
- Por cada mes del rango: composite → stack → colorizar PNG por índice + **suitability**,
  guardados en `MEDIA_ROOT/heatmaps/<id>/<capa>/<YYYY-MM>.png`, servidos por nginx en
  `/media`. Incluye `suitability_series` (media mensual) para la gráfica temporal.
- **3D:** la coropleta **vectorial** (zonas como `fill` de MapLibre) se drapea perfecta
  sobre el relieve; el ráster por píxel solo como "detalle" (se estira en pendientes
  fuertes — ver §7). Para drape ráster perfecto futuro: CesiumJS o teselar con gdal2tiles.

### 4.6 ⏳ Validación PENDIENTE del clustering (casos límite)
El MVP nunca validó si el clustering **separa de forma significativa**; siempre asumió
terreno tipo agro/ladera. El **Arquitecto de la Ciencia** debe probarlo con AOIs extremos
y decidir cómo responder la app en cada caso:

- **Océano / cuerpo de agua:** reflectancia casi uniforme → ¿clusters sin sentido? El
  scoring de "vigor/suelo" no aplica. ¿Detectar y avisar "AOI sin terreno analizable"?
- **Volcán / roca desnuda:** vegetación ~0, brillo alto, pendientes extremas → ¿el scoring
  colapsa a "No apto" en todo? ¿Es útil o ruido?
- **Ciudad / edificios:** NDBI alto, geometrías artificiales, sombras → ¿el clustering
  separa manzanas? ¿Tiene sentido para los dominios objetivo?
- **AOI mixto** (mitad cultivo, mitad río/urbano), **AOI diminuto** (< nº de clusters),
  **AOI enorme** (límite de descarga GEE), **todo nubes** (sin escenas válidas).

Preguntas a resolver: ¿cuántos clusters tiene sentido por tamaño/heterogeneidad?
¿K-Means vs HDBSCAN según el caso? ¿se necesita una **máscara de agua/urbano** (ej. con
NDWI/NDBI) antes de clusterizar? ¿umbrales para rechazar AOIs no analizables? ¿el
SuitabilityScore necesita "no aplica" en vez de forzar 0–100? Documentar criterios y, si
es posible, **tests reproducibles** con AOIs de ejemplo por categoría.

---

## 5 · Modelo de datos (GeoDjango)

**AnalysisRequest:** id (uuid), user (FK), name, aoi (PolygonField SRID 4326),
date_start, date_end, **study_type**, **indices** (JSON, override), n_clusters,
algorithm (kmeans/dbscan/hdbscan), **use_pca** (bool), status
(PENDING/PROCESSING/COMPLETED/FAILED), celery_task_id, error_message, timestamps.
Propiedad `area_ha` (transform a 3857).

**AnalysisResult:** request (O2O), clusters_geojson (JSONB, con props por zona:
priority, suitability_mean, ndvi_mean, ndmi_mean, bsi_mean, ndsi_mean, slope_mean,
solar_mean), clusters_geom (MultiPolygon, para consultas PostGIS), statistics (JSON:
suitability_global_mean, priority_distribution, silhouette, feature_importance +
importance_method, indices_used, use_pca, pca, weights, clusters[], study_type,
date_range, images_used), report_markdown, **heatmap_layers** (JSON: bounds, indices,
timesteps, url_template, ranges, suitability_series), metadatos de procedencia.

API: `POST /api/analyses/` → 202 + id (encola Celery); `GET /api/analyses/<id>/` → detalle
(polling); `GET /api/analyses/` → lista del usuario; `POST /api/auth/token/` → token.

---

## 6 · Frontend — decisión a tomar en la v2

El MVP usó **HTML/CSS/JS estático** (sin framework, servido por nginx). Funcionó pero
creció. Opciones para la v2:

- **A) Mantener vanilla + Vite** (recomendado para empezar): módulos ES, un build simple,
  CSS de design-system compartido. Bajo riesgo, sin reescribir lógica.
- **B) Framework** (React/Vue/Svelte): mejor para estado complejo (modos crear/ver,
  paneles), pero reescritura mayor.

**Conservar SÍ o SÍ:** el sistema de diseño **"aeroespacial/oscuro"** (skill
frontend-design): fondo HUD con grilla, tipografías **Chakra Petch** (títulos) /
**Sora** (cuerpo) / **JetBrains Mono** (datos), acentos verde-señal `#34d399` y cian
`#38d9f0` sobre negro-azulado `#05080d`, detalles tipo control de misión. Está todo en
`frontend/app.css` del MVP — portarlo como tokens.

Páginas: Inicio (landing), Geoanálisis (mapa + dibujo/CSV + modo crear/ver + presets +
panel de índices), Informes (KPIs + tabla de zonas + gráficas + informe IA), Vista 3D,
Login.

---

## 7 · ⚠️ Correcciones / trampas aprendidas (NO repetir)

Esto es oro: cada punto nos costó una iteración en el MVP.

1. **mapbox-gl-draw + MapLibre:** reasignar las clases CSS antes de instanciar
   (`MapboxDraw.constants.classes.CONTROL_BASE='maplibregl-ctrl'`, `CONTROL_PREFIX`,
   `CONTROL_GROUP`) o el botón de dibujo sale invisible/sin clic.
2. **Admin sin estilos con DEBUG=0:** añadir **WhiteNoise** (middleware +
   STORAGES staticfiles comprimido) para servir los estáticos.
3. **Migraciones:** `migrate` en el arranque NO basta si faltan los archivos de
   migración de la app → correr `makemigrations` al añadir/cambiar modelos.
4. **Cadena de credenciales GEE** (todo debe alinearse): valores en `.env`, ruta del
   key file, `client_email` del JSON == `GEE_SERVICE_ACCOUNT`, **proyecto registrado en
   Earth Engine**, roles IAM **Earth Engine Resource Writer + Service Usage Consumer**,
   **Earth Engine API habilitada**. Tener un `manage.py check_gee` que valide eslabón por
   eslabón.
5. **Contraseña de Postgres:** solo se aplica al **inicializar el volumen**. Cambiar
   `POSTGRES_PASSWORD` después no surte efecto → `ALTER USER` dentro del contenedor `db`,
   o borrar el volumen si no hay datos.
6. **Login/CSRF:** el endpoint `obtain_auth_token` debe llevar
   `authentication_classes = []`; si no, una cookie de sesión del admin dispara
   SessionAuthentication y su comprobación CSRF rechaza el login.
7. **Throttling:** NO poner `UserRateThrottle` global — el polling cada 4 s lo agota.
   Throttle **scoped solo en el create** (POST).
8. **Orden de autenticadores DRF:** `TokenAuthentication` primero; añadir
   `CSRF_TRUSTED_ORIGINS` (y `CORS_ALLOWED_ORIGINS`) con el origen del frontend.
9. **nginx cachea la IP del upstream:** tras recrear `web` (build/force-recreate), nginx
   sigue apuntando a la IP vieja → **502**. Reiniciar `frontend`, o en prod usar el
   `resolver 127.0.0.11` de Docker con `proxy_pass` vía variable para re-resolver siempre.
10. **Servir /media:** NO se puede anidar un volumen dentro de un bind montado `:ro`.
    Montar el volumen de media en una ruta aparte (`/srv/media`) y servirlo con `alias`.
11. **Paneles flotantes sobre el mapa:** MapLibre inyecta su canvas DESPUÉS en el DOM y lo
    tapa → dar `z-index` a los paneles.
12. **Ráster sobre terreno 3D:** una imagen drapeada crea un "telón" vertical en pendientes
    fuertes → usar **fill vectorial** (coropleta) para el 3D; el ráster solo modo detalle.
13. **scikit-learn:** filtrar **NaN e infinitos** con `np.isfinite` (no solo NaN): la
    división del EVI puede dar `inf` y rompe el clustering.
14. **El LLM envuelve el markdown en ```` ```markdown ````** → quitar el fence antes de
    compilar/guardar, o `marked` lo muestra como bloque de código.
15. **`.env` cambiado no surte efecto con `restart`** (restart no relee env) →
    `docker compose up -d --force-recreate <servicio>`.
16. **Dependencias del worker:** matplotlib + Pillow (colorizar PNG); xgboost opcional con
    try/except. La descarga GEE del heatmap baja muchas bandas/mes — vigilar tamaño con
    AOIs grandes (recortar bandas si falla).
17. **build_index_stack firma:** si cambia (p. ej. recibir la lista de índices), actualizar
    TODAS las llamadas (pipeline Y heatmap) — un olvido dejó el heatmap vacío.
18. **502 transitorio** durante `up --build`: normal mientras `web` arranca (migrate +
    collectstatic antes de gunicorn). No es un bug si luego responde.

---

## 8 · Deployment (Docker en VPS Ubuntu)

Ya documentado en `DEPLOY.md` del MVP: VPS Ubuntu (≥4 GB RAM) → Docker → clonar → `.env`
+ `credentials/gee-sa-key.json` → **Caddy** para HTTPS automático (`docker-compose.prod.yml`
override que añade caddy y quita el puerto del frontend) → `up -d --build` → migrate →
createsuperuser. Backups con `pg_dump`. Checklist de producción incluido. **Portar
`DEPLOY.md` tal cual** y parametrizar los orígenes por `PUBLIC_ORIGIN` (env) en la v2.

---

## 9 · Hoja de ruta (post-rearranque)

1. **Presets de índices por estudio (fase iniciada en MVP):** Solar (albedo MODIS, LST
   Landsat, ERA5-Land) y Minería greenfield (cocientes de banda).
2. **Modelos supervisados** (KNN/Random Forest) para salinidad/EC/CaCO₃ — requieren datos
   de campo etiquetados.
3. **Ortomosaicos de dron** (RGB → multiespectral): subir `.tif`, pipeline visible de alta
   resolución (VARI, BI + DEM/slope/aspect → micro-hábitats), servir el ortho como teselas,
   3D premium con DSM del vuelo (evaluar **CesiumJS**).
4. **InSAR Sentinel-1** para deformación de presas de relaves (alerta temprana).
5. Mover orígenes/secretos a env; tests del `engine/`; CI.

---

## 10 · Flujo de trabajo: 3 chats especializados + skills por rol

El plan es **separar en chats con un rol cada uno**, y solo pasar a implementar cuando
los dos arquitectos terminen. Cada chat **adjunta este handoff** + el output del chat
anterior. Las decisiones se propagan por **memoria** (se carga sola en el espacio) y por
un **documento de decisiones** que cada arquitecto produce.

```
Chat 1: Arquitecto de App  ─┐
                            ├─▶  Chat 3: Ingeniero (implementación)
Chat 2: Arquitecto Ciencia ─┘
```

### Chat 1 — Arquitecto de App
Objetivo: decidir estructura, patrón de diseño, contratos entre capas, settings por
entorno, estrategia de frontend, y dejar un **ADR** (Architecture Decision Record).
Trabajo mayormente de razonamiento; las skills sirven para los **entregables**:
- **Mermaid** (artefacto/diagrama) — diagramas de arquitectura y de secuencia.
- **`init`** (slash command) — generar un `CLAUDE.md` con convenciones para que el
  Ingeniero las siga.
- **`docx`** o **`pdf`** — si quieres el ADR como documento formal (si no, markdown).
- **`security-review`** — revisar el diseño de auth/secretos/superficie de ataque.
- Subagente **Plan** — explorar y comparar opciones de arquitectura.
- **`frontend-design`** (instalar del plugin oficial) — si decides el enfoque del front.

### Chat 2 — Arquitecto de la Ciencia
Objetivo: pulir el motor (índices, scoring, algoritmos) y **validar el clustering con
los casos límite de §4.6**. Aquí las skills de datos son el núcleo:
- **`data:explore-data`** — perfilar las distribuciones de índices y los AOIs de prueba.
- **`data:statistical-analysis`** — distribuciones, outliers, significancia de la
  separación entre clusters.
- **`data:validate-data`** — QA de la metodología (¿el clustering hace un buen trabajo?,
  sesgos, supuestos).
- **`data:create-viz`** / **`data:data-visualization`** — visualizar clusters, índices y
  resultados de cada caso límite.
- **`xlsx`** — tablas de índices/criterios/pesos; **`pdf`**/**`docx`** — el spec científico.

### Chat 3 — Ingeniero (implementación)
Objetivo: construir según lo que decidieron los dos arquitectos (adjuntar sus ADR/spec).
- **`init`** — leer/seguir el `CLAUDE.md` de convenciones.
- **`review`** — revisar cambios antes de integrar.
- **`security-review`** — revisión de seguridad de la implementación (auth, CSRF,
  secretos, las trampas de §7).
- Subagentes **Explore** (localizar código) y **Plan** (planear features).
- (Opcional) **`skill-creator`** — si quieres encapsular flujos repetidos en una skill.

### Cómo arrancar cada chat
1. Ábrelo **en el mismo espacio/proyecto** (la memoria de Quenaris se carga sola).
2. **Adjunta `REBUILD_HANDOFF.md`** (+ el ADR/spec del chat previo cuando aplique) y
   declara el rol: *"Eres el Arquitecto de App de Quenaris. Aquí el handoff del MVP…"*.
3. **No pegues chats anteriores enteros** — ver nota de tokens abajo.
