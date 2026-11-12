# Auditoría científica — 10 de noviembre de 2026

Estado: motor exploratorio `relative-percentiles-v2`, sin calibración de campo. Contextos: agricultura de Arequipa y restauración altoandina. Estas correcciones mejoran consistencia y trazabilidad; no establecen precisión agronómica. El código es la referencia de implementación; `REBUILD_HANDOFF.md` conserva decisiones históricas incompatibles con esta versión.

## Hallazgos y correcciones

| Hallazgo | Acción y límite |
|---|---|
| EVI/SAVI/MSAVI ya usaban reflectancia | Se conserva el escalado S2; las fórmulas ahora comparten un registro auditable y excluyen denominadores casi cero. |
| QA60 sin máscara explícita de sombras; distintas políticas entre mapas y análisis | SCL 4/5 en ambos: se conservan vegetación y suelo expuesto, excluyendo agua, nubes, sombras, nieve y clases inciertas. No clasifica uso del suelo; ciudad y roca pueden persistir. |
| Mediana sin calidad por AOI | Se cuentan píxeles utilizables dentro de la cuadrícula del AOI y observaciones válidas de B4 por píxel. La fracción combina exclusión por calidad y superficie; **no** es porcentaje de nubosidad. |
| Píxeles nodata finitos podían entrar al clustering | Lectura de máscaras del GeoTIFF, NaN y observaciones válidas, aplicada también a mapas. |
| Descarga principal a 10 m y heatmaps a 20 m | Ambos a 20 m, EPSG:4326 y remuestreo por vecino más cercano. No crea detalle para red-edge/SWIR ni para DSM (~30 m). |
| Derivadas de un mosaico DSM sin proyección fuente | Se establece la proyección fuente antes de pendiente/vecindad. Se usa el catálogo vigente GLO30_2024_1. |
| Segundo estiramiento de puntuación amplificaba el contraste | Eliminado. Los percentiles 2/98 por índice siguen siendo relativos al AOI; incluso diferencias físicas pequeñas pueden ocupar gran rango. No equivalen a significancia. |
| Heatmaps ignoraban estudio/índices/pesos y reajustaban percentiles cada mes | Se reutiliza la referencia del composite principal con pesos efectivos, direcciones y límites registrados. Los meses se recortan al intervalo solicitado, con fin exclusivo. |
| Softmax de reglas sin etiquetas de campo parecía probabilidad | `differential` devuelve `[]`. No se sustituyen causas por otras inventadas. |
| Etiquetas Óptimo/No apto y prompt con pesos/umbrales antiguos | Grupos descriptivos, advertencias, informe determinista basado en metadatos reales y aviso de resultado histórico. El prompt queda como referencia, sin ejecución del LLM en esta versión. No se recalculan datos antiguos automáticamente. |
| PSRI usaba denominador B5 (~705 nm) | Se cambia a B6 (~740 nm), aproximación a R750; B2 no coincide exactamente con R500. Sigue sin validar diagnóstico. |
| LAI y WDI sin procedencia suficiente para las fórmulas del MVP | No seleccionables; el API devuelve error de validación. No se presentan como LAI biofísico ni déficit hídrico validado. |
| NDSI/SI2 inferían salinidad sin muestras EC | Se retiran de los presets prioritarios y del peso agro; quedan como proxies opcionales identificados, sin diagnóstico. |
| Se forzaba KMeans cuando densidad no encontraba grupos | Se conserva ruido=-1 y se excluye del silhouette. Escenas constantes generan un único grupo; no se impone heterogeneidad. |
| Áreas con distorsión Web Mercator | Resultados vectoriales: área elipsoidal WGS84. AOI mostrado/cuotas: EPSG:6933 de área equivalente. |
| Importancia confundida con explicación causal | Se identifica el método; XGBoost aproxima reglas existentes. El fallback usa centroides del espacio original, incluso con PCA. |

## Matriz de fórmulas y procedencia

Notación: reflectancia S2 = DN × 0.0001; B=B2, G=B3, R=B4, RE1=B5, RE2=B6, N=B8, S1=B11, S2=B12. Resolución indica la banda más gruesa utilizada, no exactitud temática. Todas las adaptaciones a bandas anchas requieren contexto. “Pendiente” significa que se conserva una fórmula computacional, sin afirmar que su interpretación biofísica está verificada.

| Índice | Fórmula implementada | Resolución nativa aprox. | Fuente / estado / limitación |
|---|---|---|---|
| NDVI | (N−R)/(N+R) | 10 m | [USGS, índices](https://burnseverity.cr.usgs.gov/glossary). Verdor relativo; no salud ni especie. |
| EVI | 2.5(N−R)/(N+6R−7.5B+1) | 10 m | [Huete et al. 2002](https://doi.org/10.1016/S0034-4257(02)00096-2). Constantes requieren reflectancia; transferencia local sin calibrar. |
| SAVI | 1.5(N−R)/(N+R+0.5) | 10 m | [Huete 1988](https://doi.org/10.1016/0034-4257(88)90106-X). L=0.5 es supuesto, no óptimo universal. |
| MSAVI | (2N+1−√((2N+1)²−8(N−R)))/2 | 10 m | [Qi et al. 1994](https://doi.org/10.1016/0034-4257(94)90134-1). Variante cerrada MSAVI2; no viabilidad de plantación. |
| NDRE | (N−RE1)/(N+RE1) | 20 m | Adaptación explícita; procedencia/calibración local pendiente. |
| GNDVI | (N−G)/(N+G) | 10 m | Contraste espectral; interpretación cuantitativa pendiente. |
| CIre | N/RE1−1 | 20 m | Proxy red-edge; no concentración calibrada de clorofila o nitrógeno. |
| ARVI | (N−(2R−B))/(N+(2R−B)) | 10 m | Parámetro gamma=1 implícito del MVP; revisión primaria pendiente. |
| SIPI | (N−B)/(N−R) | 10 m | [Estudio de reflectancia foliar (1999)](https://www.sciencedirect.com/science/article/pii/S0034425799000486) describe bandas estrechas originales; B2≈490 no equivale a 445 nm. Interpretación pendiente. |
| LAI | Antigua: 3.618(N−R)/(N+R+0.5) | — | **Desactivado**: no hay modelo ni calibración justificando conversión a área foliar. |
| NDMI | (N−S1)/(N+S1) | 20 m | [USGS HLS VI](https://lpdaac.usgs.gov/documents/2088/HLS_VI_User_Guide_V2.pdf). No confundir con NDWI verde/NIR ni con agua disponible en suelo. |
| NDWI | (G−N)/(G+N) | 10 m | Variante verde/NIR; [estudio original aplicado a humedales](https://www.sciencedirect.com/science/article/abs/pii/S0034425717302894) describe esta convención. No humedad foliar. |
| MSI | S1/N | 20 m | Cociente exploratorio; interpretación/umbrales locales pendientes. |
| MoistureStress | (S1−N)/(S1+N) | 20 m | Exactamente −NDMI, también idéntico a NDBI en esta implementación. No aporta información independiente. |
| WDI | Antigua: (R+G)/(N+S1) | — | **Desactivado**: no sustenta el nombre déficit hídrico. |
| NDSI (legacy) | (S1−S2)/(S1+S2) | 20 m | No es el NDSI de nieve ni una medida EC. Procedencia de salinidad no verificada. |
| SI2 (legacy) | √(N²+G²+R²) | 10 m | Magnitud de brillo; no confirma sales. Procedencia de interpretación pendiente. |
| BSI | ((S1+R)−(N+B))/((S1+R)+(N+B)) | 20 m | Fórmula del MVP conservada como contraste; no prueba degradación, fertilidad o disponibilidad. |
| NBR | (N−S2)/(N+S2) | 20 m | [USGS](https://burnseverity.cr.usgs.gov/glossary). No diagnostica incendio a partir de un composite aislado. |
| NDBI | (S1−N)/(S1+N) | 20 m | Contraste conservado; ciudad y suelo desnudo se confunden. No usado para excluir ciudad automáticamente. |
| PSRI | (R−B)/RE2 | 20 m | [Merzlyak et al. 1999](https://doi.org/10.1034/j.1399-3054.1999.106119.x). Aproximación espectral, no identificación de patógenos. |
| Elevation | DSM | ~30 m | [Copernicus GLO30_2024_1](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30_2024_1). Superficie, incluye construcciones/dosel. |
| Slope | ee.Terrain.slope(DSM) | ~30 m | Grados; influye proyección/resolución. No pendiente medida en campo. |
| Aspect | ee.Terrain.aspect(DSM) | ~30 m | Grados circulares; se retira del preset agro para evitar tratar 359° y 1° como extremos lineales. |
| TPI | DSM−media local | ~30 m | Ventana circular radio 5 píxeles; escala de vecindad debe interpretarse con la proyección. |
| TRI (variante) | desviación estándar local del DSM | ~30 m | Nombre heredado: no confundir con otras definiciones de TRI. |
| SolarExposure (proxy) | (cos(aspect)+1)/2, 0.5 si slope<2° | ~30 m | Orientación norte, umbral de neutralización heurístico. **No** horas de sol ni irradiación; no incluye sombras/topoclima. |

Las fuentes bibliográficas se verificaron por catálogo, resumen/editorial o metadatos accesibles; no se afirma lectura completa de todos los artículos. Las filas pendientes no reciben validación por compartir forma matemática con otro índice. El catálogo [S2 SR Harmonized](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED) es la referencia de escalado, bandas y clases.

## Puntuación y contratos

- Agro conserva pesos relativos previos de NDVI=.25, EVI=.10, NDRE=.05, MSAVI=.10, NDMI=.20, BSI=.10, renormalizados entre los índices seleccionados con peso positivo. El resto no aporta a la puntuación por defecto; puede afectar clustering si se selecciona.
- Reforestación: BSI=.4 (creciente), MSAVI=.3 (decreciente), NDMI=.3 (creciente). Son una hipótesis exploratoria sobre cobertura/brillo/humedad, **no** un modelo ecológico de restauración. La sustitución de proxies de salinidad/agua libre no constituye calibración.
- Percentiles 2/98 por índice se ajustan una vez al composite del periodo. Un índice constante recibe 50 (sin información). No hay segundo estiramiento. Al comparar meses, se usa la misma referencia; no se asegura que la media mensual coincida con puntuar la mediana del periodo, por no linealidad y cobertura variable.
- Se conservan `suitability_mean`, `priority`, `differential` y el contenedor del API. Se añaden versión, referencia de puntuación, pesos efectivos, procedencia, calidad y advertencias a `statistics`; los mapas incluyen referencia, meses omitidos y cobertura por mes.
- `priority` conserva etiquetas históricas y cortes <40/<60/<80/resto, ahora solo como orden heurístico de inspección. No implica tratamiento. Ruido de clustering: `No evaluable`. Los grupos no son clases de salud.
- Fechas `[inicio, fin)`; meses parciales recortados. Selección inválida, desconocida o LAI/WDI recibe error; no se sustituye silenciosamente por otro preset. Grupos solicitados: 2–12, reducidos si hay pocos valores distintos.
- Mínimo operativo: 20 píxeles finitos, no una prueba de suficiencia estadística. Aviso de baja cobertura por debajo de 50%: umbral operativo explícito, sin fundamento de precisión agronómica. El porcentaje se basa en centros de píxel, no integración exacta del borde.
- Las geometrías de grupos de los nuevos análisis se recortan al polígono solicitado antes de medir su superficie geodésica. Los píxeles de borde siguen asignándose a un solo grupo, por lo que estas superficies son aproximaciones, no límites medidos en campo. Los resultados históricos sin `area_geometry_clipped` pueden incluir áreas de celdas completas fuera del terreno; no se recalculan automáticamente.
- Densidad conserva ruido; silhouette excluye ruido y puede ser nulo. Ninguna métrica interna demuestra correspondencia con causas reales. Variables correlacionadas y la elección de escala pueden cambiar las agrupaciones.
- Resultados previos permanecen almacenados; requieren recalcular para obtener semántica v2. La interfaz oculta informes causales antiguos. No se reescriben silenciosamente datos históricos.

## Verificación y pendientes

Ejecutar desde la raíz con Python 3.12 y las dependencias de `backend/requirements-test.txt` en el entorno Linux de integración (ver `docs/integration/README.md`): `python -m pytest -q`. Las pruebas usan reflectancias conocidas, rásters sintéticos con máscara, constantes, datos ausentes, ruido y la misma referencia en ambas rutas de puntuación. El lock registra el entorno utilizado, incluyendo dependencias transitivas; no declara que el stack de producción esté actualizado.

`scripts/validate_gee_science.py --output docs/science/earth-engine-run.json` ejecuta cinco sondas pequeñas sin LLM, base de datos ni mapas mensuales. Requiere variables GEE ya configuradas. No carga `.env` automáticamente. Registra coordenadas, fechas, colecciones, metadatos y un máximo de 30 solicitudes contadas de cálculo/descarga (no incluye autenticación ni descubrimiento API). Earth Engine no informa aquí un costo monetario: el conteo es una medida de actividad, no facturación. Si faltan credenciales, registra `unavailable`, cero solicitudes y salida no exitosa. Las coordenadas son contextos públicos propuestos, no etiquetas de verdad de terreno.

Limitaciones de integración: no se ha probado Django/PostGIS/Celery completo en este Windows. El API original limitaba Django a <5.2; la fase de integración posterior lo actualiza a 5.2 LTS y documenta las pruebas completas en `docs/integration/README.md`. `getDownloadURL` tiene [límite de 32 MB y 10000 píxeles por dimensión](https://developers.google.com/earth-engine/apidocs/ee-image-getdownloadurl); polígonos muy alargados o selecciones grandes pueden requerir particionado futuro.

Riego, fitosanidad y fertilización conservan perfiles experimentales, sin afirmar validez para sus nombres operativos. Falta revisar sus hipótesis por cultivo y fenología, relaciones de índices con suelo/agua/nutrientes y relevancia para puna. Solar/minería permanecen legacy, sin validación. No se han entrenado modelos supervisados ni aplicado umbrales universales de diagnóstico.

## Protocolo para validación de campo

Definir por separado agricultura y restauración: objetivo observable, cultivo/comunidad vegetal, estación y unidad de muestreo (parcela/sitio, no píxeles vecinos como réplicas independientes). Registrar coordenadas y precisión, fecha cercana al satélite, cobertura, nubosidad, fenología y método de medición. Para salinidad: EC y protocolo de laboratorio; para agua: mediciones pertinentes de suelo/planta; para restauración: ecosistema de referencia, especies, uso, manejo y seguimiento de supervivencia.

Diseñar muestreo antes de ajustar umbrales, con sitios independientes y bloques espaciales/temporales reservados para evaluación. Estimar tamaño de muestra a partir de variabilidad y error relevante, sin inventar un número universal. Separar ajuste y evaluación; reportar error, incertidumbre y ámbito de aplicación. Mantener la etiqueta exploratoria hasta contar con evidencia independiente suficiente y revisión del dominio. Registrar también resultados negativos y condiciones fuera del dominio.


### Autenticación local para las sondas

Proyecto aportado por el propietario: `quenaris-499120`. Las antiguas claves se perdieron. Para pruebas locales se admite OAuth de usuario además de cuenta de servicio. Ejecutar en PowerShell desde la raíz:

```powershell
.\.venv\Scripts\earthengine.exe authenticate --auth_mode=localhost --scopes=https://www.googleapis.com/auth/earthengine.readonly
$env:GEE_PROJECT = 'quenaris-499120'
.\.venv\Scripts\python.exe scripts/validate_gee_science.py --output docs/science/earth-engine-run.json
```

El navegador y el proceso Python deben estar en el mismo Windows. La autorización se guarda en la ruta estándar de Earth Engine, fuera del repositorio. El permiso de lectura permite cálculo sobre assets públicos; no se solicitan Drive, exportaciones ni modificación de assets. Véase [autenticación oficial](https://developers.google.com/earth-engine/guides/auth). El proyecto debe tener Earth Engine habilitado y registrado y la cuenta debe poder utilizarlo; esa condición no puede deducirse de su enlace de consola. Para producción se decidirá por separado la identidad del servidor. No copiar la autorización personal al homelab como parte de esta fase.


## Resultados ejecutados en esta sesión

- Skill `gee-scientific-validator` creada, validada con `quick_validate.py` e instalada en el directorio personal de Codex; disponible para selección desde el siguiente turno.
- 23 pruebas locales aprobadas con Python 3.12; también se verificaron sintaxis JavaScript y construcción de grafos con el SDK real de EE sin red. Las advertencias observadas pertenecen a dependencias (deprecaciones), no constituyen validación de campo.
- OAuth local de solo lectura completado para las pruebas; no se creó una clave de servicio ni se guardaron credenciales en este repositorio.
- Primera ejecución: 5 fallos EEException, 10 solicitudes contadas. Una sonda diagnóstica adicional (2 solicitudes) identificó que EE rechaza nombres de bandas iniciados por `__`; se cambiaron a `quality_aoi` y `quality_observations`. Se conserva `earth-engine-run-initial.json` como evidencia del intento fallido.
- Segunda ejecución: `earth-engine-run.json`, 10 solicitudes contadas. Resultados en la tabla inferior. El rechazo oceánico es el comportamiento esperado para un motor de superficie terrestre, no un diagnóstico sobre el mar.
- Prueba adicional de mapa mensual de reforestación: `earth-engine-heatmap-run.json`, 2 solicitudes contadas, 5 capas PNG generadas con la referencia del periodo. Los PNG quedan bajo `backend/media/heatmaps/science-validation`, excluido de Git.
- Total observado: **24 solicitudes contadas** de cálculo/descarga. Excluye autenticación y descubrimiento del API. No se obtuvo un costo monetario ni una medición independiente de precisión. Las pruebas se hicieron contra el proyecto proporcionado por el propietario, sin modificar el homelab.

| Sonda contextual, sin etiquetas de campo | Resultado técnico | Píxeles utilizables / cuadrícula | Observaciones B4 mínimas | Lectura permitida |
|---|---|---:|---:|---|
| Majes, contexto agrícola | Completado, 3 grupos | 529 / 529 | 17 | Diferencias espectrales exploratorias; no se verificó cultivo ni salud. |
| Chiguata, contexto de ladera altoandina | Completado, 3 grupos | 552 / 552 | 12 | No demuestra presencia de queñual, estado de puna ni viabilidad de restauración. |
| Océano | Rechazado por píxeles terrestres insuficientes | Sin resultado | — | No se fuerza una puntuación terrestre. |
| Misti, contexto rocoso | Completado, 3 grupos | 552 / 552 | 23 | La roca puede agruparse; no se convierte en aptitud para plantar. |
| Arequipa, contexto urbano | Completado, 3 grupos | 529 / 529 | 12 | Confirma que SCL 4/5 no excluye toda ciudad; no clasifica uso ni disponibilidad. |

El 100% de píxeles utilizables de estas cuatro sondas no significa ausencia de error. Las coordenadas no tienen inventario de cobertura ni etiquetas verificadas; ciudad, roca y ecosistemas nativos requieren una futura máscara de dominio contrastada y revisión de campo. Las agrupaciones no son unidades de manejo validadas.
