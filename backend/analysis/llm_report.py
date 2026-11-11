"""Factual reporting for uncalibrated satellite observations."""
import json
import re


SYSTEM_PROMPT = """Eres un redactor técnico de observaciones satelitales exploratorias.
Usa exclusivamente el JSON recibido. No inventes especies, cultivos, fenología,
métricas, causas de estrés, probabilidades ni tratamientos. El análisis NO está
calibrado con campo. No diagnostiques salinidad, plagas, carencias, supervivencia
de plantones ni necesidad de riego o fertilización a partir de estos índices.
La puntuación 0-100 es relativa a percentiles del AOI y periodo, con pesos
heurísticos en weights/scoring_reference; no equivale a salud o aptitud absoluta.
priority es solo un orden heurístico para inspección: puntuación <40 Muy Alta,
<60 Alta, <80 Media, resto Baja. No expresa urgencia de tratamiento.
Respeta warnings y quality: cobertura baja implica evidencia limitada. Imágenes
por escena no equivalen a observaciones válidas por píxel. Una mediana temporal
no demuestra cambios. Silhouette evalúa separación geométrica, no precisión.
XGBoost aproxima una puntuación definida por reglas: no valida causalidad.
Suelo desnudo no implica oportunidad de reforestar; puede ser roca, ciudad,
pastizal nativo o suelo bajo otro uso. No traslades hipótesis agrícolas a puna.
Estructura en español: observaciones y procedencia; tabla de grupos y puntuación
relativa; calidad/cobertura; limitaciones; verificaciones de campo recomendadas.
Si falta evidencia, indica que no puede concluirse. Omite toda recomendación
de intervención. No muestres porcentajes de certeza ni diagnósticos antiguos.
"""

USER_TEMPLATE = """\
Estadísticas del análisis geoespacial (JSON):

```json
{stats_json}
```

Redacta el informe ejecutivo siguiendo la estructura indicada.
"""


def generate_report(statistics: dict) -> str:
    """Deterministic factual report while no independent calibration exists.

    The legacy prompt remains as a documented constraint for future reviewed
    generation. This release makes no provider call, regardless of API key.
    """
    quality = statistics.get("quality", {})
    coverage = quality.get("valid_fraction")
    coverage_text = f"{100*coverage:.1f}%" if coverage is not None else "no registrada"
    lines = ["## Observaciones satelitales exploratorias",
             "Sin calibración de campo. No se emiten diagnósticos causales ni prescripciones.",
             f"Versión: {statistics.get('science_version', 'histórica/no registrada')}.",
             f"Área con datos utilizables: {statistics.get('total_area_ha', 'no registrada')} ha. "
             f"Puntuación relativa media: {statistics.get('suitability_global_mean', 'no registrada')}/100.",
             f"Cobertura utilizable de la cuadrícula del AOI: {coverage_text}. "
             f"Escenas: {statistics.get('images_used', 'no registradas')}. "
             f"Cuadrícula de salida: {statistics.get('analysis_scale_m', 'no registrada')} m.",
             "La cobertura incluye filtros de superficie y calidad; no representa porcentaje de nubes.",
             "## Grupos espectrales", "| Grupo | Puntuación relativa | Área ha |", "|---|---:|---:|"]
    for group in statistics.get("clusters", []):
        name = "Sin agrupación" if group["cluster_id"] == -1 else f"Grupo {group['cluster_id']+1}"
        lines.append(f"| {name} | {group['suitability_mean']} | {group['area_ha']} |")
    lines += ["## Interpretación y límites",
              "Los percentiles se ajustan al AOI y periodo. La escala no mide salud absoluta ni aptitud ecológica. "
              "No compare puntuaciones de corridas con referencias distintas.",
              "Los meses usan una referencia fija, pero cambios de cobertura y estación pueden alterar su media. "
              "Una diferencia mensual no prueba una tendencia ni una causa.",
              "Pesos efectivos (heurísticos): " + json.dumps(statistics.get("weights", {}), ensure_ascii=False),
              "Silhouette: " + str(statistics.get("silhouette")) + "; separación geométrica, no exactitud agronómica."]
    lines += ["- " + warning for warning in statistics.get("warnings", [])]
    lines += ["## Verificación en campo",
              "Registrar cobertura, fenología, suelo y condiciones de observación con fecha y ubicación. "
              "Para restauración, revisar ecosistema de referencia, pastizales nativos, especies, usos y tenencia. "
              "No determinar riego, fumigación, fertilización o plantación solo con estos resultados."]
    return "\n\n".join(lines)


def _strip_fence(text: str) -> str:
    """Quita un envoltorio ```markdown ... ``` que algunos modelos añaden."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[^\n]*\n?", "", t)
        t = re.sub(r"```\s*$", "", t)
    return t.strip()
