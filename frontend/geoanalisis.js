/* ===========================================================================
 * Geoanálisis — define AOI (dibujo o CSV), procesa y visualiza:
 *   - clusters GeoJSON
 *   - mapa de calor de índices (NDVI/EVI/NDMI/slope) con selector + barra temporal
 * API y authHeaders()/jsonOrThrow() provienen de auth.js.
 * ========================================================================= */

// --- Mapa base satelital (Esri, sin API key) -------------------------------
const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      },
      labels: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19,
      },
    },
    layers: [
      { id: "satellite", type: "raster", source: "satellite" },
      { id: "labels", type: "raster", source: "labels" },
    ],
  },
  center: [-71.537, -16.409], zoom: 11,   // Arequipa, Perú (por defecto)
});

// Fechas por defecto: inicio = hace 6 meses, fin = hoy (valores iniciales editables)
(function defaultDates() {
  const today = new Date();
  const past = new Date(); past.setMonth(past.getMonth() - 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  const fe = document.getElementById("dateEnd"), fs = document.getElementById("dateStart");
  if (fe) fe.value = iso(today);
  if (fs) fs.value = iso(past);
})();
map.addControl(new maplibregl.NavigationControl());

// --- Dibujo (shim de compatibilidad MapLibre) ------------------------------
MapboxDraw.constants.classes.CONTROL_BASE = "maplibregl-ctrl";
MapboxDraw.constants.classes.CONTROL_PREFIX = "maplibregl-ctrl-";
MapboxDraw.constants.classes.CONTROL_GROUP = "maplibregl-ctrl-group";
const draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
map.addControl(draw, "top-right");

let currentAOI = null;
const runBtn = document.getElementById("run");

function setAOI(geom) { currentAOI = geom; runBtn.disabled = !geom; }

map.on("draw.create", (e) => {
  // Dibujar un polígono = empezar un análisis nuevo: salir del modo "ver".
  if (document.getElementById("viewInfo").style.display !== "none") {
    enterCreateMode(); clearAnalysisView();
  }
  syncDraw();
  // Tras dibujar, pasar a direct_select para poder arrastrar los vértices ya.
  const id = e.features && e.features[0] && e.features[0].id;
  if (id) setTimeout(() => { try { draw.changeMode("direct_select", { featureId: id }); } catch (_) {} }, 0);
});
map.on("draw.update", syncDraw);
map.on("draw.delete", syncDraw);
function syncDraw() {
  const d = draw.getAll();
  setAOI(d.features.length ? d.features[d.features.length - 1].geometry : null);
}

// --- Conmutador Dibujar / CSV ----------------------------------------------
const mDraw = document.getElementById("mDraw"), mCsv = document.getElementById("mCsv");
mDraw.onclick = () => toggleMode("draw");
mCsv.onclick = () => toggleMode("csv");
function toggleMode(mode) {
  const draw_ = mode === "draw";
  mDraw.classList.toggle("on", draw_);
  mCsv.classList.toggle("on", !draw_);
  document.getElementById("drawHelp").style.display = draw_ ? "block" : "none";
  document.getElementById("csvBox").style.display = draw_ ? "none" : "block";
}

// --- Carga de CSV de vértices ----------------------------------------------
document.getElementById("csvFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  Papa.parse(file, {
    header: true, skipEmptyLines: true, dynamicTyping: true,
    complete: (res) => {
      try {
        const coords = rowsToCoords(res.data);
        const ring = coords.slice();
        const [x0, y0] = ring[0], [xn, yn] = ring[ring.length - 1];
        if (x0 !== xn || y0 !== yn) ring.push([x0, y0]); // cerrar anillo
        const geom = { type: "Polygon", coordinates: [ring] };
        draw.deleteAll();
        draw.add({ type: "Feature", properties: {}, geometry: geom });
        setAOI(geom);
        fitTo({ features: [{ geometry: geom }] });
        setStatus(`CSV cargado: ${coords.length} vértices.`);
      } catch (err) {
        setStatus("Error en el CSV: " + err.message);
      }
    },
    error: (err) => setStatus("No se pudo leer el CSV: " + err.message),
  });
});

function rowsToCoords(rows) {
  if (!rows.length) throw new Error("archivo vacío");
  const keys = Object.keys(rows[0]).map(k => k.toLowerCase().trim());
  const find = (...names) => {
    for (const n of names) { const i = keys.indexOf(n); if (i >= 0) return Object.keys(rows[0])[i]; }
    return null;
  };
  const lonK = find("lon", "longitud", "longitude", "x", "lng");
  const latK = find("lat", "latitud", "latitude", "y");
  if (!lonK || !latK) throw new Error("faltan columnas lon/lat (o longitud/latitud, x/y)");
  const coords = rows.map(r => [Number(r[lonK]), Number(r[latK])])
                     .filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (coords.length < 3) throw new Error("se requieren al menos 3 vértices válidos");
  for (const [lon, lat] of coords) {
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90)
      throw new Error(`coordenada fuera de rango WGS84: ${lon}, ${lat}`);
  }
  return coords;
}

// --- Tipo de estudio + selección de índices --------------------------------
const PRESETS = {
  agro: ["NDVI","EVI","NDRE","MSAVI","NDMI","NDWI","NDSI","SI2","BSI","NBR","PSRI",
         "Slope","Aspect","TPI","TRI","SolarExposure","Elevation"],
  riego: ["NDMI", "NDWI", "Slope", "Elevation"],
  fumigacion: ["NDVI", "NDRE", "PSRI", "NDMI"],
  reforestacion: ["BSI", "MSAVI", "NDSI", "NDWI", "Slope", "Elevation"],
  fertilizacion: ["NDVI", "NDRE", "MSAVI"]
};
const IDX_GROUPS = [
  ["Vegetación", ["NDVI","EVI","SAVI","MSAVI","NDRE","GNDVI","CIre","ARVI","SIPI","LAI"]],
  ["Agua",       ["NDMI","NDWI","MSI","MoistureStress","WDI"]],
  ["Salinidad",  ["NDSI","SI2"]],
  ["Suelo",      ["BSI","NBR","NDBI","PSRI"]],
  ["Topografía", ["Elevation","Slope","Aspect","TPI","TRI","SolarExposure"]],
];
const STUDY_DESCRIPTIONS = {
  agro: {
    priority: "Prioridad alta indica zonas con pobre desarrollo o estrés múltiple, requiriendo intervención agronómica general.",
    indices: {
      suitability: "Puntuación ponderada general (0-100) que resume la viabilidad agronómica del sector.",
      ndvi: "Mide el vigor base del cultivo. Fundamental para entender el estado de salud general.",
      evi: "Ayuda a evaluar el vigor en zonas de alta densidad foliar sin saturarse.",
      ndre: "Detecta problemas de clorofila antes de que el follaje se pierda visiblemente.",
      msavi: "Optimizado para etapas tempranas donde el suelo desnudo afecta la medición.",
      ndmi: "Mide el estrés hídrico general en la vegetación.",
      ndwi: "Detecta exceso de humedad o encharcamientos.",
      ndsi: "Identifica áreas con salinidad superficial que impiden el crecimiento.",
      si2: "Complementa al NDSI en la detección de estrés salino severo.",
      bsi: "Proporción de suelo expuesto; valores altos indican mala cobertura del cultivo.",
      nbr: "Usado para detectar quemas o biomasa leñosa muerta.",
      psri: "Indica envejecimiento prematuro del cultivo.",
      slope: "Pendientes fuertes dificultan la maquinaria y el riego.",
      aspect: "Orientación de la ladera frente al sol.",
      tpi: "Índice de posición topográfica (crestas o valles).",
      tri: "Rugosidad del terreno.",
      solarexposure: "Horas de sol directas según el relieve.",
      elevation: "Altura sobre el nivel del mar."
    }
  },
  riego: {
    priority: "Prioridad alta resalta zonas con estrés hídrico severo o encharcamiento prolongado, urgiendo ajuste en válvulas o drenajes.",
    indices: {
      suitability: "Puntuación de eficiencia hídrica (0-100). Valores bajos indican sequía extrema o inundación perjudicial.",
      ndmi: "Crítico en riego: mide la falta de agua interna en la hoja antes de que la planta se seque visiblemente.",
      ndwi: "Detecta inundaciones superficiales o zonas de mal drenaje por exceso de riego.",
      slope: "Identifica pendientes fuertes donde el agua escurre rápido y no penetra el suelo.",
      elevation: "Útil para predecir presión de agua en sistemas de riego por goteo o aspersión."
    }
  },
  fumigacion: {
    priority: "Prioridad alta marca focos con anomalías foliares, posibles epicentros de plagas u hongos para aplicación dirigida.",
    indices: {
      suitability: "Puntuación de alerta fitosanitaria. Valores bajos marcan áreas con daño foliar urgente.",
      ndvi: "Detecta parches con pérdida repentina de follaje por herbívoros.",
      ndre: "Sensible a la pérdida temprana de clorofila por enfermedades o estrés antes de que el NDVI baje.",
      psri: "Indica envejecimiento prematuro (senescencia) de la hoja causado por patógenos.",
      ndmi: "Un dosel dañado por plagas suele perder su capacidad de retener agua internamente."
    }
  },
  reforestacion: {
    priority: "Zonas Óptimas son ideales para plantar. Prioridad alta indica terrenos hostiles para el prendimiento de plantones (baja aptitud).",
    indices: {
      suitability: "Puntuación de viabilidad para plantar (0-100).",
      bsi: "Fundamental para encontrar suelo expuesto y disponible para plantar.",
      msavi: "Evalúa la escasa vegetación existente minimizando la influencia del suelo desnudo.",
      ndsi: "Evita plantar en suelos muy salinos donde los plantones no sobrevivirán.",
      ndwi: "Asegura que la zona tenga humedad base adecuada para la supervivencia temprana.",
      slope: "Pendientes extremas aumentan la erosión y dificultan la plantación manual.",
      elevation: "Condiciona qué especies de árboles pueden adaptarse al microclima."
    }
  },
  fertilizacion: {
    priority: "Prioridad alta revela parches con deficiencia nutricional (clorosis o bajo vigor) que requieren abono localizado urgente.",
    indices: {
      suitability: "Puntuación de suficiencia nutricional (0-100). Valores bajos piden fertilización inminente.",
      ndvi: "Mapea las zonas de menor biomasa que necesitan estimulación con nitrógeno.",
      ndre: "El mejor indicador de niveles bajos de Nitrógeno y clorofila en el cultivo.",
      msavi: "Útil en etapas tempranas del cultivo para decidir la primera fertilización de fondo."
    }
  }
};

const INDEX_META = {
  suitability:{n:"Aptitud", d:"Puntuación ponderada de 0 a 100 que resume el estado de la zona según el objetivo del estudio."}, 
  ndvi:{n:"NDVI", d:"Mide el vigor y verdor de las plantas. Valores altos indican vegetación sana."}, 
  evi:{n:"EVI", d:"Similar al NDVI pero corrige distorsiones atmosféricas y ruido del suelo."},
  savi:{n:"SAVI", d:"Optimizado para zonas áridas donde el suelo desnudo afecta la medición."}, 
  ndre:{n:"NDRE", d:"Sensible al contenido de clorofila y etapas tardías del cultivo."}, 
  gndvi:{n:"GNDVI", d:"Usa la banda verde para detectar variaciones en la clorofila."},
  cire:{n:"CIre", d:"Índice de clorofila Red-Edge para medir estrés nutricional."}, 
  arvi:{n:"ARVI", d:"Resistente a los efectos atmosféricos (humo, polvo)."}, 
  sipi:{n:"SIPI", d:"Mide el ratio de carotenoides/clorofila (estrés fisiológico)."},
  lai:{n:"LAI", d:"Estima el área foliar por metro cuadrado de suelo."}, 
  ndmi:{n:"NDMI", d:"Mide el contenido de humedad interna de las hojas (estrés hídrico)."}, 
  ndwi:{n:"NDWI", d:"Detecta agua libre superficial o zonas de encharcamiento."}, 
  msi:{n:"MSI", d:"Índice de estrés hídrico; valores altos indican sequedad."},
  moisturestress:{n:"M.Stress", d:"Variación del MSI para estrés por sequía."}, 
  wdi:{n:"WDI", d:"Índice de déficit de agua para optimizar el riego."}, 
  bsi:{n:"BSI", d:"Mide la proporción de suelo desnudo frente a la vegetación."},
  nbr:{n:"NBR", d:"Usado para detectar áreas quemadas o evaluar biomasa leñosa."}, 
  ndbi:{n:"NDBI", d:"Detecta áreas construidas o suelos impermeables."}, 
  psri:{n:"PSRI", d:"Relacionado con la senescencia y maduración del cultivo."},
  slope:{n:"Pendiente", d:"Inclinación del terreno en grados. Crítico para drenaje e insolación."}, 
  solarexposure:{n:"Solar", d:"Exposición teórica a la radiación solar considerando laderas y sombras."},
};

let selectedIndices = new Set(PRESETS.agro);

const studySel = document.getElementById("studyType");
const idxListEl = document.getElementById("idxList");
const idxSummary = document.getElementById("idxSummary");

function buildIdxList() {
  idxListEl.innerHTML = IDX_GROUPS.map(([g, items]) => `
    <div style="font-family:var(--font-mono); font-size:10px; letter-spacing:.1em; color:var(--cyan);
      text-transform:uppercase; margin:6px 0 3px;">${g}</div>
    ${items.map(k => `
      <label style="display:flex; align-items:center; gap:7px; font-size:12.5px; padding:2px 0; cursor:pointer;">
        <input type="checkbox" value="${k}" ${selectedIndices.has(k) ? "checked" : ""} style="width:auto;">
        ${k}
      </label>`).join("")}
  `).join("");
  idxListEl.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => {
    cb.checked ? selectedIndices.add(cb.value) : selectedIndices.delete(cb.value);
    updateIdxSummary();
  }));
}
function updateIdxSummary() {
  idxSummary.textContent = `${selectedIndices.size} índices seleccionados`;
}
function applyPreset(study) {
  selectedIndices = new Set(PRESETS[study] || PRESETS.agro);
  buildIdxList(); updateIdxSummary();
}
studySel.addEventListener("change", () => applyPreset(studySel.value));
document.getElementById("idxEdit").addEventListener("click", () => {
  const open = idxListEl.style.display === "block";
  idxListEl.style.display = open ? "none" : "block";
  document.getElementById("idxEdit").textContent = open ? "EDITAR ▾" : "OCULTAR ▴";
});

// Nº de clusters solo aplica a K-Means; ocultarlo para DBSCAN/HDBSCAN.
const algoSel = document.getElementById("algorithm");
function syncAlgo() {
  const km = algoSel.value === "kmeans";
  document.getElementById("nClustersLabel").style.display = km ? "block" : "none";
  document.getElementById("nClusters").style.display = km ? "block" : "none";
}
algoSel.addEventListener("change", syncAlgo);

// Preselección por ?estudio= desde Inicio
(function initStudy() {
  const e = new URLSearchParams(location.search).get("estudio");
  if (e && ["agro"].includes(e)) studySel.value = e;  // solar/mineria aún deshabilitados
  applyPreset(studySel.value); syncAlgo();
})();

// --- Envío + polling -------------------------------------------------------
const JOB_KEY = "gi_active_job";
const LAST_KEY = "gi_last_analysis";

runBtn.addEventListener("click", async () => {
  if (!currentAOI) return;
  const body = {
    name: document.getElementById("analysisName").value.trim(),
    aoi: currentAOI,
    date_start: document.getElementById("dateStart").value,
    date_end: document.getElementById("dateEnd").value,
    algorithm: document.getElementById("algorithm").value,
    n_clusters: parseInt(document.getElementById("nClusters").value, 10),
    study_type: document.getElementById("studyType").value,
    indices: [...selectedIndices],
    use_pca: document.getElementById("usePca").checked,
  };
  busy(true, "Enviando petición…");
  try {
    const res = await fetch(`${API}/analyses/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const job = await jsonOrThrow(res);
    localStorage.setItem(JOB_KEY, job.id);   // recordar para reanudar
    
    // Actualizar la cuota visual en la barra superior
    if (typeof window.refreshQuota === "function") window.refreshQuota();

    poll(job.id);
  } catch (e) { busy(false, "Error: " + e.message); }
});

let pollTimer = null;
function poll(id) {
  busy(true, "Procesando (Sentinel-2 → índices → clustering → informe)… " +
              "Puedes cambiar de pestaña: el cálculo sigue en el servidor.");
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    let data;
    try {
      const res = await fetch(`${API}/analyses/${id}/`, { headers: authHeaders() });
      data = await jsonOrThrow(res);
    } catch (e) { clearInterval(pollTimer); busy(false, "Error: " + e.message); return; }

    if (data.status === "COMPLETED") {
      clearInterval(pollTimer); localStorage.removeItem(JOB_KEY);
      localStorage.setItem(LAST_KEY, id);
      busy(false, "Análisis completado.");
      enterViewMode(data);                 // queda guardado: campos en solo lectura
      renderClusters(data.result.clusters_geojson);
      setupHeatmap(data.result.heatmap_layers);
      showLinks(id);
      refreshPrevList(id);
    } else if (data.status === "FAILED") {
      clearInterval(pollTimer); localStorage.removeItem(JOB_KEY);
      busy(false, "Falló: " + data.error_message);
    } else {
      setStatus("Estado: " + data.status + "… (sigue en segundo plano)");
    }
  }, 4000);
}

// --- Análisis previos: lista, carga y reorientación ------------------------
const prevSel = document.getElementById("prevAnalyses");

async function refreshPrevList(selectId) {
  try {
    const res = await fetch(`${API}/analyses/`, { headers: authHeaders() });
    const list = await jsonOrThrow(res);
    const done = list.filter(a => a.status === "COMPLETED");
    prevSel.innerHTML = `<option value="">— Nuevo análisis —</option>` + done.map(a =>
      `<option value="${a.id}">${a.name ? a.name + " · " : ""}${fmtDate(a.created_at)} · ${a.area_ha} ha</option>`
    ).join("");
    if (selectId) prevSel.value = selectId;
  } catch (_) {}
}

prevSel.addEventListener("change", () => {
  if (prevSel.value) loadAnalysisById(prevSel.value);
  else { enterCreateMode(); clearAnalysisView(); draw.deleteAll(); setAOI(null); }
});
document.getElementById("newAnalysis").addEventListener("click", () => {
  enterCreateMode(); clearAnalysisView(); draw.deleteAll(); setAOI(null);
});

document.getElementById("remakeAnalysis")?.addEventListener("click", () => {
  if (!currentLoadedAnalysis) return;
  const a = currentLoadedAnalysis;
  
  document.getElementById("analysisName").value = a.name ? a.name + " (Copia)" : "Análisis (Copia)";
  document.getElementById("dateStart").value = a.date_start;
  document.getElementById("dateEnd").value = a.date_end;
  document.getElementById("algorithm").value = a.algorithm || "kmeans";
  if (a.n_clusters) {
    document.getElementById("nClusters").value = a.n_clusters;
  }
  if (a.study_type) {
    document.getElementById("studyType").value = a.study_type;
  }
  if (a.indices && Array.isArray(a.indices)) {
    selectedIndices = new Set(a.indices);
    buildIdxList();
    updateIdxSummary();
  }
  document.getElementById("usePca").checked = !!a.use_pca;
  syncAlgo();

  enterCreateMode();
  clearAnalysisView();
  
  draw.deleteAll();
  if (a.aoi) {
    draw.add({ type: "Feature", properties: {}, geometry: a.aoi });
    setAOI(a.aoi);
    const b = new maplibregl.LngLatBounds();
    const walk = (c) => Array.isArray(c[0]) ? c.forEach(walk) : b.extend(c);
    walk(a.aoi.coordinates);
    map.fitBounds(b, { padding: 60 });
  }
});

document.getElementById("deleteAnalysis")?.addEventListener("click", async () => {
  if (!currentLoadedAnalysis) return;
  const id = currentLoadedAnalysis.id;
  if (!confirm("¿Estás seguro de que deseas eliminar este análisis? Esta acción no se puede deshacer.")) return;
  
  setStatus("Eliminando análisis...");
  try {
    const res = await fetch(`${API}/analyses/${id}/`, {
      method: "DELETE",
      headers: authHeaders()
    });
    if (!res.ok) throw new Error("Fallo al eliminar el análisis.");
    
    await refreshPrevList();
    enterCreateMode();
    clearAnalysisView();
    draw.deleteAll();
    setAOI(null);
    setStatus("Análisis eliminado exitosamente.");
  } catch (e) {
    setStatus("Error: " + e.message);
  }
});

// --- Modo VER (solo lectura) vs CREAR --------------------------------------
function enterCreateMode() {
  document.getElementById("createControls").style.display = "block";
  document.getElementById("viewInfo").style.display = "none";
  prevSel.value = "";
}
function enterViewMode(a) {
  document.getElementById("createControls").style.display = "none";
  document.getElementById("viewInfo").style.display = "block";
  const algoName = { kmeans: "K-Means", dbscan: "DBSCAN", hdbscan: "HDBSCAN" }[a.algorithm] || a.algorithm;
  const nIdx = (a.indices || []).length;
  document.getElementById("viewFields").innerHTML = `
    <div class="kv"><span>Nombre</span><b>${a.name || "(sin nombre)"}</b></div>
    <div class="kv"><span>Estudio</span><b>${a.study_type || "agro"}</b></div>
    <div class="kv"><span>Periodo</span><b>${a.date_start} → ${a.date_end}</b></div>
    <div class="kv"><span>Algoritmo</span><b>${algoName}${a.use_pca ? " + PCA" : ""}</b></div>
    <div class="kv"><span>Índices</span><b>${nIdx || "preset"}</b></div>
    <div class="kv"><span>Área</span><b>${a.area_ha} ha</b></div>`;
}

let currentLoadedAnalysis = null;

async function loadAnalysisById(id) {
  setStatus("Cargando análisis…");
  try {
    const res = await fetch(`${API}/analyses/${id}/`, { headers: authHeaders() });
    const data = await jsonOrThrow(res);
    if (data.status !== "COMPLETED" || !data.result) { setStatus("Ese análisis no está disponible."); return; }
    currentLoadedAnalysis = data;
    localStorage.setItem(LAST_KEY, id);
    prevSel.value = id;
    enterViewMode(data);                              // campos en solo lectura
    renderClusters(data.result.clusters_geojson);     // reorienta el mapa (fitTo)
    setupHeatmap(data.result.heatmap_layers);
    showLinks(id);
    setStatus("Análisis cargado: " + (data.name || id.slice(0, 8)));
  } catch (e) { setStatus("Error: " + e.message); }
}

function clearAnalysisView() {
  ["heat", "clusters-fill", "clusters-outline"].forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
  ["heat", "clusters"].forEach(s => { if (map.getSource(s)) map.removeSource(s); });
  document.getElementById("hm").classList.remove("show");
  document.getElementById("hmToggle").style.display = "none";
  document.getElementById("links").innerHTML = "";
  localStorage.removeItem(LAST_KEY);
  setStatus("");
}

function fmtDate(s) { return s ? new Date(s).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : ""; }

// --- Al cargar la página: reanudar job en curso o recuperar el último -------
(async function init() {
  await refreshPrevList();
  const active = localStorage.getItem(JOB_KEY);
  if (active) {
    try {
      const res = await fetch(`${API}/analyses/${active}/`, { headers: authHeaders() });
      const data = await jsonOrThrow(res);
      if (data.status === "PENDING" || data.status === "PROCESSING") { poll(active); return; }
      localStorage.removeItem(JOB_KEY);
    } catch (_) { localStorage.removeItem(JOB_KEY); }
  }
  // Sin job activo: recuperar el último análisis visto (conserva al navegar).
  const last = localStorage.getItem(LAST_KEY);
  if (last) loadAnalysisById(last);
})();

// --- Render de clusters (coloreados por label/ranking relativo) ------------
const LABEL_COLOR = { 
  "Óptimo": "#34d399", 
  "Bueno": "#7bb661", 
  "Moderado": "#f5a524", 
  "Marginal": "#d97736",
  "No apto": "#b5651d" 
};
function renderClusters(geojson) {
  const labelColor = ["match", ["get","label"], ...Object.entries(LABEL_COLOR).flat(), "#888"];
  if (map.getSource("clusters")) { map.getSource("clusters").setData(geojson); }
  else {
    map.addSource("clusters", { type: "geojson", data: geojson });
    map.addLayer({ id: "clusters-fill", type: "fill", source: "clusters",
      paint: { "fill-color": labelColor, "fill-opacity": 0.45 } });
    map.addLayer({ id: "clusters-outline", type: "line", source: "clusters",
      paint: { "line-color": "#0b1018", "line-width": 1, "line-opacity": 0.8 } });
  }
  fitTo(geojson);
}

// --- Mapa de calor temporal (rásters PNG propios servidos en /media) -------
let HM = null, hmIndex = null, hmTime = 0;

function hmSetVisible(v) {
  const box = document.getElementById("hm"), tgl = document.getElementById("hmToggle");
  box.classList.toggle("show", v);
  tgl.textContent = v ? "▾ Ocultar capas de índices" : "▸ Mostrar capas de índices";
  
  if (map.getLayer("heat")) {
    map.setLayoutProperty("heat", "visibility", v ? "visible" : "none");
  }
  if (map.getLayer("clusters-fill")) {
    map.setPaintProperty("clusters-fill", "fill-opacity", v ? 0.0 : 0.45);
  }
}
document.getElementById("hmClose").addEventListener("click", () => hmSetVisible(false));
document.getElementById("hmToggle").addEventListener("click", () =>
  hmSetVisible(!document.getElementById("hm").classList.contains("show")));

function setupHeatmap(layers) {
  const box = document.getElementById("hm"), tgl = document.getElementById("hmToggle");
  if (!layers || !layers.indices || !layers.timesteps) {
    box.classList.remove("show"); tgl.style.display = "none"; return;
  }
  tgl.style.display = "block";
  // Filtrar para mostrar solo "suitability" y los índices usados en este análisis
  const usedIndices = (currentLoadedAnalysis?.result?.statistics?.indices_used || []).map(i => i.toLowerCase());
  const filteredIndices = layers.indices.filter(i => i === "suitability" || usedIndices.includes(i));
  
  HM = layers; 
  HM.indices = filteredIndices; // Sobrescribir la lista para los botones
  hmIndex = filteredIndices[0]; 
  hmTime = 0;

  // Botones de índice
  const btns = document.getElementById("idxBtns");
  const NAMES = {
    suitability:"Aptitud", ndvi:"NDVI", evi:"EVI", savi:"SAVI", ndre:"NDRE", gndvi:"GNDVI",
    cire:"CIre", arvi:"ARVI", sipi:"SIPI", lai:"LAI", ndmi:"NDMI", ndwi:"NDWI", msi:"MSI",
    moisturestress:"M.Stress", wdi:"WDI", bsi:"BSI", nbr:"NBR", ndbi:"NDBI", psri:"PSRI",
    slope:"Pendiente", solarexposure:"Solar",
  };
  btns.innerHTML = filteredIndices.map(i =>
    `<button data-i="${i}" class="${i===hmIndex?"on":""}">${NAMES[i]||i}</button>`).join(" ");
  btns.querySelectorAll("button").forEach(b => b.onclick = () => {
    hmIndex = b.dataset.i;
    btns.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    updateHeatmap();
  });

  // Barra temporal
  const slider = document.getElementById("timeSlider");
  slider.max = String(layers.timesteps.length - 1);
  slider.value = "0";
  slider.oninput = () => { hmTime = parseInt(slider.value, 10); updateHeatmap(); };

  document.getElementById("opacity").oninput = (e) => {
    if (map.getLayer("heat")) map.setPaintProperty("heat", "raster-opacity", e.target.value / 100);
  };

  hmSetVisible(true);
  updateHeatmap();
}

function updateHeatmap() {
  if (!HM) return;
  const ts = HM.timesteps[hmTime];
  document.getElementById("timeLabel").textContent = ts;
  const url = HM.url_template.replace("{index}", hmIndex).replace("{timestep}", ts);
  const [w, s, e, n] = HM.bounds;
  const coords = [[w, n], [e, n], [e, s], [w, s]];

  if (map.getSource("heat")) {
    map.getSource("heat").updateImage({ url, coordinates: coords });
  } else {
    map.addSource("heat", { type: "image", url, coordinates: coords });
    // Insertar bajo los clusters para que las zonas queden visibles encima
    const before = map.getLayer("clusters-fill") ? "clusters-fill" : undefined;
    map.addLayer({ id: "heat", type: "raster", source: "heat",
      paint: { "raster-opacity": document.getElementById("opacity").value / 100 } }, before);
  }
  
  // Actualizar descripción
  const studyType = currentLoadedAnalysis?.study_type || "agro";
  const dict = STUDY_DESCRIPTIONS[studyType] || STUDY_DESCRIPTIONS.agro;
  const meta = INDEX_META[hmIndex.toLowerCase()] || {};
  const d = dict.indices[hmIndex.toLowerCase()] || meta.d || "";
  document.getElementById("hmDesc").innerHTML = `<span style="color:var(--cyan);font-weight:bold;">${meta.n || hmIndex}:</span> ${d}`;
}

// --- Utilidades -------------------------------------------------------------
function fitTo(geojson) {
  const b = new maplibregl.LngLatBounds();
  const walk = (c) => Array.isArray(c[0]) ? c.forEach(walk) : b.extend(c);
  geojson.features.forEach(f => walk(f.geometry.coordinates));
  map.fitBounds(b, { padding: 60 });
}
function showLinks(id) {
  document.getElementById("links").innerHTML =
    `<a href="informes.html?id=${id}">▤ Ver informe completo</a>
     <a href="viewer3d.html?id=${id}">⬢ Vista 3D</a>`;
}
function busy(b, msg) {
  document.getElementById("spinner").style.display = b ? "block" : "none";
  runBtn.disabled = b || !currentAOI;
  setStatus(msg);
}
function setStatus(msg) { document.getElementById("status").textContent = msg || ""; }
