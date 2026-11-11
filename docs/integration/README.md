# Integración y dependencias

Entorno objetivo: Python 3.12, Linux amd64. Las pruebas completas se ejecutan en Docker dentro de Ubuntu WSL en el equipo Windows de desarrollo; no en el homelab. Mantener WSL activo durante las pruebas: en este equipo la VM puede apagarse cuando termina la última sesión interactiva, incluso con servicios systemd.

## Dependencias

`backend/requirements.in` declara dependencias directas y límites de compatibilidad. `backend/requirements.txt` fija todo el grafo con hashes. El lock de pruebas añade pytest/pytest-django/pip-audit y restringe sus paquetes de ejecución al lock principal. El Dockerfile instala con `--require-hashes`, comprueba `pip check` y ejecuta como usuario sin privilegios. El target de producción es `runtime`; `test` añade las herramientas de pruebas.

Django pasa a 5.2 LTS (5.2.19 en esta resolución), con soporte de seguridad hasta abril de 2028 según [Django](https://www.djangoproject.com/download/). Se utiliza XGBoost CPU, sin dependencias CUDA, y se retira el SDK OpenAI de ejecución porque el informe científico actual es determinista. Pillow se actualiza a la rama 13 tras los avisos detectados en la rama 12. Se sustituye el lock científico provisional de Windows por estos locks canónicos de Linux para evitar instrucciones de instalación incompatibles entre sí.

Regeneración explícita, revisando el diff y repitiendo pruebas/auditoría después:

```bash
uv pip compile backend/requirements.in --python-version 3.12 --python-platform x86_64-unknown-linux-gnu --generate-hashes --output-file backend/requirements.txt
uv pip compile backend/requirements-test.in --python-version 3.12 --python-platform x86_64-unknown-linux-gnu --generate-hashes --output-file backend/requirements-test.txt
```

Python, PostGIS, Redis y Nginx están fijados por digest en los archivos correspondientes. La imagen Python es Debian Trixie y obtiene GDAL/GEOS/PROJ del gestor de paquetes: esos paquetes del sistema no tienen un snapshot APT fijado, por lo que una reconstrucción futura no garantiza igualdad binaria total. Conservar las imágenes verificadas o registrar de nuevo su inventario al reconstruir. Cloudflared es opcional y no forma parte de esta prueba ni queda actualizado por esta fase.

## Ejecución local

Desde una sesión Linux/WSL, en la raíz del repositorio:

```bash
export GEE_OAUTH_DIRECTORY=/mnt/c/Users/bq/.config/earthengine
export GEE_PROJECT=quenaris-499120
bash scripts/integration.sh build
bash scripts/integration.sh unit
bash scripts/integration.sh audit
bash scripts/integration.sh smoke
```

La carpeta OAuth solo se monta en el worker, en modo lectura, para la prueba local con Earth Engine. No se incluye en la imagen ni se copia al homelab. El smoke hace consultas reales y pequeñas a EE; no habilitarlo en un proyecto diferente sin revisar sus coordenadas y fechas. Los tests de API y cálculo no llaman a EE.

El proyecto `quenaris-integration` tiene redes y volúmenes independientes, credenciales ficticias de prueba, frontend solo en `127.0.0.1:18080` y administrador separado en `127.0.0.1:18081`. PostGIS/Redis no publican puertos. Las herramientas de prueba montan el repositorio de solo lectura. Este Compose es exclusivo de desarrollo y no es una configuración pública.

El puerto del frontend se puede cambiar con `INTEGRATION_FRONTEND_PORT`. Después de la prueba inicial, este checkout usa 8080 mediante `.env`, para reutilizar el origen que ya autorizaba el cliente web de Google. La dirección actual es `http://localhost:8080/login.html`; no abrir el HTML como archivo. `bash scripts/integration.sh start` levanta la app sin consumir un análisis de EE y lee la configuración de `.env` mediante Compose.

Para verificar persistencia: guardar el UUID que emite `smoke`, recrear únicamente los contenedores web/worker (sin eliminar volúmenes), esperar salud y ejecutar:

```bash
bash scripts/integration.sh verify UUID_DEL_ANALISIS
```

Nginx resuelve `web` mediante DNS de Docker, permitiendo recrear la API sin mantener una IP antigua en el proxy. Los datos y PNG deben seguir disponibles después de recrear contenedores. Para detener el entorno y conservar sus volúmenes: `bash scripts/integration.sh stop`. No ejecutar `down -v` si se desean conservar los resultados.

## Comportamientos comprobados

Los tests cubren login por usuario/contraseña, autorización, validación científica, creación/polling, publicación después del commit, rechazo al agotarse cuota y concurrencia sobre la última reserva. Un fallo de publicación devuelve HTTP 503, deja el análisis FAILED y restituye su reserva una sola vez. Los reintentos temporales conservan la reserva y no se presentan como fallo terminal. Los fallos terminales la restituyen; las tareas duplicadas de análisis terminados se ignoran. Resultado y estado COMPLETED se guardan en una única transacción.

`python manage.py recover_stale_analyses` recupera PENDING/PROCESSING sin actividad durante más de 35 minutos, por encima del hard limit de 30 minutos del worker. El servicio beat lo programa cada cinco minutos; se puede ejecutar también manualmente. Se comprueba el último intento bajo bloqueo para no recuperar reintentos recientes. Un análisis creado antes de la migración 0006 no se marca retrospectivamente como cuota reservada; revisar su contabilidad antes de recuperar trabajos históricos. Ver [seguridad](../security/README.md) para el control de entregas duplicadas y resultados de intentos antiguos.

GET `/api/health/` es una comprobación de disponibilidad de Django/PostGIS sin autenticación; no certifica disponibilidad de EE ni del worker. El worker se inicia después de las migraciones y la salud de web. Redis usa `noeviction` para que la presión de memoria no descarte silenciosamente mensajes de la cola.

## Precaución con bases existentes

Los mantenedores de [docker-postgis](https://github.com/postgis/docker-postgis) indican que las etiquetas 3.5/3.6 dejaron de actualizarse y que pasar a 3.7 cambia el sistema base y glibc. **No conectar automáticamente un volumen antiguo a esa imagen:** hacer pg_dump/pg_restore a un volumen nuevo y validar extensiones/índices. El homelab documentado está recién reinstalado; aquí la prueba 3.7 usa un volumen nuevo `integration_db_v2`. El volumen previo de la prueba 3.5 se conserva y no se mezcla.

La base inicial Bookworm emitió el aviso `gis.W001` por GDAL 3.6; se sustituyó por Trixie para habilitar la protección de acceso a archivos/red en referencias espaciales de GDAL 3.9 o posterior.

Las comprobaciones posteriores en Edge, protección de `/media/` y administración privada se documentan en [seguridad](../security/README.md). El login Google real de la aplicación y las pruebas de restauración de backups siguen pendientes. Autenticación OAuth de Earth Engine y login Google de la aplicación son mecanismos diferentes.


## Resultado de la fase de dependencias, 10 de noviembre de 2026

- **32 pruebas aprobadas**, sin advertencias en la ejecución final sobre Trixie/GDAL 3.10.3. Incluye cálculo, GeoDjango/PostGIS, autenticación, concurrencia de cuotas y recuperación de tareas.
- `makemigrations --check --dry-run`: sin cambios pendientes; migraciones 0001–0006 aplicadas al entorno real de integración.
- `pip check`: sin conflictos al construir. Runtime y tests comparten las mismas versiones de los 77 paquetes de ejecución. `pip-audit` no encontró avisos conocidos en ese lock; no constituye auditoría de paquetes del sistema ni garantía de ausencia de vulnerabilidades.
- Prueba real por HTTP: login, HTTP 202, Redis/Celery, Earth Engine (13 escenas), tres grupos, resultado PostGIS, informe factual, PNG y estáticos del admin. El caso oceánico terminó FAILED y devolvió la reserva, dejando solo un análisis consumido.
- Resultado y PNG accesibles después de recrear web/worker y, nuevamente, tras reconstruir sobre Trixie. Nginx no necesitó reiniciarse para resolver la API recreada.
- Compose base y de integración validados. El proyecto de integración se detuvo al finalizar, conservando sus volúmenes. No se modificaron otros stacks, el homelab ni GitHub.

Evidencia: [resumen](verification.json), [inventario](runtime-inventory.json), [prueba real](smoke.json), [persistencia](persistence.json), [auditoría de paquetes](dependency-audit.json). Las pruebas reales no son validación agronómica ni una prueba completa del navegador.

La fase posterior de acceso privado amplió la suite a **57 pruebas aprobadas**, verificó Edge, aplicó la migración 0007 y repitió el análisis real y la persistencia con PNG autenticado. La evidencia vigente de esos controles está en [seguridad](../security/README.md); los JSON de este directorio conservan el resultado de la fase de dependencias.

El rediseño posterior usa React/TypeScript y frontend construido por Docker; `integration.sh build` construye también esa imagen. Su evidencia está en [frontend](../frontend/README.md): 62 pruebas backend, 16 de frontend, nueve E2E y nuevas comprobaciones reales de EE/Google. La administración, volúmenes y contratos existentes se conservan; no hay migraciones de base de datos nuevas por el rediseño.
