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

// Métricas por zona (coropleta vectorial).
const METRICS = {
  priority: { name: "Prioridad de Manejo", type: "cat", desc: "Clasificación inteligente que prioriza las zonas con menor aptitud. Zonas 'No aptas' requieren Alta Prioridad de intervención." }
};

// Índices del ráster (modo detalle), agrupados.
const INDEX_META = {
  suitability:{n:"Aptitud",g:"Aptitud", d:"Puntuación ponderada de 0 a 100 que resume el estado de la zona según el objetivo del estudio."}, 
  ndvi:{n:"NDVI",g:"Vegetación", d:"Mide el vigor y verdor de las plantas. Valores altos indican vegetación sana."}, 
  evi:{n:"EVI",g:"Vegetación", d:"Similar al NDVI pero corrige distorsiones atmosféricas y ruido del suelo."},
  savi:{n:"SAVI",g:"Vegetación", d:"Optimizado para zonas áridas donde el suelo desnudo afecta la medición."}, 
  ndre:{n:"NDRE",g:"Vegetación", d:"Sensible al contenido de clorofila y etapas tardías del cultivo."}, 
  gndvi:{n:"GNDVI",g:"Vegetación", d:"Usa la banda verde para detectar variaciones en la clorofila."},
  cire:{n:"CIre",g:"Vegetación", d:"Índice de clorofila Red-Edge para medir estrés nutricional."}, 
  arvi:{n:"ARVI",g:"Vegetación", d:"Resistente a los efectos atmosféricos (humo, polvo)."}, 
  sipi:{n:"SIPI",g:"Vegetación", d:"Mide el ratio de carotenoides/clorofila (estrés fisiológico)."},
  lai:{n:"LAI",g:"Vegetación", d:"Estima el área foliar por metro cuadrado de suelo."}, 
  ndmi:{n:"NDMI",g:"Agua", d:"Mide el contenido de humedad interna de las hojas (estrés hídrico)."}, 
  ndwi:{n:"NDWI",g:"Agua", d:"Detecta agua libre superficial o zonas de encharcamiento."}, 
  msi:{n:"MSI",g:"Agua", d:"Índice de estrés hídrico; valores altos indican sequedad."},
  moisturestress:{n:"M.Stress",g:"Agua", d:"Variación del MSI para estrés por sequía."}, 
  wdi:{n:"WDI",g:"Agua", d:"Índice de déficit de agua para optimizar el riego."}, 
  bsi:{n:"BSI",g:"Suelo", d:"Mide la proporción de suelo desnudo frente a la vegetación."},
  nbr:{n:"NBR",g:"Suelo", d:"Usado para detectar áreas quemadas o evaluar biomasa leñosa."}, 
  ndbi:{n:"NDBI",g:"Suelo", d:"Detecta áreas construidas o suelos impermeables."}, 
  psri:{n:"PSRI",g:"Suelo", d:"Relacionado con la senescencia y maduración del cultivo."},
  slope:{n:"Pendiente",g:"Topografía", d:"Inclinación del terreno en grados. Crítico para drenaje e insolación."}, 
  solarexposure:{n:"Solar",g:"Topografía", d:"Exposición teórica a la radiación solar considerando laderas y sombras."},
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

let STATE = { mode: "zonas", layers: null, metric: "priority", index: null, time: 0, range: "", analysis: null };

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

const fmtDate = (iso) => { const d=new Date(iso); return isNaN(d)?iso:d.toLocaleDateString("es-ES",{day:"2-digit",month:"short",year:"2-digit"}); };

map.on("load", async () => {
  map.setTerrain({ source: "dem", exaggeration: 1.15 });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
  map.addControl(new maplibregl.TerrainControl({ source: "dem", exaggeration: 1.15 }));
  bindControls();
  const list = await loadList();
  const done = list.filter(a => a.status === "COMPLETED");
  
  const sel = document.getElementById("analysisSelect");
  if (sel) {
    if (!done.length) {
      sel.innerHTML = `<option value="">No hay análisis completados</option>`;
      sel.disabled = true;
    } else {
      sel.innerHTML = done.map(a => 
        `<option value="${a.id}">${a.user_email ? '[' + a.user_email + '] ' : ''}${a.name ? a.name + " · " : ""}${fmtDate(a.created_at)} · ${a.area_ha} ha</option>`
      ).join("");
      sel.onchange = (e) => { 
        analysisId = e.target.value; 
        loadAnalysis(analysisId); 
        const url = new URL(window.location);
        url.searchParams.set("id", analysisId);
        window.history.pushState({}, "", url);
      };
    }
  }

  if (!analysisId && done.length) {
    analysisId = done[0].id;
  }
  
  if (analysisId) {
    if (sel && done.length) sel.value = analysisId;
    loadAnalysis(analysisId);
  }
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
  STATE.analysis = a;
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

  map.on("click", "clusters-fill", (e) => {
    if (STATE.mode !== "zonas") return;
    const p = e.features[0].properties;
    let html = `<div style="font-family:var(--font-mono); font-size:11px; color:#111827; padding:2px;">
      <div style="font-weight:bold; margin-bottom:8px; border-bottom:1px solid #e5e7eb; padding-bottom:4px;">Valores de la Zona</div>`;
    for (const [k, m] of Object.entries(METRICS)) {
      if (p[k] !== undefined) {
        let val = p[k];
        if (typeof val === "number") val = val.toFixed(2);
        html += `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="color:#6b7280; margin-right:16px;">${m.name}</span>
          <span style="font-weight:bold;">${val}</span>
        </div>`;
      }
    }
    html += `</div>`;
    new maplibregl.Popup({ closeButton: true, maxWidth: "250px" })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  map.on("mouseenter", "clusters-fill", () => {
    if (STATE.mode === "zonas") map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "clusters-fill", () => {
    map.getCanvas().style.cursor = "";
  });
}

// --- Controles -------------------------------------------------------------
function bindControls() {
  document.getElementById("modeZon").onclick = () => setMode("zonas");
  document.getElementById("modePix").onclick = () => setMode("pixel");
  document.getElementById("layerSelect").onchange = (e) => {
    if (STATE.mode === "zonas") { STATE.metric = e.target.value; paintZones(); }
    else { STATE.index = e.target.value; drawHeat(); }
    updateDescription();
    legend();
  };
  document.getElementById("timeSlider").oninput = (e) => {
    STATE.time = parseInt(e.target.value, 10);
    document.getElementById("timeLabel").textContent = STATE.layers ? STATE.layers.timesteps[STATE.time] : "—";
    drawHeat();
  };
  document.getElementById("opacity").oninput = (e) => {
    const val = e.target.value / 100;
    if (STATE.mode === "zonas" && map.getLayer("clusters-fill")) {
      map.setPaintProperty("clusters-fill", "fill-opacity", val);
    } else if (STATE.mode === "pixel" && map.getLayer("heat")) {
      map.setPaintProperty("heat", "raster-opacity", val);
    }
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
    const val = document.getElementById("opacity").value / 100;
    map.setPaintProperty("clusters-fill", "fill-opacity", val);
    map.setPaintProperty("clusters-outline", "line-opacity", 0.7);
    paintZones();
  } else {
    map.setPaintProperty("clusters-fill", "fill-opacity", 0);
    map.setPaintProperty("clusters-outline", "line-opacity", 0.5);
    if (STATE.layers) drawHeat();
  }
  updateDescription();
  legend();
}

function updateDescription() {
  const note = document.getElementById("modeNote");
  const studyType = STATE.analysis?.study_type || "agro";
  const dict = STUDY_DESCRIPTIONS[studyType] || STUDY_DESCRIPTIONS.agro;
  
  if (STATE.mode === "zonas") {
    let desc = dict.priority;
    note.innerHTML = `<span style="color:var(--cyan);font-weight:bold;">Prioridad de Manejo:</span> ${desc}<br><br>
                      ⓘ <b>Vectorial</b>: Resume la mediana del periodo y se adhiere al relieve sin distorsión (drapeado perfecto).`;
  } else {
    if (!STATE.layers) {
      note.innerHTML = `Este análisis no tiene capas ráster; relánzalo para verlas.`;
      return;
    }
    const meta = INDEX_META[STATE.index] || {};
    const d = dict.indices[STATE.index.toLowerCase()] || meta.d || "";
    note.innerHTML = `<span style="color:var(--cyan);font-weight:bold;">${meta.n || STATE.index}:</span> ${d}<br><br>
                      ⓘ <b>Ráster Mensual</b>: Al encender el relieve 3D, la imagen ráster puede deformarse o separarse del suelo debido a cómo el motor gráfico interpola la cuadrícula en pendientes pronunciadas.`;
  }
}

function buildSelect() {
  const sel = document.getElementById("layerSelect");
  if (STATE.mode === "zonas") {
    sel.innerHTML = Object.entries(METRICS).map(([k, m]) =>
      `<option value="${k}" ${k === STATE.metric ? "selected" : ""}>${m.name}</option>`).join("");
  } else {
    if (!STATE.layers) { sel.innerHTML = "<option>—</option>"; return; }
    const usedIndices = (STATE.analysis?.result?.statistics?.indices_used || []).map(i => i.toLowerCase());
    const avail = STATE.layers.indices.filter(i => i === "suitability" || usedIndices.includes(i));
    
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
  const opacityVal = document.getElementById("opacity").value / 100;
  if (map.getSource("heat")) {
    map.getSource("heat").updateImage({ url, coordinates: coords });
    map.setLayoutProperty("heat", "visibility", "visible");
    map.setPaintProperty("heat", "raster-opacity", opacityVal);
  } else {
    map.addSource("heat", { type: "image", url, coordinates: coords });
    map.addLayer({ id: "heat", type: "raster", source: "heat",
      paint: { "raster-opacity": opacityVal } });
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
