"""
Reglas heurísticas para el diagnóstico diferencial de zonas.
Basado en los valores promedios de los índices dentro de un cluster.
Devuelve un array ordenado con `evidence_score` usando una aproximación Softmax.
"""
from __future__ import annotations

import math

def softmax(scores_dict: dict[str, float], temperature: float = 0.3) -> list[dict]:
    """Aplica Softmax a un diccionario de scores brutos y devuelve lista ordenada."""
    if not scores_dict:
        return []
    
    # Prevenir overflow
    max_score = max(scores_dict.values())
    exp_scores = {k: math.exp((v - max_score) / temperature) for k, v in scores_dict.items()}
    sum_exp = sum(exp_scores.values())
    
    # Calcular probabilidades
    probs = [
        {"cause": k, "evidence_score": round(v / sum_exp, 3)}
        for k, v in exp_scores.items()
    ]
    
    # Ordenar de mayor a menor probabilidad
    return sorted(probs, key=lambda x: x["evidence_score"], reverse=True)


def infer_causes(index_means: dict[str, float]) -> list[dict]:
    """
    Infiere la causa principal (diagnóstico diferencial) basándose en promedios
    zonales de los índices presentes.
    """
    # Valores por defecto seguros si un índice no está presente
    ndvi = index_means.get("NDVI", 0.5)
    ndmi = index_means.get("NDMI", 0.2)
    ndsi = index_means.get("NDSI", -0.2)
    si2 = index_means.get("SI2", 0.1)
    bsi = index_means.get("BSI", -0.1)
    msavi = index_means.get("MSAVI", ndvi) # MSAVI suele ser similar a NDVI
    
    scores = {}
    
    # 1. Estrés Hídrico
    # Sube si hay poca humedad (NDMI bajo) pero hay algo de vegetación (para diferenciar de suelo desnudo)
    water_deficit = max(0.0, 0.2 - ndmi) * 5.0  # Penaliza fuertemente NDMI < 0.2
    veg_presence = min(1.0, max(0.0, ndvi * 2.0)) # 0 a 1
    scores["ESTRES_HIDRICO"] = water_deficit * veg_presence
    
    # 2. Salinidad
    # Sensible al índice de salinidad normalizado y salinidad 2
    sal_ndsi = max(0.0, ndsi) * 4.0
    sal_si2 = max(0.0, si2 - 0.1) * 3.0
    scores["SALINIDAD"] = sal_ndsi + sal_si2
    
    # 3. Degradación de Suelo (o Suelo Desnudo)
    # Suelo desnudo (BSI > 0) y nulo vigor vegetal
    bare_soil = max(0.0, bsi) * 3.0
    low_veg = max(0.0, 0.2 - ndvi) * 4.0
    scores["DEGRADACION_SUELO"] = bare_soil + low_veg
    
    # 4. Sano / Óptimo
    # Buenos índices de humedad y vegetación, sin salinidad
    good_veg = max(0.0, ndvi - 0.4) * 3.0
    good_water = max(0.0, ndmi) * 2.0
    no_salinity = max(0.0, -ndsi) * 1.0
    scores["SANO_OPTIMO"] = good_veg + good_water + no_salinity
    
    # 5. Estrés Térmico / Anomalía
    # Causa residual para comportamientos atípicos no clasificados (ej. NDMI alto pero NDVI muy bajo)
    scores["ANOMALIA_DESCONOCIDA"] = 0.5
    
    return softmax(scores)
