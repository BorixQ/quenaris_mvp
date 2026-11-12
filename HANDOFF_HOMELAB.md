# Handoff: levantar Quenaris en el homelab

**Fecha:** 10 de noviembre de 2026, America/Lima.

**Destinatario:** propietario o agente que continuará el despliegue.
**Supuesto:** comenzar con una prueba privada y, después de validarla, preparar la publicación HTTPS de `quenaris.tech`. Este documento es un traspaso; no afirma que el despliegue esté hecho.

## Objetivo y criterio de terminado

Ejecutar Quenaris en la laptop Debian, acceder de forma privada, completar un análisis pequeño y comprobar la persistencia y la recuperación de datos. Antes de abrirlo a Internet, revisar y probar HTTPS, Cloudflare, autenticación, medios privados y copias restaurables. La aplicación produce resultados exploratorios sin calibración de campo.

## Estado actual

- **Código publicado:** `main` del repositorio [BorixQ/quenaris_mvp](https://github.com/BorixQ/quenaris_mvp), commit `3a2d44366bdd2cb1f3da7ada13504e99a319552b` (verificar HEAD al iniciar). Incluye frontend React, motor científico, controles de acceso y Compose.
- **No publicado aún:** el README actualizado y este handoff están como cambios locales en el checkout Windows, fuera del commit indicado. Un `git clone` del servidor no los incluirá hasta que se registren y suban.
- **Comprobado en Windows/WSL:** 62 pruebas backend, 16 de frontend y 14 E2E; login Google y un análisis real con Earth Engine. Son pruebas técnicas, no una validación agronómica ni una prueba en Debian.
- **Homelab:** no se ha desplegado Quenaris en esta fase. La información siguiente proviene del handoff de infraestructura del 10 de noviembre y puede haber cambiado; verificar el estado actual.
- **Datos:** las cuentas, cuotas, análisis y PNG del entorno de integración Windows permanecen en sus volúmenes locales. Clonar el repositorio no los traslada al homelab. Si se desean conservar, planificar una migración explícita y ensayar la restauración; no copiar los datos de prueba como si fueran producción.

## Contexto de la laptop

Toshiba Satellite L45-B, Debian 13, i3-4005U (2 núcleos/4 hilos), 8 GB RAM y SSD de 240 GB. Docker Engine, Compose, SSH con claves y Tailscale estaban instalados. Desde el Windows configurado se usa `ssh homelab`; confirmar conectividad y huella del host. La fuente de infraestructura es `C:/Users/bq/Documents/ChatGPT/Homelab/HANDOFF.md` en Windows; el checkout de Quenaris es otro proyecto.

El usuario `bq` requiere **sudo interactivo** para Docker. No pedir contraseñas o tokens por chat, modificar sudoers ni dar permisos adicionales solo para automatizar el despliegue. El propietario debe introducir su contraseña localmente cuando corresponda.

## Decisiones y límites

- Comenzar con frontend y administrador en loopback del servidor; consultar desde Windows mediante SSH/Tailscale. Mantener PostGIS y Redis sin puertos publicados.
- Compose principal: `docker-compose.yml`. `compose.integration.yml` es solo para pruebas aisladas y usa credenciales ficticias; no emplearlo como configuración pública.
- Primera configuración de recursos: `CELERY_CONCURRENCY=1` y `WEB_WORKERS=2`, sujetos a medición en la laptop. Las bibliotecas numéricas de la imagen ya tienen `OMP_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1` y `MKL_NUM_THREADS=1`. No son límites duros de memoria o CPU.
- El informe es determinista; no se necesita clave LLM. Los estudios de riego, fitosanidad y nutrición permanecen experimentales.
- El túnel Cloudflare es opcional y no se inicia por defecto. La única aplicación prevista para publicación es Quenaris; administración y otros servicios permanecen privados.
- No reinstalar Debian ni reconstruir el homelab. El frontend antiguo abierto como `file://` no funciona como despliegue: usar la app servida por Nginx.

## Pasos de entrega

### 1. Inventariar el servidor antes de cambiarlo

En Windows, `ssh homelab`. En la sesión Debian, con el propietario presente para sudo:

```bash
sudo docker ps -a
sudo docker compose ls
sudo docker volume ls
sudo docker info --format '{{.LoggingDriver}}'
df -h
free -h
```

Registrar proyectos, puertos y volúmenes existentes. La observación anterior de `/srv` vacío no garantiza que siga así. El Compose de Quenaris usa nombres fijos de contenedores `geoinsight_*`: comprobar conflictos antes de arrancar. No eliminar contenedores, volúmenes ni datos existentes. Acordar la ubicación definitiva; `/srv/stacks/quenaris` es una propuesta, no un directorio ya creado.

### 2. Obtener la versión y preparar configuración

En una ubicación acordada y vacía del servidor, clonar [el repositorio](https://github.com/BorixQ/quenaris_mvp) y comprobar `git status` y `git rev-parse HEAD`. Revisar `README.md`, `HOMELAB.md`, `docker-compose.yml` y `docs/security/README.md` **del checkout utilizado**. Si HEAD es posterior al commit de arriba, revisar los cambios antes de aplicarlos.

Copiar `.env.example` a `.env` solo si no existe una configuración que deba conservarse. Generar `DJANGO_SECRET_KEY` larga y aleatoria, establecer `POSTGRES_PASSWORD` única y completar las opciones requeridas sin publicar sus valores. Mantener `.env` restringido al propietario y fuera de Git. Dejar `FRONTEND_BIND_ADDRESS=127.0.0.1`, `FRONTEND_PORT=8080` y `ADMIN_PORT=8001` para la prueba privada, comprobando que no haya conflictos de puertos.

**Earth Engine:** el proyecto usado en la prueba local fue `quenaris-499120`. El worker del Compose principal espera una cuenta de servicio y un JSON mediante `GEE_PROJECT`, `GEE_SERVICE_ACCOUNT` y `GEE_PRIVATE_KEY_FILE=/credentials/gee-sa-key.json`. El usuario indicó que ya no dispone de claves o tokens: revisar en Google Cloud qué credencial apropiada puede usarse y provisionarla de forma segura; no asumir que existe una clave reutilizable. La autenticación OAuth de usuario de Windows era solo para integración y no se copia automáticamente. La lectura del archivo debe funcionar para el usuario del contenedor **UID 10001**, sin hacer la clave pública; verificar permisos, grupo numérico y posible remapeo de usuarios Docker. No pegar ni imprimir la clave. La decisión de crear una clave nueva depende de las políticas y permisos del proyecto.

**Google login:** opcional; el client ID web es público y se configura por separado de Earth Engine. Validar los orígenes JavaScript exactos en Google Cloud. Los orígenes `localhost:8080` y `127.0.0.1:8080` se usaron en Windows; un túnel abierto como `localhost:18080` es un origen distinto. El login local usuario/contraseña permite hacer la primera prueba sin cambiar Cloud. La cuenta Google y su cuota de Windows no se migran con Git.

### 3. Construir y comprobar en privado

Desde la raíz del checkout Debian, después de revisar `.env`, credenciales, colisiones y volúmenes:

```bash
sudo docker compose config --quiet
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 web worker
sudo docker compose exec web python manage.py createsuperuser
```

La primera construcción puede tardar y consumir recursos. `web` aplica las migraciones al arrancar: si ya existe una base que deba conservarse, primero hacer y probar un respaldo compatible. Crear el superusuario solo si hace falta y guardar sus credenciales de forma segura. El frontend expone `127.0.0.1:8080`; el administrador, `127.0.0.1:8001`. Los puertos **18080/18081** pertenecían al entorno de integración de Windows y no son los valores predeterminados del Compose principal.

Desde PowerShell en Windows, si los puertos locales están libres:

```powershell
ssh -N -L 18080:127.0.0.1:8080 -L 18081:127.0.0.1:8001 homelab
```

Mantener la sesión abierta y acceder a `http://localhost:18080/analisis` y `http://localhost:18081/admin/`. Si los puertos locales están ocupados, elegir otros libres. Comprobar el origen de Google antes de usar ese login. El administrador usa su cuenta Django y no debe publicarse por Cloudflare. El frontend público bloquea `/admin/`.

Con la credencial EE configurada y legible por el worker:

```bash
sudo docker compose exec worker python manage.py check_gee --lon -71.537 --lat -16.409
```

Leer todo el resultado: el comando muestra el primer fallo, pero no debe asumirse que su código de salida siempre detecta un error. Después ejecutar **un único análisis terrestre pequeño** desde la interfaz, con cuota suficiente y fechas válidas. Registrar área aproximada, fechas, escenas, resultado, PNG privado, tiempos y consumo. Comprobar que otro usuario no puede acceder al resultado ni a sus imágenes. Las consultas reales consumen recursos/cuota de Earth Engine.

### 4. Operación, persistencia y respaldo

Revisar `sudo docker stats`, disco, logs y estado de tareas durante un análisis representativo; ajustar solo tras medir. La cola tiene límite blando de 25 min y duro de 30 min; `beat` recupera tareas obsoletas, sujeto a que el worker y Redis estén operativos. Comprobar reinicio y persistencia sin eliminar volúmenes.

Diseñar copias externas de PostGIS **y** del volumen de mapas `media_data`, además de la recuperación segura de configuración/secretos. Un dump SQL por sí solo no contiene los PNG. Probar restauración en un entorno aislado antes de depender del servicio. No usar `docker compose down -v`, borrar volúmenes o reutilizar volúmenes PostGIS de versiones anteriores sin plan de migración compatible. Cambiar `POSTGRES_PASSWORD` en `.env` no actualiza una base ya inicializada.

### 5. Preparar la publicación después de la prueba privada

Revisar con el propietario DNS y túnel existentes en Cloudflare, configurar el destino al servicio `frontend:80` en su red y comprobar HTTPS. Antes de habilitarlo, ajustar `DJANGO_ALLOWED_HOSTS`, CORS/CSRF y el origen Google al dominio real; revisar `DJANGO_REQUIRE_HTTPS`, `DJANGO_TRUST_PROXY_SSL`, cookies, cabeceras de proxy y la IP real usada para throttling. No cachear públicamente `/api/` ni `/media/`. Verificar desde otra red que el administrador no es público y que los resultados y PNG de otros usuarios se deniegan. La etiqueta de cloudflared en el Compose es móvil: acordar versión y actualización antes de depender de ella. El estado de DNS/túnel anterior es histórico; verificarlo de nuevo.

## Pendientes y riesgos

- **Propietario:** confirmar dónde instalar y si se migrarán datos de Windows; asegurar acceso sudo interactivo y credenciales EE autorizadas.
- **Operación:** medir recursos, temperatura, SSD y recuperación tras cortes; diseñar y probar respaldos fuera de la laptop. No hay una medición de capacidad ni restauración verificada en este servidor.
- **Seguridad:** validar exposición IPv4/IPv6, Tailscale, proxy, cabeceras, cache y retención de PNG. Eliminar un análisis impide su acceso, pero la limpieza de archivos y copias sigue pendiente según la guía de seguridad.
- **Ciencia y UX:** faltan calibración/validación en campo y pruebas de usabilidad con agrónomos; no presentar pruebas de software como precisión agronómica.
- **Credenciales:** una cuenta administradora local se crea por servidor; el inicio con Google y la autorización EE son configuraciones distintas.

## Referencias

- [README de Quenaris](README.md), [guía de homelab](HOMELAB.md), [seguridad](docs/security/README.md), [integración](docs/integration/README.md), [auditoría científica](docs/science/AUDIT.md), [frontend](docs/frontend/README.md).
- En Windows: `C:/Users/bq/Documents/ChatGPT/Homelab/HANDOFF.md` es el handoff de infraestructura; contiene una fotografía anterior del código, así que usar el commit actual indicado arriba para Quenaris.
- Este documento no contiene contraseñas, claves ni tokens. No se han efectuado cambios en el servidor al redactarlo.

**Primera acción recomendada:** conectar por SSH y completar el inventario Docker privilegiado de la sección 1 junto al propietario, antes de elegir ruta o arrancar servicios.
