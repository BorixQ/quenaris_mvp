/* ===========================================================================
 * Auth compartida — guarda el Token DRF en localStorage y construye cabeceras.
 * Se incluye ANTES de dashboard.js y viewer3d.js.
 * ========================================================================= */
const API = "/api";
const TOKEN_KEY = "gi_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}

// Solo adjunta la cabecera si HAY token; evita el "Token " vacío que DRF rechaza.
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: "Token " + t } : {};
}

// Llamar al cargar páginas protegidas: si no hay token, va al login.
function requireAuth() {
  if (!getToken()) location.href = "login.html";
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  location.href = "login.html";
}

// Parsea JSON con seguridad: si el servidor devuelve HTML (404/500/proxy caído),
// lanza un mensaje legible en vez del críptico "Unexpected token '<'".
async function jsonOrThrow(res) {
  // Token ausente, inválido o caducado: limpia y manda al login (auto-recuperación).
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "login.html";
    throw new Error("Sesión no válida; vuelve a iniciar sesión.");
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const txt = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    throw new Error(
      `El backend respondió ${res.status} con HTML, no JSON. ` +
      `¿Reconstruiste el contenedor y corriste migrate? Respuesta: ${txt}`
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}
