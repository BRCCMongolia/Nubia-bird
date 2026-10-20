// Nubia Bird: нислэгийн зам зурах газрын зураг. Тор (дэвтрийн зураг) ба хиймэл дагуулын зураг, нэг товчоор солино.
"use strict";

const SAT_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/* opts: {pts, onChange, track, me, heat:[[cell,count]], readonly, mode} — pts нь торын зургийн пиксел [x,y]. */
function PathMap(el, opts) {
  const st = Object.assign({ pts: [], track: [], me: null, heat: null, readonly: false, mode: localStorage.getItem("mapMode") || "grid" }, opts);
  let vb = { x: 0, y: 0, w: GRID.w, h: GRID.h }, leaf = null, layers = {};
  el.classList.add("map");

  function tools() {
    return `<div class="maptools">
      ${st.mode === "grid" ? `<button type="button" data-z="1" aria-label="Томруулах">＋</button><button type="button" data-z="-1" aria-label="Жижигрүүлэх">－</button>` : ""}
      <button type="button" data-m="grid" aria-pressed="${st.mode === "grid"}">Тор</button>
      <button type="button" data-m="sat" aria-pressed="${st.mode === "sat"}">Хиймэл дагуул</button></div>`;
  }
  function arrowsSvg(P) {
    let s = "";
    for (let i = 1; i < P.length; i++) {
      const [x1, y1] = P[i - 1], [x2, y2] = P[i], a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      s += `<path d="M-9,-8 L9,0 L-9,8 Z" fill="#c8102e" transform="translate(${mx},${my}) rotate(${a})"/>`;
    }
    return s;
  }
  function svg() {
    const P = st.pts, T = st.track.map(ll => Geo.llToPx(ll));
    const heat = st.heat ? st.heat.map(([c, n, max]) => {
      const r = GRID.rows.indexOf(c[0]), k = +c.slice(1) - 1; if (r < 0) return "";
      return `<rect x="${GRID.x0 + k * GRID.cw}" y="${GRID.y0 + r * GRID.ch}" width="${GRID.cw}" height="${GRID.ch}" fill="#c8102e" fill-opacity="${(.18 + .62 * n / max).toFixed(2)}"/>`;
    }).join("") : "";
    const me = st.me ? Geo.llToPx(st.me) : null;
    return `<svg viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" role="img" aria-label="Аэродромын тор зураг">
      <image href="img/grid.jpg" width="${GRID.w}" height="${GRID.h}"/>${heat}
      ${T.length > 1 ? `<polyline points="${T.map(p => p.join(",")).join(" ")}" fill="none" stroke="#2a5aa6" stroke-width="4" stroke-opacity=".7" stroke-dasharray="10 6"/>` : ""}
      ${P.length > 1 ? `<polyline points="${P.map(p => p.join(",")).join(" ")}" fill="none" stroke="#c8102e" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>${arrowsSvg(P)}` : ""}
      ${P.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i ? 9 : 13}" fill="${i ? "#fff" : "#c8102e"}" stroke="#c8102e" stroke-width="4"/><text x="${p[0] + 14}" y="${p[1] - 12}" font-size="26" font-weight="700" fill="#c8102e" stroke="#fff" stroke-width="6" paint-order="stroke">${i + 1}</text>`).join("")}
      ${me ? `<circle cx="${me[0]}" cy="${me[1]}" r="10" fill="#2a5aa6" stroke="#fff" stroke-width="4"/>` : ""}
    </svg>`;
  }
  function render() {
    if (leaf) { leaf.remove(); leaf = null; }
    if (st.mode === "grid") { el.innerHTML = svg() + tools(); bindGrid(); }
    else { el.innerHTML = `<div class="leaf"></div>` + tools(); initLeaf(); }
    $$(".maptools [data-m]", el).forEach(b => b.onclick = e => { e.stopPropagation(); st.mode = b.dataset.m; localStorage.setItem("mapMode", st.mode); render(); });
    $$(".maptools [data-z]", el).forEach(b => b.onclick = e => { e.stopPropagation(); zoom(+b.dataset.z > 0 ? .6 : 1 / .6); });
  }
  function zoom(f, cx, cy) {
    cx ??= vb.x + vb.w / 2; cy ??= vb.y + vb.h / 2;
    const w = Math.min(GRID.w, Math.max(200, vb.w * f)), h = w * GRID.h / GRID.w;
    vb = { x: clamp(cx - w / 2, 0, GRID.w - w), y: clamp(cy - h / 2, 0, GRID.h - h), w, h };
    $("svg", el).setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function bindGrid() {
    const s = $("svg", el); let down = null, moved = false;
    const toSvg = e => { const p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(s.getScreenCTM().inverse()); };
    s.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false; });
    s.addEventListener("pointermove", e => {
      if (!down || vb.w >= GRID.w) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 8) moved = true;
      if (moved) {
        const k = vb.w / s.getBoundingClientRect().width;
        vb.x = clamp(down.vb.x - dx * k, 0, GRID.w - vb.w); vb.y = clamp(down.vb.y - dy * k, 0, GRID.h - vb.h);
        s.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
      }
    });
    s.addEventListener("pointerup", e => {
      if (!down) return; const wasMoved = moved; down = null;
      if (wasMoved || st.readonly) return;
      const q = toSvg(e);
      if (q.x < GRID.x0 || q.y < GRID.y0) return;
      st.pts.push([Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]); st.onChange?.(st.pts); render();
    });
    s.addEventListener("dblclick", e => { e.preventDefault(); const q = toSvg(e); zoom(.6, q.x, q.y); });
  }
  function initLeaf() {
    if (!window.L) { el.innerHTML = `<div class="empty">Газрын зургийн сан ачаалагдсангүй.</div>` + tools(); return; }
    const box = $(".leaf", el);
    leaf = L.map(box, { zoomControl: true, attributionControl: true, tap: true }).setView(ARP, 14);
    L.tileLayer(SAT_URL, { maxZoom: 19, maxNativeZoom: 18, crossOrigin: true, attribution: "Esri World Imagery" }).addTo(leaf);
    // 200 м-ийн тор
    const g = L.layerGroup().addTo(leaf), x1 = GRID.x0 + GRID.cols * GRID.cw, y1 = GRID.y0 + GRID.rows.length * GRID.ch;
    for (let c = 0; c <= GRID.cols; c++) { const x = GRID.x0 + c * GRID.cw; L.polyline([Geo.pxToLL([x, GRID.y0]), Geo.pxToLL([x, y1])], { color: "#fff", weight: 1, opacity: .55, interactive: false }).addTo(g); }
    for (let r = 0; r <= GRID.rows.length; r++) { const y = GRID.y0 + r * GRID.ch; L.polyline([Geo.pxToLL([GRID.x0, y]), Geo.pxToLL([x1, y])], { color: "#fff", weight: 1, opacity: .55, interactive: false }).addTo(g); }
    for (let c = 1; c <= GRID.cols; c++) L.marker(Geo.pxToLL([GRID.x0 + (c - .5) * GRID.cw, GRID.y0 + GRID.ch * .3]), { icon: L.divIcon({ className: "glabel", html: c }), interactive: false }).addTo(g);
    GRID.rows.forEach((r, i) => L.marker(Geo.pxToLL([GRID.x0 + GRID.cw * .3, GRID.y0 + (i + .5) * GRID.ch]), { icon: L.divIcon({ className: "glabel", html: r }), interactive: false }).addTo(g));
    layers.path = L.layerGroup().addTo(leaf);
    drawLeaf();
    if (st.heat) st.heat.forEach(([c, n, max]) => {
      const r = GRID.rows.indexOf(c[0]), k = +c.slice(1) - 1; if (r < 0) return;
      const x = GRID.x0 + k * GRID.cw, y = GRID.y0 + r * GRID.ch;
      L.polygon([[x, y], [x + GRID.cw, y], [x + GRID.cw, y + GRID.ch], [x, y + GRID.ch]].map(p => Geo.pxToLL(p)), { color: "#c8102e", weight: 0, fillOpacity: .18 + .55 * n / max, interactive: false }).addTo(leaf);
    });
    const ll = st.pts.map(p => Geo.pxToLL(p)).concat(st.track);
    if (ll.length) leaf.fitBounds(L.latLngBounds(ll).pad(.4), { maxZoom: 17 });
    if (!st.readonly) leaf.on("click", e => { st.pts.push(Geo.llToPx([e.latlng.lat, e.latlng.lng]).map(v => Math.round(v * 10) / 10)); st.onChange?.(st.pts); drawLeaf(); });
    setTimeout(() => leaf && leaf.invalidateSize(), 50);
  }
  function drawLeaf() {
    const lg = layers.path; lg.clearLayers();
    if (st.track.length > 1) L.polyline(st.track, { color: "#7ea5e4", weight: 4, dashArray: "8 6" }).addTo(lg);
    const P = st.pts.map(p => Geo.pxToLL(p));
    if (P.length > 1) {
      L.polyline(P, { color: "#ff4d5e", weight: 5 }).addTo(lg);
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i], ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
        L.marker(Geo.pxToLL([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), { interactive: false, icon: L.divIcon({ className: "", iconSize: [18, 18], iconAnchor: [9, 9], html: `<svg width="18" height="18" viewBox="-9 -9 18 18" style="transform:rotate(${ang}deg)"><path d="M-8,-7 L8,0 L-8,7 Z" fill="#ff4d5e" stroke="#fff" stroke-width="1.5"/></svg>` }) }).addTo(lg);
      }
    }
    P.forEach((p, i) => L.circleMarker(p, { radius: i ? 6 : 9, color: "#ff4d5e", weight: 3, fillColor: i ? "#fff" : "#ff4d5e", fillOpacity: 1 }).bindTooltip(String(i + 1), { permanent: true, direction: "right", className: "ptlabel" }).addTo(lg));
    if (st.me) L.circleMarker(st.me, { radius: 8, color: "#fff", weight: 3, fillColor: "#2a5aa6", fillOpacity: 1 }).addTo(lg);
  }
  render();
  return {
    set(p) { Object.assign(st, p); if (st.mode === "grid") render(); else if (leaf) drawLeaf(); },
    undo() { st.pts.pop(); st.onChange?.(st.pts); render(); },
    clear() { st.pts.length = 0; st.onChange?.(st.pts); render(); },
    destroy() { if (leaf) leaf.remove(); }
  };
}
