/* ===========================================================================
 * Vista 3D — relieve + imagery satelital, con dos modos sobre el terreno:
 *
 *   ZONAS (vector)   → coropleta de las zonas coloreadas por la métrica elegida.
 *                      Los polígonos vectoriales se adhieren a CADA triángulo del
 *                      terreno → drapeado perfecto, sin distorsión, cubre todo el AOI.
 *   DETALLE PÍXEL    → mapa de calor ráster por índice/mes (alta resolución).
 *                      Sobre pendientes muy fuertes el ráster puede estirarse.
 *
 * Temporal: el DETALLE PÍXEL es mensual (barra de tiempo). La coropleta de ZONAS
 * resume la mediana del periodo (un valor por zona).
 * ========================================================================= */
const params = new URLSearchParams(location.search);
let analysisId = params.get("id");

const PRIO_COLOR = { "Muy Alta": "#34d399", "Alta": "#7bb661", "Media": "#f5a524", "Baja": "#b5651d" };
const RAMP = {
  RdYlGn: ["#d73027", "#fee08b", "#1a9850"], YlGn: ["#ffffcc", "#78c679", "#006837"],
  BrBG: ["#8c510a", "#f5f5f5", "#01665e"], YlOrBr: ["#ffffd4", "#fe9929", "#993404"],
  cividis: ["#00204d", "#7c7b78", "#ffea46"], magma: ["#000004", "#b73779", "#fcfdbf"],
  BrBG_r: ["#01665e", "#f5f5f5", "#8c510a"], PuOr: ["#5e3c99", "#f7f7f7", "#e66101"],
};

// Métricas por zona (coropleta vectorial). 'cat' = categórica (prioridad).
const METRICS = {
  priority:         { name: "Prioridad",            type: "cat" },
  suitability_mean: { name: "Aptitud (0–100)",      vmin: 0,    vmax: 100, cmap: "RdYlGn" },
  ndvi_mean:        { name: "NDVI — vigor",         vmin: -0.2, vmax: 0.9, cmap: "RdYlGn" },
  ndmi_mean:        { name: "NDMI — humedad",       vmin: -0.3, vmax: 0.5, cmap: "BrBG" },
  bsi_mean:         { name: "Suelo desnudo (BSI)",  vmin: -0.5, vmax: 0.5, cmap: "YlOrBr" },
  slope_mean:       { name: "Pendiente (°)",        vmin: 0,    vmax: 45,  cmap: "cividis" },
  solar_mean:       { name: "Exposición solar",     vmin: 0,    vmax: 1,   cmap: "magma" },
};

// Índices del ráster (modo detalle), agrupados.
const INDEX_META = {
  suitability:{n:"Aptitud",g:"Aptitud"}, ndvi:{n:"NDVI",g:"Vegetación"}, evi:{n:"EVI",g:"Vegetación"},
  savi:{n:"SAVI",g:"Vegetación"}, ndre:{n:"NDRE",g:"Vegetación"}, gndvi:{n:"GNDVI",g:"Vegetación"},
  cire:{n:"CIre",g:"Vegetación"}, arvi:{n:"ARVI",g:"Vegetación"}, sipi:{n:"SIPI",g:"Vegetación"},
  lai:{n:"LAI",g:"Vegetación"}, ndmi:{n:"NDMI",g:"Agua"}, ndwi:{n:"NDWI",g:"Agua"}, msi:{n:"MSI",g:"Agua"},
  moisturestress:{n:"M.Stress",g:"Agua"}, wdi:{n:"WDI",g:"Agua"}, bsi:{n:"BSI",g:"Suelo"},
  nbr:{n:"NBR",g:"Suelo"}, ndbi:{n:"NDBI",g:"Suelo"}, psri:{n:"PSRI",g:"Suelo"},
  slope:{n:"Pendiente",g:"Topografía"}, solarexposure:{n:"Solar",g:"Topografía"},
};
const PIX_CMAP = {
  suitability:"RdYlGn", ndvi:"RdYlGn", evi:"RdYlGn", savi:"RdYlGn", ndre:"RdYlGn", gndvi:"RdYlGn",
  cire:"YlGn", arvi:"RdYlGn", sipi:"PuOr", lai:"YlGn", ndmi:"BrBG", ndwi:"BrBG", msi:"BrBG_r",
  moisturestress:"BrBG_r", wdi:"BrBG_r", bsi:"YlOrBr", nbr:"RdYlGn", ndbi:"YlOrBr", psri:"YlOrBr",
  slope:"cividis", solarexposure:"magma",
};
const GROUPS = ["Aptitud", "Vegetación", "Agua", "Suelo", "Topografía"];

const map = new maplibregl.Map({
  container: "map", center: [-71.537, -16.409], zoom: 13, pitch: 62, bearing: -18, maxPitch: 80,
  style: {
    version: 8,
    sources: {
      satellite: { type: "raster", tileSize: 256, maxzoom: 19,
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        attribution: "Esri, Maxar" },
      dem: { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 15,
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"] },
    },
    layers: [
      { id: "satellite", type: "raster", source: "satellite" },
      { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.4 } },
    ],
  },
});

let STATE = { mode: "zonas", layers: null, metric: "priority", index: null, time: 0, range: "" };

map.on("load", async () => {
  map.setTerrain({ source: "dem", exaggeration: 1.15 });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
  map.addControl(new maplibregl.TerrainControl({ source: "dem", exaggeration: 1.15 }));
  bindControls();
  const list = await loadList();
  if (!analysisId) {
    const done = list.filter(a => a.status === "COMPLETED");
    if (done.length) analysisId = done[0].id;
  }
  if (analysisId) loadAnalysis(analysisId);
});

async function loadList() {
  try { const r = await fetch(`${API}/analyses/`, { headers: authHeaders() }); return await jsonOrThrow(r); }
  catch (e) { return []; }
}

async function loadAnalysis(id) {
  let a;
  try { const r = await fetch(`${API}/analyses/${id}/`, { headers: authHeaders() }); a = await jsonOrThrow(r); }
  catch (e) { alert(e.message); return; }
  if (!a.result) return;
  document.getElementById("analName").textContent = a.name || ("Análisis " + id.slice(0, 8));
  STATE.range = `${a.date_start} → ${a.date_end}`;
  STATE.layers = a.result.heatmap_layers || null;
  renderZones(a.result.clusters_geojson);
  fitTo(a.result.clusters_geojson);
  setMode("zonas");
}

function renderZones(geojson) {
  if (map.getSource("clusters")) { map.getSource("clusters").setData(geojson); return; }
  map.addSource("clusters", { type: "geojson", data: geojson });
  map.addLayer({ id: "clusters-fill", type: "fill", source: "clusters",
    paint: { "fill-color": "#888", "fill-opacity": 0.55 } });
  map.addLayer({ id: "clusters-outline", type: "line", source: "clusters",
    paint: { "line-color": "#0b1018", "line-width": 1, "line-opacity": 0.7 } });
}

// --- Controles -------------------------------------------------------------
function bindControls() {
  document.getElementById("modeZon").onclick = () => setMode("zonas");
  document.getElementById("modePix").onclick = () => setMode("pixel");
  document.getElementById("layerSelect").onchange = (e) => {
    if (STATE.mode === "zonas") { STATE.metric = e.target.value; paintZones(); }
    else { STATE.index = e.target.value; drawHeat(); }
    legend();
  };
  document.getElementById("timeSlider").oninput = (e) => {
    STATE.time = parseInt(e.target.value, 10);
    document.getElementById("timeLabel").textContent = STATE.layers ? STATE.layers.timesteps[STATE.time] : "—";
    drawHeat();
  };
  document.getElementById("opacity").oninput = (e) => {
    if (map.getLayer("heat")) map.setPaintProperty("heat", "raster-opacity", e.target.value / 100);
  };
}

function setMode(mode) {
  STATE.mode = mode;
  document.getElementById("modeZon").classList.toggle("on", mode === "zonas");
  document.getElementById("modePix").classList.toggle("on", mode === "pixel");
  document.getElementById("pixOnly").style.display = mode === "pixel" ? "block" : "none";
  document.getElementById("selLabel").textContent = mode === "zonas" ? "Métrica de la zona" : "Índice (ráster)";
  buildSelect();

  if (mode === "zonas") {
    if (map.getLayer("heat")) map.setLayoutProperty("heat", "visibility", "none");
    map.setPaintProperty("clusters-fill", "fill-opacity", 0.55);
    map.setPaintProperty("clusters-outline", "line-opacity", 0.7);
    paintZones();
    document.getElementById("modeNote").innerHTML =
      `ⓘ Coropleta <b>vectorial</b>: se adhiere al relieve sin distorsión y cubre todo el AOI.
       Resume la <b>mediana</b> del periodo ${STATE.range}.`;
  } else {
    map.setPaintProperty("clusters-fill", "fill-opacity", 0);
    map.setPaintProperty("clusters-outline", "line-opacity", 0.5);
    if (STATE.layers) drawHeat();
    document.getElementById("modeNote").innerHTML = STATE.layers
      ? `ⓘ Ráster por <b>píxel</b> y por <b>mes</b> (barra temporal). En pendientes muy
         fuertes el ráster puede estirarse; usa <b>Zonas</b> para un drapeado perfecto.`
      : `Este análisis no tiene capas ráster; relánzalo para verlas.`;
  }
  legend();
}

function buildSelect() {
  const sel = document.getElementById("layerSelect");
  if (STATE.mode === "zonas") {
    sel.innerHTML = Object.entries(METRICS).map(([k, m]) =>
      `<option value="${k}" ${k === STATE.metric ? "selected" : ""}>${m.name}</option>`).join("");
  } else {
    if (!STATE.layers) { sel.innerHTML = "<option>—</option>"; return; }
    const avail = STATE.layers.indices;
    let html = "";
    for (const g of GROUPS) {
      const items = avail.filter(k => (INDEX_META[k] || {}).g === g);
      if (items.length) html += `<optgroup label="${g}">` +
        items.map(k => `<option value="${k}">${(INDEX_META[k] || {}).n || k}</option>`).join("") + `</optgroup>`;
    }
    sel.innerHTML = html;
    STATE.index = avail[0];
    const slider = document.getElementById("timeSlider");
    slider.max = String(STATE.layers.timesteps.length - 1); slider.value = "0"; STATE.time = 0;
    document.getElementById("timeLabel").textContent = STATE.layers.timesteps[0];
  }
}

// --- Coropleta vectorial (drape perfecto) ----------------------------------
function paintZones() {
  if (!map.getLayer("clusters-fill")) return;
  const m = METRICS[STATE.metric];
  let expr;
  if (m.type === "cat") {
    expr = ["match", ["get", "priority"], ...Object.entries(PRIO_COLOR).flat(), "#888"];
  } else {
    const ramp = RAMP[m.cmap], mid = (m.vmin + m.vmax) / 2;
    expr = ["interpolate", ["linear"], ["coalesce", ["get", STATE.metric], m.vmin],
            m.vmin, ramp[0], mid, ramp[1], m.vmax, ramp[2]];
  }
  map.setPaintProperty("clusters-fill", "fill-color", expr);
}

// --- Ráster por píxel (detalle) --------------------------------------------
function drawHeat() {
  if (STATE.mode !== "pixel" || !STATE.layers || !STATE.index) return;
  const L = STATE.layers, ts = L.timesteps[STATE.time];
  const url = L.url_template.replace("{index}", STATE.index).replace("{timestep}", ts);
  const [w, s, e, n] = L.bounds, coords = [[w, n], [e, n], [e, s], [w, s]];
  if (map.getSource("heat")) {
    map.getSource("heat").updateImage({ url, coordinates: coords });
    map.setLayoutProperty("heat", "visibility", "visible");
  } else {
    map.addSource("heat", { type: "image", url, coordinates: coords });
    map.addLayer({ id: "heat", type: "raster", source: "heat",
      paint: { "raster-opacity": document.getElementById("opacity").value / 100 } });
  }
}

// --- Leyenda dinámica ------------------------------------------------------
function legend() {
  const el = document.getElementById("legend");
  if (STATE.mode === "zonas" && STATE.metric === "priority") {
    el.innerHTML = `<div class="lt">Prioridad de zonas</div>` + Object.entries(PRIO_COLOR).map(([k, c]) =>
      `<div class="row"><span class="sw" style="background:${c}"></span>${k}</div>`).join("");
    return;
  }
  let name, ramp, lo, hi;
  if (STATE.mode === "zonas") {
    const m = METRICS[STATE.metric]; name = m.name; ramp = RAMP[m.cmap]; lo = m.vmin; hi = m.vmax;
  } else if (STATE.layers && STATE.index) {
    name = (INDEX_META[STATE.index] || {}).n || STATE.index;
    ramp = RAMP[PIX_CMAP[STATE.index] || "RdYlGn"];
    const r = (STATE.layers.ranges || {})[STATE.index] || {}; lo = r.vmin; hi = r.vmax;
  } else { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="lt">${name}</div>
    <div class="ramp" style="background:linear-gradient(90deg,${ramp.join(",")})"></div>
    <div class="ramp-ends"><span>${lo}</span><span>${hi}</span></div>`;
}

function fitTo(geojson) {
  const b = new maplibregl.LngLatBounds();
  const walk = (c) => Array.isArray(c[0]) ? c.forEach(walk) : b.extend(c);
  geojson.features.forEach(f => walk(f.geometry.coordinates));
  map.fitBounds(b, { padding: 90, pitch: 62, bearing: -18 });
}
