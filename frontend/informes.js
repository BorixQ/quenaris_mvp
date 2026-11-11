/* ===========================================================================
 * Informes — render del informe geoespacial estilo ejecutivo.
 * Portada de empresa + ficha del AOI + resumen + KPIs + informe del LLM
 * (markdown compilado con marked.js). Selector entre los análisis del usuario.
 * ========================================================================= */

const qs = new URLSearchParams(location.search);
let selectedId = qs.get("id");

const STUDY_DESCRIPTIONS = SCIENCE_STUDY;

const INDEX_META = {
  suitability:{n:"Aptitud"}, ndvi:{n:"NDVI"}, evi:{n:"EVI"}, savi:{n:"SAVI"}, ndre:{n:"NDRE"}, gndvi:{n:"GNDVI"},
  cire:{n:"CIre"}, arvi:{n:"ARVI"}, sipi:{n:"SIPI"}, lai:{n:"LAI"}, ndmi:{n:"NDMI"}, ndwi:{n:"NDWI"}, msi:{n:"MSI"},
  moisturestress:{n:"M.Stress"}, wdi:{n:"WDI"}, bsi:{n:"BSI"}, nbr:{n:"NBR"}, ndbi:{n:"NDBI"}, psri:{n:"PSRI"},
  slope:{n:"Pendiente"}, solarexposure:{n:"Solar"}
};
scientificMetadata(INDEX_META);

init();

async function init() {
  let list = [];
  try {
    const res = await fetch(`${API}/analyses/`, { headers: authHeaders() });
    list = await jsonOrThrow(res);
  } catch (e) {
    document.getElementById("reportRoot").innerHTML = `<div class="card pad">Error: ${escapeHTML(e.message)}</div>`;
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
       ${a.user_email ? '[' + escapeHTML(a.user_email) + '] ' : ''}${a.name ? escapeHTML(a.name) + " · " : ""}${fmtDate(a.created_at)} · ${a.area_ha} ha
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
  } catch (e) { root.innerHTML = `<div class="card pad">Error: ${escapeHTML(e.message)}</div>`; return; }

  const r = a.result || {};
  const st = r.statistics || {};
  const reportMd = stripFence(r.report_markdown || "_El informe no está disponible para este análisis._");
  const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const reportHtml = `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(reportMd)}</pre>`;

  root.innerHTML = `
    <div class="card pad" id="report">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h1 class="page">${escapeHTML(a.name) || "Informe Geoespacial"}</h1>
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
        <h4>⚠️ Resultado exploratorio, sin calibración</h4>
        <p>Puntuación relativa con pesos heurísticos. No demuestra salud, viabilidad de plantación ni necesidad de intervención. Requiere observaciones de campo.</p>
      </div>` : ''}
      <div class="summary">${execSummary(st)}</div>
      <ul class="hint">${(st.warnings || []).map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      <div class="kpis" style="margin-top:16px;">
        <div class="kpi"><div class="lbl">Puntuación relativa media</div><div class="val">${num(st.suitability_global_mean)}<span style="font-size:14px;color:var(--muted)">/100</span></div></div>
        <div class="kpi"><div class="lbl">Área con datos utilizables</div><div class="val">${num(st.total_area_ha)} ha</div></div>
        <div class="kpi"><div class="lbl">Hectáreas de menor puntuación</div><div class="val">${priorityHa(st)} ha</div></div>
        <div class="kpi"><div class="lbl">Zonas detectadas</div><div class="val">${st.n_clusters ?? "—"}</div></div>
      </div>

      <div class="page-break"></div>
      <div class="section-title">I. ANÁLISIS DESCRIPTIVO</div>
      <p style="color:var(--muted); font-size:14px; margin-top:-8px; margin-bottom:16px;">Evaluación del estado actual del cultivo mediante índices crudos. Se procesaron ${r.images_used || "varias"} imágenes del satélite Sentinel-2 en el periodo. Se retienen píxeles terrestres clasificados por SCL (vegetación/suelo expuesto); la máscara puede cometer errores. Cobertura utilizable: ${st.quality ? (100 * st.quality.valid_fraction).toFixed(1) + "%" : "no registrada en esta corrida"}. Cuadrícula de salida: ${st.analysis_scale_m || "no registrada"} m.</p>

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
          <b>Orden de inspección:</b> ${STUDY_DESCRIPTIONS[a.study_type || "agro"]?.priority || "Es la clasificación en texto de la Aptitud."}
        </p>
      </div>

      ${st.feature_importance && st.feature_importance.length > 0 ? `
      <div class="callout tip">
        <h4>💡 Transparencia del Algoritmo (Explicabilidad)</h4>
        <p>Mayor importancia interna según ${st.importance_method || "método no registrado"} (no causalidad ni validación): <strong>${st.feature_importance[0].feature}</strong> (Importancia relativa interna: ${(st.feature_importance[0].importance * 100).toFixed(0)}%).</p>
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

      <p class="hint">Serie mensual descriptiva con referencia fija del periodo (solo corridas v2); la cobertura puede variar entre meses. No demuestra una tendencia ni permite comparar otras corridas.</p>
      <div class="page-break"></div>
      <div class="section-title">II. AGRUPACIONES EXPLORATORIAS</div>
      <p style="color:var(--muted); font-size:14px; margin-top:-8px; margin-bottom:16px;">Agrupaciones espectrales y puntuación relativa; causas no determinadas.</p>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom: 16px;">
        <div class="card pad"><b style="font-size:13px;">Distribución de prioridad (ha)</b>
          <canvas id="chPrio" height="170"></canvas></div>
        <div class="card pad"><b style="font-size:13px;">Aptitud por zona</b>
          <canvas id="chSuit" height="170"></canvas></div>
      </div>
      <h3 style="font-size: 15px; margin-top:24px; color:var(--ink);">Observaciones por grupo</h3>
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
        <p>El mapa de prescripción para maquinaria agrícola no se ha generado. Se requiere un modelo agronómico validado con datos de campo antes de generar prescripciones. Un presupuesto no basta para establecer dosis.</p>
      </div>

      <div class="page-break"></div>
      <div class="section-title">Anexo: Informe factual</div>
      <div class="md">${st.science_version ? reportHtml : "Informe histórico oculto: recalcula este análisis para usar las reglas científicas actuales."}</div>

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
  "Grupo 1": "#4477aa", "Grupo 2": "#66ccee", "Grupo 3": "#228833", "Grupo 4": "#ccbb44", "Grupo 5": "#ee6677", "Sin agrupación": "#888888",
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
  transformRequest: privateMapRequest,
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
        datasets: [{ label: "Puntuación relativa media", data: series.map(s => s.suitability_mean),
          borderColor: "#34d399", backgroundColor: hexA("#34d399", .15), fill: true, tension: 0, pointBackgroundColor: "#34d399" }] },
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
  return `Resultado exploratorio sobre ${num(st.total_area_ha)} ha con datos utilizables.
    Puntuación relativa media: ${num(st.suitability_global_mean)}/100.
    Grupos: ${st.n_clusters}. La separación espectral no identifica causas ni valida aptitud.
    ${st.science_version ? "Referencia: " + st.science_version : "Resultado histórico: recalcular con el motor científico actual."}`;
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
  return (st.clusters || []).map(c => `<div class="zone-card"><h3>${c.cluster_id === -1 ? "Sin agrupación" : "Grupo " + (Number(c.cluster_id) + 1)} · ${num(c.area_ha)} ha</h3>
    <p>Sin diagnóstico causal validado.</p><span>Puntuación relativa: ${num(c.suitability_mean)}</span></div>`).join("");
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
