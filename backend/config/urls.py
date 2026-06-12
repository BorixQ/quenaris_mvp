from django.contrib import admin
from django.urls import include, path
from rest_framework.authtoken.views import ObtainAuthToken


class TokenView(ObtainAuthToken):
    """Entrega el token a partir de usuario/contraseña en el cuerpo.

    authentication_classes = [] evita que una cookie de sesión activa (p. ej.
    estar logueado en el admin) dispare SessionAuthentication y, con ella, la
    comprobación CSRF que rechazaría el login. Las credenciales viajan en el
    body, así que esta vista no necesita autenticación previa.
    """
    authentication_classes = []


urlpatterns = [
    path("admin/", admin.site.urls),
    # Devuelve {"token": "..."} a partir de {"username", "password"}
    path("api/auth/token/", TokenView.as_view(), name="api-token"),
    path("api/", include("analysis.urls")),
]
