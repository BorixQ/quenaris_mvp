/* Shared scientific interpretation. No agronomic calibration is available. */
const SCIENCE_NOTE = "Exploratorio · sin calibración de campo. Puntuación relativa al área y periodo; no confirma causas ni prescribe tratamientos. En reforestación deben verificarse ecosistemas nativos, uso del suelo y especies.";
const SCIENCE_INDICES = {
  suitability: "Puntuación relativa al AOI y periodo. Los pesos son heurísticos; no mide viabilidad absoluta.",
  ndvi: "Contraste NIR/rojo asociado a cobertura y verdor; no confirma salud ni especie.",
  evi: "Índice de vegetación con constantes sobre reflectancia; requiere contexto local.",
  savi: "Índice con ajuste de suelo L=0.5; no es una medida de fertilidad.",
  msavi: "Índice ajustado al fondo de suelo; no estima éxito de plantación.",
  ndre: "Contraste NIR/red-edge, influido por dosel, pigmentos y suelo.",
  ndmi: "Contraste NIR/SWIR; no cuantifica por sí solo necesidad de riego.",
  ndwi: "Contraste verde/NIR; no demuestra humedad disponible en suelo.",
  ndsi: "Contraste SWIR1/SWIR2 del MVP; sin calibración para salinidad.",
  si2: "Magnitud espectral NIR/verde/rojo; sin calibración para salinidad.",
  bsi: "Contraste de brillo/cobertura; suelo expuesto no implica degradación ni disponibilidad.",
  psri: "Aproximación Sentinel-2 de un índice de pigmentos; no diagnostica enfermedad.",
  solarexposure: "Proxy de orientación norte (0-1), neutro en terreno casi plano; no son horas de sol.",
  tri: "Desviación local del DSM en ventana de 5 píxeles; variante de rugosidad.",
  tpi: "Diferencia del DSM respecto a su media local; ventana de 5 píxeles.",
  elevation: "Altura de la superficie del DSM; incluye vegetación e infraestructura.",
  slope: "Pendiente derivada del DSM; resolución nativa aproximada de 30 m."
};
const SCIENCE_STUDY = Object.fromEntries(["agro", "reforestacion", "riego", "fumigacion", "fertilizacion"].map(k => [k, {
  priority: "Orden relativo para inspección. No expresa urgencia de intervención. " + SCIENCE_NOTE,
  indices: SCIENCE_INDICES
}]));
function scientificMetadata(meta) {
  for (const [key, value] of Object.entries(meta)) {
    value.d = SCIENCE_INDICES[key] || "Índice espectral exploratorio; requiere interpretación y validación local.";
  }
}
function scientificBanner() {
  const banner = document.createElement("p");
  banner.textContent = SCIENCE_NOTE;
  banner.setAttribute("role", "note");
  banner.style.cssText = "padding:10px 16px;margin:0;border-bottom:1px solid #657384;background:#182126;color:#eef3f5;font-size:12px;position:relative;z-index:4";
  document.body.prepend(banner);
}
scientificBanner();
