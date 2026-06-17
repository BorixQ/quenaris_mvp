/* ===========================================================================
 * Informes — render del informe geoespacial estilo ejecutivo.
 * Portada de empresa + ficha del AOI + resumen + KPIs + informe del LLM
 * (markdown compilado con marked.js). Selector entre los análisis del usuario.
 * ========================================================================= */

const qs = new URLSearchParams(location.search);
let selectedId = qs.get("id");

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
       ${a.name ? a.name + " · " : ""}${fmtDate(a.created_at)} · ${a.area_ha} ha
     </option>`).join("");
  document.getElementById("picker").innerHTML = `
    <label style="font-size:13px; color:var(--muted);">Mis análisis:</label>
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

      <div class="section-title">◴ Resumen ejecutivo
        <span class="badge ai" style="margin-left:8px;">Auto-generado por IA</span>
      </div>
      <div class="summary">${execSummary(st)}</div>

      <div class="section-title">▦ Indicadores clave</div>
      <div class="kpis">
        <div class="kpi"><div class="lbl">Aptitud media</div><div class="val">${num(st.suitability_global_mean)}<span style="font-size:14px;color:var(--muted)">/100</span></div></div>
        <div class="kpi"><div class="lbl">Área total</div><div class="val">${num(st.total_area_ha)} ha</div></div>
        <div class="kpi"><div class="lbl">Hectáreas prioritarias</div><div class="val">${priorityHa(st)} ha</div></div>
        <div class="kpi"><div class="lbl">Zonas detectadas</div><div class="val">${st.n_clusters ?? "—"}</div></div>
      </div>

      <div class="section-title">▥ Zonas por prioridad</div>
      ${zonesTable(st)}

      <div class="section-title">◷ Gráficas</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px;">
        <div class="card pad"><b style="font-size:13px;">Distribución de prioridad (ha)</b>
          <canvas id="chPrio" height="170"></canvas></div>
        <div class="card pad"><b style="font-size:13px;">Aptitud por zona</b>
          <canvas id="chSuit" height="170"></canvas></div>
        <div class="card pad"><b style="font-size:13px;">Perfil de índices por zona</b>
          <canvas id="chRadar" height="170"></canvas></div>
        <div class="card pad"><b style="font-size:13px;">Evolución de la aptitud media</b>
          <canvas id="chTime" height="170"></canvas></div>
      </div>

      <div class="section-title">▤ Informe detallado</div>
      <div class="md">${reportHtml}</div>

      <hr style="border:none; border-top:1px solid var(--line); margin:24px 0 12px;">
      <p class="hint">
        Generado por Terranode · Sentinel-2 (${st.satellite_collection || "COPERNICUS/S2_SR_HARMONIZED"}).
        Documento de carácter técnico-orientativo. <a href="viewer3d.html?id=${a.id}">Ver en 3D ⬢</a>
      </p>
    </div>`;

  document.getElementById("jsonBtn").onclick = () => downloadJSON(a);
  renderCharts(st, r.heatmap_layers);
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
    data: { labels: order.filter(k => pd[k]), datasets: [{
      data: order.filter(k => pd[k]).map(k => pd[k]),
      backgroundColor: order.filter(k => pd[k]).map(k => pcol[k]) }] },
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

  // 3. Perfil de índices por zona (radar normalizado)
  const axes = [["ndvi_mean","NDVI"],["ndmi_mean","NDMI"],["bsi_mean","Suelo"],
                ["slope_mean_deg","Pendiente"],["solar_mean","Solar"]];
  const norm = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const ranges = { ndvi_mean:[-0.2,0.9], ndmi_mean:[-0.3,0.5], bsi_mean:[0.5,-0.5],
                   slope_mean_deg:[40,0], solar_mean:[0,1] };
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
          borderColor: "#1f7a3d", backgroundColor: hexA("#1f7a3d", .12), fill: true, tension: .3 }] },
      options: { scales: { y: { beginAtZero: true, max: 100 } } },
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

function zonesTable(st) {
  if (!st.clusters) return "";
  const rows = st.clusters.map(c => `
    <tr>
      <td>${c.label || "—"}</td>
      <td><span class="badge" style="background:${PRIO_COLOR[c.priority] || "#888"}22;color:${PRIO_COLOR[c.priority] || "#555"}">${c.priority}</span></td>
      <td>${num(c.suitability_mean)}/100</td>
      <td>${num(c.area_ha)} ha</td>
      <td>${num(c.ndvi_mean)}</td>
      <td>${num(c.ndmi_mean)}</td>
    </tr>`).join("");
  return `<table class="md" style="width:100%;border-collapse:collapse;">
    <thead><tr>
      <th>Zona</th><th>Prioridad</th><th>Aptitud</th><th>Área</th><th>NDVI</th><th>NDMI</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
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
