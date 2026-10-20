// Nubia Bird: дэлгэцийн жижиг хэсгүүд (сонголтын товч, доод цонх, гарын үсэг, зураг) ба GPS.
"use strict";

function toast(msg, ms = 2400) {
  let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, ms);
}

/* Сонголтын товчнууд. multi бол массив буцаана. own=true бол "Өөрөө бичих…" нэмнэ.
   search=true бол дээр нь хайх талбар гарна. ownType="number", ownSuffix=" цаг" бол тоо бичүүлнэ. */
function chips(name, opts, val, { multi = false, fill = false, own = false, labels = null, limit = 0, search = false, ownType = "", ownSuffix = "", ownLabel = "Өөрөө бичих…", ownKeep = "" } = {}) {
  const sel = v => multi ? (val || []).includes(v) : val === v;
  const customs = multi ? (val || []).filter(v => !opts.includes(v)) : (val && !opts.includes(val) ? [val] : []);
  const all = opts.concat(customs), cut = limit && all.length > limit + 2 && !all.slice(limit).some(sel);
  const lab = (v, i) => labels && labels[i] ? labels[i] : esc(v) + (i >= opts.length && ownSuffix ? esc(ownSuffix) : "");
  const html = `<div class="chips${fill ? " fill" : ""}" data-chips="${name}" data-multi="${multi ? 1 : ""}"${ownType ? ` data-own-type="${ownType}"` : ""}${ownSuffix ? ` data-own-suffix="${esc(ownSuffix)}"` : ""}${ownKeep ? ` data-own-keep="${esc(ownKeep)}"` : ""}>${all.map((v, i) => `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${sel(v)}"${cut && i >= limit ? " hidden" : ""}>${lab(v, i)}</button>`).join("")}${cut ? `<button type="button" class="chip own" data-more="1">Бусад ${all.length - limit}…</button>` : ""}${own ? `<button type="button" class="chip own" data-own="1">${esc(ownLabel)}</button>` : ""}</div>`;
  return search ? `<div class="chipfind"><input type="search" class="chipq" placeholder="Хайх…" autocomplete="off" aria-label="Хайх">${html}<div class="small nomatch" hidden>Олдсонгүй. «Өөрөө бичих» дарж нэмнэ.</div></div>` : html;
}
/* Бүх chips бүлгийг холбоно: onPick(name, value) */
function bindChips(root, onPick) {
  $$("[data-chips]", root).forEach(g => g.addEventListener("click", async e => {
    const b = e.target.closest(".chip"); if (!b) return;
    const name = g.dataset.chips, multi = !!g.dataset.multi;
    if (b.dataset.more) { $$(".chip[hidden]", g).forEach(c => c.hidden = false); b.remove(); return; }
    if (b.dataset.own) {
      const q = g.parentElement.querySelector(".chipq");
      const v = await promptText("Өөрөө бичих", q ? q.value.trim() : "", { type: g.dataset.ownType || "text", check: g.dataset.ownKeep || "" }); if (!v) return;
      if (q) { q.value = ""; q.dispatchEvent(new Event("input")); }
      const nb = document.createElement("button"); nb.type = "button"; nb.className = "chip"; nb.dataset.v = v; nb.textContent = v + (g.dataset.ownSuffix || "");
      if (promptText.checked) nb.dataset.keep = "1"; // "Цаашид жагсаалтад хадгалах" сонгосон
      g.insertBefore(nb, b); nb.click(); return;
    }
    if (multi) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
    else $$(".chip", g).forEach(c => c.setAttribute("aria-pressed", c === b));
    const value = multi ? $$('.chip[aria-pressed="true"]', g).map(c => c.dataset.v) : b.dataset.v;
    onPick(name, value, b);
  }));
  // Хайх талбар: бичсэн үсгээр товчнуудыг шүүнэ (монгол, англи нэрээр)
  $$(".chipq", root).forEach(q => q.addEventListener("input", () => {
    const g = q.nextElementSibling, t = q.value.trim().toLowerCase();
    $(".chip[data-more]", g)?.click();
    let n = 0;
    $$(".chip:not(.own)", g).forEach(c => { const on = !t || c.textContent.toLowerCase().includes(t) || c.getAttribute("aria-pressed") === "true"; c.hidden = !on; n += on; });
    q.parentElement.querySelector(".nomatch").hidden = !t || n > 0;
  }));
}

/* Доод цонх */
function openSheet(title, html, mount) {
  const scrim = document.createElement("div"); scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div><div class="head"><h2>${esc(title)}</h2><button type="button" class="x" aria-label="Хаах">✕</button></div><div class="body" style="display:grid;gap:14px">${html}</div></div>`;
  document.body.appendChild(scrim); document.body.style.overflow = "hidden";
  const close = () => { scrim.remove(); document.body.style.overflow = ""; };
  $(".x", scrim).onclick = close;
  scrim.addEventListener("click", e => { if (e.target === scrim) close(); });
  mount?.($(".body", scrim), close);
  return close;
}
function confirmBox(msg, { ok = "Тийм", cancel = "Үгүй", danger = false, alt = null } = {}) {
  return new Promise(res => {
    const scrim = document.createElement("div"); scrim.className = "scrim center";
    scrim.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><div style="font-size:17px">${msg}</div><div class="row">${alt ? `<button type="button" class="btn" data-r="alt">${esc(alt)}</button>` : ""}<button type="button" class="btn" data-r="no">${esc(cancel)}</button><button type="button" class="btn ${danger ? "d" : "p"}" data-r="yes">${esc(ok)}</button></div></div>`;
    document.body.appendChild(scrim);
    scrim.addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (!b && e.target !== scrim) return; scrim.remove(); res(b ? b.dataset.r === "yes" ? true : b.dataset.r === "alt" ? "alt" : false : false); });
  });
}
/* check өгвөл доор нь сонголт гарна; сонгосон эсэх нь promptText.checked-д үлдэнэ */
function promptText(title, val = "", { placeholder = "", type = "text", check = "" } = {}) {
  promptText.checked = false;
  return new Promise(res => {
    const scrim = document.createElement("div"); scrim.className = "scrim center";
    scrim.innerHTML = `<form class="dialog"><div style="font-weight:650;font-size:17px">${esc(title)}</div><input type="${type}" value="${esc(val)}" placeholder="${esc(placeholder)}" autocomplete="off"${type === "number" ? ' inputmode="decimal" min="1"' : ""}>${check ? `<label class="check"><span>${esc(check)}</span><input type="checkbox" class="toggle" name="keep"></label>` : ""}<div class="row"><button type="button" class="btn" data-r="no">Болих</button><button class="btn p">Болсон</button></div></form>`;
    document.body.appendChild(scrim);
    const inp = $("input", scrim); setTimeout(() => inp.focus(), 50);
    $("form", scrim).onsubmit = e => { e.preventDefault(); promptText.checked = !!$("[name=keep]", scrim)?.checked; scrim.remove(); res(inp.value.trim()); };
    $("[data-r=no]", scrim).onclick = () => { scrim.remove(); res(""); };
  });
}

/* Зураг авах: camera = "environment" (ар тал) эсвэл "user" (сэлфи) */
function pickPhoto(camera = "environment", { gallery = true } = {}) {
  return new Promise(res => {
    const i = document.createElement("input"); i.type = "file"; i.accept = "image/*";
    if (camera && !gallery) i.capture = camera;
    i.onchange = async () => { const f = i.files[0]; res(f ? await shrinkImage(f, camera === "user" ? 720 : 1280) : null); };
    i.click();
  });
}
async function photoChoice() {
  const r = await confirmBox("Зураг хаанаас авах вэ?", { ok: "Камер", cancel: "Болих", alt: "Галерей" });
  if (r === true) return pickPhoto("environment", { gallery: false });
  if (r === "alt") return pickPhoto(null);
  return null;
}

/* Хуруугаар гарын үсэг зурах */
function SigPad(wrap) {
  wrap.classList.add("sig");
  wrap.innerHTML = `<canvas></canvas><div class="hint">Энд хуруугаараа гарын үсэг зурна</div>`;
  const c = $("canvas", wrap), hint = $(".hint", wrap); let ctx, drawing = false, empty = true, last;
  function size() {
    const r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
    const img = empty ? null : c.toDataURL();
    c.width = r.width * d; c.height = r.height * d; ctx = c.getContext("2d"); ctx.scale(d, d);
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#13233f";
    if (img) { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0, r.width, r.height); i.src = img; }
  }
  const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener("pointerdown", e => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); empty = false; hint.hidden = true; ctx.beginPath(); ctx.arc(last[0], last[1], 1.2, 0, 7); ctx.fill(); });
  c.addEventListener("pointermove", e => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; });
  addEventListener("pointerup", () => drawing = false);
  requestAnimationFrame(size);
  return {
    isEmpty: () => empty,
    clear() { empty = true; hint.hidden = false; ctx.clearRect(0, 0, c.width, c.height); },
    async blob() { // цагаан дэвсгэртэй PNG
      const o = document.createElement("canvas"); o.width = c.width; o.height = c.height;
      const x = o.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, o.width, o.height); x.drawImage(c, 0, 0);
      return new Promise(r => o.toBlob(r, "image/png"));
    }
  };
}

/* Нислэгийн зам зурах бүтэн дэлгэц. "Болсон" дарахад onDone(цэгүүд) дуудна, "Болих" бол өөрчлөхгүй. */
function pathEditor({ pts, track, me }, onDone) {
  const work = pts.map(p => [...p]);
  const wrap = document.createElement("div"); wrap.className = "mapfull"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "Нислэгийн зам зурах");
  wrap.innerHTML = `<div class="mfhead"><button type="button" class="btn sm" data-x>Болих</button><div class="grow"><b>Нислэгийн зам</b><div class="seq small" data-seq></div></div></div>
    <div class="mfmap"></div>
    <div class="small mfhint">Анх харсан цэгээ, дараа нь чиглэл өөрчилсөн газар бүрийг дарна.</div>
    <div class="mffoot"><button type="button" class="btn" data-u>Буцаах</button><button type="button" class="btn" data-c>Арилгах</button><button type="button" class="btn p" data-ok>Болсон</button></div>`;
  document.body.appendChild(wrap); document.body.style.overflow = "hidden";
  const seq = () => $("[data-seq]", wrap).textContent = work.length ? work.map(p => Geo.cell(p)).join(" → ") : "Цэг сонгоогүй";
  const pm = PathMap($(".mfmap", wrap), { pts: work, track, me, onChange: seq }); seq();
  const close = () => { pm.destroy(); wrap.remove(); document.body.style.overflow = ""; };
  $("[data-u]", wrap).onclick = () => pm.undo();
  $("[data-c]", wrap).onclick = () => pm.clear();
  $("[data-x]", wrap).onclick = close;
  $("[data-ok]", wrap).onclick = () => { close(); onDone(work); };
}

/* Зүйлийн эрсдэл: богино мөр ба "Дэлгэрэнгүй" карт */
const riskInfoOf = sp => RISK_INFO[sp] || (riskOf(sp) === 2 ? RISK_INFO_II : null);
function riskLine(sp) {
  const r = riskOf(sp); if (r < 2) return "";
  const txt = r === 3 ? "<b>Өндөр эрсдэлтэй</b>, үргээх шаардлагатай" : "<b>Дунд эрсдэлтэй</b>, анхааралтай ажиглана";
  return `<div class="banner ${r === 3 ? "crit" : "warn"}"><b>${RISK_LABEL[r]}</b><span class="grow">${txt}</span>${riskInfoOf(sp) ? `<button type="button" class="btn sm" data-risk="${esc(sp)}">Дэлгэрэнгүй</button>` : ""}</div>`;
}
function riskCard(sp) {
  const r = riskOf(sp), I = riskInfoOf(sp);
  return `<div class="riskcard"><div class="row"><div class="grow"><div class="title">${esc(sp)}</div><div class="small"><i>${esc(latinOf(sp))}</i></div></div>${r ? `<span class="badge r${r}" style="font-size:15px;padding:4px 12px">${RISK_LABEL[r]}</span>` : ""}</div>
    ${r >= 2 ? `<div class="r${r}" style="font-weight:650">${r === 3 ? "Өндөр эрсдэлтэй. Үргээх шаардлагатай." : "Дунд эрсдэлтэй. Анхааралтай ажиглана."}</div>` : ""}
    ${I ? `<div class="stats two"><div class="stat"><b>${I.h} м</b><span>Нисэх дундаж өндөр</span></div>${I.d ? `<div class="stat"><b>${I.d} м</b><span>Хяналтын зай (газардах хэсгээс)</span></div>` : ""}</div>
    <div><p class="h">Яаж үргээх</p><ol class="steps">${I.how.map(x => `<li>${esc(x)}</li>`).join("")}</ol></div>
    <div><p class="h">Урьдчилан сэргийлэх</p><ul class="steps">${I.prev.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : `<div class="small">${r ? "Энэ зүйлд тусгай зөвлөмж алга." : "Эрсдэлийн үнэлгээгүй зүйл."}</div>`}</div>`;
}
function riskSheet(sp) { openSheet("Эрсдэл, үргээх арга", riskCard(sp)); }
document.addEventListener("click", e => { const b = e.target.closest("[data-risk]"); if (b) { e.preventDefault(); riskSheet(b.dataset.risk); } });

/* Хураагддаг хэсэг: нээлттэй/хаалттай байдлыг санана */
function fold(key, title, body, { open = false, count = "" } = {}) {
  let o = open; try { const v = localStorage.getItem("fold:" + key); if (v != null) o = v === "1"; } catch (e) { }
  return `<details class="fold" data-fold="${key}"${o ? " open" : ""}><summary><span class="grow">${title}</span>${count !== "" ? `<span class="cnt">${count}</span>` : ""}</summary><div class="foldbody">${body}</div></details>`;
}
document.addEventListener("toggle", e => { const d = e.target; if (d.dataset?.fold) try { localStorage.setItem("fold:" + d.dataset.fold, d.open ? "1" : "0"); } catch (x) { } }, true);

/* ---------- GPS: үзлэгийн явсан зам ---------- */
const Tracker = {
  watch: null, last: null, lock: null, listeners: new Set(), error: "",
  start() {
    if (this.watch != null || !("geolocation" in navigator)) return;
    this.watch = navigator.geolocation.watchPosition(p => this.onPos(p), e => { this.error = e.message; this.emit(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    this.wake();
  },
  stop() { if (this.watch != null) navigator.geolocation.clearWatch(this.watch); this.watch = null; this.release(); },
  async wake() { try { if ("wakeLock" in navigator && !this.lock) { this.lock = await navigator.wakeLock.request("screen"); this.lock.addEventListener("release", () => this.lock = null); } } catch (e) { } },
  release() { try { this.lock?.release(); } catch (e) { } this.lock = null; },
  async onPos(p) {
    const c = p.coords; this.error = "";
    this.last = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: p.timestamp };
    const i = Store.insp;
    if (i && c.accuracy <= 60) {
      const pt = [+c.latitude.toFixed(6), +c.longitude.toFixed(6), p.timestamp], prev = i.track[i.track.length - 1];
      if (!prev || Geo.dist(prev, pt) > 10 || p.timestamp - prev[2] > 20000) {
        i.track.push(pt); i.km = Math.round(Geo.trackKm(i.track) * 100) / 100;
        if (i.track.length % 3 === 0 || !prev) await Store.saveInsp(i);
      }
    }
    this.emit();
  },
  emit() { this.listeners.forEach(f => f()); },
  status() {
    if (!("geolocation" in navigator)) return ["", "GPS байхгүй"];
    if (this.error) return ["weak", "GPS: зөвшөөрөл хэрэгтэй"];
    if (!this.last) return ["", "GPS хайж байна…"];
    return this.last.acc <= 30 ? ["on", `GPS ±${Math.round(this.last.acc)} м`] : ["weak", `GPS сул ±${Math.round(this.last.acc)} м`];
  }
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Tracker.watch != null) Tracker.wake(); });

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 21V5M8 7h7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>'
};
