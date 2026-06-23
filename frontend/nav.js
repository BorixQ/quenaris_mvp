/* ===========================================================================
 * Navegación compartida. Inyecta la barra superior y marca el enlace activo.
 * Requiere auth.js cargado antes (usa logout()).
 * Uso: <body><div id="nav" data-active="geoanalisis"></div> ... <script src="nav.js">
 * ========================================================================= */
(function renderNav() {
  const holder = document.getElementById("nav");
  if (!holder) return;
  const active = holder.dataset.active || "";

  const items = [
    { id: "inicio", label: "Inicio", href: "inicio.html", icon: "⌂" },
    { id: "geoanalisis", label: "Geoanálisis", href: "geoanalisis.html", icon: "◎" },
    { id: "informes", label: "Informes", href: "informes.html", icon: "▤" },
    { id: "3d", label: "Vista 3D", href: "viewer3d.html", icon: "⬢" },
  ];

  holder.className = "nav";
  holder.innerHTML = `
    <div class="brand"><a href="inicio.html" style="color:inherit; text-decoration:none;"><span class="logo">▲</span> TERRANODE</a></div>
    <div class="links">
      ${items.map(i => `
        <a href="${i.href}" class="${i.id === active ? "active" : ""}">
          <span aria-hidden="true">${i.icon}</span>${i.label}
        </a>`).join("")}
    </div>
    <div class="spacer"></div>
    ${active === "geoanalisis" ? '<div id="navQuota" style="font-family:var(--font-mono); font-size:11px; color:var(--muted); display:flex; align-items:center; gap:12px; margin-right:16px;"></div>' : ''}
    <a href="perfil.html" class="btn-out" style="text-decoration:none; display:flex; align-items:center; gap:6px;"><span>👤</span> PERFIL</a>
  `;


  window.refreshQuota = function() {
    if (typeof getToken === "function" && getToken()) {
      fetch(`${typeof API !== 'undefined' ? API : '/api'}/auth/quota/`, { headers: authHeaders() })
        .then(res => res.json())
        .then(quota => {
          if (quota.analyses_allowed !== undefined && active === "geoanalisis") {
            const quotaDiv = document.getElementById("navQuota");
            if (quotaDiv) {
              quotaDiv.innerHTML = `
                <span>Análisis usados: <b style="color:var(--cyan)">${quota.analyses_used}</b> de ${quota.analyses_allowed} (Área máx: ${quota.max_area_ha}ha)</span>
                <a href="https://facebook.com" target="_blank" class="btn" style="padding:4px 8px; font-size:10px; margin:0; border-radius:4px; text-decoration:none;">▸ AMPLIAR</a>
              `;
            }
          }
        })
        .catch(err => console.error("Error al cargar cuotas:", err));
    }
  };

  // Llamar inicialmente
  window.refreshQuota();
})();
