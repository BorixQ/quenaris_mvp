/* ===========================================================================
 * Auth compartida — guarda el Token DRF en sessionStorage y construye cabeceras.
 * Se incluye ANTES de dashboard.js y viewer3d.js.
 * ========================================================================= */
const API = "/api";
const TOKEN_KEY = "gi_token";
// Retire indefinitely stored legacy credentials; users sign in once again.
localStorage.removeItem(TOKEN_KEY);
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g,c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
// Never send authentication to third-party imagery or arbitrary URLs.
function privateMapRequest(url) {
  const target = new URL(url, location.href);
  if (target.origin === location.origin && target.pathname.startsWith("/media/heatmaps/")) {
    return {url:target.href,headers:authHeaders(),credentials:"omit"};
  }
  return {url};
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(t) {
  sessionStorage.setItem(TOKEN_KEY, t);
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

async function logout() {
  try { await fetch(`${API}/auth/logout/`, {method:"POST",headers:authHeaders()}); }
  finally { sessionStorage.removeItem(TOKEN_KEY); location.href = "login.html"; }
}

// Parsea JSON con seguridad: si el servidor devuelve HTML (404/500/proxy caído),
// lanza un mensaje legible en vez del críptico "Unexpected token '<'".
async function jsonOrThrow(res) {
  // Token ausente, inválido o caducado: limpia y manda al login (auto-recuperación).
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
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
