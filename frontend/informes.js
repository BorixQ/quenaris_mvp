/* ===========================================================================
 * Informes — render del informe geoespacial estilo ejecutivo.
 * Portada de empresa + ficha del AOI + resumen + KPIs + informe del LLM
 * (markdown compilado con marked.js). Selector entre los análisis del usuario.
 * ========================================================================= */

const qs = new URLSearchParams(location.search);
let selectedId = qs.get("id");

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
  suitability:{n:"Aptitud"}, ndvi:{n:"NDVI"}, evi:{n:"EVI"}, savi:{n:"SAVI"}, ndre:{n:"NDRE"}, gndvi:{n:"GNDVI"},
  cire:{n:"CIre"}, arvi:{n:"ARVI"}, sipi:{n:"SIPI"}, lai:{n:"LAI"}, ndmi:{n:"NDMI"}, ndwi:{n:"NDWI"}, msi:{n:"MSI"},
  moisturestress:{n:"M.Stress"}, wdi:{n:"WDI"}, bsi:{n:"BSI"}, nbr:{n:"NBR"}, ndbi:{n:"NDBI"}, psri:{n:"PSRI"},
  slope:{n:"Pendiente"}, solarexposure:{n:"Solar"}
};

init();

async function init() {
  let list = [];
  try {
    const res = await fetch(`${API}/analyses/`, { headers: authHeaders() });
    list = await jsonOrThrow(res);
  } catch (e) {
    document.getElementById("reportRoot").innerHTML = `<div class="card pad">Error: ${e.message}</div>`;
    return;
  }
  const completed = list.filter(a => a.status === "COMPLETED");
  renderPicker(completed);

  if (!selectedId && completed.length) selectedId = completed[0].id;
  if (selectedId) loadReport(selectedId);
  else document.getElementById("reportRoot").innerHTML =
    `<div class="card pad">Aún no tienes informes completados. Genera uno en
     <a href="geoanalisis.html">Geoanálisis</a>.</div>`;
}

function renderPicker(items) {
  if (!items.length) return;
  const sel = items.map(a =>
    `<option value="${a.id}" ${a.id === selectedId ? "selected" : ""}>
       ${a.user_email ? '[' + a.user_email + '] ' : ''}${a.name ? a.name + " · " : ""}${fmtDate(a.created_at)} · ${a.area_ha} ha
     </option>`).join("");
  document.getElementById("picker").innerHTML = `
    <label style="font-size:13px; color:var(--muted);">Análisis disponibles:</label>
    <select id="sel" style="max-width:420px;">${sel}</select>`;
  document.getElementById("sel").onchange = (e) => { selectedId = e.target.value; loadReport(selectedId); };
}

async function loadReport(id) {
  const root = document.getElementById("reportRoot");
  root.innerHTML = `<div class="spinner"></div>`;
  let a;
  try {
    const res = await fetch(`${API}/analyses/${id}/`, { headers: authHeaders() });
    a = await jsonOrThrow(res);
  } catch (e) { root.innerHTML = `<div class="card pad">Error: ${e.message}</div>`; return; }

  const r = a.result || {};
  const st = r.statistics || {};
  const reportMd = stripFence(r.report_markdown || "_El informe de IA no está disponible para este análisis._");
  const reportHtml = window.marked ? marked.parse(reportMd) : reportMd;

  root.innerHTML = `
    <div class="card pad" id="report">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h1 class="page">${a.name || "Informe Geoespacial"}</h1>
          <p class="sub">Terranode · Plataforma de análisis geoespacial multiespectral</p>
        </div>
        <div class="toolbar">
          <button class="btn ghost" onclick="window.print()">⭳ Exportar PDF</button>
          <button class="btn ghost" id="jsonBtn">⭳ JSON</button>
        </div>
      </div>

      <hr style="border:none; border-top:1px solid var(--line); margin:18px 0;">

      <div class="report-head">
        <div class="avatar">AOI</div>
        <div style="flex:1;">
          <div style="font-size:20px; font-weight:800;">Área de Interés · ${a.area_ha} ha</div>
          <div class="sub" style="margin:2px 0 0;">ID: ${a.id}</div>
        </div>
        <div style="text-align:right;">
          <div class="lbl" style="font-size:12px; color:var(--muted);">Fecha del informe</div>
          <div style="font-weight:700;">${fmtDate(a.created_at)}</div>
        </div>
      </div>

      <div class="meta">
        <div><div class="lbl">Periodo analizado</div><div class="v">${a.date_start} → ${a.date_end}</div></div>
        <div><div class="lbl">Algoritmo</div><div class="v">${st.algorithm || a.algorithm}</div></div>
        <div><div class="lbl">Escenas Sentinel-2</div><div class="v">${r.images_used ?? "—"}</div></div>
        <div><div class="lbl">Procesamiento</div><div class="v">${r.processing_seconds ?? "—"} s</div></div>
      </div>

      <div class="section-title">RESUMEN EJECUTIVO</div>
      ${st.calibrated === false ? `
      <div class="callout warning">
        <h4>⚠️ Modelo Teórico (Basado en Índices)</h4>
        <p>El modelo actual evalúa la salud vegetal utilizando firmas espectrales satelitales puras. No ha sido calibrado con datos físicos de rendimiento de su cosecha (Ground-Truth), por lo que las proyecciones se basan en óptimos teóricos de la literatura.</p>
      </div>` : ''}
      <div class="summary">${execSummary(st)}</div>
      <div class="kpis" style="margin-top:16px;">
        <div class="kpi"><div class="lbl">Aptitud media</div><div class="val">${num(st.suitability_global_mean)}<span style="font-size:14px;color:var(--muted)">/100</span></div></div>
        <div class="kpi"><div class="lbl">Área total</div><div class="val">${num(st.total_area_ha)} ha</div></div>
        <div class="kpi"><div class="lbl">Hectáreas prioritarias</div><div class="val">${priorityHa(st)} ha</div></div>
        <div class="kpi"><div class="lbl">Zonas detectadas</div><div class="val">${st.n_clusters ?? "—"}</div></div>
      </div>

      <div class="page-break"></div>
      <div class="section-title">I. ANÁLISIS DESCRIPTIVO</div>
      <p style="color:var(--muted); font-size:14px; margin-top:-8px; margin-bottom:16px;">Evaluación del estado actual del cultivo mediante índices crudos. Se procesaron ${r.images_used || "varias"} imágenes del satélite Sentinel-2 en el periodo. Los píxeles cubiertos por nubes fueron removidos automáticamente mediante la banda QA60 para garantizar lecturas fiables.</p>
      
      ${r.clusters_geojson ? `
      <div style="display:flex; flex-wrap:wrap; gap:16px; margin-bottom: 24px;">
        <div style="flex:1; min-width:300px; height: 350px; border-radius: 8px; border: 1px solid var(--line); overflow:hidden; position:relative;">
          <div id="clusterMap" style="width:100%; height:100%;"></div>
        </div>
        <div style="width:250px; background:var(--bg-1); border:1px solid var(--line); border-radius:8px; padding:16px;">
          <h4 style="margin:0 0 12px; font-size:14px; color:var(--ink);">Leyenda de Zonas</h4>
          <div id="clusterLegend"></div>
        </div>
      </div>
      ` : ''}

      <div class="callout tip" style="margin-bottom: 16px;">
        <h4 style="margin-bottom:4px; font-size:14px;">Glosario Rápido</h4>
        <p style="font-size:13px; line-height:1.5; color:var(--muted);">
          <b>Aptitud (0-100):</b> ${STUDY_DESCRIPTIONS[a.study_type || "agro"]?.indices?.suitability || "Calificación numérica basada en firmas espectrales."}<br>
          <b>Prioridad de Manejo:</b> ${STUDY_DESCRIPTIONS[a.study_type || "agro"]?.priority || "Es la clasificación en texto de la Aptitud."}
        </p>
      </div>

      ${st.feature_importance && st.feature_importance.length > 0 ? `
      <div class="callout tip">
        <h4>💡 Transparencia del Algoritmo (Explicabilidad)</h4>
        <p>La Inteligencia Artificial determinó que el factor más crítico para segmentar su campo hoy fue: <strong>${st.feature_importance[0].feature}</strong> (Peso de importancia: ${(st.feature_importance[0].importance * 100).toFixed(0)}%).</p>
      </div>` : ''}

      <div class="card pad" style="margin-bottom: 18px; margin-top: 18px;">
        <b style="font-size:13px; display:block; margin-bottom:12px;">Métricas Promedio por Zona</b>
        <div style="overflow-x:auto;">
          <table style="width:100%; text-align:left; border-collapse:collapse; font-family:var(--font-mono); font-size:12px; white-space:nowrap;">
            <tr style="border-bottom:1px solid var(--line); color:var(--muted);">
              <th style="padding:8px 4px;">Zona</th>
              <th style="padding:8px 4px;">Área (ha)</th>
              ${(st.indices_used || []).map(idx => `<th style="padding:8px 4px;">${INDEX_META[idx.toLowerCase()]?.n || idx}</th>`).join("")}
              <th style="padding:8px 4px;">Aptitud</th>
            </tr>
            ${(st.clusters || []).map(c => `
            <tr style="border-bottom:1px solid var(--line-bright);">
              <td style="padding:8px 4px; font-weight:600; color:var(--ink);">${c.label}</td>
              <td style="padding:8px 4px;">${num(c.area_ha)}</td>
              ${(st.indices_used || []).map(idx => `<td style="padding:8px 4px;">${num(c[idx.toLowerCase() + "_mean"])}</td>`).join("")}
              <td style="padding:8px 4px; font-weight:bold;">${num(c.suitability_mean)}</td>
            </tr>
            `).join("")}
          </table>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px;">
        <div class="card pad"><b style="font-size:13px;">Evolución de la aptitud media</b>
          <canvas id="chTime" height="170"></canvas></div>
        <div class="card pad"><b style="font-size:13px;">Perfil de índices por zona</b>
          <canvas id="chRadar" height="170"></canvas></div>
      </div>

      <div class="page-break"></div>
      <div class="section-title">II. ANÁLISIS DIAGNÓSTICO</div>
      <p style="color:var(--muted); font-size:14px; margin-top:-8px; margin-bottom:16px;">Zonificación inteligente, explicabilidad del algoritmo y causa raíz por zona.</p>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom: 16px;">
        <div class="card pad"><b style="font-size:13px;">Distribución de prioridad (ha)</b>
          <canvas id="chPrio" height="170"></canvas></div>
        <div class="card pad"><b style="font-size:13px;">Aptitud por zona</b>
          <canvas id="chSuit" height="170"></canvas></div>
      </div>
      <h3 style="font-size: 15px; margin-top:24px; color:var(--ink);">Diagnóstico Diferencial por Zona</h3>
      <div class="zone-grid">
      ${diagnosticCards(st)}
      </div>

      <div class="page-break"></div>
      <div class="section-title">III. ANÁLISIS PREDICTIVO</div>
      <p style="color:var(--muted); font-size:14px; margin-top:-8px; margin-bottom:16px;">Proyección de rendimiento, estrés futuro y modelado fenológico (Grados Día).</p>
      <div class="callout danger">
        <h4>🚨 Módulo Desactivado: Datos Insuficientes</h4>
        <p>Este análisis no se encuentra disponible para esta corrida. Se requiere la ingesta de series temporales meteorológicas (Temperaturas Máximas y Mínimas históricas) y la selección de Temperatura Base del cultivo.</p>
      </div>

      <div class="page-break"></div>
      <div class="section-title">IV. ANÁLISIS PRESCRIPTIVO</div>
      <p style="color:var(--muted); font-size:14px; margin-top:-8px; margin-bottom:16px;">Generación automática de mapas de maquinaria para aplicación de Tasa Variable (VRT).</p>
      <div class="callout danger">
        <h4>🚨 Módulo Desactivado: Parámetros Incompletos</h4>
        <p>El mapa de prescripción para maquinaria agrícola no se ha generado. Se requiere ingresar un Presupuesto Total de Insumos (ej. Litros de fertilizante) y los límites de aplicación por hectárea.</p>
      </div>

      <div class="page-break"></div>
      <div class="section-title">Anexo: Informe Detallado (LLM)</div>
      <div class="md">${reportHtml}</div>

      <hr style="border:none; border-top:1px solid var(--line); margin:24px 0 12px;">
      <p class="hint">
        Generado por Terranode · Sentinel-2 (${st.satellite_collection || "COPERNICUS/S2_SR_HARMONIZED"}).
        Documento de carácter técnico-orientativo. <a href="viewer3d.html?id=${a.id}">Ver en 3D ⬢</a>
      </p>
    </div>`;

  document.getElementById("jsonBtn").onclick = () => downloadJSON(a);
  renderCharts(st, r.heatmap_layers);
  if (r.clusters_geojson) renderClusterMap(r.clusters_geojson, st.clusters);
}

const LABEL_COLOR = { 
  "Óptimo": "#34d399", 
  "Bueno": "#7bb661", 
  "Moderado": "#f5a524", 
  "Marginal": "#d97736",
  "No apto": "#b5651d" 
};

function renderClusterMap(geojson, clusterStats) {
  if (!window.maplibregl) return;
  
  const b = new maplibregl.LngLatBounds();
  geojson.features.forEach(f => {
    const coords = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] 
                 : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.flatMap(p => p[0]) : [];
    coords.forEach(c => b.extend(c));
  });

  const map = new maplibregl.Map({
    container: 'clusterMap',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    bounds: b,
    fitBoundsOptions: { padding: 40, maxZoom: 18 }
  });

  map.on('load', () => {
    // Add satellite background
    map.addSource('satellite', {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256
    });
    map.addLayer({ id: 'satellite-layer', type: 'raster', source: 'satellite', paint: { 'raster-opacity': 0.6 } });

    const labelColor = ["match", ["get","label"], ...Object.entries(LABEL_COLOR).flat(), "#888"];
    map.addSource('clusters', { type: 'geojson', data: geojson });
    map.addLayer({ id: 'clusters-fill', type: 'fill', source: 'clusters', paint: { 'fill-color': labelColor, 'fill-opacity': 0.6 } });
    map.addLayer({ id: 'clusters-outline', type: 'line', source: 'clusters', paint: { 'line-color': '#000', 'line-width': 1 } });
  });

  // Render legend
  const legendHtml = (clusterStats || []).map(c => `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:13px; font-family:var(--font-mono);">
      <div style="width:16px; height:16px; border-radius:4px; background:${LABEL_COLOR[c.label] || '#888'}; border:1px solid #000;"></div>
      <div style="flex:1;">${c.label}</div>
      <div style="color:var(--muted);">${num(c.area_ha)} ha</div>
    </div>
  `).join("");
  document.getElementById("clusterLegend").innerHTML = legendHtml;
}

let CHARTS = [];
function renderCharts(st, heatmap) {
  CHARTS.forEach(c => c.destroy()); CHARTS = [];
  if (!window.Chart) return;
  // Tema oscuro para Chart.js
  Chart.defaults.color = "#8395a3";
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.borderColor = "rgba(120,170,190,.12)";
  const clusters = st.clusters || [];

  // 1. Distribución de prioridad (doughnut)
  const pd = st.priority_distribution || {};
  const order = ["Muy Alta", "Alta", "Media", "Baja"];
  const pcol = { "Muy Alta": "#1f7a3d", "Alta": "#7bb661", "Media": "#d9a441", "Baja": "#b5651d" };
  mk("chPrio", {
    type: "doughnut",
    data: { labels: order, datasets: [{
      data: order.map(k => pd[k] || 0),
      backgroundColor: order.map(k => pcol[k]) }] },
    options: { plugins: { legend: { position: "right" } } },
  });

  // 2. Aptitud por zona (bar)
  mk("chSuit", {
    type: "bar",
    data: { labels: clusters.map(c => c.label),
      datasets: [{ label: "Aptitud (0-100)", data: clusters.map(c => c.suitability_mean),
        backgroundColor: clusters.map(c => pcol[c.priority] || "#888") }] },
    options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } },
  });

  // 3. Perfil de ecofisiología por zona (radar normalizado)
  // El borde exterior del radar representa las "mejores" condiciones.
  const used = st.indices_used || [];
  const axes = used.slice(0, 5).map(idx => {
    const meta = INDEX_META[idx.toLowerCase()] || {};
    return [idx.toLowerCase() + "_mean", meta.n || idx];
  });
  axes.push(["suitability_mean", "Aptitud Global"]);

  const norm = (v, lo, hi) => Math.max(0, Math.min(1, ((v||0) - lo) / (hi - lo)));
  const ranges = { suitability_mean: [0, 100] };
  const INVERTED_INDICES = ["bsi", "ndsi", "si2", "ndbi", "msi", "moisturestress", "slope"];

  used.forEach(idx => {
    const k = idx.toLowerCase();
    const r = (heatmap && heatmap.ranges && heatmap.ranges[k]) || {vmin: -1, vmax: 1};
    if (INVERTED_INDICES.includes(k)) {
      ranges[k + "_mean"] = [r.vmax, r.vmin]; // invertido: menor es mejor
    } else {
      ranges[k + "_mean"] = [r.vmin, r.vmax];
    }
  });
  mk("chRadar", {
    type: "radar",
    data: { labels: axes.map(a => a[1]),
      datasets: clusters.map((c, i) => ({
        label: c.label,
        data: axes.map(([k]) => norm(c[k], ranges[k][0], ranges[k][1])),
        fill: true, backgroundColor: hexA(palette(i), .12), borderColor: palette(i), borderWidth: 2,
      })) },
    options: { scales: { r: { min: 0, max: 1, ticks: { display: false } } } },
  });

  // 4. Evolución temporal de la aptitud (line)
  const series = (heatmap && heatmap.suitability_series) || [];
  if (series.length) {
    mk("chTime", {
      type: "line",
      data: { labels: series.map(s => s.month),
        datasets: [{ label: "Aptitud media", data: series.map(s => s.suitability_mean),
          borderColor: "#34d399", backgroundColor: hexA("#34d399", .15), fill: true, tension: .4, pointBackgroundColor: "#34d399" }] },
      options: { scales: { y: { beginAtZero: true, max: 100, ticks: { stepSize: 20 } } } },
    });
  } else {
    const el = document.getElementById("chTime");
    if (el) el.parentElement.insertAdjacentHTML("beforeend",
      `<p class="hint">Serie temporal no disponible para este análisis.</p>`);
  }
}

function mk(id, cfg) {
  const el = document.getElementById(id);
  if (el) CHARTS.push(new Chart(el, cfg));
}
function palette(i) { return ["#1f7a3d","#16a89a","#d9a441","#b5651d","#7bb661","#0b3d1f"][i % 6]; }
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}

function execSummary(st) {
  if (!st.clusters) return "Resumen no disponible.";
  const best = [...st.clusters].sort((a, b) => b.suitability_mean - a.suitability_mean)[0];
  const worst = [...st.clusters].sort((a, b) => a.suitability_mean - b.suitability_mean)[0];
  const sil = st.silhouette != null
    ? ` Separación de zonas (silhouette) <b>${st.silhouette}</b>.` : "";
  return `Se analizó el área con un motor multicriterio sobre ${(st.indices_used || []).length || "varios"}
    índices, segmentándola en <b>${st.n_clusters}</b> zonas. La <b>aptitud media</b> global es
    <b>${num(st.suitability_global_mean)}/100</b> sobre <b>${num(st.total_area_ha)} ha</b>.
    La mejor zona es <b>${(best.label || "")}</b> (aptitud ${num(best.suitability_mean)},
    prioridad ${best.priority}, ${num(best.area_ha)} ha); la más limitada es
    <b>${(worst.label || "")}</b> (aptitud ${num(worst.suitability_mean)}, ${num(worst.area_ha)} ha),
    candidata prioritaria a intervención.${sil} El detalle se desarrolla abajo.`;
}

const PRIO_COLOR = { "Muy Alta": "#1f7a3d", "Alta": "#7bb661", "Media": "#d9a441", "Baja": "#b5651d" };

function priorityHa(st) {
  const d = st.priority_distribution || {};
  return ((d["Muy Alta"] || 0) + (d["Alta"] || 0)).toFixed(1);
}

const CAUSE_DICT = {
  ESTRES_HIDRICO: { icon: "💧", name: "Estrés Hídrico" },
  SALINIDAD: { icon: "🧂", name: "Salinidad Alta" },
  DEGRADACION_SUELO: { icon: "🏜️", name: "Degradación / Suelo Desnudo" },
  SANO_OPTIMO: { icon: "✅", name: "Cultivo Sano / Óptimo" },
  ANOMALIA_DESCONOCIDA: { icon: "❓", name: "Anomalía Desconocida" }
};

function diagnosticCards(st) {
  if (!st.clusters) return "";
  return st.clusters.map(c => {
    let causeHtml = "";
    if (c.differential && c.differential.length > 0) {
      const p = c.differential[0];
      const info = CAUSE_DICT[p.cause] || { icon: "⚠️", name: p.cause };
      causeHtml = `
        <div class="cause">
          <span class="cause-title">${info.icon} ${info.name}</span>
          <span class="cause-ev">Evidencia: ${(p.evidence_score * 100).toFixed(0)}%</span>
        </div>`;
    }
    
    return `
      <div class="zone-card">
        <h3>${c.label || "Zona"} <span style="font-weight:400; color:var(--muted)">· ${num(c.area_ha)} ha</span></h3>
        ${causeHtml}
        <div class="raw-vals">
          ${(st.indices_used || []).slice(0, 3).map(idx => `<span>${INDEX_META[idx.toLowerCase()]?.n || idx}: ${num(c[idx.toLowerCase() + "_mean"])}</span>`).join("")}
          <span style="font-weight:bold; color:var(--cyan);">Aptitud: ${num(c.suitability_mean)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function downloadJSON(a) {
  const blob = new Blob([JSON.stringify(a, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `informe_${a.id}.json`; link.click();
  URL.revokeObjectURL(url);
}

// El LLM suele envolver el informe en un bloque ```markdown ... ```; lo quitamos
// para que marked compile el contenido en vez de mostrarlo como código.
function stripFence(s) {
  const t = (s || "").trim();
  if (t.startsWith("```")) {
    return t.replace(/^```[^\n]*\n?/, "").replace(/```\s*$/, "").trim();
  }
  return s;
}

function num(v) { return (v === null || v === undefined) ? "—" : v; }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "—"; }
