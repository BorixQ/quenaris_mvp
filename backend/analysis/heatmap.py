"""
Mapas de calor temporales (rásters propios) — capa de aptitud + índices.

Para cada mes del rango: composite Sentinel-2 sin nubes → stack de índices →
se colorizan como PNG (RGBA, transparencia en nodata) la capa SUITABILITY
(SuitabilityScore 0–100, M2) y un conjunto curado de índices.

Salida: MEDIA_ROOT/heatmaps/<id>/<capa>/<YYYY-MM>.png
Frontend: capa `image` de MapLibre con selector y barra temporal.
"""
from __future__ import annotations

import logging
import os
import tempfile
import urllib.request
from datetime import date

import ee
import matplotlib
import numpy as np
import rasterio
from matplotlib.colors import Normalize
from PIL import Image

from . import scoring
from .gee_pipeline import _mask_s2_clouds, init_gee
from .indices import REGISTRY, build_index_stack

logger = logging.getLogger(__name__)

# El heatmap descarga TODO el registro de índices (para colorizar cualquier capa
# de DISPLAY y para computar la aptitud), independientemente del preset del análisis.
HEATMAP_BANDS = list(REGISTRY)

# Capas a colorizar: clave_publica -> (banda del stack o "__suit__", rango, colormap)
# Se generan TODOS los índices del análisis + la aptitud. Colorizar es barato:
# el stack completo ya se descarga una vez por mes.
DISPLAY = {
    "suitability":    {"band": "__suit__",      "vmin": 0,    "vmax": 100, "cmap": "RdYlGn"},
    # Vegetación
    "ndvi":           {"band": "NDVI",          "vmin": -0.2, "vmax": 0.9, "cmap": "RdYlGn"},
    "evi":            {"band": "EVI",           "vmin": -0.2, "vmax": 1.0, "cmap": "RdYlGn"},
    "savi":           {"band": "SAVI",          "vmin": -0.2, "vmax": 1.0, "cmap": "RdYlGn"},
    "ndre":           {"band": "NDRE",          "vmin": -0.2, "vmax": 0.7, "cmap": "RdYlGn"},
    "gndvi":          {"band": "GNDVI",         "vmin": -0.2, "vmax": 0.8, "cmap": "RdYlGn"},
    "cire":           {"band": "CIre",          "vmin": 0,    "vmax": 5,   "cmap": "YlGn"},
    "arvi":           {"band": "ARVI",          "vmin": -0.5, "vmax": 0.9, "cmap": "RdYlGn"},
    "sipi":           {"band": "SIPI",          "vmin": 0,    "vmax": 2,   "cmap": "PuOr"},
    "lai":            {"band": "LAI",           "vmin": 0,    "vmax": 4,   "cmap": "YlGn"},
    # Agua
    "msavi":          {"band": "MSAVI",         "vmin": -0.2, "vmax": 0.8, "cmap": "RdYlGn"},
    "ndmi":           {"band": "NDMI",          "vmin": -0.3, "vmax": 0.5, "cmap": "BrBG"},
    "ndwi":           {"band": "NDWI",          "vmin": -0.5, "vmax": 0.5, "cmap": "BrBG"},
    # Salinidad (alto = más sal = peor)
    "ndsi":           {"band": "NDSI",          "vmin": -0.3, "vmax": 0.4, "cmap": "YlOrBr"},
    "si2":            {"band": "SI2",           "vmin": 0,    "vmax": 0.5, "cmap": "YlOrBr"},
    "msi":            {"band": "MSI",           "vmin": 0,    "vmax": 2,   "cmap": "BrBG_r"},
    "moisturestress": {"band": "MoistureStress","vmin": -0.5, "vmax": 0.5, "cmap": "BrBG_r"},
    "wdi":            {"band": "WDI",           "vmin": 0,    "vmax": 2,   "cmap": "BrBG_r"},
    # Suelo
    "bsi":            {"band": "BSI",           "vmin": -0.5, "vmax": 0.5, "cmap": "YlOrBr"},
    "nbr":            {"band": "NBR",           "vmin": -0.5, "vmax": 0.8, "cmap": "RdYlGn"},
    "ndbi":           {"band": "NDBI",          "vmin": -0.5, "vmax": 0.5, "cmap": "YlOrBr"},
    "psri":           {"band": "PSRI",          "vmin": -0.2, "vmax": 0.4, "cmap": "YlOrBr"},
    # Topografía
    "slope":          {"band": "Slope",         "vmin": 0,    "vmax": 45,  "cmap": "cividis"},
    "solarexposure":  {"band": "SolarExposure", "vmin": 0,    "vmax": 1,   "cmap": "magma"},
}
HEATMAP_SCALE = 20


def _month_starts(d0: date, d1: date) -> list[date]:
    out, y, m = [], d0.year, d0.month
    while (y, m) <= (d1.year, d1.month):
        out.append(date(y, m, 1))
        m = 1 if m == 12 else m + 1
        y = y + 1 if m == 1 else y
    return out


def _next_month(d: date) -> date:
    return date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)


def _composite(aoi, start, end, cloud_max=35.0):
    coll = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(aoi).filterDate(start, end)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_max))
            .map(_mask_s2_clouds))
    return (coll.median().clip(aoi), int(coll.size().getInfo()))


def _download(img, aoi, scale) -> str:
    url = img.getDownloadURL({"region": aoi, "scale": scale, "format": "GEO_TIFF",
                              "bands": HEATMAP_BANDS})
    tmp = tempfile.NamedTemporaryFile(suffix=".tif", delete=False)
    urllib.request.urlretrieve(url, tmp.name)
    return tmp.name


def _bands(data: np.ndarray) -> dict[str, np.ndarray]:
    return {name: data[i] for i, name in enumerate(HEATMAP_BANDS)}


def _suitability_2d(b: dict[str, np.ndarray]) -> np.ndarray:
    """SuitabilityScore por píxel sobre la grilla 2D (nan donde falta dato)."""
    h, w = b["NDVI"].shape
    feats = [f for f in scoring.INDEX_PROFILES.keys() if f in b]
    raw = {k: b[k].reshape(-1) for k in feats}
    
    valid = np.isfinite(np.column_stack([raw[k] for k in raw])).all(axis=1)

    out = np.full(h * w, np.nan, dtype=float)
    if valid.sum() >= 20:
        valid_raw = {k: raw[k][valid] for k in raw}
        out[valid] = scoring.compute_suitability(valid_raw)
    return out.reshape(h, w)


def _colorize(arr, vmin, vmax, cmap_name) -> Image.Image:
    cmap = matplotlib.colormaps[cmap_name]
    norm = Normalize(vmin=vmin, vmax=vmax, clip=True)
    filled = np.where(np.isfinite(arr), arr, vmin)
    rgba = (cmap(norm(filled)) * 255).astype(np.uint8)
    rgba[~np.isfinite(arr), 3] = 0
    return Image.fromarray(rgba, mode="RGBA")


def generate_heatmaps(aoi_geojson, date_start, date_end, analysis_id, media_root) -> dict | None:
    init_gee()
    aoi = ee.Geometry(aoi_geojson)
    d0, d1 = date.fromisoformat(date_start), date.fromisoformat(date_end)

    out_root = os.path.join(media_root, "heatmaps", str(analysis_id))
    for layer in DISPLAY:
        os.makedirs(os.path.join(out_root, layer), exist_ok=True)

    timesteps, bounds, suit_series = [], None, []
    for ms in _month_starts(d0, d1):
        label = ms.strftime("%Y-%m")
        composite, n = _composite(aoi, ms.isoformat(), _next_month(ms).isoformat())
        if n == 0:
            continue
        stack = build_index_stack(aoi, composite, HEATMAP_BANDS)
        try:
            tif = _download(stack, aoi, HEATMAP_SCALE)
        except Exception:
            logger.exception("Heatmap: descarga falló para %s", label)
            continue
        try:
            with rasterio.open(tif) as src:
                data = src.read()
                if bounds is None:
                    b = src.bounds
                    bounds = [b.left, b.bottom, b.right, b.top]
            bd = _bands(data)
            suit_grid = _suitability_2d(bd)
            for layer, spec in DISPLAY.items():
                grid = suit_grid if spec["band"] == "__suit__" else bd[spec["band"]]
                img = _colorize(grid, spec["vmin"], spec["vmax"], spec["cmap"])
                img.save(os.path.join(out_root, layer, f"{label}.png"))
            # Media de aptitud del mes (para la gráfica temporal del informe)
            m = float(np.nanmean(suit_grid)) if np.isfinite(suit_grid).any() else None
            suit_series.append({"month": label, "suitability_mean": round(m, 1) if m is not None else None})
            timesteps.append(label)
        finally:
            os.unlink(tif)

    if not timesteps:
        return None
    return {
        "bounds": bounds,
        "indices": list(DISPLAY.keys()),
        "timesteps": timesteps,
        "url_template": f"/media/heatmaps/{analysis_id}/{{index}}/{{timestep}}.png",
        "ranges": {k: {"vmin": v["vmin"], "vmax": v["vmax"]} for k, v in DISPLAY.items()},
        "suitability_series": suit_series,
    }
