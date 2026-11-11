"""
Índices ecofisiológicos, espectrales y topográficos — con registro y presets.

Fórmulas fieles al motor de Terranode, refinadas según el análisis de optimización
de variables (jun 2026): se añaden MSAVI (sustituye a SAVI, sin factor L manual),
índices de salinidad NDSI/SI2 (críticos en el desierto de Arequipa) y topografía
completa (Aspect, TPI, TRI, Elevación) además de Slope y exposición solar.

El pipeline computa SOLO los índices del preset/selección del usuario.

Banda Sentinel-2 (S2_SR_HARMONIZED):
  B2 azul · B3 verde · B4 rojo · B5 red-edge1 · B8 NIR · B11 SWIR1 · B12 SWIR2
"""
from __future__ import annotations

import ee

# Todos los índices disponibles (el registro). El preset elige el subconjunto.
REGISTRY = [
    # Vegetación
    "NDVI", "EVI", "SAVI", "MSAVI", "NDRE", "GNDVI", "CIre", "ARVI", "SIPI", "LAI",
    # Agua
    "NDMI", "NDWI", "MSI", "MoistureStress", "WDI",
    # Salinidad
    "NDSI", "SI2",
    # Suelo
    "BSI", "NBR", "NDBI", "PSRI",
    # Topografía
    "Elevation", "Slope", "Aspect", "TPI", "TRI", "SolarExposure",
]

# Presets por tipo de estudio (refinados según el documento técnico).
# Cada preset define: 'indices', 'weights', y 'profile_overrides' (opcional)
PRESETS = {
    "agro": {
        "indices": [
            "NDVI", "EVI", "NDRE", "MSAVI",
            "NDMI", "NDWI",
            "BSI", "NBR",
            "Slope", "TPI", "TRI", "SolarExposure", "Elevation"
        ],
        "weights": None, # Usa los pesos por defecto de scoring.py
        "profile_overrides": {}
    },
    "riego": {
        "indices": ["NDMI", "NDWI", "Slope", "Elevation"],
        "weights": {"NDMI": 0.6, "NDWI": 0.4, "Slope": 0.0, "Elevation": 0.0},
        "profile_overrides": {"NDWI": {"direction": "low_good"}} # Evitar encharcamiento
    },
    "fumigacion": {
        "indices": ["NDVI", "NDRE", "PSRI", "NDMI"],
        "weights": {"NDVI": 0.30, "NDRE": 0.30, "PSRI": 0.25, "NDMI": 0.15},
        "profile_overrides": {"PSRI": {"direction": "low_good"}} # PSRI bajo es sano
    },
    "reforestacion": {
        "indices": ["BSI", "MSAVI", "NDMI", "Slope", "Elevation"],
        "weights": {"BSI": 0.4, "MSAVI": 0.3, "NDMI": 0.3},
        "profile_overrides": {
            "BSI": {"direction": "high_good"},   # Suelo desnudo = oportunidad
            "MSAVI": {"direction": "low_good"},  # Poca vegetación actual = bueno
            "NDMI": {"direction": "high_good"}
        }
    },
    "fertilizacion": {
        "indices": ["NDVI", "NDRE", "MSAVI"],
        "weights": {"NDVI": 0.4, "NDRE": 0.4, "MSAVI": 0.2},
        "profile_overrides": {} # Todos mantienen su default high_good
    },
    # Compatibilidad legacy
    "solar": {"indices": ["Slope", "Aspect", "SolarExposure", "Elevation", "TPI", "BSI"]},
    "mineria": {"indices": ["BSI", "NDSI", "NDBI", "Slope", "Elevation", "TPI", "TRI"]}
}

DEFAULT_STUDY = "agro"
# Legacy formulas without a verified biophysical interpretation are not selectable.
UNVERIFIED = {"LAI", "WDI"}


def resolve_indices(study_type: str | None, override: list[str] | None) -> list[str]:
    """Devuelve la lista de índices a computar: override del usuario o el preset."""
    if study_type and study_type not in PRESETS:
        raise ValueError("Tipo de estudio desconocido.")
    if override is not None:
        if not isinstance(override, list) or not override or any(
            not isinstance(i, str) or i not in REGISTRY or i in UNVERIFIED for i in override
        ):
            raise ValueError("Selección de índices vacía, desconocida o sin fórmula verificada (LAI/WDI).")
        return list(dict.fromkeys(override))
            
    preset = PRESETS.get(study_type or DEFAULT_STUDY, PRESETS["agro"])
    
    # Compatibilidad con formato antiguo (lista) vs nuevo (dict)
    if isinstance(preset, list):
        return preset
    return preset.get("indices", [])


# Expressions use unitless reflectance, including homogeneous ratios.
# Each denominator is masked near zero instead of treating undefined ratios as 0.
FORMULAS = {
    "NDVI": ("(N-R)/(N+R)", "N+R"),
    "EVI": ("2.5*(N-R)/(N+6*R-7.5*B+1)", "N+6*R-7.5*B+1"),
    "SAVI": ("1.5*(N-R)/(N+R+0.5)", "N+R+0.5"),
    "MSAVI": ("(2*N+1-sqrt((2*N+1)*(2*N+1)-8*(N-R)))/2", "2"),
    "NDRE": ("(N-RE1)/(N+RE1)", "N+RE1"),
    "GNDVI": ("(N-G)/(N+G)", "N+G"),
    "CIre": ("N/RE1-1", "RE1"),
    "ARVI": ("(N-(2*R-B))/(N+(2*R-B))", "N+(2*R-B)"),
    "SIPI": ("(N-B)/(N-R)", "N-R"),
    "NDMI": ("(N-S1)/(N+S1)", "N+S1"),
    "NDWI": ("(G-N)/(G+N)", "G+N"),
    "MSI": ("S1/N", "N"),
    "MoistureStress": ("(S1-N)/(S1+N)", "S1+N"),
    "NDSI": ("(S1-S2)/(S1+S2)", "S1+S2"),
    "SI2": ("sqrt(N*N+G*G+R*R)", "1"),
    "BSI": ("((S1+R)-(N+B))/((S1+R)+(N+B))", "S1+R+N+B"),
    "NBR": ("(N-S2)/(N+S2)", "N+S2"),
    "NDBI": ("(S1-N)/(S1+N)", "S1+N"),
    # Sentinel-2 approximation to R678/R500/R750, not a disease diagnosis.
    "PSRI": ("(R-B)/RE2", "RE2"),
}


def spectral_indices(img: ee.Image) -> ee.Image:
    bands = {n: img.select(b).divide(10000) for n, b in {
        "B": "B2", "G": "B3", "R": "B4", "RE1": "B5", "RE2": "B6",
        "N": "B8", "S1": "B11", "S2": "B12"}.items()}
    indices = []
    for name, (formula, denominator) in FORMULAS.items():
        valid = img.expression(denominator, bands).abs().gt(1e-6)
        indices.append(img.expression(formula, bands).updateMask(valid).rename(name))
    return img.addBands(indices)


def topography(aoi: ee.Geometry) -> ee.Image:
    """Elevación, pendiente, orientación, exposición solar, TPI y TRI."""
    tiles = ee.ImageCollection("COPERNICUS/DEM/GLO30_2024_1").filterBounds(aoi.buffer(1000)).select("DEM")
    # A mosaic loses the source projection; terrain/neighborhood derivatives need it.
    dem = tiles.mosaic().setDefaultProjection(tiles.first().select("DEM").projection())
    elev = dem.rename("Elevation")
    slope = ee.Terrain.slope(dem).rename("Slope")
    aspect = ee.Terrain.aspect(dem)

    # Exposición solar (hemisferio sur): northness, neutra en terreno plano.
    aspect_rad = aspect.multiply(3.141592653589793 / 180.0)
    northness = aspect_rad.cos().add(1).divide(2)
    solar = northness.where(slope.lt(2), 0.5).rename("SolarExposure")

    # TPI (posición topográfica) = elevación - media local; TRI (rugosidad) = desv. local.
    kernel = ee.Kernel.circle(radius=5, units="pixels")
    local_mean = dem.reduceNeighborhood(ee.Reducer.mean(), kernel)
    tpi = dem.subtract(local_mean).rename("TPI")
    tri = dem.reduceNeighborhood(ee.Reducer.stdDev(), kernel).rename("TRI")

    return ee.Image.cat([elev, slope, aspect.rename("Aspect"), tpi, tri, solar])


def build_index_stack(aoi: ee.Geometry, composite: ee.Image, index_list: list[str]) -> ee.Image:
    """Imagen multibanda con SOLO los índices pedidos, recortada al AOI."""
    full = spectral_indices(composite).addBands(topography(aoi))
    return full.select(index_list).clip(aoi).toFloat()
