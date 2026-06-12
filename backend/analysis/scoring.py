"""
Puntuación multicriterio + prioridad (Agro) — refinado jun 2026.

Cambios respecto a la versión anterior, según el análisis de optimización:
  - Vegetación sin redundancia: NDVI, EVI, NDRE.
  - Agua: NDMI + NDWI (fuera MSI y MoistureStress por colinealidad).
  - Mitigación de suelo: MSAVI (sustituye a SAVI) + BSI.
  - NUEVO criterio de SALINIDAD: NDSI + SI2 (estrés osmótico, clave en Arequipa).
  - Topografía: pendiente óptima + exposición solar.

El SuitabilityScore se normaliza por los puntos de los índices PRESENTES, así que
sigue siendo 0–100 aunque el usuario deseleccione algún índice.

  sigmoid(z) = 1/(1+exp(-k·z));  índice "malo" (invertido) → sigmoid(-z).
"""
from __future__ import annotations

import numpy as np

# criterio -> [(feature_z, max_pts, invertido), ...]
CRITERIA: dict[str, list[tuple[str, float, bool]]] = {
    "vigor_vegetal": [
        ("NDVI", 10.0, False), ("EVI", 8.0, False), ("NDRE", 7.0, False),
    ],
    "disponibilidad_hidrica": [
        ("NDMI", 12.0, False), ("NDWI", 8.0, False),
    ],
    "mitigacion_suelo": [
        ("MSAVI", 8.0, False), ("BSI", 7.0, True),
    ],
    "salinidad": [
        ("NDSI", 8.0, True), ("SI2", 7.0, True),   # más sal = peor → invertido
    ],
    "topografia": [
        ("slope_opt", 8.0, False), ("SolarExposure", 7.0, False),
    ],
    "bajo_estres": [
        ("PSRI", 5.0, True), ("NBR", 5.0, False),
    ],
}

# Pesos nominales (informativos; el score real se normaliza por features presentes).
WEIGHTS = {"vigor_vegetal": 0.25, "disponibilidad_hidrica": 0.20, "mitigacion_suelo": 0.15,
           "salinidad": 0.15, "topografia": 0.15, "bajo_estres": 0.10}

THRESHOLDS = {"Muy Alta": 75.0, "Alta": 50.0, "Media": 25.0}


def sigmoid(z: np.ndarray, k: float = 1.0) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-k * z))


def slope_optimality(slope_deg: np.ndarray, mu: float = 4.0, sigma: float = 9.0) -> np.ndarray:
    """Aptitud por pendiente: óptima en pendientes suaves; penaliza las empinadas."""
    return np.exp(-((slope_deg - mu) ** 2) / (2.0 * sigma ** 2))


def _present_terms(z: dict[str, np.ndarray]):
    """Itera (criterio, feature, pts, invertido) solo de features presentes en z."""
    for crit, terms in CRITERIA.items():
        for feat, pts, inv in terms:
            if feat in z:
                yield crit, feat, pts, inv


def sub_scores(z: dict[str, np.ndarray], k: float = 1.0) -> dict[str, np.ndarray]:
    """Sub-score 0–100 por criterio (normalizado por sus features presentes)."""
    n = len(next(iter(z.values())))
    acc = {c: np.zeros(n) for c in CRITERIA}
    poss = {c: 0.0 for c in CRITERIA}
    for crit, feat, pts, inv in _present_terms(z):
        acc[crit] += pts * sigmoid(-z[feat] if inv else z[feat], k)
        poss[crit] += pts
    return {c: (acc[c] / poss[c] * 100 if poss[c] else acc[c]) for c in CRITERIA}


def suitability(z: dict[str, np.ndarray], k: float = 1.0) -> np.ndarray:
    """SuitabilityScore 0–100 por píxel, normalizado por los índices presentes."""
    n = len(next(iter(z.values())))
    total = np.zeros(n)
    possible = 0.0
    for _crit, feat, pts, inv in _present_terms(z):
        total += pts * sigmoid(-z[feat] if inv else z[feat], k)
        possible += pts
    if possible == 0:
        return np.zeros(n)
    return np.clip(total / possible * 100, 0, 100)


def classify_priority(score: float) -> str:
    if score >= THRESHOLDS["Muy Alta"]:
        return "Muy Alta"
    if score >= THRESHOLDS["Alta"]:
        return "Alta"
    if score >= THRESHOLDS["Media"]:
        return "Media"
    return "Baja"
