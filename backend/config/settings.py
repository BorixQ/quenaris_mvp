"""
Configuración Django — GeoInsight SaaS.
GeoDjango (django.contrib.gis) + DRF + Celery.
"""
import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if len(SECRET_KEY) < 50 or SECRET_KEY.startswith(("dev-only", "cambiar-")):
    raise ImproperlyConfigured("DJANGO_SECRET_KEY debe ser una clave aleatoria de al menos 50 caracteres.")
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",          # GeoDjango
    "rest_framework",
    "rest_framework.authtoken",   # tabla de tokens para TokenAuthentication
    "rest_framework_gis",
    "corsheaders",
    "analysis",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # sirve estáticos del admin con DEBUG=0
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = os.environ.get("DJANGO_URLCONF", "config.urls")
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Base de datos: PostGIS ---
DATABASES = {
    "default": dj_database_url.config(
        default="postgis://geoinsight:geoinsight@db:5432/geoinsight",
        engine="django.contrib.gis.db.backends.postgis",
    )
}

# --- DRF ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # Las cookies del administrador no autentican la API pública.
        "analysis.authentication.ExpiringTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Sin throttle global: el polling del frontend (cada 4 s) agotaría cualquier
    # límite por usuario. Solo se limita la CREACIÓN de análisis (lo costoso),
    # vía ScopedRateThrottle en la vista (scope "analysis_create").
    "NUM_PROXIES": 1,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_RATES": {"analysis_create": "40/hour", "login_ip": "100/hour", "login_account": "20/hour",
                               "email_request_ip": "100/hour", "email_request_address": "5/hour",
                               "email_verify_ip": "200/hour", "email_verify_address": "30/hour"},
}

def env_list(name, default):
    """Lee una lista de valores separados por comas, ignorando espacios."""
    return [value.strip() for value in os.environ.get(name, default).split(",") if value.strip()]


CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"
)

# Orígenes confiables para la validación CSRF de Django (peticiones POST/PUT/DELETE).
# Añade aquí tu dominio de producción cuando despliegues.
CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"
)

# --- Celery ---
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "redis://redis:6379/1")
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]

# --- Google Earth Engine ---
GEE_SERVICE_ACCOUNT = os.environ.get("GEE_SERVICE_ACCOUNT", "")
GEE_PRIVATE_KEY_FILE = os.environ.get("GEE_PRIVATE_KEY_FILE", "/credentials/gee-sa-key.json")
GEE_PROJECT = os.environ.get("GEE_PROJECT", "")

# --- LLM (compatible OpenAI: DeepSeek, OpenAI, etc.) ---
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")

# --- Estáticos / Media ---
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    # Comprime y versiona los estáticos; WhiteNoise los sirve eficientemente.
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

LANGUAGE_CODE = "es"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Redis database 2 is separate from the broker and Celery results.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache",
                       "LOCATION": os.environ.get("DJANGO_CACHE_URL", "redis://redis:6379/2"),
                       "KEY_PREFIX": "quenaris"}}
AUTH_TOKEN_HOURS = 24
PUBLIC_SIGNUP_ENABLED = os.environ.get("PUBLIC_SIGNUP_ENABLED", "0") == "1"
EMAIL_LOGIN_ENABLED = os.environ.get("EMAIL_LOGIN_ENABLED", "0") == "1"
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "1") == "1"
EMAIL_USE_SSL = os.environ.get("EMAIL_USE_SSL", "0") == "1"
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "")
DATA_UPLOAD_MAX_MEMORY_SIZE = 128 * 1024
ANALYSIS_MAX_VERTICES = 1000
ANALYSIS_MAX_DOWNLOAD_BYTES = 24 * 1024 * 1024
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_PATH = "/admin/"
CSRF_COOKIE_PATH = "/admin/"
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = os.environ.get("DJANGO_COOKIE_SECURE", "1") == "1"
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SECURE_SSL_REDIRECT = os.environ.get("DJANGO_REQUIRE_HTTPS", "0") == "1"
SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
if os.environ.get("DJANGO_TRUST_PROXY_SSL", "0") == "1":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
