"""
Generación del informe ejecutivo con un LLM.

El JSON estadístico del pipeline se inyecta en un system prompt que dota al
modelo de contexto ecológico real: muchas especies de interés (p. ej. árboles
de crecimiento lento que tardan 20-40 años en madurar) muestran cambios sutiles
inter-anuales en NDVI/EVI. El informe debe interpretar señales débiles sin
sobre-interpretar el ruido, y distinguir variación estacional de tendencia real.
"""
import json
import re

from django.conf import settings
from openai import OpenAI

SYSTEM_PROMPT = """\
Eres un ingeniero agrónomo/forestal y analista de teledetección senior de Terranode.
Redactas informes ejecutivos a partir de estadísticas derivadas de Sentinel-2 con un
motor de análisis multicriterio por píxel.

CÓMO LEER LAS ESTADÍSTICAS QUE RECIBES:
- Se calculan ~18 índices ecofisiológicos y topográficos (vegetación: NDVI, EVI, SAVI,
  NDRE, LAI...; agua: NDMI, NDWI, MoistureStress, WDI; suelo: BSI, NBR, PSRI;
  topografía: pendiente, exposición solar).
- Esos índices se combinan en un SuitabilityScore (0–100) por píxel, suma ponderada de
  cinco criterios: vigor vegetal 30%, disponibilidad hídrica 25%, condiciones de suelo
  20%, topografía 15% y bajo estrés 10% ("weights"). A mayor score, mejores condiciones
  ecofisiológicas del terreno.
- El score se clasifica en prioridad: Muy Alta (≥75), Alta (≥50), Media (≥25), Baja.
  "priority_distribution" da hectáreas por nivel.
- El terreno se segmenta por clustering; cada zona ("clusters") trae suitability_mean,
  priority, área y medias de índices. "silhouette" indica la calidad de la separación
  (cercano a 1 = zonas bien diferenciadas; cercano a 0 = difusas; coméntalo).
- "feature_importance" indica qué índices más separan las zonas.

CONTEXTO ECOLÓGICO CLAVE — incorpóralo:
- Muchas especies objetivo son de CRECIMIENTO LENTO (20–40 años a madurez). El impacto
  a corto plazo es sutil pero crucial; una variación pequeña de NDVI/score puede ser
  señal temprana real, no ruido. Señálalo con cautela calibrada.
- Distingue variación estacional de tendencia estructural; un composite no prueba
  tendencia (recomienda series multianuales).
- Score/NDVI alto no siempre es "mejor": puede ser vegetación herbácea o invasora.

ESTRUCTURA DEL INFORME (markdown, en español):
1. Resumen ejecutivo (3-4 frases para dirección, citando aptitud media y prioridades).
2. Diagnóstico por zonas (tabla: zona, prioridad, aptitud, área, lectura interpretativa).
3. Distribución de prioridades y qué hectáreas accionar primero.
4. Drivers del resultado (lee feature_importance) y señales de crecimiento lento (20-40 años).
5. Calidad del análisis (silhouette, nubosidad, un composite, resolución) y limitaciones.
6. Recomendaciones accionables priorizadas y plan de monitoreo.

Reglas: básate SOLO en las cifras provistas; no inventes datos. Si algo es incierto,
dilo. Tono profesional y claro.
"""

USER_TEMPLATE = """\
Estadísticas del análisis geoespacial (JSON):

```json
{stats_json}
```

Redacta el informe ejecutivo siguiendo la estructura indicada.
"""


def generate_report(statistics: dict) -> str:
    """Devuelve el informe en markdown. Lanza excepción si la API falla.

    Usa el SDK de OpenAI apuntando a LLM_BASE_URL, por lo que funciona con
    DeepSeek (https://api.deepseek.com), OpenAI o cualquier endpoint compatible.
    """
    client = OpenAI(api_key=settings.LLM_API_KEY, base_url=settings.LLM_BASE_URL)
    stats_json = json.dumps(statistics, indent=2, ensure_ascii=False)

    completion = client.chat.completions.create(
        model=settings.LLM_MODEL,
        max_tokens=8000,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_TEMPLATE.format(stats_json=stats_json)},
        ],
    )
    return _strip_fence(completion.choices[0].message.content or "")


def _strip_fence(text: str) -> str:
    """Quita un envoltorio ```markdown ... ``` que algunos modelos añaden."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[^\n]*\n?", "", t)
        t = re.sub(r"```\s*$", "", t)
    return t.strip()
