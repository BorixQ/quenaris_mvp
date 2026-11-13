# Acceso privado, cuotas y recuperación

Revisión local del código; el homelab puede ejecutar una versión anterior. Esta guía complementa la [revisión científica](../science/AUDIT.md), la [integración](../integration/README.md) y el [registro autónomo](registro-autonomo.md).

## Cambios de acceso

- `/api/analyses/` y sus detalles son exclusivos del propietario, también cuando quien consulta es superusuario. La gestión de otros usuarios corresponde al administrador privado.
- El propietario puede habilitar lectura anónima de un análisis completado mediante un enlace independiente. El interruptor revoca tanto el JSON público como los PNG compartidos. Las rutas privadas conservan sus comprobaciones de propietario. Ver [compartir análisis](compartir-analisis.md).
- La portada y `/destacados` muestran únicamente proyectos con enlace activo seleccionados por una cuenta administradora. `/compartidos-conmigo` es una colección privada de enlaces guardados explícitamente por su destinatario. Guardar o destacar no concede permisos para modificar el análisis original. Ver [reglas de descubrimiento y colección](descubrir-proyectos.md).
- Los PNG de `/media/heatmaps/` pasan por Django: token válido, propietario, análisis completado y capa/mes registrados en el resultado. Se rechazan rutas arbitrarias y enlaces simbólicos que salgan del directorio del análisis. Nginx no monta ni sirve el volumen de medios directamente.
- Las respuestas privadas llevan `Cache-Control: private, no-store` y `Vary: Authorization, Cookie`. Los PNG se guardan por intento; solo se sirve el intento que se confirmó en la base. Los resultados anteriores mantienen su URL protegida sin exigir recálculo.
- MapLibre adjunta el token únicamente a imágenes bajo `/media/heatmaps/` del mismo origen. No se añaden credenciales a imágenes compartidas ni a mapas de terceros. Las imágenes privadas requieren autenticación; las compartidas usan la ruta específica autorizada por su enlace.
- Los tokens duran 24 horas desde su emisión, sin renovación automática por actividad. Se guardan en `sessionStorage`; al actualizar se elimina el token histórico de `localStorage`, por lo que hay que iniciar sesión otra vez. Cerrar sesión revoca el token en el servidor. Se conserva un token por usuario: cerrar sesión afecta a sus otras pestañas/sesiones que compartan ese token.
- Las cookies de sesión Django autentican solo el administrador, con ruta `/admin/`, HttpOnly y protección CSRF. La API pública acepta tokens, no esas cookies. Se escapan los nombres, correos y mensajes de error insertados en HTML; los informes se muestran como texto.

Google login es opcional. El backend verifica el ID token, exige correo verificado y persiste la identidad por `sub`. El registro abierto está desactivado por defecto. Cuando se habilita, crea cuentas nuevas sin vincularlas automáticamente a cuentas existentes; las cuentas históricas conservan el procedimiento administrativo de autorización. El acceso por código de correo se configura por separado. Consulta las condiciones y limitaciones de ambos métodos en [registro autónomo](registro-autonomo.md). La configuración pública expone únicamente el client ID, no secretos.

La app debe abrirse desde el servidor HTTP, no abriendo `frontend/login.html` como `file://`. El formulario muestra un enlace al servidor cuando detecta ese caso y avisa si Google no está configurado o su librería no se pudo cargar. El Compose de integración usa 18080 por defecto; en este checkout, la configuración local lo cambia a `http://localhost:8080/login.html` para coincidir con el cliente Google existente.

Para habilitar Google se necesita un cliente OAuth de tipo **Aplicación web** del proyecto correspondiente. El puerto de la app debe coincidir con un origen JavaScript autorizado del cliente (sin `/login.html`); usar el dominio HTTPS exacto cuando se despliegue. El cliente existente de Quenaris ya autorizaba `http://localhost:8080`, `http://127.0.0.1:8080` y `https://quenaris.tech`. Se reutilizó su configuración, sin modificarla en Google Cloud. Esta integración utiliza un callback JavaScript; no requiere un client secret en la app ni activar la API de Gmail. Ver [configuración oficial de Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

El Compose de integración acepta `GOOGLE_OAUTH_CLIENT_ID` e `INTEGRATION_FRONTEND_PORT` desde el entorno o `.env`. El archivo `.env` local, excluido de Git, guarda el client ID público y el puerto 8080 junto con la ruta OAuth de EE; no contiene un client secret ni copia las credenciales de EE. Recrear los servicios después de cambiarlo. Para iniciar sin ejecutar un análisis de prueba: `bash scripts/integration.sh start`. Mantener WSL activo durante el uso. No reutilizar este `.env` de desarrollo como configuración del Compose de producción.

## Cuotas y tareas

La reserva de cuota y la comprobación de un único análisis activo por usuario se hacen con bloqueo de fila en PostGIS. Las cuentas de prueba usan un saldo acumulado de hectáreas; las cuotas especiales existentes conservan su modalidad. Borrar un análisis completado no recupera la cuota consumida. Se rechaza borrar trabajos activos. Un fallo terminal o de publicación devuelve la reserva una sola vez; un reintento temporal la conserva. Ver [saldo y migración](cuotas-area.md).

Cada ejecución adquiere un identificador de intento bajo bloqueo. Una entrega duplicada no ejecuta un trabajo activo reciente; un intento antiguo no puede guardar resultados ni restituir la cuota de otro. La publicación de resultados y el cambio a COMPLETED son atómicos. Un corte entre el commit y la publicación puede dejar un PENDING huérfano; la recuperación intenta volver a publicarlo sin consumir otra cuota.

`beat` programa la recuperación cada cinco minutos. Un PROCESSING sin actividad durante 35 minutos se marca fallido; un PENDING antiguo se republica como máximo una vez por intervalo y conserva su cuota. Se comprueba de nuevo el estado bajo bloqueo y se usa el inicio del último intento para no recuperar prematuramente un reintento reciente. El broker puede contener mensajes duplicados que el worker ignora. La ejecución efectiva depende de que Redis y un worker estén disponibles; no es una garantía de recuperación en exactamente 35 minutos. Ejecutar una sola instancia de beat. También se puede llamar manualmente a `python manage.py recover_stale_analyses`.

Los análisis históricos anteriores a la migración 0006 no se marcan retrospectivamente como reservas; revisar su contabilidad antes de recuperarlos.

Límites operativos, además de las cuotas asignadas en el administrador:

| Control | Valor actual |
|---|---|
| Trabajo activo por usuario | 1 |
| Creación de análisis | 40/hora por usuario |
| Login | 100/hora por IP; contraseña además 20/hora por cuenta |
| Cuerpo HTTP | 128 KiB |
| AOI | Polígono WGS84 válido, hasta 1000 vértices y 50 km² |
| Periodo | Límite en días por análisis; por defecto 124 días (aproximadamente 4 meses) para cuentas de prueba |
| Descarga estimada del composite | Hasta 24 MiB; lado de cuadrícula hasta 9500 píxeles |

La estimación de descarga corresponde a la cuadrícula nominal actual de 20 m en EPSG:4326; actualizar la comprobación si cambia la descarga del pipeline. Los límites son protección de recursos, no criterios de validez científica. El worker mantiene su límite de 30 minutos y genera mapas mes a mes: ampliar la cuota temporal no garantiza que periodos largos terminen a tiempo. Los throttles usan Redis compartido y son orientativos ante concurrencia, como advierte [DRF](https://www.django-rest-framework.org/api-guide/throttling/); la reserva de cuota usa transacciones de base de datos.

## Administración privada y publicación futura

El servicio `admin` tiene una URLconf distinta, sin la API de análisis, y publica únicamente `127.0.0.1:8001`. El frontend público devuelve 404 en `/admin/` y `/static/`; tampoco puede llegar al administrador a través de su proxy. En integración se usan 18080 para la app y 18081 para el administrador. La red propia del administrador permite publicar ese puerto en localhost; PostGIS y Redis permanecen en una red interna sin puertos publicados.

En la laptop: abrir `http://localhost:8001/admin/`. Desde otro equipo con acceso SSH privado al homelab, un ejemplo de túnel es:

```bash
ssh -N -L 8001:127.0.0.1:8001 USUARIO@IP_PRIVADA_DEL_HOMELAB
```

Abrir después `http://localhost:8001/admin/` en ese equipo. Mantener la sesión SSH abierta. El Compose desactiva Secure/redirect HTTPS solo en este servicio de loopback para permitir el túnel HTTP local. No cambiar ese bind a `0.0.0.0`, no publicarlo por Cloudflare y no reutilizar sus cookies como autenticación pública.

Antes de publicar la app por HTTPS, configurar dominio/orígenes exactos y `DJANGO_REQUIRE_HTTPS=1`, `DJANGO_TRUST_PROXY_SSL=1`, `DJANGO_COOKIE_SECURE=1`. El proxy de entrada debe sobrescribir `X-Forwarded-Proto`; no aceptar ese encabezado de clientes no confiables. La clave Django es obligatoria y de al menos 50 caracteres; generarla aleatoriamente y no usar la clave de integración. No copiar el Compose de integración a producción.

Nginx sobrescribe `X-Forwarded-For` con su par directo para evitar suplantación. Detrás de Cloudflare Tunnel, el throttle por IP agrupará conexiones por el proxy hasta configurar y probar una cadena de IP real confiable. La cuota por usuario sigue aplicándose. No habilitar reglas de CDN que cacheen `/api/` o `/media/`; purgar cualquier caché de medios públicos de la versión antigua. Los recursos de terceros siguen sujetos a sus propios servicios y política de privacidad.

## Evidencia y límites

La fase posterior de rediseño React conserva estos controles y añade las leyendas del colorizador. Su evidencia actualizada está en [frontend](../frontend/README.md): 62 pruebas backend, controles de navegador renovados y login Google real en la SPA. El entorno local queda activo en el puerto 8080; los resultados siguientes describen la fase anterior.

Resultado final: **57 tests aprobados**, prueba Edge aprobada y análisis real con Earth Engine completado (13 escenas, tres grupos). Se comprobó la devolución de cuota del caso sin datos, la persistencia tras recrear contenedores y la protección del PNG en la imagen final. Django no detectó problemas ni cambios de modelos pendientes; migraciones hasta 0007 aplicadas en integración. Ambos Compose se validaron y solo frontend/administrador publicaron puertos, ligados a localhost.

Evidencia: [verificación y puertos](verification.json), [navegador](browser.json), [análisis real](smoke.json), [persistencia](persistence.json). Se detuvo el proyecto aislado al terminar conservando los volúmenes.

Los resultados seguros para compartir se guardan en este directorio, sin contraseñas ni tokens. `scripts/security_browser.py` crea usuarios y un PNG sintéticos solo en el entorno aislado y comprueba login, imagen real de MapLibre, ausencia de token en solicitudes externas, nombre tratado como texto, denegación a terceros, administrador privado y logout. Requiere Windows/WSL con Edge y Playwright. `scripts/integration_smoke.py` comprueba además HTTP → Redis/Celery → Earth Engine → PostGIS → PNG protegido y devolución de cuota ante un caso sin datos.

Reproducir los controles en el entorno de desarrollo preparado:

```bash
export GEE_OAUTH_DIRECTORY=/ruta/local/al/directorio/oauth
bash scripts/integration.sh build
bash scripts/integration.sh unit
bash scripts/integration.sh smoke
```

Con el stack activo, en PowerShell desde el repositorio: `.venv\Scripts\python.exe scripts\security_browser.py`. Para el puerto local actual, definir antes `$env:SECURITY_BROWSER_BASE_URL="http://localhost:8080"`. Este script está adaptado a Ubuntu WSL y a la ruta local actual; revisar sus constantes al usar otro checkout. Los scripts que crean fixtures exigen `INTEGRATION_TEST_ENV=1`, configurado solo en el servicio de pruebas. Al terminar: `bash scripts/integration.sh stop` (sin eliminar volúmenes).

Los tests de Google simulan el verificador y cubren las decisiones de vinculación/autorización. En una comprobación posterior del mismo día se completó también un login real con Gmail en `localhost:8080` y se verificó que el perfil devolvía la cuenta autenticada y su cuota. Evidencia sin tokens ni correo: [login Google real](google-login.json). La app quedó activa para el usuario después de esa comprobación. OAuth de Earth Engine es independiente. El uso de `sub` y la validación del ID token siguen la [documentación de Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Esta fase no incluye una prueba de penetración completa, restauración de backups, medición en la laptop real ni validación agronómica. `sessionStorage` es accesible a JavaScript del mismo origen; la cabecera CSP actual limita marcos/objetos/base pero no es una política completa contra XSS. Los scripts de terceros conservan ese riesgo. La eliminación de un registro impide acceder a sus medios por la API, pero no elimina los PNG del volumen o backups: la política de retención y limpieza sigue pendiente. Los operadores con acceso a Docker, base de datos o backups mantienen acceso administrativo a los datos.
