# Compartir un análisis por enlace

Implementación preparada y comprobada en el entorno local de integración el 13 de noviembre de 2026. El estado de publicación depende de la versión instalada en cada entorno.

## Uso

1. Abre un análisis completado con resultados en **Mis análisis**.
2. En **Compartir análisis**, activa **Compartir por enlace**.
3. Usa **Copiar enlace** o **Abrir enlace**. El visitante accede sin cuenta al resumen, mapa, datos técnicos, informe y vista 3D.
4. Apaga el interruptor para retirar el acceso. Al volver a activarlo se genera un enlace distinto y el anterior sigue revocado.

La interfaz espera la confirmación del servidor antes de cambiar el estado del interruptor. Un fallo de guardado muestra un error y permite reintentar. Las solicitudes duplicadas de activación conservan el enlace vigente.

## Alcance del acceso

Todos los análisis existentes y nuevos empiezan privados: la migración `0013_analysis_share_token` agrega un UUID opcional sin asignarlo a registros previos. Solo el propietario puede activar o desactivar su enlace y solo se puede activar cuando el análisis está COMPLETED y tiene resultado. Compartir no ejecuta un nuevo análisis ni consume cuota.

El enlace contiene un UUID aleatorio distinto del identificador del análisis. Es una credencial de lectura: cualquiera que lo reciba o lo reenvíe puede ver la ubicación exacta del terreno, su nombre, fechas, configuración, grupos, estadísticas, mapas e informe. La respuesta pública usa una lista explícita de campos y excluye correo, cuenta, cuota, tareas internas, mensajes de error y controles de compartir. La administración puede seleccionar un proyecto con enlace activo para la portada pública; los enlaces que no fueron seleccionados no aparecen en la galería. Ver [portada, recibidos y destacados](descubrir-proyectos.md).

Las rutas privadas mantienen autenticación y propiedad, incluso para administradores. La vista compartida no permite crear copias, eliminar, modificar ni cambiar permisos; sí permite consultar e imprimir el informe. Desactivar al propietario o eliminar el análisis también deja el enlace sin acceso.

## Revocación y mapas

| Ruta | Acceso | Función |
| --- | --- | --- |
| `POST /api/analyses/<id>/sharing/` | Propietario autenticado | Recibe `{"enabled": true}` o `{"enabled": false}`; devuelve `sharing_enabled` y `share_path`. |
| `/compartido/<enlace>` | Visitante | Pantalla de lectura, fuera del control de inicio de sesión. |
| `GET /api/shared/<enlace>/` | Enlace vigente | Resultado con campos públicos y plantilla de mapas compartidos. |
| `GET /api/shared/<enlace>/heatmaps/<índice>/<mes>.png` | Enlace vigente | PNG del resultado y del intento confirmado; valida índice, mes y ruta. |

Cada consulta del resultado y cada descarga del mapa vuelven a comprobar el enlace en la base de datos. El servidor responde 404 desde que confirma la desactivación. Las respuestas JSON y PNG llevan `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noarchive` y `Referrer-Policy: no-referrer`. El documento de la app aplica `no-referrer` y la vista compartida agrega una directiva robots. Estas directivas piden a clientes y buscadores que no almacenen/indexen el contenido; no son una garantía contra quien ya tenga el enlace.

La pestaña compartida visible comprueba acceso cada 15 segundos y al recuperar el foco. Si el acceso fue revocado, sustituye el resultado por **Análisis no disponible**, también si ya había datos en memoria. Una descarga, impresión o captura que el visitante haya guardado antes de la revocación queda fuera del control del servidor.

## Revisión local y pruebas

La aplicación se verificó en `http://localhost:8080`, con PostGIS y Redis exclusivos de `compose.integration.yml`. Las nuevas migraciones se aplicaron solo a esa base local. No se iniciaron consultas nuevas de Earth Engine para esta función.

- Suite de backend: **117 pruebas aprobadas**, incluidas 18 de compartir (propiedad, anonimato, validación, cuota, solo lectura, revocación, rotación, PNG actuales/históricos y bajas).
- Suite de interfaz: **33 pruebas aprobadas**, incluidas activación, copia, desactivación, error de guardado, solicitudes duplicadas y retirada de datos ya cargados.
- Edge sobre API real local: **2 pruebas aprobadas**, a 1440 y 360 px. Verifican acceso desde un contexto sin sesión, carga del mapa mensual, informe, revocación del JSON y del PNG, actualización de la pestaña abierta y regeneración del enlace. Las teselas de fondo se sustituyen por una imagen de prueba en estas comprobaciones; la API y los permisos de los PNG se consultan realmente.
- Las comprobaciones de accesibilidad de propietario y visitante no detectaron infracciones en las reglas WCAG ejecutadas por axe. No equivalen a una auditoría manual completa.
- Construcción TypeScript/Vite y Docker del frontend completada. Se conserva el aviso de tamaño del paquete MapLibre.

Las capturas `docs/frontend/evidence/sharing-*.png` usan datos simulados y lo advierten en pantalla; no son resultados científicos de Seal. `scripts/sharing_seed.py` solo funciona en el servicio de pruebas aislado y crea la demostración sin activar su enlace. La prueba de navegador usa el interruptor real para activarlo.

Para repetir las pruebas en este equipo, mantén una sesión WSL abierta mientras usas los servicios. Desde la raíz del repositorio dentro de WSL:

```bash
docker compose -f compose.integration.yml build web tests frontend
docker compose -f compose.integration.yml up -d --wait db redis web frontend
docker compose -f compose.integration.yml run --rm --no-deps tests python -m pytest -q -o cache_dir=/tmp/pytest-cache
docker compose -f compose.integration.yml run --rm --no-deps tests python /app/manage.py makemigrations --check --dry-run
```

Desde `frontend/app` en Windows:

```powershell
npm.cmd test
npm.cmd run test:e2e -- sharing.spec.ts
```

El fixture guarda credenciales aleatorias de la cuenta sintética en `.local-backups/sharing-preview.json`, excluido de Git, para revisar el interruptor localmente. `docs/frontend/evidence/sharing-preview.json` contiene únicamente las rutas de la demostración. El enlace público puede abrirse sin esas credenciales.

## Paso a la web oficial

Una publicación deberá incluir backend, migraciones 0013–0015 y frontend de la misma versión; aplicar las migraciones antes de arrancar la API nueva y comprobar la revocación también a través del proxy público. Las cifras de pruebas de esta guía corresponden a la primera fase de compartir; la verificación ampliada está en [descubrimiento de proyectos](descubrir-proyectos.md).
