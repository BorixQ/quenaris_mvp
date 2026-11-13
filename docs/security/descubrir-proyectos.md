# Portada pública, Compartidos conmigo y proyectos destacados

Preparado y comprobado en local el 13 de noviembre de 2026. El estado de cada despliegue debe verificarse en la instalación correspondiente.

## Navegación y uso

- `/` es la nueva portada pública: presentación de Queñaris, tres destacados recientes, acceso a la galería y al espacio de análisis.
- `/destacados` permite explorar todos los proyectos seleccionados, nueve por página, sin crear una cuenta. El login incluye **Ver proyectos destacados** antes del formulario.
- **Mis análisis** mantiene los trabajos creados por la cuenta.
- **Compartidos conmigo**, junto a Mis análisis en la navegación, reúne análisis de otras personas que la cuenta guardó desde un enlace. Su texto explicativo distingue recibir un análisis de compartir uno propio.

Para guardar un análisis recibido, abre su enlace y pulsa **Guardar en Compartidos conmigo**. Si no has iniciado sesión, **Entrar para guardar en mi cuenta** vuelve al análisis después del acceso; entonces puedes guardarlo. También puedes pegar un enlace de este mismo servidor en la colección. Abrir un enlace por sí solo no crea ningún registro de recibido. No se envían correos ni invitaciones automáticas.

Los enlaces guardados se pueden quitar de la colección sin borrar el análisis original. Si el propietario retira el acceso, el registro muestra **Acceso retirado** sin proporcionar un enlace funcional ni nuevos datos del proyecto. Volver a activar el interruptor genera un enlace nuevo: el destinatario debe recibirlo y guardarlo para recuperar el acceso.

## Destacar proyectos como administrador

Las cuentas activas con `is_staff` o `is_superuser` pueden seleccionar proyectos. Se verificó también un administrador con `is_staff=True` e `is_superuser=False`.

1. **Proyecto propio:** completa el análisis, activa su enlace y usa **Destacar proyecto** en el bloque Administración.
2. **Proyecto recibido:** abre el enlace activo que te enviaron; el bloque Administración permite destacarlo. Guardarlo en tu colección es opcional y facilita volver a encontrarlo.
3. Puedes añadir una descripción de hasta 320 caracteres para la portada, actualizarla o **Quitar de destacados**. Cualquier administrador puede gestionar la selección de un proyecto cuyo enlace conoce.
4. Una vez destacado, puedes cargar, cambiar o quitar su imagen de tarjeta. Admite JPEG, PNG y WebP de hasta 2 MB y 16 megapíxeles; se recorta visualmente en formato horizontal. Sin imagen se utiliza la ilustración del polígono.

El bloque avisa que el proyecto aparecerá públicamente, sin iniciar sesión. Destacar no activa por sí mismo el enlace de un análisis privado. El texto del interruptor del propietario informa que la administración podrá seleccionar el proyecto para la portada.

Cuando el propietario desactiva el enlace, la selección se elimina en la misma transacción. Reactivar el enlace no vuelve a destacar automáticamente el proyecto. Las consultas públicas verifican además que el enlace de la selección coincida con el actual, el análisis esté completado, conserve su resultado y su propietario esté activo. Un enlace antiguo o un identificador privado no permite seleccionar un proyecto ajeno.

Una cuenta administradora que recibió un enlace mantiene lectura sobre su contenido: no adquiere permiso para modificar, eliminar, recalcular ni cambiar la configuración de compartir del análisis original. Las rutas privadas continúan restringidas al propietario, incluso para administradores.

## Persistencia y API

La migración `0014_received_featured_analyses` añade dos entidades, sin seleccionar proyectos ni guardar enlaces retrospectivamente:

| Entidad | Datos y límite de acceso |
| --- | --- |
| `ReceivedAnalysis` | Cuenta destinataria, análisis, versión del enlace, nombre visto al guardar y fecha. Único por cuenta/análisis. El nombre anterior permite identificar un acceso retirado sin revelar cambios privados posteriores. |
| `FeaturedAnalysis` | Análisis, versión del enlace vigente al seleccionarlo, descripción, cuenta administradora y fecha de selección. Un registro por análisis. La identidad del administrador no se expone en las tarjetas públicas. |

| Ruta | Acceso y operación |
| --- | --- |
| `GET /api/featured/` | Anónimo. Lista paginada de tarjetas con nombre, descripción, tipo, fechas, área, polígono y enlace activo. Excluye cuentas, correos y metadatos internos. |
| `GET /api/received/` | Autenticado. Lista paginada de la colección propia. Un registro sin acceso conserva únicamente identificador de colección, nombre anterior, fecha y estado. |
| `DELETE /api/received/<id>/` | Solo la cuenta que guardó el enlace; elimina el registro de colección. |
| `GET /api/shared/<enlace>/account/` | Autenticado. Opciones para esa cuenta: propietario, guardado, posibilidad de destacar y estado de selección. Es independiente de la consulta pública del resultado. |
| `POST /api/shared/<enlace>/account/` | Autenticado. Guarda o actualiza la referencia al enlace recibido. Rechaza guardar un análisis propio. |
| `POST /api/analyses/<id>/featured/` | Administrador propietario, con enlace activo para seleccionar. |
| `POST /api/shared/<enlace>/featured/` | Administrador con enlace activo de un proyecto recibido. |

Las acciones de destacar reciben `enabled` y una descripción opcional. Guardar y destacar usan bloqueo del análisis para coordinarse con la revocación del propietario. No ejecutan Earth Engine, duplican resultados ni consumen cuota. Todas las nuevas respuestas llevan `Cache-Control: private, no-store`. La galería anónima ignora credenciales antiguas; la cuenta se consulta únicamente para opciones privadas de una sesión iniciada.

La imagen se valida por contenido y dimensiones, se orienta según EXIF y se vuelve a codificar en WebP sin metadatos, con un máximo de 1200 × 800 píxeles. El archivo procesado se guarda en PostGIS junto al registro destacado y se incluye en los respaldos de la base. Una URL versionada se comprueba contra el enlace actual en cada descarga: reemplazar o quitar la imagen, retirar el destacado o desactivar el enlace invalida la URL anterior. El proxy acepta hasta 3 MB solo en las rutas de carga; la aplicación impone 2 MB por archivo. Como cualquier contenido público, una imagen ya descargada puede conservarse por el visitante.

## Demostración y verificación local

- **135 pruebas de backend aprobadas:** se mantienen autenticación, ciencia y cuotas; se añaden pruebas de colección privada, aislamiento entre cuentas, guardado explícito/idempotente, retirada de acceso, regeneración, roles de administrador, descripción, paginación y filtros de visibilidad.
- **42 pruebas de interfaz aprobadas:** portada sin autenticación, estados vacíos, paginación, importación de enlaces, retorno desde el login, guardado explícito, registros retirados y controles de administrador.
- **4 pruebas Edge aprobadas:** dos recorridos de descubrimiento y dos de compartir, a 1440 y 360 px. Usan la API local real y contextos separados para propietario, administrador, destinatario y visitante sin sesión. Comprueban destacar proyectos propios/recibidos, guardar, retirar acceso, navegar desde el login y cargar/revocar mapas.
- Axe no encontró infracciones en las reglas WCAG ejecutadas sobre portada, colección y vistas de compartir. Esto no sustituye una revisión manual completa.
- Construcción TypeScript/Vite y Docker correcta. `makemigrations --check --dry-run`: sin cambios pendientes. Se mantiene el aviso existente del tamaño de MapLibre.

`scripts/sharing_seed.py --discovery` crea únicamente en el entorno aislado dos proyectos simulados, un propietario, un administrador y un destinatario. No obtiene datos satelitales nuevos. La prueba del navegador activa enlaces y selecciona proyectos con los controles reales. Las tarjetas y los resultados identifican los datos como demostración. Las credenciales de esas cuentas se guardan en `.local-backups/discovery-preview.json`, excluido de Git; las rutas públicas de revisión están en `docs/frontend/evidence/discovery-preview.json`.

Capturas de escritorio y móvil: `docs/frontend/evidence/discovery-home-*.png`, `discovery-gallery-*.png`, `discovery-received-*.png`, `discovery-admin-*.png` y `discovery-curate-received-*.png`. El acceso desde el login está en `discovery-login-1440.png`.

Para repetir, mantén WSL activo y usa exclusivamente `compose.integration.yml`:

```bash
docker compose -f compose.integration.yml build web tests frontend
docker compose -f compose.integration.yml up -d --wait db redis web frontend
docker compose -f compose.integration.yml run --rm --no-deps tests python -m pytest -q -o cache_dir=/tmp/pytest-cache
docker compose -f compose.integration.yml run --rm --no-deps tests python /app/manage.py makemigrations --check --dry-run
```

Desde `frontend/app` en Windows:

```powershell
npm.cmd test
npm.cmd run test:e2e -- discovery.spec.ts sharing.spec.ts
```

## Estado de publicación

La revisión pública local está en `http://localhost:8080/` y `http://localhost:8080/destacados`. La colección requiere iniciar sesión en `http://localhost:8080/compartidos-conmigo`. Para publicar una versión concreta, sigue la guía de CI/CD y comprueba las migraciones y el resultado en el servidor.
