# Capacidad multiusuario de Quenaris

Revisión del código local para preparar una demostración. Las cifras de duración y de usuarios simultáneos aún no se han medido en el homelab.

## Distribución actual

1. La API acepta solicitudes de diferentes cuentas y reserva una cuota por solicitud. Cada cuenta puede tener como máximo un trabajo pendiente o en ejecución.
2. Redis recibe las tareas y Celery las procesa. El Compose local configura una concurrencia inicial de un proceso; la configuración efectiva de cada despliegue debe verificarse antes de afirmar cuántos procesos tiene.
3. Con un solo proceso, solo un análisis avanza a la vez. Los demás permanecen pendientes. Los reintentos y la entrega de tareas pueden alterar el orden; no se garantiza un orden estricto.
4. La interfaz consulta los estados del servidor, sin estimar porcentajes ni tiempos de espera.

El límite de un trabajo activo es **por cuenta**; no es un límite global sobre el tamaño de la cola. Abrir el registro puede aumentar el número de trabajos pendientes. La prueba `test_distinct_users_can_enqueue_analyses_at_the_same_time` comprueba dos solicitudes simultáneas en el entorno aislado y sustituye la publicación de tareas por un simulador: no mide el worker ni demuestra capacidad para tráfico real.

La prueba local `tests/test_multiuser_worker.py` también pasó con diez cuentas ficticias enviando solicitudes concurrentes a Redis y un worker Celery real de concurrencia uno. Con el primer trabajo detenido deliberadamente se observaron uno en proceso y nueve pendientes; tras liberarlo se completaron los diez, sin solapamiento. Los cálculos fueron simulados: esta prueba no mide tiempos de Earth Engine ni la capacidad de la laptop.

## Recuperación de tareas

En el código local, la recuperación ya no marca como fallida una solicitud `PENDING` solo por esperar 35 minutos. En su lugar, intenta volver a publicarla y mantiene la reserva de cuota. La publicación se limita a una vez por intervalo y los intentos se adquieren con bloqueo de base de datos para impedir que una entrega duplicada ejecute o cobre dos veces. Las solicitudes `PROCESSING` que superan el plazo de recuperación continúan marcándose como fallidas.

La republicación también intenta recuperar el caso en que la base registró una solicitud pero el proceso terminó antes de publicarla. Una espera legítima puede generar copias redundantes en la cola; se ignoran al reclamar la tarea o si ya terminó. Si el broker no está disponible, la solicitud y su reserva permanecen pendientes y se vuelve a intentar más adelante. La recuperación depende de beat, Redis y un worker disponibles; no garantiza recuperación en un plazo fijo. Falta probar cortes reales y colas prolongadas en un entorno aislado antes de aplicarla en el homelab.

Cada ejecución tiene actualmente un límite blando de 25 minutos y uno duro de 30. La generación de mapas consulta periodos por mes; un rango largo puede tardar más y no está garantizado que termine dentro de esos límites.

## Demostración de cinco años

Un periodo de cinco años abarca al menos 60 meses: el generador recorre cada mes y, cuando hay escenas, solicita un ráster. No se ha medido cuánto tardará en el homelab ni cuántas solicitudes de Earth Engine consumirá; cinco años de cuota no amplían el plazo del worker. Se debe medir primero con el terreno y periodo elegidos, sin ejecutar varias copias en producción.

El cálculo principal usa una mediana de las observaciones del periodo completo. Por sí solo, ese resultado no demuestra cómo cambió el terreno entre años. Los mapas mensuales se calculan respecto de una referencia común del periodo principal; diferencias de cobertura, estacionalidad y nubes limitan la interpretación. No presentar esas diferencias como tendencias o causas validadas. Los meses sin datos deben permanecer identificados. Los nuevos análisis recortan las geometrías rasterizadas al polígono solicitado antes de medir sus superficies; los resultados anteriores se conservan con una advertencia sobre su método de área.

La demostración pública requiere que la persona propietaria elija el terreno, las fechas y el análisis cuyos resultados y ubicación se harán públicos. Un ejemplo preparado evita que cada visitante ejecute su propia consulta; no publicar información de una cuenta privada por defecto ni aceptar el ID como autorización para acceder a ella.

## Comprobaciones propuestas

- Con datos y credenciales ficticios, crear solicitudes a la vez para varias cuentas, ejecutar un worker real aislado y verificar estados, reservas y finalización; incluir más de un tiempo de espera simulado y publicación interrumpida.
- Probar recuperación tras parar el worker o reiniciar el broker en un entorno de pruebas, sin usar ni modificar la base de producción.
- Medir en el homelab un número pequeño de trabajos reales y representativos, registrando superficie, fechas, escenas, tiempos de espera y ejecución, memoria, CPU, almacenamiento y errores. Coordinar la prueba para no interferir con otros usuarios y registrar el consumo de Earth Engine cuando esté disponible.
- Repetir con concurrencia superior a uno solo si las mediciones y la capacidad del servidor lo justifican. El resultado debe informar una capacidad observada bajo condiciones concretas, no una garantía general.

Las solicitudes reales consumen recursos de Google Earth Engine, además de los del homelab. La demostración pública debería usar un resultado previamente preparado para que pueda mostrarse aun cuando la cola esté ocupada. Sus datos deben identificarse como reales o simulados según corresponda, y los resultados continúan siendo exploratorios y sin calibración de campo.
