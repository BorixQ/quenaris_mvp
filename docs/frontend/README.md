# Frontend Quenaris: React, UI y UX

Implementado localmente el 10 de noviembre de 2026. La nueva app usa React, TypeScript estricto, Vite, React Router, TanStack Query y CSS Modules. MapLibre y los gráficos se cargan bajo demanda. Sora se sirve localmente con su licencia. Node solo interviene en la construcción; la imagen final contiene Nginx y los archivos estáticos.

La [auditoría y diseño](DESIGN.md) registra los hallazgos, decisiones, recorrido, sistema visual, roles de las skills y guion de revisión. No se han realizado entrevistas ni pruebas de usabilidad con agrónomos. Las verificaciones automatizadas no demuestran calibración científica ni conformidad WCAG completa.

## Abrir y ejecutar

En este checkout, abrir **http://localhost:8080/analisis**. No abrir los HTML como archivos. El `.env` local de integración conserva el client ID público de Google, la ruta de credenciales EE y el puerto 8080; sigue excluido de Git. No contiene un secreto de cliente Google ni copia las credenciales EE.

Desde Ubuntu WSL en la raíz del repositorio:

```bash
bash scripts/integration.sh build
bash scripts/integration.sh start
```

Mantener WSL activo durante el uso. No copiar este entorno de desarrollo con sus credenciales ficticias a producción. Para detenerlo y conservar datos: `bash scripts/integration.sh stop`. El homelab y GitHub no se modificaron en esta fase.

La configuración de ambos Compose construye `frontend/app` y sirve solo su `dist`; los HTML/JS anteriores conservados en `frontend` no forman parte de la imagen nueva. El proxy sigue protegiendo `/media/` y bloqueando `/admin/` en la entrada pública.

## Funciones

- Mis análisis reúne todos los estados, filtros y búsqueda; en pantallas pequeñas el historial se presenta por registros apilados.
- Asistente en cuatro pasos con dibujo, CSV/pegado de coordenadas, superficie aproximada, revisión y límites de cuenta. Fechas en America/Lima y fin exclusivo; el periodo inicial respeta min(30, cuota).
- Al pulsar «Dibujar polígono» el mapa ocupa la ventana para facilitar los vértices; «Listo, volver al análisis» conserva el terreno. En los resultados y en 3D, «Ampliar mapa» mantiene la leyenda y los controles visibles. Escape vuelve a la vista anterior sin reiniciar el mapa.
- Cinco estudios; los tres módulos no priorizados llevan además la identificación Experimental. Ninguno se presenta como diagnóstico calibrado.
- Resultado con calidad, resumen, grupos, mapas, datos técnicos, informe imprimible/JSON y 3D bajo demanda.
- Errores, trabajos pendientes y procesamiento usan el estado real del servidor, sin porcentajes ni tiempos inventados. El borrador se conserva solo en memoria y avisa antes de descartarse.
- Sesión en sessionStorage, revocación al salir, limpieza de caché privada al recibir 401 y autenticación de PNG solo en rutas del mismo origen. No hay Service Worker ni persistencia de resultados en almacenamiento local.

## API y compatibilidad

Se conservan los endpoints y campos de autenticación, cuota y análisis. La única ampliación es `result.heatmap_layers.legends`: un objeto por capa con `vmin`, `vmax` y una lista de 256 colores RGB hexadecimales obtenidos mediante `_colorize`. Las pruebas comparan esa lista con los píxeles producidos por el mismo colorizador. No se modifican fórmulas, pesos ni puntuaciones, y no hay migración de base de datos.

Los resultados históricos sin leyenda muestran el rango si existe y explican que no se registraron colores. La ausencia de datos se muestra como guion, nunca como cero. Los informes históricos sin versión científica no reproducen diagnósticos antiguos.

Las rutas canónicas son `/login`, `/analisis`, `/analisis/nuevo`, `/analisis/:id`, `/analisis/:id/informe`, `/analisis/:id/3d` y `/perfil`. Las páginas `.html` anteriores redirigen en el cliente conservando el UUID cuando procede. Las rutas de API y medios no pasan por ese fallback.

El catálogo de índices/presets está exportado desde los literales del motor con `python scripts/export_ui_science.py`. Una prueba compara sus índices y pesos seleccionables con el backend para detectar divergencias.

MapLibre 6 requiere [empaquetar explícitamente el worker con Vite](https://maplibre.org/maplibre-gl-js/docs/); se incluye como recurso local y se limita a dos workers. Cada mapa y gráfico libera recursos al desmontarse. Solo hay un mapa activo en cada vista.

## Pruebas

Desde `frontend/app`, con Node 24.22.1 o compatible:

```bash
npm ci --ignore-scripts
npm run build
npm test
npm run test:e2e
```

Las E2E requieren el stack local, Windows, Ubuntu WSL y Edge instalado. El fixture de Playwright contiene la ruta de este checkout en WSL; ajústala en `frontend/app/e2e/app.spec.ts` si trabajas desde otro directorio. `SECURITY_BROWSER_BASE_URL` permite cambiar el origen de pruebas (predeterminado http://localhost:8080). Crean cuentas sintéticas en el entorno aislado; sus credenciales se mantienen en memoria y no se guardan trazas ni estados autenticados. Las llamadas de creación se interceptan para no consumir EE durante la suite de interfaz. Los PNG privados y la autenticación por contraseña se comprueban contra Django real. Las imágenes base son controladas para evitar dependencia de proveedores externos en esos tests.

Para repetir la suite sin agotar los 100 accesos por hora de la IP compartida, el fixture restablece únicamente los contadores de acceso por IP en la caché aislada, mediante `security_seed.py --reset-login-throttle`. El script exige `INTEGRATION_TEST_ENV=1`; no cambia límites de producción ni borra sesiones, reservas o colas. Los artefactos de fallos son locales y están excluidos de Git; pueden incluir datos de las cuentas sintéticas.

La verificación adicional de seguridad real, sin mocks de la API de resultados, es:

```powershell
$env:SECURITY_BROWSER_BASE_URL="http://localhost:8080"
.venv\Scripts\python.exe scripts\security_browser.py
```

La prueba real EE independiente se ejecuta con `bash scripts/integration.sh smoke`; procesa dos AOI pequeños públicos (terrestre y oceánico), por lo que consume recursos del proyecto de EE configurado. No usar proyectos distintos sin revisar coordenadas/fechas. El login Google real se comprobó en el navegador del propietario, sin copiar tokens ni contraseñas.

## Evidencia del resultado

- 62 pruebas backend: 57 regresiones y cinco casos nuevos de leyendas/contrato de presets.
- 16 pruebas Vitest/Testing Library: fechas, geometría, límites, valores ausentes, sesión, filtros, leyendas históricas y prevención de doble envío.
- Catorce E2E: CSV, dibujo, vistas ampliadas, recuperación tras recarga y actualización, PNG privado, permisos, fallos/parcialidad, rutas antiguas, 3D/desmontaje, sesión y tres tamaños de pantalla. El resumen `verification.json` conserva la ejecución anterior de nueve pruebas.
- Axe con reglas A/AA/2.1/2.2 en 360/768/1440 px sin violaciones detectadas en las pantallas revisadas. Escaneo estático de DOM renderizado sin hallazgos; ambos tienen alcance limitado y se complementan con comprobación de teclado y revisión visual.
- EE real: 13 escenas, tres grupos, PNG privado, 11 leyendas y devolución de reserva del caso oceánico. Esto es integración técnica, no validación agronómica.
- Google real: cuenta autenticada en la SPA nueva. Administración privada, nombre con HTML mostrado como texto y revocación de token comprobados nuevamente.

Archivos: [resumen](verification.json), [EE real](live-ee.json), [seguridad en Edge](security-browser.json), [escaneo estático](a11y-static.json), [contrastes](contrast.json) y [npm audit](npm-audit.json). La auditoría npm registra avisos conocidos al ejecutar la consulta, no garantiza ausencia de vulnerabilidades.

Las capturas `evidence/analyses-*` y `evidence/report-*` muestran **datos controlados de prueba**. La captura local `evidence/live-google.png` muestra una cuenta real autenticada y está excluida de Git. Las capturas no son ejemplos de precisión del motor.

## Reversión local

Se conserva la imagen `quenaris-frontend-legacy:20261110` con el frontend/configuración anterior y una copia local en `.local-backups/frontend-legacy-20261110` (excluida de Git). Para usarla en este equipo:

```bash
docker compose -f compose.integration.yml -f docs/frontend/rollback.compose.yml up -d --no-build --no-deps frontend
```

Para volver a React: `docker compose -f compose.integration.yml up -d --no-build --no-deps frontend`. No se eliminan volúmenes ni se revierten datos. La copia y la imagen son locales y deben conservarse si se quiere mantener esta opción.

## Límites pendientes

La prueba se hizo en Windows/WSL, no en la laptop del homelab. La primera apertura de mapas descarga el paquete WebGL y su worker; se cargan separados de login e historial, pero son recursos grandes. Los mapas externos dependen de conexión. Falta revisión con usuarios reales y tecnología asistiva. No se añade calibración de campo, funcionamiento sin conexión, pagos ni funciones predictivas.
