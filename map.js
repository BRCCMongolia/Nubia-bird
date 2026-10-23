// Nubia Bird: нислэгийн зам зурах газрын зураг. Тор (дэвтрийн зураг) ба хиймэл дагуулын зураг, нэг товчоор солино.
"use strict";

const SAT_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/* opts: {pts, onChange, track, me, heat:[[cell,count]], readonly, mode, rotatable, onTap, follow, marks} — pts нь торын зургийн пиксел [x,y].
   onTap(px): товшилтыг цэг тавихын оронд гадагш дамжуулна (хялбар бүртгэл). follow: зураг GPS-ийн цэгийг дагаж төвлөрнө, гараар гүйлгэвэл түр зогсоно.
   Тор горимд хоёр хуруугаар томруулж, нэг хуруугаар гүйлгэнэ; нэг товшилт цэг тавина. rot: торыг 90° эргүүлж хэвтээгээр харуулна. */
function PathMap(el, opts) {
  const st = Object.assign({ pts: [], track: [], me: null, heat: null, readonly: false, rotatable: false, rot: false, onTap: null, follow: false, marks: [], mode: localStorage.getItem("mapMode") || "grid" }, opts);
  const OW = () => st.rot ? GRID.h : GRID.w, OH = () => st.rot ? GRID.w : GRID.h; // эргүүлсний дараах гадна хэмжээ
  let vb = { x: 0, y: 0, w: OW(), h: OH() }, leaf = null, layers = {};
  el.classList.add("map");
  const live = () => !st.readonly || st.onTap; // товшилт хүлээн авах эсэх

  function tools() {
    return `<div class="maptools">
      ${st.mode === "grid" ? `<button type="button" data-z="1" aria-label="Томруулах">＋</button><button type="button" data-z="-1" aria-label="Жижигрүүлэх">－</button>` : ""}
      ${st.mode === "grid" && st.rotatable ? `<button type="button" data-rot aria-pressed="${st.rot}">⟳ Хэвтээ</button>` : ""}
      ${st.onTap ? `<button type="button" data-follow aria-pressed="${st.follow}">◎ Намайг дага</button>` : ""}
      <button type="button" data-m="grid" aria-pressed="${st.mode === "grid"}">Тор</button>
      <button type="button" data-m="sat" aria-pressed="${st.mode === "sat"}">Хиймэл дагуул</button></div>`;
  }
  function arrowsSvg(P) {
    let s = "";
    for (let i = 1; i < P.length; i++) {
      const [x1, y1] = P[i - 1], [x2, y2] = P[i], a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      s += `<path d="M-13,-11 L13,0 L-13,11 Z" fill="#c8102e" stroke="#fff" stroke-width="2.5" transform="translate(${mx},${my}) rotate(${a})"/>`;
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
    const lbl = (x, y) => st.rot ? ` transform="rotate(-90 ${x} ${y})"` : ""; // эргүүлсэн үед дугаарыг босоо байлгана
    return `<svg viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" role="img" aria-label="Аэродромын тор зураг"${st.fill ? ` preserveAspectRatio="xMidYMid slice"` : ""}${live() ? ` style="touch-action:none"` : ""}><g class="inner"${st.rot ? ` transform="translate(${GRID.h},0) rotate(90)"` : ""}>
      <image href="img/grid.jpg" width="${GRID.w}" height="${GRID.h}"/>${heat}
      ${T.length > 1 ? `<polyline points="${T.map(p => p.join(",")).join(" ")}" fill="none" stroke="#2a5aa6" stroke-width="4" stroke-opacity=".7" stroke-dasharray="10 6"/>` : ""}
      ${P.length > 1 ? `<polyline points="${P.map(p => p.join(",")).join(" ")}" fill="none" stroke="#c8102e" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>${arrowsSvg(P)}` : ""}
      ${P.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i ? 9 : 13}" fill="${i ? "#fff" : "#c8102e"}" stroke="#c8102e" stroke-width="4"/><text x="${p[0] + 14}" y="${p[1] - 12}"${lbl(p[0] + 14, p[1] - 12)} font-size="26" font-weight="700" fill="#c8102e" stroke="#fff" stroke-width="6" paint-order="stroke">${i + 1}</text>`).join("")}
      ${st.marks.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="11" fill="#f39c12" stroke="#fff" stroke-width="4"/>`).join("")}
      ${me ? `<circle cx="${me[0]}" cy="${me[1]}" r="10" fill="#2a5aa6" stroke="#fff" stroke-width="4"/>` : ""}
    </g></svg>`;
  }
  // GPS цэгийг төвд байлгана (эргүүлсэн бол inner-ийн хувиргалтыг тооцно)
  function center() {
    if (!st.follow || !st.me) return;
    if (st.mode !== "grid") { if (leaf) leaf.setView(st.me, Math.max(leaf.getZoom(), 16), { animate: false }); return; }
    const [x, y] = Geo.llToPx(st.me), cx = st.rot ? GRID.h - y : x, cy = st.rot ? x : y;
    const w = vb.w >= OW() ? Math.min(OW(), 700) : vb.w, h = w * OH() / OW();
    vb = { x: clamp(cx - w / 2, 0, OW() - w), y: clamp(cy - h / 2, 0, OH() - h), w, h };
  }
  function setFollow(on) { st.follow = on; $(".maptools [data-follow]", el)?.setAttribute("aria-pressed", on); st.onFollow?.(on); }
  function render() {
    if (leaf) { leaf.remove(); leaf = null; }
    if (st.mode === "grid") { center(); el.innerHTML = svg() + tools(); bindGrid(); }
    else { el.innerHTML = `<div class="leaf"></div>` + tools(); initLeaf(); }
    $$(".maptools [data-m]", el).forEach(b => b.onclick = e => { e.stopPropagation(); st.mode = b.dataset.m; localStorage.setItem("mapMode", st.mode); render(); });
    $$(".maptools [data-z]", el).forEach(b => b.onclick = e => { e.stopPropagation(); zoom(+b.dataset.z > 0 ? .6 : 1 / .6); });
    $(".maptools [data-follow]", el)?.addEventListener("click", e => { e.stopPropagation(); setFollow(true); if (st.mode === "grid") render(); else center(); });
    $(".maptools [data-rot]", el)?.addEventListener("click", e => { e.stopPropagation(); st.rot = !st.rot; vb = { x: 0, y: 0, w: OW(), h: OH() }; render(); });
  }
  // f < 1 томруулна. (cx, cy) цэг дэлгэц дээр байрандаа үлдэнэ.
  function zoom(f, cx, cy, from = vb) {
    cx ??= from.x + from.w / 2; cy ??= from.y + from.h / 2;
    const w = Math.min(OW(), Math.max(200, from.w * f)), h = w * OH() / OW();
    vb = { x: clamp(cx - (cx - from.x) * w / from.w, 0, OW() - w), y: clamp(cy - (cy - from.y) * h / from.h, 0, OH() - h), w, h };
    $("svg", el).setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function bindGrid() {
    const s = $("svg", el), g = $(".inner", s), ptrs = new Map();
    let down = null, moved = false, pinch = null, multi = false;
    const at = (node, x, y) => { const p = s.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(node.getScreenCTM().inverse()); };
    const two = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    s.addEventListener("pointerdown", e => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) { down = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false; multi = false; }
      if (ptrs.size === 2) { const t = two(), q = at(s, t.mx, t.my); pinch = { d: t.d, vb: { ...vb }, q }; multi = true; }
    });
    s.addEventListener("pointermove", e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size >= 2) { const t = two(); if (st.follow) setFollow(false); if (t.d > 10) zoom(pinch.d / t.d, pinch.q.x, pinch.q.y, pinch.vb); return; }
      if (!down || multi) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 8) moved = true;
      if (moved && st.follow) setFollow(false);
      if (moved && vb.w < OW()) {
        const k = 1 / s.getScreenCTM().a;
        vb.x = clamp(down.vb.x - dx * k, 0, OW() - vb.w); vb.y = clamp(down.vb.y - dy * k, 0, OH() - vb.h);
        s.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
      }
    });
    const up = e => {
      if (!ptrs.delete(e.pointerId)) return;
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 1) { const [p] = [...ptrs.values()]; down = { x: p.x, y: p.y, vb: { ...vb } }; moved = true; } // хоёр хуруунаас нэгд шилжихэд цэг тавихгүй
      if (ptrs.size) return;
      const tap = down && !moved && !multi && e.type === "pointerup"; down = null;
      if (!tap || !live()) return;
      const q = at(g, e.clientX, e.clientY);
      if (q.x < GRID.x0 || q.y < GRID.y0 || q.x > GRID.w || q.y > GRID.h) return;
      if (st.onTap) return st.onTap([Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]);
      st.pts.push([Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]); st.onChange?.(st.pts); render();
    };
    s.addEventListener("pointerup", up); s.addEventListener("pointercancel", up);
    s.addEventListener("dblclick", e => { e.preventDefault(); const q = at(s, e.clientX, e.clientY); zoom(.6, q.x, q.y); });
  }
  function initLeaf() {
    if (!window.L) { el.innerHTML = `<div class="empty">Газрын зургийн сан ачаалагдсангүй.</div>` + tools(); return; }
    const box = $(".leaf", el);
    leaf = L.map(box, { zoomControl: true, attributionControl: true, tap: true }).setView(ARP, 14);
    leaf.attributionControl.setPrefix(false); // «Leaflet» холбоос дээр санамсаргүй дарж аппаас гарахгүй
    L.tileLayer(SAT_URL, { maxZoom: 19, maxNativeZoom: 18, crossOrigin: true, attribution: "Esri World Imagery" }).addTo(leaf);
    // 200 м-ийн тор
    const g = L.layerGroup().addTo(leaf), x1 = GRID.x0 + GRID.cols * GRID.cw, y1 = GRID.y0 + GRID.rows.length * GRID.ch;
    for (let c = 0; c <= GRID.cols; c++) { const x = GRID.x0 + c * GRID.cw; L.polyline([Geo.pxToLL([x, GRID.y0]), Geo.pxToLL([x, y1])], { color: "#fff", weight: 1, opacity: .55, interactive: false }).addTo(g); }
    for (let r = 0; r <= GRID.rows.length; r++) { const y = GRID.y0 + r * GRID.ch; L.polyline([Geo.pxToLL([GRID.x0, y]), Geo.pxToLL([x1, y])], { color: "#fff", weight: 1, opacity: .55, interactive: false }).addTo(g); }
    for (let c = 1; c <= GRID.cols; c++) L.marker(Geo.pxToLL([GRID.x0 + (c - .5) * GRID.cw, GRID.y0 + GRID.ch * .3]), { icon: L.divIcon({ className: "glabel", html: c }), interactive: false }).addTo(g);
    L.polygon([[GRID.x0, GRID.y0], [x1, GRID.y0], [x1, y1], [GRID.x0, y1]].map(p => Geo.pxToLL(p)), { color: "#ffd23f", weight: 3, fill: false, interactive: false }).addTo(g); // торын хүрээ
    GRID.rows.forEach((r, i) => L.marker(Geo.pxToLL([GRID.x0 + GRID.cw * .3, GRID.y0 + (i + .5) * GRID.ch]), { icon: L.divIcon({ className: "glabel", html: r }), interactive: false }).addTo(g));
    layers.path = L.layerGroup().addTo(leaf);
    drawLeaf();
    if (st.heat) st.heat.forEach(([c, n, max]) => {
      const r = GRID.rows.indexOf(c[0]), k = +c.slice(1) - 1; if (r < 0) return;
      const x = GRID.x0 + k * GRID.cw, y = GRID.y0 + r * GRID.ch;
      L.polygon([[x, y], [x + GRID.cw, y], [x + GRID.cw, y + GRID.ch], [x, y + GRID.ch]].map(p => Geo.pxToLL(p)), { color: "#c8102e", weight: 0, fillOpacity: .18 + .55 * n / max, interactive: false }).addTo(leaf);
    });
    const ll = st.pts.map(p => Geo.pxToLL(p)).concat(st.track);
    if (st.follow && st.me) center();
    else if (ll.length) leaf.fitBounds(L.latLngBounds(ll).pad(.4), { maxZoom: 17 });
    leaf.on("dragstart", () => { if (st.follow) setFollow(false); });
    if (st.onTap) leaf.on("click", e => st.onTap(Geo.llToPx([e.latlng.lat, e.latlng.lng]).map(v => Math.round(v * 10) / 10)));
    else if (!st.readonly) leaf.on("click", e => { st.pts.push(Geo.llToPx([e.latlng.lat, e.latlng.lng]).map(v => Math.round(v * 10) / 10)); st.onChange?.(st.pts); drawLeaf(); });
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
    st.marks.forEach(p => L.circleMarker(Geo.pxToLL(p), { radius: 7, color: "#fff", weight: 2, fillColor: "#f39c12", fillOpacity: 1, interactive: false }).addTo(lg));
    if (st.me) L.circleMarker(st.me, { radius: 8, color: "#fff", weight: 3, fillColor: "#2a5aa6", fillOpacity: 1 }).addTo(lg);
  }
  render();
  return {
    set(p) { Object.assign(st, p); if (st.mode === "grid") render(); else if (leaf) { drawLeaf(); center(); } },
    undo() { st.pts.pop(); st.onChange?.(st.pts); render(); },
    clear() { st.pts.length = 0; st.onChange?.(st.pts); render(); },
    destroy() { if (leaf) leaf.remove(); }
  };
}
