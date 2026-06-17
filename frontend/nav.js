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
    <div class="brand"><span class="logo">▲</span> TERRANODE</div>
    <div class="links">
      ${items.map(i => `
        <a href="${i.href}" class="${i.id === active ? "active" : ""}">
          <span aria-hidden="true">${i.icon}</span>${i.label}
        </a>`).join("")}
    </div>
    <div class="spacer"></div>
    <span class="sys"><span class="dot"></span>SYS · ONLINE</span>
    <button class="btn-out" id="navLogout">⎋ SALIR</button>
  `;
  const out = document.getElementById("navLogout");
  if (out) out.addEventListener("click", () => (typeof logout === "function" ? logout() : null));
})();
