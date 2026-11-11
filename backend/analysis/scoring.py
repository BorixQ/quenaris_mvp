"""Exploratory, AOI-relative score. No agronomic calibration is claimed."""
from __future__ import annotations
import numpy as np

VERSION = "relative-percentiles-v2"
INDEX_PROFILES = {
    "NDVI": {"direction": "high_good", "weight": .25},
    "EVI": {"direction": "high_good", "weight": .10},
    "NDRE": {"direction": "high_good", "weight": .05},
    "MSAVI": {"direction": "high_good", "weight": .10},
    "NDMI": {"direction": "high_good", "weight": .20},
    "NDWI": {"direction": "low_good", "weight": 0.0},
    "BSI": {"direction": "low_good", "weight": .10},
    "NDSI": {"direction": "low_good", "weight": 0.0},
    "SI2": {"direction": "low_good", "weight": 0.0},
    "PSRI": {"direction": "low_good", "weight": 0.0},
    "Slope": {"direction": "low_good", "weight": 0.0},
    "SolarExposure": {"direction": "high_good", "weight": 0.0},
    "Elevation": {"direction": "high_good", "weight": 0.0},
}
WEIGHTS = {k: v["weight"] for k, v in INDEX_PROFILES.items() if v["weight"] > 0}
# Legacy ordinal bins: heuristic inspection rank, never treatment urgency.
THRESHOLDS = {"Baja": 80., "Media": 60., "Alta": 40.}


def fit_reference(index_maps, weights=None, overrides=None):
    """Fit once on the period composite and reuse unchanged for monthly maps."""
    weights = WEIGHTS if weights is None else weights
    overrides = overrides or {}
    profiles = {}
    for name, values in index_maps.items():
        if name not in INDEX_PROFILES or weights.get(name, 0) <= 0:
            continue
        profile = {**INDEX_PROFILES[name], **overrides.get(name, {})}
        if profile["direction"] not in ("high_good", "low_good"):
            raise ValueError("Dirección de puntuación desconocida.")
        arr = np.asarray(values, dtype=float)
        valid = arr[np.isfinite(arr)]
        if not valid.size:
            raise ValueError(f"Sin datos finitos para {name}.")
        low, high = np.percentile(valid, [2, 98])
        profiles[name] = {"direction": profile["direction"], "weight": float(weights[name]),
                          "low": float(low), "high": float(high)}
    total = sum(p["weight"] for p in profiles.values())
    if not total:
        raise ValueError("La selección no contiene índices con peso de puntuación.")
    for profile in profiles.values():
        profile["weight"] /= total
    return {"version": VERSION, "scope": "AOI-period-relative", "profiles": profiles}


def normalize_index(array, profile):
    array = np.asarray(array, dtype=float)
    finite = np.isfinite(array)
    out = np.full(array.shape, np.nan)
    if not finite.any():
        return out
    low, high = profile.get("low"), profile.get("high")
    if low is None or high is None:
        low, high = np.percentile(array[finite], [2, 98])
    if high - low < 1e-9:
        out[finite] = 50.0  # uninformative index, not moderate ecological health
    else:
        out[finite] = 100 * np.clip((array[finite] - low) / (high - low), 0, 1)
        if profile["direction"] == "low_good":
            out[finite] = 100 - out[finite]
    return out


def compute_suitability(index_maps, weights=None, overrides=None, reference=None):
    if not index_maps:
        raise ValueError("No hay índices para puntuar.")
    reference = reference or fit_reference(index_maps, weights, overrides)
    profiles = reference["profiles"]
    if not profiles or any(name not in index_maps for name in profiles):
        raise ValueError("Faltan índices de la referencia de puntuación.")
    arrays = [np.asarray(index_maps[n], dtype=float) for n in profiles]
    if any(a.shape != arrays[0].shape for a in arrays):
        raise ValueError("Los índices deben compartir la misma cuadrícula.")
    score = np.zeros_like(arrays[0], dtype=float)
    for name, profile in profiles.items():
        score += normalize_index(index_maps[name], profile) * profile["weight"]
    return np.clip(score, 0, 100)


def classify_priority(score):
    if not np.isfinite(score):
        return "No evaluable"
    if score < 40:
        return "Muy Alta"
    if score < 60:
        return "Alta"
    if score < 80:
        return "Media"
    return "Baja"
