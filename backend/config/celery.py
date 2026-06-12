import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("geoinsight")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# Tareas geoespaciales: pesadas y largas. Configuración defensiva.
app.conf.update(
    task_acks_late=True,                  # re-encolar si el worker muere
    worker_prefetch_multiplier=1,         # una tarea pesada a la vez por proceso
    task_time_limit=60 * 30,              # hard limit: 30 min
    task_soft_time_limit=60 * 25,
    result_expires=60 * 60 * 24,
)
