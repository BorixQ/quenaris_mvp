"""
Motor de análisis (por píxel) — GEE + scikit-learn, con presets e índices
seleccionables, PCA opcional, KMeans/DBSCAN/HDBSCAN e importancia XGBoost.

Flujo:
  composite Sentinel-2 → stack de los índices del preset/selección → z-score
  → SuitabilityScore (M2, robusto a índices faltantes) → [PCA opcional] →
  clustering (M3) → zonas etiquetadas por aptitud → GeoJSON + estadísticas.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import urllib.request

import ee
import geopandas as gpd
import numpy as np
import rasterio
from django.conf import settings
from rasterio import features as rio_features
from shapely.geometry import shape
from sklearn.cluster import DBSCAN, KMeans
from sklearn.metrics import silhouette_score

from . import scoring
from .diagnosis_rules import infer_causes
from .indices import build_index_stack, resolve_indices, PRESETS

logger = logging.getLogger(__name__)

ANALYSIS_SCALE = 20
QUALITY_BANDS = ["quality_aoi", "quality_observations"]



# ---------------------------------------------------------------------------
def init_gee() -> None:
    account = getattr(settings, "GEE_SERVICE_ACCOUNT", "")
    if account:
        credentials = ee.ServiceAccountCredentials(account, settings.GEE_PRIVATE_KEY_FILE)
        ee.Initialize(credentials, project=settings.GEE_PROJECT or None)
    else:
        # Local research: reuse OAuth credentials created by earthengine authenticate.
        ee.Initialize(project=settings.GEE_PROJECT or None)
    ee.data.setDeadline(60000)


def _mask_s2_clouds(image: ee.Image) -> ee.Image:
    # SCL 4/5: vegetated or bare land. Excludes shadow, cloud, snow and water.
    # Built surfaces may remain in class 5: this is not a land-use classifier.
    scl = image.select("SCL")
    return image.updateMask(scl.eq(4).Or(scl.eq(5)))


def _composite(aoi: ee.Geometry, start: str, end: str, cloud_max: float = 30.0):
    coll = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(aoi).filterDate(start, end)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_max))
            .map(_mask_s2_clouds))
    n = int(coll.size().getInfo())
    if n == 0:
        raise ValueError("Sin imágenes Sentinel-2 libres de nubes para el AOI y fechas. "
                         "Amplía el rango o el umbral de nubosidad.")
    composite = coll.median().clip(aoi)
    observations = coll.select("B4").count().rename("quality_observations").unmask(0).clip(aoi)
    footprint = ee.Image.constant(1).rename("quality_aoi").clip(aoi)
    return composite.addBands([footprint, observations]), n


def _download(img: ee.Image, aoi: ee.Geometry, scale: int, bands: list[str]) -> str:
    url = img.getDownloadURL({"region": aoi, "scale": scale, "format": "GEO_TIFF", "bands": bands, "crs": "EPSG:4326"})
    tmp = tempfile.NamedTemporaryFile(suffix=".tif", delete=False)
    path = tmp.name
    tmp.close()
    try:
        urllib.request.urlretrieve(url, path)
    except Exception:
        os.unlink(path)
        raise
    return path


def _zscore(a: np.ndarray) -> np.ndarray:
    s = a.std()
    return (a - a.mean()) / s if s > 1e-9 else np.zeros_like(a)


# ---------------------------------------------------------------------------
def _analyze(tif_path: str, index_list: list[str], algorithm: str,
             n_clusters: int, use_pca: bool, study_type: str) -> dict:
    with rasterio.open(tif_path) as src:
        data = src.read(masked=True).filled(np.nan)
        transform, crs = src.transform, src.crs

    _, h, w = data.shape
    n_idx = len(index_list)
    flat = data[:n_idx].reshape(n_idx, -1).T
    footprint = np.isfinite(data[n_idx].reshape(-1)) if len(data) > n_idx else np.ones(h*w, dtype=bool)
    observations = data[n_idx+1].reshape(-1) if len(data) > n_idx+1 else np.ones(h*w)
    valid = np.isfinite(flat).all(axis=1) & footprint & (observations > 0)
    warnings = ["Resultado exploratorio sin calibración de campo.",
                "Puntuación relativa al AOI y periodo; no comparable con otras corridas.",
                "Suelo expuesto no implica disponibilidad para reforestar; verificar pastizales nativos, uso y tenencia.",
                "La máscara SCL puede conservar superficies urbanas y cometer errores en terreno montañoso."]
    fraction = float(valid.sum() / max(1, footprint.sum()))
    if fraction < .5:
        warnings.append("Menos del 50% de la cuadrícula del AOI tiene datos terrestres utilizables; baja cobertura.")
    if valid.sum() < 20:
        raise ValueError("Píxeles válidos insuficientes tras filtrar nubes/NaN.")

    raw = {name: flat[valid, i] for i, name in enumerate(index_list)}
    feat_names = list(index_list)
    Z = {name: _zscore(raw[name]) for name in index_list}

    preset = PRESETS.get(study_type, PRESETS["agro"])
    weights = None
    overrides = None
    if isinstance(preset, dict):
        weights = preset.get("weights")
        overrides = preset.get("profile_overrides")

    # M2 — aptitud por píxel (usa los índices crudos con normalización MinMax contextual)
    reference = scoring.fit_reference(raw, weights=weights, overrides=overrides)
    suit = scoring.compute_suitability(raw, reference=reference)

    # Matriz de features; PCA opcional para mitigar colinealidad
    X_orig = np.column_stack([Z[n] for n in feat_names])
    X_cluster, pca_info = X_orig, None
    if use_pca and X_orig.shape[1] > 2 and np.var(X_orig) > 1e-12:
        from sklearn.decomposition import PCA
        pca = PCA(n_components=0.95, random_state=42)
        X_cluster = pca.fit_transform(X_orig)
        pca_info = {"n_components": int(pca.n_components_),
                    "explained_variance": round(float(pca.explained_variance_ratio_.sum()), 3)}

    # M3: do not force arbitrary clusters on constant or undersized data.
    labels, algorithm = cluster_pixels(X_cluster, algorithm, n_clusters)
    if len(set(labels.tolist()) - {-1}) < 2:
        warnings.append("Sin evidencia de múltiples grupos espectrales diferenciados.")

    sil = _silhouette(X_cluster, labels)
    importance, imp_method = _importance(feat_names, X_orig, suit, None, labels)

    ids = sorted(set(labels.tolist()))
    suit_by = {c: float(np.mean(suit[labels == c])) for c in ids}
    ranked = sorted(ids, key=lambda c: suit_by[c])
    land_ids = [c for c in ranked if c != -1]
    label_map = {c: f"Grupo {c+1}" for c in land_ids}
    label_map[-1] = "Sin agrupación"

    label_raster = np.full(h * w, -9999, dtype=np.int32)
    label_raster[valid] = labels
    label_raster = label_raster.reshape(h, w)

    recs = []
    for geom, val in rio_features.shapes(label_raster, mask=(label_raster != -9999), transform=transform):
        recs.append({"geometry": shape(geom), "cluster_id": int(val)})
    base = gpd.GeoDataFrame(recs, crs=crs).dissolve(by="cluster_id", as_index=False)
    gdf = base.to_crs(4326)
    from pyproj import Geod
    geod = Geod(ellps="WGS84")
    area_by = {int(r.cluster_id): abs(geod.geometry_area_perimeter(r.geometry)[0]) / 10_000
               for r in gdf.itertuples()}

    # Medias por zona solo de los índices presentes (para coropletas/stats)
    extra = {f"{name.lower()}_mean": name for name in index_list}
    extra["solar_mean"] = "SolarExposure"
    present_extra = {k: b for k, b in extra.items() if b in raw}

    clusters, prio_area = [], {}
    for c in ids:
        sel = labels == c
        s_mean = suit_by[c]
        prio = scoring.classify_priority(s_mean) if c != -1 else "No evaluable"
        area = area_by.get(c, 0.0)
        prio_area[prio] = prio_area.get(prio, 0.0) + area
        row = {"cluster_id": c, "label": label_map[c], "priority": prio,
               "suitability_mean": round(s_mean, 1), "area_ha": round(area, 2),
               "pixel_count": int(sel.sum())}
        
        raw_means = {}
        for k, b in present_extra.items():
            val = float(np.mean(raw[b][sel]))
            row[k] = round(val, 4)
            raw_means[b] = val
            
        row["differential"] = infer_causes(raw_means)
        clusters.append(row)

    gdf["label"] = gdf["cluster_id"].map(label_map)
    gdf["priority"] = gdf["cluster_id"].map(lambda c: scoring.classify_priority(suit_by[c]) if c != -1 else "No evaluable")
    gdf["suitability_mean"] = gdf["cluster_id"].map(lambda c: round(suit_by[c], 1))
    for k, b in present_extra.items():
        gdf[k] = gdf["cluster_id"].map(lambda c, bb=b: round(float(np.mean(raw[bb][labels == c])), 4))
    geojson = json.loads(gdf.to_json())

    statistics = {
        "calibrated": False,
        "science_version": scoring.VERSION,
        "score_interpretation": "relative_exploratory",
        "warnings": warnings,
        "scoring_reference": reference,
        "quality": {"valid_pixels": int(valid.sum()), "aoi_grid_pixels": int(footprint.sum()),
                    "valid_fraction": fraction, "min_observations": int(observations[valid].min()),
                    "mean_observations": float(observations[valid].mean()),
                    "mask": "SCL classes 4,5; finite selected bands"},
        "analysis_scale_m": ANALYSIS_SCALE,
        "collections": {"optical": "COPERNICUS/S2_SR_HARMONIZED", "surface_model": "COPERNICUS/DEM/GLO30_2024_1"},
        "date_end_exclusive": True,
        "area_method": "WGS84 ellipsoidal geometry area; displayed AOI/quota uses equal-area EPSG:6933",
        "native_resolution_note": "Optical 10/20m; DSM ~30m; output grid 20m; nearest resampling.",
        "priority_interpretation": "heuristic inspection rank, not treatment urgency",
        "diagnostic_status": "withheld_no_field_validation",
        "algorithm": algorithm,
        "n_clusters": len(set(ids) - {-1}), "noise_pixels": int((labels == -1).sum()),
        "total_area_ha": round(sum(area_by.values()), 2),
        "suitability_global_mean": round(float(np.mean(suit)), 1),
        "priority_distribution": {k: round(v, 2) for k, v in prio_area.items()},
        "silhouette": sil,
        "feature_importance": importance,
        "importance_method": imp_method,
        "indices_used": index_list,
        "use_pca": use_pca,
        "pca": pca_info,
        "weights": {k: p["weight"] for k, p in reference["profiles"].items()},
        "clusters": sorted(clusters, key=lambda c: -c["suitability_mean"]),
    }
    return {"clusters_geojson": geojson, "statistics": statistics}


def cluster_pixels(X, algorithm, n_clusters):
    if not 2 <= n_clusters <= 12:
        raise ValueError("n_clusters debe estar entre 2 y 12.")
    if len(X) < 20 or not np.isfinite(X).all():
        raise ValueError("Píxeles finitos insuficientes para agrupar (mínimo 20).")
    unique = np.unique(X, axis=0).shape[0]
    k = min(n_clusters, unique, max(1, len(X) // 5))
    if k < 2:
        return np.zeros(len(X), dtype=int), "homogeneous"
    if algorithm == "dbscan":
        labels = DBSCAN(eps=1.2, min_samples=max(5, len(X)//20), n_jobs=1).fit_predict(X)
        return labels, algorithm
    if algorithm == "hdbscan":
        from sklearn.cluster import HDBSCAN
        return HDBSCAN(min_cluster_size=max(5, len(X)//20)).fit_predict(X), algorithm
    if algorithm != "kmeans":
        raise ValueError("Algoritmo desconocido.")
    return KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(X), "kmeans"


def _silhouette(X, labels):
    keep = labels != -1
    X, labels = X[keep], labels[keep]
    uniq = set(labels.tolist())
    if len(uniq) < 2:
        return None
    idx = np.arange(len(labels))
    if len(idx) > 5000:
        idx = np.random.RandomState(42).choice(idx, 5000, replace=False)
    try:
        return round(float(silhouette_score(X[idx], labels[idx])), 3)
    except Exception:
        return None


def _importance(names, X_orig, suit, centers, labels):
    """Importancia de índices. Primero intenta XGBoost (pseudo-supervisado sobre la
    aptitud → qué índices la explican); si no está, usa separación de centroides."""
    try:
        from xgboost import XGBRegressor
        idx = np.arange(X_orig.shape[0])
        if len(idx) > 20000:
            idx = np.random.RandomState(42).choice(idx, 20000, replace=False)
        m = XGBRegressor(n_estimators=120, max_depth=4, learning_rate=0.1,
                         n_jobs=1, verbosity=0, random_state=42)
        m.fit(X_orig[idx], suit[idx])
        imp = np.asarray(m.feature_importances_, dtype=float)
        total = imp.sum() or 1.0
        pairs = sorted(zip(names, (imp / total).tolist()), key=lambda t: -t[1])
        return [{"feature": n, "importance": round(v, 3)} for n, v in pairs[:10]], "xgboost"
    except Exception:
        logger.info("XGBoost no disponible; importancia por centroides")

    # Recompute in original feature space; PCA centroids have different dimensions.
    cids = sorted(set(labels.tolist()) - {-1})
    if len(cids) < 2:
        return [], "none"
    centers = np.array([X_orig[labels == c].mean(axis=0) for c in cids])
    spread = centers.std(axis=0)
    total = spread.sum() or 1.0
    pairs = sorted(zip(names, (spread / total).tolist()), key=lambda t: -t[1])
    return [{"feature": n, "importance": round(v, 3)} for n, v in pairs[:10]], "centroids"


# ---------------------------------------------------------------------------
def run_pipeline(aoi_geojson: dict, date_start: str, date_end: str,
                 algorithm: str = "kmeans", n_clusters: int = 4,
                 study_type: str = "agro", indices: list[str] | None = None,
                 use_pca: bool = False) -> dict:
    t0 = time.time()
    init_gee()
    aoi = ee.Geometry(aoi_geojson)
    index_list = resolve_indices(study_type, indices)

    composite, n_images = _composite(aoi, date_start, date_end)
    stack = build_index_stack(aoi, composite, index_list).addBands(composite.select(QUALITY_BANDS)).toFloat()
    tif = _download(stack, aoi, ANALYSIS_SCALE, index_list + QUALITY_BANDS)
    try:
        out = _analyze(tif, index_list, algorithm, n_clusters, use_pca, study_type)
    finally:
        os.unlink(tif)

    out["statistics"]["date_range"] = {"start": date_start, "end": date_end}
    out["statistics"]["study_type"] = study_type
    out["statistics"]["images_used"] = n_images
    out["images_used"] = n_images
    out["processing_seconds"] = round(time.time() - t0, 1)
    return out
