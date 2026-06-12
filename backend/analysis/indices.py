"""
Índices ecofisiológicos, espectrales y topográficos — con registro y presets.

Fórmulas fieles al motor de Quenaris, refinadas según el análisis de optimización
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
# Agro: sin redundancias (fuera GNDVI, MSI, MoistureStress; SAVI→MSAVI),
#       con salinidad y topografía completa.
PRESETS = {
    "agro": [
        "NDVI", "EVI", "NDRE", "MSAVI",          # vegetación + suelo (germinación)
        "NDMI", "NDWI",                          # agua
        "NDSI", "SI2",                           # salinidad
        "BSI", "NBR", "PSRI",                    # suelo / estrés
        "Slope", "Aspect", "TPI", "TRI", "SolarExposure", "Elevation",  # topografía
    ],
    # Definidos para fases siguientes (no activos en la UI todavía).
    "solar": ["Slope", "Aspect", "SolarExposure", "Elevation", "TPI", "BSI"],
    "mineria": ["BSI", "NDSI", "NDBI", "Slope", "Elevation", "TPI", "TRI"],
}

DEFAULT_STUDY = "agro"


def resolve_indices(study_type: str | None, override: list[str] | None) -> list[str]:
    """Devuelve la lista de índices a computar: override del usuario o el preset."""
    if override:
        sel = [i for i in override if i in REGISTRY]
        if sel:
            return sel
    return PRESETS.get(study_type or DEFAULT_STUDY, PRESETS["agro"])


def spectral_indices(img: ee.Image) -> ee.Image:
    """Calcula los índices espectrales sobre un composite Sentinel-2."""
    B2, B3, B4 = img.select("B2"), img.select("B3"), img.select("B4")
    B5, B8 = img.select("B5"), img.select("B8")
    B11, B12 = img.select("B11"), img.select("B12")
    # Reflectancia 0-1 para fórmulas que lo requieren
    NIR, RED, GRE, BLU = B8.divide(10000), B4.divide(10000), B3.divide(10000), B2.divide(10000)

    ndvi = img.normalizedDifference(["B8", "B4"]).rename("NDVI")
    evi = img.expression("2.5*((NIR-RED)/(NIR+6*RED-7.5*BLUE+1))",
                         {"NIR": NIR, "RED": RED, "BLUE": BLU}).rename("EVI")
    savi = img.expression("1.5*((NIR-RED)/(NIR+RED+0.5))", {"NIR": NIR, "RED": RED}).rename("SAVI")
    # MSAVI: sin factor L manual (sustituye al SAVI en el preset agro)
    msavi = img.expression(
        "(2*NIR + 1 - sqrt((2*NIR+1)*(2*NIR+1) - 8*(NIR-RED)))/2",
        {"NIR": NIR, "RED": RED}).rename("MSAVI")
    ndre = img.normalizedDifference(["B8", "B5"]).rename("NDRE")
    gndvi = img.normalizedDifference(["B8", "B3"]).rename("GNDVI")
    cire = img.expression("(NIR/RE1)-1", {"NIR": B8, "RE1": B5}).rename("CIre")
    arvi = img.expression("(NIR-(2*RED-BLUE))/(NIR+(2*RED-BLUE))",
                          {"NIR": B8, "RED": B4, "BLUE": B2}).rename("ARVI")
    sipi = img.expression("(NIR-BLUE)/(NIR-RED)", {"NIR": B8, "BLUE": B2, "RED": B4}).rename("SIPI")
    lai = img.expression("3.618*((NIR-RED)/(NIR+RED+0.5))", {"NIR": NIR, "RED": RED}).rename("LAI")

    ndmi = img.normalizedDifference(["B8", "B11"]).rename("NDMI")
    ndwi = img.normalizedDifference(["B3", "B8"]).rename("NDWI")
    msi = img.expression("SWIR1/NIR", {"SWIR1": B11, "NIR": B8}).rename("MSI")
    mstress = img.normalizedDifference(["B11", "B8"]).rename("MoistureStress")
    wdi = img.expression("(RED+GREEN)/(NIR+SWIR1)",
                         {"RED": B4, "GREEN": B3, "NIR": B8, "SWIR1": B11}).rename("WDI")

    # Salinidad
    ndsi = img.normalizedDifference(["B11", "B12"]).rename("NDSI")  # (SWIR1-SWIR2)/(SWIR1+SWIR2)
    si2 = img.expression("sqrt(NIR*NIR + GREEN*GREEN + RED*RED)",
                         {"NIR": NIR, "GREEN": GRE, "RED": RED}).rename("SI2")

    bsi = img.expression("((SWIR1+RED)-(NIR+BLUE))/((SWIR1+RED)+(NIR+BLUE))",
                         {"SWIR1": B11, "RED": B4, "NIR": B8, "BLUE": B2}).rename("BSI")
    nbr = img.normalizedDifference(["B8", "B12"]).rename("NBR")
    ndbi = img.normalizedDifference(["B11", "B8"]).rename("NDBI")
    psri = img.expression("(RED-BLUE)/RE1", {"RED": B4, "BLUE": B2, "RE1": B5}).rename("PSRI")

    return img.addBands([ndvi, evi, savi, msavi, ndre, gndvi, cire, arvi, sipi, lai,
                         ndmi, ndwi, msi, mstress, wdi, ndsi, si2, bsi, nbr, ndbi, psri])


def topography(aoi: ee.Geometry) -> ee.Image:
    """Elevación, pendiente, orientación, exposición solar, TPI y TRI."""
    dem = ee.ImageCollection("COPERNICUS/DEM/GLO30").select("DEM").mosaic()
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
