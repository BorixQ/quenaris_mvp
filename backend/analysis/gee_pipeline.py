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
from .indices import build_index_stack, resolve_indices

logger = logging.getLogger(__name__)

ANALYSIS_SCALE = 20
SEMANTIC = ["No apto", "Marginal", "Moderado", "Bueno", "Óptimo"]


# ---------------------------------------------------------------------------
def init_gee() -> None:
    credentials = ee.ServiceAccountCredentials(
        settings.GEE_SERVICE_ACCOUNT, settings.GEE_PRIVATE_KEY_FILE)
    ee.Initialize(credentials, project=settings.GEE_PROJECT or None)


def _mask_s2_clouds(image: ee.Image) -> ee.Image:
    qa = image.select("QA60")
    mask = qa.bitwiseAnd(1 << 10).eq(0).And(qa.bitwiseAnd(1 << 11).eq(0))
    return image.updateMask(mask)


def _composite(aoi: ee.Geometry, start: str, end: str, cloud_max: float = 30.0):
    coll = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(aoi).filterDate(start, end)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_max))
            .map(_mask_s2_clouds))
    n = int(coll.size().getInfo())
    if n == 0:
        raise ValueError("Sin imágenes Sentinel-2 libres de nubes para el AOI y fechas. "
                         "Amplía el rango o el umbral de nubosidad.")
    return coll.median().clip(aoi), n


def _download(img: ee.Image, aoi: ee.Geometry, scale: int, bands: list[str]) -> str:
    url = img.getDownloadURL({"region": aoi, "scale": scale, "format": "GEO_TIFF", "bands": bands})
    tmp = tempfile.NamedTemporaryFile(suffix=".tif", delete=False)
    urllib.request.urlretrieve(url, tmp.name)
    return tmp.name


def _zscore(a: np.ndarray) -> np.ndarray:
    s = a.std()
    return (a - a.mean()) / s if s > 1e-9 else np.zeros_like(a)


# ---------------------------------------------------------------------------
def _analyze(tif_path: str, index_list: list[str], algorithm: str,
             n_clusters: int, use_pca: bool) -> dict:
    with rasterio.open(tif_path) as src:
        data = src.read()
        transform, crs = src.transform, src.crs

    n_idx, h, w = data.shape
    flat = data.reshape(n_idx, -1).T
    valid = np.isfinite(flat).all(axis=1)
    if valid.sum() < 20:
        raise ValueError("Píxeles válidos insuficientes tras filtrar nubes/NaN.")

    raw = {name: flat[valid, i] for i, name in enumerate(index_list)}
    feat_names = list(index_list)
    Z = {name: _zscore(raw[name]) for name in index_list}
    if "Slope" in index_list:
        raw["slope_opt"] = scoring.slope_optimality(raw["Slope"])
        Z["slope_opt"] = _zscore(raw["slope_opt"])
        feat_names.append("slope_opt")

    # M2 — aptitud por píxel (usa los índices presentes)
    suit = scoring.suitability(Z)

    # Matriz de features; PCA opcional para mitigar colinealidad
    X_orig = np.column_stack([Z[n] for n in feat_names])
    X_cluster, pca_info = X_orig, None
    if use_pca and X_orig.shape[1] > 2:
        from sklearn.decomposition import PCA
        pca = PCA(n_components=0.95, random_state=42)
        X_cluster = pca.fit_transform(X_orig)
        pca_info = {"n_components": int(pca.n_components_),
                    "explained_variance": round(float(pca.explained_variance_ratio_.sum()), 3)}

    # M3 — clustering
    centers = None
    if algorithm == "dbscan":
        labels = DBSCAN(eps=1.2, min_samples=30, n_jobs=-1).fit_predict(X_cluster)
    elif algorithm == "hdbscan":
        from sklearn.cluster import HDBSCAN
        mcs = max(50, valid.sum() // 50)
        labels = HDBSCAN(min_cluster_size=int(mcs)).fit_predict(X_cluster)
    else:
        algorithm = "kmeans"
        km = KMeans(n_clusters=n_clusters, n_init=10, random_state=42).fit(X_cluster)
        labels = km.labels_
        centers = km.cluster_centers_

    sil = _silhouette(X_cluster, labels)
    importance, imp_method = _importance(feat_names, X_orig, suit, centers, labels)

    ids = sorted(set(labels.tolist()))
    suit_by = {c: float(np.mean(suit[labels == c])) for c in ids}
    ranked = sorted(ids, key=lambda c: suit_by[c])
    sem = _semantic_for(len(ranked))
    label_map = {c: sem[i] for i, c in enumerate(ranked)}

    label_raster = np.full(h * w, -9999, dtype=np.int32)
    label_raster[valid] = labels
    label_raster = label_raster.reshape(h, w)

    recs = []
    for geom, val in rio_features.shapes(label_raster, mask=(label_raster != -9999), transform=transform):
        recs.append({"geometry": shape(geom), "cluster_id": int(val)})
    base = gpd.GeoDataFrame(recs, crs=crs).dissolve(by="cluster_id", as_index=False)
    gdf = base.to_crs(4326)
    gdf_m = base.to_crs(3857)
    area_by = {int(r.cluster_id): float(r.geometry.area / 10_000) for r in gdf_m.itertuples()}

    # Medias por zona solo de los índices presentes (para coropletas/stats)
    extra = {"ndvi_mean": "NDVI", "ndmi_mean": "NDMI", "bsi_mean": "BSI",
             "ndsi_mean": "NDSI", "slope_mean": "Slope", "solar_mean": "SolarExposure"}
    present_extra = {k: b for k, b in extra.items() if b in raw}

    clusters, prio_area = [], {}
    for c in ids:
        sel = labels == c
        s_mean = suit_by[c]
        prio = scoring.classify_priority(s_mean)
        area = area_by.get(c, 0.0)
        prio_area[prio] = prio_area.get(prio, 0.0) + area
        row = {"cluster_id": c, "label": label_map[c], "priority": prio,
               "suitability_mean": round(s_mean, 1), "area_ha": round(area, 2),
               "pixel_count": int(sel.sum())}
        for k, b in present_extra.items():
            row[k] = round(float(np.mean(raw[b][sel])), 4)
        clusters.append(row)

    gdf["label"] = gdf["cluster_id"].map(label_map)
    gdf["priority"] = gdf["cluster_id"].map(lambda c: scoring.classify_priority(suit_by[c]))
    gdf["suitability_mean"] = gdf["cluster_id"].map(lambda c: round(suit_by[c], 1))
    for k, b in present_extra.items():
        gdf[k] = gdf["cluster_id"].map(lambda c, bb=b: round(float(np.mean(raw[bb][labels == c])), 4))
    geojson = json.loads(gdf.to_json())

    statistics = {
        "algorithm": algorithm,
        "n_clusters": len(ids),
        "total_area_ha": round(sum(area_by.values()), 2),
        "suitability_global_mean": round(float(np.mean(suit)), 1),
        "priority_distribution": {k: round(v, 2) for k, v in prio_area.items()},
        "silhouette": sil,
        "feature_importance": importance,
        "importance_method": imp_method,
        "indices_used": index_list,
        "use_pca": use_pca,
        "pca": pca_info,
        "weights": scoring.WEIGHTS,
        "clusters": sorted(clusters, key=lambda c: -c["suitability_mean"]),
    }
    return {"clusters_geojson": geojson, "statistics": statistics}


def _silhouette(X, labels):
    uniq = set(labels.tolist()) - {-1}
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
            idx = np.random.RandomState(0).choice(idx, 20000, replace=False)
        m = XGBRegressor(n_estimators=120, max_depth=4, learning_rate=0.1,
                         n_jobs=-1, verbosity=0)
        m.fit(X_orig[idx], suit[idx])
        imp = np.asarray(m.feature_importances_, dtype=float)
        total = imp.sum() or 1.0
        pairs = sorted(zip(names, (imp / total).tolist()), key=lambda t: -t[1])
        return [{"feature": n, "importance": round(v, 3)} for n, v in pairs[:10]], "xgboost"
    except Exception:
        logger.info("XGBoost no disponible; importancia por centroides")

    if centers is None:
        cids = sorted(set(labels.tolist()) - {-1})
        if len(cids) < 2:
            return [], "none"
        centers = np.array([X_orig[labels == c].mean(axis=0) for c in cids])
    spread = centers.std(axis=0)
    total = spread.sum() or 1.0
    pairs = sorted(zip(names, (spread / total).tolist()), key=lambda t: -t[1])
    return [{"feature": n, "importance": round(v, 3)} for n, v in pairs[:10]], "centroids"


def _semantic_for(n: int) -> list[str]:
    idx = np.linspace(0, len(SEMANTIC) - 1, n).round().astype(int)
    return [SEMANTIC[i] for i in idx]


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
    stack = build_index_stack(aoi, composite, index_list)
    tif = _download(stack, aoi, ANALYSIS_SCALE, index_list)
    try:
        out = _analyze(tif, index_list, algorithm, n_clusters, use_pca)
    finally:
        os.unlink(tif)

    out["statistics"]["date_range"] = {"start": date_start, "end": date_end}
    out["statistics"]["study_type"] = study_type
    out["statistics"]["images_used"] = n_images
    out["images_used"] = n_images
    out["processing_seconds"] = round(time.time() - t0, 1)
    return out
