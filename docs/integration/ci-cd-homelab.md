# CI/CD de Quenaris en el homelab

## Qué significa

**CI (integración continua)** comprueba cada cambio propuesto: instala dependencias fijadas, ejecuta las pruebas del servidor y de la interfaz, compila React y prueba el acceso en un navegador. GitHub ejecuta estas tareas en máquinas temporales, no en la laptop del homelab. Puedes ver cada ejecución en la pestaña **Actions** del repositorio.

**CD (entrega continua)** consiste en tener una versión comprobada y una forma repetible de instalarla. En esta primera etapa, el despliegue se ejecuta por SSH de forma deliberada: aprobar código o pulsar un botón en GitHub no da acceso automático a la laptop. No se instala un runner permanente de GitHub en el homelab ni se suben claves del servidor a GitHub. Los respaldos y la migración se realizan en la máquina existente.

CI se ejecuta en cada pull request, al actualizar `main` y manualmente desde Actions. El backend se prueba con PostGIS y Redis aislados. Las pruebas del navegador usan respuestas simuladas, por lo que una ejecución verde no confirma Google, SMTP, Earth Engine ni la capacidad real del servidor. La comprobación en CI no despliega nada por sí sola. Las acciones de GitHub están fijadas por SHA y el workflow solo necesita permiso de lectura.

## Flujo diario

1. Crear una rama para el cambio y abrir un pull request hacia `main`.
2. En GitHub, abrir **Actions** o los controles del pull request. Esperar a que los trabajos **API y procesamiento** e **Interfaz y navegador** terminen en verde. Un fallo se consulta abriendo el trabajo y el paso rojo.
3. Revisar e integrar el cambio. Después, verificar también la ejecución correspondiente al commit de `main`: ese SHA identifica exactamente la versión que se desea entregar.
4. Preparar un `git archive` de ese commit y su SHA256, transferirlo por SSH y ejecutar `scripts/deploy-homelab.sh` en la terminal del servidor. El script exige que el commit coincida con `origin/main`; no interpreta una ejecución verde automáticamente, por lo que el operador debe comprobarla en GitHub.
5. Revisar el resultado público y el administrador privado. La activación del registro autónomo es independiente y continúa desactivada si no se configuran sus variables.

Si deseas que GitHub impida integrar cambios con pruebas fallidas, hay que configurar una regla de protección para `main` con ambos trabajos como comprobaciones obligatorias. El archivo del workflow por sí solo no crea esa regla. Conviene verificar antes las opciones disponibles en la cuenta y no impedir por accidente la administración del repositorio.

## Actualización y reversión

El script de despliegue debe ejecutarse como `bq` desde una terminal interactiva para que `sudo` pueda pedir la contraseña sin compartirla. Antes de modificar la instalación comprueba el SHA del archivo, consulta `main`, valida Compose y verifica que no haya análisis pendientes o en proceso. Guarda el código anterior y etiqueta las imágenes existentes en un directorio privado de `/home/bq/quenaris-deploy-backups/`. Pausa el acceso público, vuelve a comprobar los análisis y detiene worker y beat. A continuación guarda un `pg_dump` y verifica que `pg_restore --list` pueda leerlo. Finalmente instala el archivo, compila imágenes, aplica las migraciones al iniciar `web` y comprueba el endpoint de salud. Habrá una interrupción del sitio durante la operación.

Si ocurre un error después de la pausa, intenta restaurar el código y arrancar las imágenes anteriores. **No restaura automáticamente la base de datos**: las migraciones deben ser compatibles con la versión anterior; restaurar una copia podría eliminar datos nuevos. La copia de la base no sustituye un respaldo completo: no incluye los mapas del volumen de medios ni las credenciales, está en el mismo equipo y la lectura de su índice no demuestra una restauración completa. Mantener copias fuera de la laptop y ensayar su restauración sigue pendiente.

El script preserva `.env`, `credentials/` y `compose.override.yml`; la sobreescritura local actual añade el grupo necesario para las credenciales de Earth Engine. La administración sigue en `127.0.0.1:8001`, accesible desde Windows con `ssh -N -L 28081:127.0.0.1:8001 homelab`. No publicar el administrador ni entregar el socket Docker a un runner.

Para revertir manualmente, identificar el directorio de respaldo que indique el script, revisar qué ocurrió y consultar `rollback-images.yml`, `commit-before.txt` y `source-before.tar.gz`. No borrar volúmenes ni ejecutar `docker compose down -v` en producción. Revisar compatibilidad de migraciones y cualquier escritura posterior antes de considerar una restauración de base de datos.

## Límites actuales

- El primer despliegue y el primer CI remoto deben verificarse antes de afirmar que el procedimiento funciona en este homelab.
- Construir imágenes puede tardar varios minutos y consumir recursos de una laptop de 8 GB; no hacerlo mientras haya análisis activos.
- Los cambios de código que eliminen o renombren columnas requieren un plan explícito de migración compatible y reversión; conservar imágenes anteriores no revierte el esquema.
- Las acciones y dependencias fijadas necesitan revisiones periódicas. La política de protección de rama y una restauración real de respaldos son pasos separados.
