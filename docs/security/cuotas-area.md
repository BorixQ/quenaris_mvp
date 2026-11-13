# Saldo acumulado de hectáreas

La versión descrita aquí debe desplegarse con la migración `0012_cumulative_area_quota`. Las cuentas nuevas de prueba reciben **10 ha acumuladas** y un límite de **124 días por análisis**, aproximadamente cuatro meses. La duración se comprueba de manera independiente en cada análisis; no se resta de un saldo de días. Una cuenta puede enviar nuevos trabajos mientras tenga superficie disponible, con un único trabajo pendiente o en ejecución a la vez.

El servidor mide el polígono en EPSG:6933 y reserva su superficie redondeada al metro cuadrado más cercano, con un mínimo de 1 m² (0,0001 ha) por solicitud. La medición aproximada del navegador puede diferir: el aviso de superficie es orientativo y el servidor decide si cabe en el saldo. Cada solicitud cuenta por separado, incluso si repite o se solapa con un terreno ya analizado; el saldo no representa superficie única de propiedad. Un trabajo fallido devuelve su reserva una sola vez, mientras que un reintento la conserva. Eliminar un resultado completado no devuelve su superficie.

La reserva, la comprobación del saldo y la creación del trabajo se ejecutan en una transacción con bloqueo de la cuota. `charged_area_ha` registra cuánto se reservó para ese trabajo; no se reconstruye el cargo a partir de la geometría al devolverlo. La interfaz y `/api/auth/quota/` muestran área asignada, usada o reservada, y restante; los campos anteriores de cantidad de análisis se conservan para cuentas con límites personalizados.

## Cuentas existentes y transición

La migración reconoce como prueba las cuentas que no son staff ni superusuario y mantienen uno de los dos conjuntos predeterminados históricos: **1 análisis, 10 ha por terreno y 123 días**, o **1 análisis, 1 ha y 31 días**. Esas cuentas comienzan con 10 ha de saldo desde el cambio y 124 días por análisis; sus análisis anteriores y el contador histórico se conservan, pero no se descuentan de ese saldo nuevo.

Las demás cuotas existentes, incluida la cuenta administradora, conservan sus límites de cantidad, área y periodo. Un valor vacío en `area_allowance_ha` indica que sigue activa la cuota anterior por cantidad de análisis; un valor numérico habilita saldo acumulado. La administración privada permite ajustar el saldo total, pero no editar directamente el consumo registrado.

La aplicación anterior no registraba un tipo de plan: una cuenta con una cuota especial idéntica a uno de los valores predeterminados no puede distinguirse automáticamente y también será tratada como prueba. Revisar antes de desplegar si existe alguna excepción de ese tipo y anotar su configuración para restaurarla desde el administrador. Los trabajos anteriores a la migración no tienen `charged_area_ha` y no descuentan ni devuelven superficie del nuevo saldo.

Desplegar sin trabajos activos, con respaldo de la base y comprobación posterior de cuentas representativas. La migración modifica los límites predeterminados de las cuentas reconocidas; volver a una imagen antigua no revierte automáticamente esos datos ni hace que el código antiguo respete el saldo acumulado. Una restauración de base debe evaluarse en función de las escrituras posteriores. No se ha medido capacidad de concurrencia ni validado el resultado agronómico mediante esta cuota.
