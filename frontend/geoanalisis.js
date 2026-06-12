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
  solar: ["Slope","Aspect","SolarExposure","Elevation","TPI","BSI"],
  mineria: ["BSI","NDSI","NDBI","Slope","Elevation","TPI","TRI"],
};
const IDX_GROUPS = [
  ["Vegetación", ["NDVI","EVI","SAVI","MSAVI","NDRE","GNDVI","CIre","ARVI","SIPI","LAI"]],
  ["Agua",       ["NDMI","NDWI","MSI","MoistureStress","WDI"]],
  ["Salinidad",  ["NDSI","SI2"]],
  ["Suelo",      ["BSI","NBR","NDBI","PSRI"]],
  ["Topografía", ["Elevation","Slope","Aspect","TPI","TRI","SolarExposure"]],
];
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

async function loadAnalysisById(id) {
  setStatus("Cargando análisis…");
  try {
    const res = await fetch(`${API}/analyses/${id}/`, { headers: authHeaders() });
    const data = await jsonOrThrow(res);
    if (data.status !== "COMPLETED" || !data.result) { setStatus("Ese análisis no está disponible."); return; }
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

// --- Render de clusters (coloreados por prioridad) -------------------------
const PRIO_COLOR = { "Muy Alta":"#34d399", "Alta":"#7bb661", "Media":"#f5a524", "Baja":"#b5651d" };
function renderClusters(geojson) {
  const prioColor = ["match", ["get","priority"], ...Object.entries(PRIO_COLOR).flat(), "#888"];
  if (map.getSource("clusters")) { map.getSource("clusters").setData(geojson); }
  else {
    map.addSource("clusters", { type: "geojson", data: geojson });
    map.addLayer({ id: "clusters-fill", type: "fill", source: "clusters",
      paint: { "fill-color": prioColor, "fill-opacity": 0.45 } });
    map.addLayer({ id: "clusters-outline", type: "line", source: "clusters",
      paint: { "line-color": "#0b1018", "line-width": 1, "line-opacity": 0.8 } });
  }
  fitTo(geojson);
}

// --- Mapa de calor temporal (rásters PNG propios servidos en /media) -------
let HM = null, hmIndex = null, hmTime = 0;

// Mostrar/ocultar el panel de capas (toggle en barra lateral + ✕ en el panel)
function hmSetVisible(v) {
  const box = document.getElementById("hm"), tgl = document.getElementById("hmToggle");
  box.classList.toggle("show", v);
  tgl.textContent = v ? "▾ Ocultar capas de índices" : "▸ Mostrar capas de índices";
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
  HM = layers; hmIndex = layers.indices[0]; hmTime = 0;

  // Botones de índice
  const btns = document.getElementById("idxBtns");
  const NAMES = {
    suitability:"Aptitud", ndvi:"NDVI", evi:"EVI", savi:"SAVI", ndre:"NDRE", gndvi:"GNDVI",
    cire:"CIre", arvi:"ARVI", sipi:"SIPI", lai:"LAI", ndmi:"NDMI", ndwi:"NDWI", msi:"MSI",
    moisturestress:"M.Stress", wdi:"WDI", bsi:"BSI", nbr:"NBR", ndbi:"NDBI", psri:"PSRI",
    slope:"Pendiente", solarexposure:"Solar",
  };
  btns.innerHTML = layers.indices.map(i =>
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
