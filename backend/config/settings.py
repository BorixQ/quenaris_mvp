"""
Configuración Django — GeoInsight SaaS.
GeoDjango (django.contrib.gis) + DRF + Celery.
"""
import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key")
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
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

ROOT_URLCONF = "config.urls"
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
        # Token primero: si el request trae un token válido, gana este autenticador
        # y NO se ejecuta la comprobación CSRF de SessionAuthentication.
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Sin throttle global: el polling del frontend (cada 4 s) agotaría cualquier
    # límite por usuario. Solo se limita la CREACIÓN de análisis (lo costoso),
    # vía ScopedRateThrottle en la vista (scope "analysis_create").
    "DEFAULT_THROTTLE_RATES": {"analysis_create": "40/hour"},
}

CORS_ALLOWED_ORIGINS = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

# Orígenes confiables para la validación CSRF de Django (peticiones POST/PUT/DELETE).
# Añade aquí tu dominio de producción cuando despliegues.
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

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
