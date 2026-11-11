# Quenaris: diseño del flujo de análisis

Fecha: 10 de noviembre de 2026. Público principal: agrónomos y técnicos. Marca Quenaris, tema claro; escritorio para trabajar y móvil para consultar. Este documento registra una evaluación heurística y decisiones del propietario, no entrevistas ni una validación de usabilidad con agrónomos.

## Auditoría inicial — design-auditor

| Prioridad | Hallazgo observado en el frontend anterior | Corrección |
|---|---|---|
| Alta | Inicio promocional después del login; trabajos activos ocultos por selectores de completados | Mis análisis, todos los estados y acceso directo al trabajo activo |
| Alta | Fechas iniciales de seis meses frente a cuota inicial de 31 días | Inicializar con min(30, cuota) días y validar antes de enviar |
| Alta | Leyenda única frente a varias paletas del colorizador Python | Metadatos de leyenda publicados por el mismo colorizador |
| Alta | Formularios largos, etiquetas sin asociación y mensajes genéricos | Asistente, campos etiquetados, errores contextuales y resumen de revisión |
| Alta | Mapas y paneles de ancho fijo sin alternativa textual suficiente | Diseño adaptable, tablas equivalentes y controles accesibles |
| Media | Secciones prescriptivas desactivadas y enlaces de ampliación a Facebook | Informe factual y explicación de cuota sin acciones ficticias |
| Media | Varias familias tipográficas, HUD y brillos compiten con datos | Sora local, jerarquía sobria y componentes comunes |
| Media | Scripts globales, estilos inline y versiones diferentes de MapLibre | React/TypeScript, módulos por función y dependencias bloqueadas |

## Recorrido — ux-researcher-designer y product-designer

Hipótesis: un técnico necesita saber qué terreno y periodo está evaluando, qué calidad tienen los datos y qué significa la puntuación antes de considerar una inspección de campo. No se inventan citas ni perfiles demográficos.

1. Acceso: Google o cuenta local; recuperar sesión válida y explicar fallos.
2. Mis análisis: encontrar trabajos por nombre, estudio y estado; iniciar o reanudar consulta.
3. Nuevo análisis: objetivo/nombre → terreno por dibujo/CSV → periodo y opciones avanzadas → revisión.
4. Seguimiento: pendiente/procesando sin porcentajes ficticios, conservar ejecución del servidor al navegar.
5. Resultado: resumen de calidad → mapa y leyenda → datos por grupo → informe factual/3D.
6. Fallos: distinguir falta de datos, cuota, red, sesión y mapas externos; conservar acceso al resto del resultado.

El prototipo funcional y los casos de pruebas usan fixtures identificables; no presentan resultados ficticios como mediciones. Salud general y reforestación siguen siendo exploratorios; los otros tres estudios llevan además la etiqueta Experimental.

## Sistema visual — ui-design-system

Tokens CSS: fondo #F6F8FA, superficie #FFFFFF, tinta #172B3A, acción #166534, información #1D4ED8. Sora alojada localmente, cuerpo 16 px, cifras tabulares, espaciado de 4/8 px. Colores del mapa provienen de los datos, no del tema. Iconos SVG consistentes. Estados con texto, no solo color.

Componentes compartidos: botones, campos, avisos, tarjetas de estado, tablas, pestañas, diálogos nativos accesibles y controles del mapa. Foco visible, objetivos táctiles de 44 px, reducción de movimiento y alternativa tabular a gráficos/mapas. Objetivo WCAG 2.2 AA; las herramientas estáticas no certifican conformidad.

## Arquitectura — senior-frontend

SPA React/TypeScript estricto en frontend/app, Vite, React Router y TanStack Query. CSS Modules y variables CSS. Nginx sirve únicamente dist; los HTML anteriores quedan fuera de la imagen nueva. Node solo participa en el build. Cliente API compartido, caché en memoria, token en sessionStorage y borrado de datos al expirar/cerrar sesión. POST sin reintentos automáticos; trabajos activos se consultan cada cuatro segundos mientras la pestaña es visible.

Los mapas/gráficos se cargan por ruta y liberan recursos al desmontarse. La única ampliación de API es heatmap_layers.legends; resultados históricos sin ella muestran rangos y explican su ausencia. No se recalculan puntuaciones ni se cambian fórmulas.

## Guion de revisión y usabilidad

Tareas para el propietario y, cuando estén disponibles, técnicos externos: crear un análisis sin modificar algoritmos; detectar un periodo fuera de cuota; recuperar un trabajo tras recargar; explicar por qué una puntuación alta no prueba salud; localizar meses sin datos; consultar un informe en móvil; encontrar un análisis fallido y corregir su entrada. Registrar finalización, errores, dudas y tiempo sin inventar resultados. Los hallazgos de sesiones reales se añadirán separadamente.

## Entrega y comprobaciones

Vitest/Testing Library cubren validación, fechas, sesión y estados. Playwright cubre recorrido, mapas privados, fallos, compatibilidad de rutas, teclado y tamaños de 360/768/1440 px. a11y-audit aporta escaneo estructural/contraste y se complementa con revisión renderizada. Mantener los tests backend y registrar EE/Google reales separadamente. No desplegar en el homelab en esta fase.
