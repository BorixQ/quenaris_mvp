"""
Valida la conexión a Google Earth Engine de forma aislada.

Uso:
    docker compose exec worker python manage.py check_gee
    docker compose exec worker python manage.py check_gee --lon -72.0 --lat -37.5

Comprueba, en orden, cada eslabón de la cadena y para en el primero que falle,
con un diagnóstico accionable:
  1. Variables de entorno presentes.
  2. Archivo de clave existe y su client_email coincide con GEE_SERVICE_ACCOUNT.
  3. ee.Initialize() autentica contra el proyecto.
  4. Una operación de cómputo trivial responde (valida el acceso al backend).
  5. Hay imágenes Sentinel-2 sobre un punto de prueba.
"""
import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Valida credenciales y acceso a Google Earth Engine."

    def add_arguments(self, parser):
        parser.add_argument("--lon", type=float, default=-72.0, help="Longitud del punto de prueba")
        parser.add_argument("--lat", type=float, default=-37.5, help="Latitud del punto de prueba")

    def handle(self, *args, **opts):
        ok = self.style.SUCCESS
        warn = self.style.WARNING
        err = self.style.ERROR

        # --- 1. Variables de entorno ---
        self.stdout.write("1) Variables de entorno…")
        sa = settings.GEE_SERVICE_ACCOUNT
        key_file = settings.GEE_PRIVATE_KEY_FILE
        project = settings.GEE_PROJECT
        for name, val in [("GEE_SERVICE_ACCOUNT", sa),
                          ("GEE_PRIVATE_KEY_FILE", key_file),
                          ("GEE_PROJECT", project)]:
            if not val:
                self.stdout.write(err(f"   ✗ {name} está vacía. Defínela en .env."))
                return
            if "mi-proyecto" in str(val) or val.startswith("mi-sa@"):
                self.stdout.write(err(f"   ✗ {name}='{val}' sigue siendo el valor de EJEMPLO."))
                return
            self.stdout.write(ok(f"   ✓ {name} = {val}"))

        # --- 2. Archivo de clave + coherencia del email ---
        self.stdout.write("2) Archivo de clave…")
        if not os.path.exists(key_file):
            self.stdout.write(err(f"   ✗ No existe {key_file}. "
                                  "Coloca el JSON en ./credentials/gee-sa-key.json y recrea el worker."))
            return
        try:
            with open(key_file) as fh:
                key = json.load(fh)
        except Exception as e:
            self.stdout.write(err(f"   ✗ No se pudo leer el JSON: {e}"))
            return
        client_email = key.get("client_email", "")
        key_project = key.get("project_id", "")
        self.stdout.write(ok(f"   ✓ Clave leída. client_email = {client_email}"))
        if client_email != sa:
            self.stdout.write(err(f"   ✗ client_email del JSON ({client_email}) "
                                  f"NO coincide con GEE_SERVICE_ACCOUNT ({sa})."))
            return
        if key_project and key_project != project:
            self.stdout.write(warn(f"   ! project_id del JSON ({key_project}) "
                                   f"difiere de GEE_PROJECT ({project}). Suele querer decir "
                                   "que la SA pertenece a otro proyecto."))

        # --- 3. Inicialización / autenticación ---
        self.stdout.write("3) ee.Initialize()…")
        try:
            import ee
            credentials = ee.ServiceAccountCredentials(sa, key_file)
            ee.Initialize(credentials, project=project)
            self.stdout.write(ok("   ✓ Autenticado e inicializado."))
        except Exception as e:
            self.stdout.write(err(f"   ✗ Falló la inicialización: {e}"))
            self.stdout.write(warn("   Pistas: ¿Earth Engine API habilitada en el proyecto? "
                                   "¿Proyecto registrado en code.earthengine.google.com/register? "
                                   "¿La SA tiene rol 'Earth Engine Resource Writer'?"))
            return

        # --- 4. Operación de cómputo trivial ---
        self.stdout.write("4) Operación de cómputo…")
        try:
            val = ee.Number(40).add(2).getInfo()
            assert val == 42
            self.stdout.write(ok("   ✓ El backend de cómputo responde."))
        except Exception as e:
            self.stdout.write(err(f"   ✗ El cómputo falló: {e}"))
            return

        # --- 5. Disponibilidad de Sentinel-2 ---
        self.stdout.write("5) Sentinel-2 sobre el punto de prueba…")
        try:
            point = ee.Geometry.Point([opts["lon"], opts["lat"]])
            n = int(
                ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(point)
                .filterDate("2025-01-01", "2025-03-31")
                .size()
                .getInfo()
            )
            self.stdout.write(ok(f"   ✓ {n} escenas Sentinel-2 disponibles "
                                 f"en [{opts['lon']}, {opts['lat']}] (Q1 2025)."))
        except Exception as e:
            self.stdout.write(err(f"   ✗ Consulta de imágenes falló: {e}"))
            return

        self.stdout.write(ok("\n✓ GEE validado de extremo a extremo. El pipeline puede ejecutarse."))
