"""
Puntuación multicriterio + prioridad (Agro) — Refactorizado con Perfiles de Aptitud.
"""
from __future__ import annotations

import numpy as np

# Perfiles de Aptitud
# direction: 'high_good' (más alto es mejor) o 'low_good' (más bajo es mejor)
# weight: peso por defecto para la agricultura general
INDEX_PROFILES = {
    "NDVI":  {"direction": "high_good", "weight": 0.25},
    "EVI":   {"direction": "high_good", "weight": 0.10},
    "NDRE":  {"direction": "high_good", "weight": 0.05},
    "MSAVI": {"direction": "high_good", "weight": 0.10},
    "NDMI":  {"direction": "high_good", "weight": 0.20},
    "NDWI":  {"direction": "low_good",  "weight": 0.00},
    "BSI":   {"direction": "low_good",  "weight": 0.10},
    "NDSI":  {"direction": "low_good",  "weight": 0.10},
    "SI2":   {"direction": "low_good",  "weight": 0.05},
    "PSRI":  {"direction": "low_good",  "weight": 0.05},
    # Topográficos o sin impacto directo en la suma por defecto
    "Slope": {"direction": "low_good",  "weight": 0.00},
    "SolarExposure": {"direction": "high_good", "weight": 0.00},
    "Elevation": {"direction": "high_good", "weight": 0.00},
}

# Solo de referencia, los pesos reales se toman del perfil y se normalizan
WEIGHTS = {k: v["weight"] for k, v in INDEX_PROFILES.items() if v["weight"] > 0}

# Umbrales de Aptitud (no de prioridad directamente).
THRESHOLDS = {"Baja": 80.0, "Media": 60.0, "Alta": 40.0}

def normalize_index(array: np.ndarray, profile: dict) -> np.ndarray:
    """Aplica escalado Min-Max (0-100) dinámico usando los percentiles 2 y 98 del array."""
    valid_data = array[np.isfinite(array)]
    if len(valid_data) == 0:
        return np.zeros_like(array)
        
    p_low = np.percentile(valid_data, 2)
    p_high = np.percentile(valid_data, 98)
    
    # Si todo es constante (ej. imagen plana)
    if p_high - p_low < 1e-9:
        return np.full_like(array, 50.0)
        
    # Recorte a los percentiles para evitar outliers extremos
    clipped = np.clip(array, p_low, p_high)
    
    if profile["direction"] == "high_good":
        return 100.0 * (clipped - p_low) / (p_high - p_low)
    elif profile["direction"] == "low_good":
        return 100.0 * (p_high - clipped) / (p_high - p_low)
    else:
        return np.zeros_like(array)

def compute_suitability(index_maps: dict[str, np.ndarray], weights: dict[str, float] = None, overrides: dict = None) -> np.ndarray:
    """
    Calcula el Suitability Score (0-100) combinando índices normalizados.
    """
    # Si no se pasan pesos explícitos, usar los por defecto de los perfiles
    if weights is None:
        weights = {k: v["weight"] for k, v in INDEX_PROFILES.items()}
    if overrides is None:
        overrides = {}
        
    n = len(next(iter(index_maps.values())))
    score = np.zeros(n)
    total_weight = 0.0
    
    for name, array in index_maps.items():
        if name in INDEX_PROFILES and weights.get(name, 0) > 0:
            profile = INDEX_PROFILES[name].copy()
            if name in overrides:
                profile.update(overrides[name])
                
            norm = normalize_index(array, profile)
            w = weights[name]
            score += norm * w
            total_weight += w
            
    if total_weight > 0:
        score /= total_weight
        
    # Estirar el score final para que aproveche todo el rango 0-100
    s_min = np.percentile(score, 2)
    s_max = np.percentile(score, 98)
    if s_max - s_min > 1e-9:
        score = (score - s_min) / (s_max - s_min) * 100
        
    return np.clip(score, 0, 100)

def classify_priority(score: float) -> str:
    """
    Clasificación de la prioridad de intervención según la aptitud (0-100).
    Zonas con BAJA aptitud requieren ALTA prioridad de manejo.
    """
    if score < THRESHOLDS["Alta"]:
        return "Muy Alta"
    if score < THRESHOLDS["Media"]:
        return "Alta"
    if score < THRESHOLDS["Baja"]:
        return "Media"
    return "Baja"
