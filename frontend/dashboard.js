/* ===========================================================================
 * Dashboard 2D — dibujo del AOI, envío asíncrono y polling del resultado.
 * El POST devuelve 202 + id; hacemos polling hasta status COMPLETED/FAILED.
 * ========================================================================= */

// API y cabeceras de auth provienen de auth.js (incluido antes que este script).

const map = new maplibregl.Map({
  container: "map",
  // Imagery satelital de Esri (gratuita, sin API key). Ayuda a ubicar el AOI.
  style: {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      },
      // Etiquetas de lugares/calles superpuestas para orientarse mejor.
      labels: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [
      { id: "satellite", type: "raster", source: "satellite" },
      { id: "labels", type: "raster", source: "labels" },
    ],
  },
  center: [-72.0, -37.5],
  zoom: 9,
});

// --- Compatibilidad mapbox-gl-draw <-> MapLibre v4 -------------------------
// mapbox-gl-draw emite controles con clases CSS "mapboxgl-ctrl-*"; MapLibre usa
// el prefijo "maplibregl-ctrl-*". Sin este shim el botón sale sin estilo y no
// responde al clic. Hay que reescribir las constantes ANTES de instanciar.
MapboxDraw.constants.classes.CONTROL_BASE   = "maplibregl-ctrl";
MapboxDraw.constants.classes.CONTROL_PREFIX = "maplibregl-ctrl-";
MapboxDraw.constants.classes.CONTROL_GROUP  = "maplibregl-ctrl-group";

// Herramienta de dibujo de polígonos
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: true, trash: true },
});
map.addControl(draw, "top-right");
map.addControl(new maplibregl.NavigationControl());

let currentAOI = null;
const runBtn = document.getElementById("run");

function onDrawChange() {
  const data = draw.getAll();
  if (data.features.length > 0) {
    // Conservar solo el último polígono dibujado
    currentAOI = data.features[data.features.length - 1].geometry;
    runBtn.disabled = false;
  } else {
    currentAOI = null;
    runBtn.disabled = true;
  }
}
map.on("draw.create", onDrawChange);
map.on("draw.update", onDrawChange);
map.on("draw.delete", onDrawChange);

// --- Envío + polling -------------------------------------------------------
runBtn.addEventListener("click", async () => {
  if (!currentAOI) return;

  const body = {
    aoi: currentAOI, // GeoJSON Polygon — DRF-GIS lo acepta directamente
    date_start: document.getElementById("dateStart").value,
    date_end: document.getElementById("dateEnd").value,
    algorithm: document.getElementById("algorithm").value,
    n_clusters: parseInt(document.getElementById("nClusters").value, 10),
  };

  setBusy(true, "Enviando petición…");
  try {
    const res = await fetch(`${API}/analyses/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const job = await jsonOrThrow(res);   // lanza mensaje claro si no es JSON / no-ok
    pollResult(job.id);
  } catch (e) {
    setBusy(false, "Error: " + e.message);
  }
});

async function pollResult(id) {
  setBusy(true, "Procesando en segundo plano (GEE + clustering + informe)…");
  const interval = setInterval(async () => {
    const res = await fetch(`${API}/analyses/${id}/`, { headers: authHeaders() });
    let data;
    try {
      data = await jsonOrThrow(res);
    } catch (e) {
      clearInterval(interval);
      setBusy(false, "Error: " + e.message);
      return;
    }

    if (data.status === "COMPLETED") {
      clearInterval(interval);
      setBusy(false, "Análisis completado.");
      renderClusters(data.result.clusters_geojson);
      renderReport(data.result.report_markdown);
      showActions(id);
    } else if (data.status === "FAILED") {
      clearInterval(interval);
      setBusy(false, "Falló: " + data.error_message);
    } else {
      document.getElementById("status").textContent = "Estado: " + data.status + "…";
    }
  }, 4000);
}

// --- Render de los clusters en el mapa 2D ----------------------------------
const PALETTE = {
  zona_degradada: "#b5651d", zona_estresada: "#d9a441",
  vegetacion_moderada: "#9acd32", vegetacion_saludable: "#3c9a3c",
  vegetacion_densa: "#1f7a3d", bosque_maduro: "#0b3d1f",
};

function renderClusters(geojson) {
  if (map.getSource("clusters")) {
    map.getSource("clusters").setData(geojson);
    return;
  }
  map.addSource("clusters", { type: "geojson", data: geojson });
  map.addLayer({
    id: "clusters-fill",
    type: "fill",
    source: "clusters",
    paint: {
      "fill-color": [
        "match", ["get", "label"],
        ...Object.entries(PALETTE).flat(),
        "#888",
      ],
      "fill-opacity": 0.55,
    },
  });
  map.addLayer({
    id: "clusters-outline", type: "line", source: "clusters",
    paint: { "line-color": "#222", "line-width": 1 },
  });

  // Zoom al resultado
  const b = new maplibregl.LngLatBounds();
  geojson.features.forEach(f => addCoords(f.geometry, b));
  map.fitBounds(b, { padding: 40 });
}

function addCoords(geom, bounds) {
  const walk = (c) => Array.isArray(c[0]) ? c.forEach(walk) : bounds.extend(c);
  walk(geom.coordinates);
}

function renderReport(md) {
  document.getElementById("report").textContent = md || "(Sin informe generado)";
}

function showActions(id) {
  document.getElementById("actions").innerHTML =
    `<a href="viewer3d.html?id=${id}" target="_blank">→ Abrir vista 3D histórica</a>`;
}

function setBusy(busy, msg) {
  document.getElementById("spinner").style.display = busy ? "block" : "none";
  document.getElementById("status").textContent = msg || "";
  runBtn.disabled = busy || !currentAOI;
}
