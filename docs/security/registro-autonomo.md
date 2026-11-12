# Registro autónomo y acceso por correo

Este documento describe los cambios locales, no afirma que estén desplegados ni habilitados en quenaris.tech. El registro público y el acceso por correo están desactivados por defecto.

## Recorrido y cuentas existentes

Con `PUBLIC_SIGNUP_ENABLED=1`, una persona nueva puede crear su cuenta al entrar con Google o, si además está habilitado el correo, al verificar el código recibido. La cuenta nueva recibe la cuota predeterminada vigente: 10 ha, 123 días y un análisis disponible. Son límites distintos de las capacidades del servidor y no afectan retroactivamente las cuotas de otras cuentas.

Google debe entregar un correo verificado cuya titularidad pueda considerar autorizada para ese inicio de sesión: Gmail o una cuenta Google Workspace cuyo dominio coincida con el dominio alojado que indica Google. Si Google no es autoridad para el correo indicado, se ofrece la alternativa de código por correo. El inicio con Google requiere un cliente OAuth y un origen autorizado; el acceso por correo requiere SMTP funcional.

Por seguridad no se vinculan automáticamente cuentas existentes por coincidir en el correo. Las cuentas antiguas siguen usando sus métodos y autorización habituales. Una cuenta nueva creada con Google debe seguir usando Google; una creada con código debe seguir usando código. No hay todavía una pantalla para vincular los dos métodos. Esto evita que la inscripción pública permita apropiarse de cuentas antiguas, pero debe explicarse a los participantes de la demostración.

El código tiene ocho dígitos, caduca a los 10 minutos y solo puede usarse una vez. Se permiten cinco intentos por código y un nuevo envío después de 60 segundos; hay límites adicionales por IP y por dirección. El servidor guarda una huella protegida del código, no el código en texto claro. Los desafíos caducados se eliminan mediante la tarea periódica de recuperación; si el worker está detenido, la limpieza se retrasa, aunque el código ya no es válido. Una cuenta inactiva no puede entrar; el administrador puede desactivarla desde la administración privada.

## Activación posterior en el homelab

1. Elegir un proveedor SMTP transaccional, verificar el dominio remitente y configurar los registros de autenticación de correo que indique el proveedor. Comprobar que acepte destinatarios externos y correos institucionales.
2. Incorporar las variables siguientes al `.env` privado de producción, sin enviarlas al repositorio ni al chat. El nombre de usuario y la contraseña SMTP son los que proporcione el servicio; no tienen por qué coincidir con la contraseña de la cuenta del proveedor.

   ```dotenv
   PUBLIC_SIGNUP_ENABLED=0
   EMAIL_LOGIN_ENABLED=0
   EMAIL_HOST=servidor-smtp-del-proveedor
   EMAIL_PORT=587
   EMAIL_HOST_USER=usuario-smtp
   EMAIL_HOST_PASSWORD=credencial-smtp
   EMAIL_USE_TLS=1
   EMAIL_USE_SSL=0
   DEFAULT_FROM_EMAIL=acceso@quenaris.tech
   ```

   El ejemplo utiliza STARTTLS. Si el proveedor exige TLS implícito, ajustar puerto y activar `EMAIL_USE_SSL=1` con `EMAIL_USE_TLS=0`. El acceso por correo requiere configurar exactamente una de las dos opciones de cifrado. Limitar el acceso a `.env`: el Compose lo entrega a los contenedores configurados para usarlo.
3. Respaldar y comprobar la restauración de la base de datos antes de actualizar. Construir la versión nueva, aplicar la migración `0011_email_identity` y recrear los servicios siguiendo el procedimiento del homelab. No copiar el Compose de integración al servidor. Verificar conectividad SMTP desde el contenedor web y funcionamiento de Redis, worker y beat. El Compose del repositorio conecta `web` también a `frontend_net`; confirmar que la configuración efectiva del homelab permita la salida SMTP.
4. Para una prueba controlada, activar ambas opciones y recrear `web`. Usar cuentas nuevas propias de los dominios que se desee comprobar, probar recepción, caducidad, código incorrecto y segundo inicio. Probar también Google real con una cuenta nueva y comprobar que las cuentas antiguas conservan su acceso. Para cerrar nuevas inscripciones de inmediato, volver `PUBLIC_SIGNUP_ENABLED=0` y recrear `web`; las identidades existentes pueden seguir entrando. Para desactivar también el acceso por código, fijar `EMAIL_LOGIN_ENABLED=0`.

La recepción y la entrega real no se han probado sin proveedor. La aceptación por SMTP no garantiza que un mensaje llegue a la bandeja de entrada. Revisar SPF, DKIM y las políticas que exija el proveedor, además de spam y bloqueos institucionales. Mantener la administración detrás del túnel SSH, no publicarla para el registro.

## Capacidad y controles

El envío SMTP ocurre durante la solicitud web y tiene un timeout de 10 segundos. Si el proveedor está lento, puede ocupar procesos web; con dos procesos y 10–50 asistentes simultáneos debe medirse antes del pitch. Las cuotas y los límites de solicitud reducen el abuso, pero no demuestran resistencia ante tráfico malicioso. Los throttles compartidos de DRF son aproximados bajo concurrencia. La configuración actual detrás de Cloudflare puede agrupar varias personas en la misma IP de proxy; comprobar la IP cliente y los límites antes de abrir el registro para no bloquear al público. No confiar en cabeceras de IP enviadas directamente por clientes.

La cuota por cuenta y la cola de análisis son controles diferentes: permitir registros no demuestra que 50 análisis puedan terminar durante la presentación. Consultar [capacidad multiusuario](../integration/capacidad-multiusuario.md) y ensayar carga y recuperación en el homelab. Los correos de acceso no se ponen en la misma cola que los análisis largos.

## Pruebas locales

Los tests backend utilizan PostgreSQL/Redis de integración, un buzón en memoria y verificadores Google simulados; no envían correo ni crean cuentas externas. Cubren nuevas identidades, colisiones con cuentas antiguas, caducidad, intentos, simultaneidad y opciones desactivadas. Las pruebas React y Playwright usan respuestas controladas; las comprobaciones automáticas de accesibilidad no equivalen a una auditoría completa. Falta probar Google y SMTP reales, y medir capacidad en producción.
