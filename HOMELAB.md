# Primera ejecución en una laptop

Esta guía prepara una prueba en la propia máquina. El homelab documentado el 10 de noviembre de 2026 es una Toshiba Satellite L45-B con Debian 13, Intel i3-4005U (2 núcleos / 4 hilos) y 8 GB de RAM. Ya dispone de Docker, Compose y acceso privado por Tailscale. El consumo real de la aplicación depende del área y del análisis; todavía no se ha medido en esta laptop.

El stack actualizado está preparado y probado en Docker/WSL en Windows; ver [integración](docs/integration/README.md). Esa prueba no equivale a un despliegue en el homelab.

El frontend actual usa React/TypeScript y se construye con Node dentro de una etapa Docker; el contenedor final solo ejecuta Nginx. No se añade un servidor Node a la laptop. Ver [rediseño y pruebas](docs/frontend/README.md) para la nueva navegación, leyendas, evidencia y reversión local.

La máquina de trabajo Windows y el servidor Debian son distintos: este checkout local todavía debe transferirse o clonarse en Debian antes de usarlo allí. En el servidor, la administración de Docker requiere `sudo` interactivo. Antes de desplegar, inventariar los contenedores y proyectos existentes con el propietario, y conservar los datos que se encuentren.

## Requisitos y configuración

- Linux con Docker Engine y el plugin Docker Compose, Git y conexión a internet. Los mapas, Earth Engine y, si se usa, el proveedor de IA son servicios externos.
- Una cuenta y un proyecto de Google Earth Engine configurados, con la credencial de servicio descrita en el README. Sin ellos se puede iniciar la interfaz, pero no ejecutar un análisis real.
- En la versión científica actual los informes son deterministas y no necesitan clave LLM. La configuración del proveedor queda reservada para una fase futura.

```bash
git clone https://github.com/BorixQ/quenaris_mvp.git
cd quenaris_mvp
cp .env.example .env
mkdir -p credentials
python3 -c 'import secrets; print(secrets.token_urlsafe(50))'
```

Edita `.env`: usa la clave generada para `DJANGO_SECRET_KEY`, elige una contraseña fuerte para `POSTGRES_PASSWORD` y completa las variables de Earth Engine. Copia la clave JSON a `credentials/gee-sa-key.json`. No compartas ni subas `.env` o `credentials/` a Git. Los valores de ejemplo no son credenciales válidas.

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web worker
docker compose exec web python manage.py createsuperuser
docker compose exec worker python manage.py check_gee
```

Abre `http://localhost:8080` en la laptop. El administrador está separado en `http://localhost:8001/admin/`, ligado únicamente a loopback. Desde otro equipo, acceder mediante túnel SSH como explica la [guía de seguridad](docs/security/README.md). `/admin/` en el frontend devuelve 404. Al arrancar, `web` aplica las migraciones existentes y recopila los archivos estáticos. No ejecutes `makemigrations` como parte del despliegue: solo corresponde cuando se modifican modelos durante el desarrollo.

`CELERY_CONCURRENCY=1` y `WEB_WORKERS=2` son valores iniciales conservadores, no una garantía de capacidad. Para revisar consumo usa `docker stats`; si faltan recursos, revisa los logs y reduce el área o el rango de fechas. Cambiar el `.env` requiere recrear servicios con `docker compose up -d`, no solo reiniciarlos.

## Red y datos

El frontend escucha únicamente en `127.0.0.1` por defecto. Para probar desde la red local, configura `FRONTEND_BIND_ADDRESS=0.0.0.0`, añade la IP o nombre de la laptop a `DJANGO_ALLOWED_HOSTS` y el origen completo (por ejemplo `http://192.168.1.10:8080`) a `DJANGO_CSRF_TRUSTED_ORIGINS`; después ejecuta `docker compose up -d`. HTTP transmite credenciales y tokens sin cifrar: utilízalo solo en una red de confianza y prepara HTTPS antes de cualquier acceso remoto.

La intención documentada es publicar únicamente Quenaris en `quenaris.tech` mediante Cloudflare, manteniendo la administración privada. Cloudflare Tunnel no se inicia por defecto. Para activarlo explícitamente, configura `CLOUDFLARE_TUNNEL_TOKEN`, configura el servicio de destino del túnel para llegar al contenedor `frontend` en el puerto 80 y usa `docker compose --profile tunnel up -d`. Los medios ahora comprueban propietario y token; el frontend bloquea el administrador. Antes de publicar, configurar HTTPS y encabezados del proxy, comprobar IP real/throttles y evitar caché pública de `/api/` y `/media/` siguiendo la [guía de seguridad](docs/security/README.md). La fase actual solo ha probado esos controles localmente.

Antes de actualizar una base existente desde las imágenes PostGIS antiguas a 3.7, usar dump/restore en un volumen nuevo y revisar la advertencia de la guía de integración. No reutilizar un volumen antiguo automáticamente.

La base de datos y los archivos generados viven en volúmenes de Docker. Una copia SQL de la base **no** incluye los mapas guardados en `media_data`; respalda ambos por separado y comprueba la restauración. No uses `docker compose down -v` si deseas conservarlos. Cambiar `POSTGRES_PASSWORD` en `.env` no cambia la contraseña de una base ya inicializada.

## Comprobaciones pendientes

- Probar el arranque completo, login, análisis y recuperación de datos en la laptop real.
- Medir CPU y memoria durante un análisis representativo con los límites numéricos ya configurados; ajustar capacidad en la laptop real.
- Confirmar las credenciales, cuotas y condiciones de uso de Earth Engine para el despliegue.
- Validar científicamente índices, puntuaciones e informes con datos de campo.
- Verificar en el homelab los controles de acceso ya probados localmente, HTTPS/proxy, política de retención y restauración de backups antes de publicar.
