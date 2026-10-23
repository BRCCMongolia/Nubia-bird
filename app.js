// Nubia Bird: дэлгэцүүд.
"use strict";

/* ---------- Чиглүүлэгч ---------- */
const App = {
  stack: [], cur: null, cleanup: [], guard: null,
  // guard: хадгалаагүй өөрчлөлттэй дэлгэцээс гарахаас өмнө асууна
  async leave() { if (!this.guard) return true; const ok = await this.guard(); if (ok) this.guard = null; return ok; },
  async go(name, params = {}, { replace = false, reset = false } = {}) {
    if (!await this.leave()) return;
    if (reset) this.stack = [];
    else if (this.cur && !replace) this.stack.push(this.cur);
    this.cur = { name, params }; await this.render(); scrollTo(0, 0);
  },
  async back() { if (!await this.leave()) return; this.cur = this.stack.pop() || { name: "home", params: {} }; this.render(); },
  async render() {
    this.cleanup.forEach(f => f()); this.cleanup = []; this.guard = null;
    const v = Views[this.cur.name], main = $("main");
    const out = await v(this.cur.params);
    $(".top h1").textContent = out.title;
    $(".top .back").hidden = !this.stack.length || ["home", "report", "ref"].includes(this.cur.name);
    $(".top .logo").hidden = !$(".top .back").hidden;
    $$(".nav button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === (out.tab || this.cur.name)));
    main.innerHTML = out.html;
    out.mount?.(main);
    updateSync();
  },
  onCleanup(f) { this.cleanup.push(f); }
};

async function updateSync() {
  const el = $(".sync"); if (!el) return;
  const n = await Store.pending();
  let cls = "ok", txt = "Илгээсэн";
  if (!Sync.configured()) { cls = ""; txt = n ? `${n} хүлээгдэж буй` : "Sheet холбоогүй"; }
  else if (Sync.busy) { cls = "pending"; txt = "Илгээж байна…"; }
  else if (n && !navigator.onLine) { cls = "pending"; txt = `${n} · офлайн`; }
  else if (n && Sync.lastError) { cls = "err"; txt = `${n} илгээгдээгүй`; }
  else if (n) { cls = "pending"; txt = `${n} хүлээгдэж буй`; }
  el.className = "sync " + cls; $("span", el).textContent = txt;
}
Sync.listeners.add(updateSync);
addEventListener("online", updateSync); addEventListener("offline", updateSync);

/* ---------- Нийтлэг хэсгүүд ---------- */
// Товчийг давхар дарахаас хамгаална: үйлдэл дуустал дахин ажиллахгүй
function once(fn) {
  let run = false;
  return async function (e) {
    if (run) return; run = true; const b = e?.currentTarget; if (b) b.disabled = true;
    try { return await fn.call(this, e); } finally { run = false; if (b?.isConnected) b.disabled = false; }
  };
}
const shiftEnd = s => s.start + s.len * 3600000;
const shiftLine = s => `${esc(s.staff)} · ${fmtDT(s.start)} – ${fmtDT(s.end || shiftEnd(s))} (${s.len} цаг)`;
const coLine = x => x.coworkers?.length ? `Хамт: ${x.coworkers.map(esc).join(", ")}` : "";
// Картын тоо: 1-р мөр үргэлж, 2-р мөрөнд зөвхөн тэгээс их нь. insps = null бол үзлэгийг харуулахгүй.
const countLine = (insps, obs) => {
  const sp = new Set(obs.filter(o => o.sp).map(o => o.sp));
  const l1 = [`Зүйл ${sp.size}`, `Бодгаль ${sum(obs, o => +o.n || 0)}`, `Үргээлэг ${obs.filter(o => hasArga(o, "Үргээлэг")).length}`, `Устгал ${sum(obs.filter(o => hasArga(o, "Устгал")), o => +o.n || 0)}`];
  const l2 = [[insps, "Үзлэг"], [[...sp].filter(n => riskOf(n) === 3).length, "III түвшний"], [sum(obs, o => +o.ammoGun || 0), "Ангийн сум"], [sum(obs, o => +o.ammoSig || 0), "Дохионы сум"]]
    .filter(([n]) => n > 0).map(([n, t]) => `${t} ${n}`);
  return l1.join(" · ") + (l2.length ? `</span><span class="s">${l2.join(" · ")}` : "");
};
const riskBadge = sp => { const r = riskOf(sp); return r ? `<span class="badge r${r}">${RISK_LABEL[r]}</span>` : ""; };
const obsItem = o => `<button type="button" class="item" data-obs="${o.id}">
  <span class="t ${riskOf(o.sp) === 3 ? "r3" : ""}">${esc(o.sp || "Зүйл тодорхойгүй")} × ${o.n || "?"}${o.newSp ? ` <span class="badge new">Шинэ</span>` : ""}</span>
  <span class="badge ${o.done ? "done" : "todo"}">${o.done ? "Бүрэн" : "Дутуу"}</span>
  <span class="s">${fmtTime(o.t)} · ${esc(listTxt(o.arga))}${asList(o.beh).length ? " · " + esc(listTxt(o.beh)) : ""}${o.pts.length ? " · " + esc(pathTxt(o.pts, 4, "→")) : ""}${o.photos.length ? " · 📷" + o.photos.length : ""}</span></button>`;
function bindObsItems(root) { $$("[data-obs]", root).forEach(b => b.onclick = () => App.go("obs", { id: b.dataset.obs })); }
async function usageSorted(base, group) {
  const u = await DB.meta("usage", {});
  const used = Object.entries(u).filter(([n]) => group(n)).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  return [...new Set([...used.slice(0, 6), ...base])].slice(0, 14);
}
const typeGroup = t => n => { const g = (SP_INDEX.get(n) || [])[1]; return t === "Шувуу" ? g === "Ш" : t === "Амьтан" ? g && g !== "Ш" : !g; };
function searchSpecies(q, type) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const g = type === "Шувуу" ? ["Ш"] : type === "Амьтан" ? ["Х", "М", "Н"] : null;
  return SPECIES.filter(s => (!g || g.includes(s[1])) && (s[0].toLowerCase().includes(q) || s[3].toLowerCase().includes(q)))
    .sort((a, b) => (b[0].toLowerCase().startsWith(q)) - (a[0].toLowerCase().startsWith(q)) || b[2] - a[2]).slice(0, 8);
}
// Өнөөдөр хамгийн олон удаа бүртгэсэн зүйлс (ажиглалтын тоогоор)
async function todaySpecies(type) {
  const t0 = dayStart(Date.now()), c = {};
  (await DB.all("obs")).forEach(o => { if (o.t >= t0 && o.sp && (o.type || "Шувуу") === type) c[o.sp] = (c[o.sp] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 8);
}

/* ---------- Ажилтан сонгох: "Үндсэн ажилтан" (1) ба "Хамт ажилласан" (олон, заавал биш) ---------- */
function staffButtons(staff, exclude, selected) {
  return staff.filter(s => s[0] !== exclude).map(s => `<button type="button" class="item pick" data-staff="${esc(s[0])}" data-pos="${esc(s[1])}" aria-pressed="${s[0] === selected}"><span class="t">${esc(s[0])}</span><span class="small">${esc(s[1])}</span></button>`).join("")
    + `<button type="button" class="item pick add" data-add="1"><span class="t">+ Нэр нэмэх</span></button>`;
}
/* Нэр, албан тушаалыг нэг цонхонд. Албан тушаал заавал биш. */
function askNewStaff() {
  return new Promise(res => {
    const scrim = document.createElement("div"); scrim.className = "scrim center";
    scrim.innerHTML = `<form class="dialog"><div style="font-weight:650;font-size:17px">Нэр нэмэх</div><input type="text" name="n" placeholder="Нэр (жишээ нь Б.Болд)" autocomplete="off"><input type="text" name="p" placeholder="Албан тушаал (заавал биш)" autocomplete="off"><label class="check"><span>Цаашид жагсаалтад хадгалах</span><input type="checkbox" class="toggle" name="keep"></label><div class="row"><button type="button" class="btn" data-r="no">Болих</button><button class="btn p">Болсон</button></div></form>`;
    document.body.appendChild(scrim);
    const f = $("form", scrim); setTimeout(() => f.n.focus(), 50);
    f.onsubmit = async e => {
      e.preventDefault(); const n = f.n.value.trim(), p = f.p.value.trim();
      if (!n) { f.n.focus(); toast("Нэрээ бичнэ үү"); return; }
      scrim.remove(); if (f.keep.checked) await Store.addStaff(n, p); res([n, p]);
    };
    $("[data-r=no]", scrim).onclick = () => { scrim.remove(); res(null); };
  });
}
function bindStaff(box, onPick) {
  const mark = b => $$("[data-staff]", box).forEach(x => x.setAttribute("aria-pressed", x === b));
  box.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.add) {
      const r = await askNewStaff(); if (!r) return;
      const ex = $$("[data-staff]", box).find(x => x.dataset.staff === r[0]); if (ex) { mark(ex); onPick(ex.dataset.staff, ex.dataset.pos); return; }
      const nb = document.createElement("button"); nb.type = "button"; nb.className = "item pick"; nb.dataset.staff = r[0]; nb.dataset.pos = r[1];
      nb.innerHTML = `<span class="t">${esc(r[0])}</span><span class="small">${esc(r[1])}</span>`; box.insertBefore(nb, b); mark(nb); onPick(r[0], r[1]); return;
    }
    mark(b); onPick(b.dataset.staff, b.dataset.pos);
  });
}
/* st = {staff, pos, coworkers}. Сонгосны дараа хэсэг хураагдаж, нэр нь гарчиг дээр харагдана. */
function staffPicker(staff, st, { mainLabel = "Үндсэн ажилтан", coLabel = "Хамт ажилласан" } = {}) {
  const coChips = staff.filter(s => s[0] !== st.staff).map(s => `<button type="button" class="chip" data-co="${esc(s[0])}" aria-pressed="${st.coworkers.includes(s[0])}">${esc(s[0])}</button>`).join("");
  return `<div class="staffpick">
    <details class="fold inner" data-sp-main${st.staff ? "" : " open"}><summary><span class="grow">${mainLabel}</span><b class="sumv" data-sum-main>${st.staff ? esc(st.staff) : "Сонгоогүй"}</b></summary>
      <div class="list" data-main>${staffButtons(staff, null, st.staff)}</div></details>
    <details class="fold inner" data-sp-co><summary><span class="grow">${coLabel} <span class="small">(заавал биш)</span></span><b class="sumv" data-sum-co>${st.coworkers.length ? esc(st.coworkers.join(", ")) : "—"}</b></summary>
      <div class="chips" data-cobox>${coChips}<button type="button" class="chip own" data-coadd="1">+ Нэр нэмэх</button></div></details></div>`;
}
function bindStaffPicker(box, st, onChange) {
  const sumCo = () => $("[data-sum-co]", box).textContent = st.coworkers.length ? st.coworkers.join(", ") : "—";
  bindStaff($("[data-main]", box), (n, p) => {
    st.staff = n; st.pos = p; st.coworkers = st.coworkers.filter(x => x !== n);
    $("[data-sum-main]", box).textContent = n; $("[data-sp-main]", box).open = false;
    $$("[data-co]", box).forEach(c => { c.hidden = c.dataset.co === n; if (c.hidden) c.setAttribute("aria-pressed", "false"); });
    sumCo(); onChange?.();
  });
  $("[data-cobox]", box).addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.coadd) {
      const r = await askNewStaff(); if (!r) return;
      const ex = $$("[data-co]", box).find(x => x.dataset.co === r[0]);
      if (ex) { ex.hidden = false; if (ex.getAttribute("aria-pressed") !== "true") ex.click(); return; }
      if (r[0] === st.staff) return;
      const nb = document.createElement("button"); nb.type = "button"; nb.className = "chip"; nb.dataset.co = r[0]; nb.textContent = r[0];
      b.before(nb);
      $("[data-main] [data-add]", box).insertAdjacentHTML("beforebegin", `<button type="button" class="item pick" data-staff="${esc(r[0])}" data-pos="${esc(r[1])}" aria-pressed="false"><span class="t">${esc(r[0])}</span><span class="small">${esc(r[1])}</span></button>`);
      nb.click(); return;
    }
    const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on);
    st.coworkers = on ? [...st.coworkers, b.dataset.co] : st.coworkers.filter(x => x !== b.dataset.co);
    sumCo(); onChange?.();
  });
  $$("[data-co]", box).forEach(c => c.hidden = c.dataset.co === st.staff);
}
const KEEP_CAR = "Цаашид жагсаалтад хадгалах";
/* Ээлжийн статистик: Үзлэг · Зүйл · Бодгаль · Давтамж · Үргээлэг */
const shiftStats = (insps, obs) => `<div class="stats">${[[insps.length, "Үзлэг"], [new Set(obs.filter(o => o.sp).map(o => o.sp)).size, "Зүйл"], [sum(obs, o => +o.n || 0), "Бодгаль"], [obs.length, "Давтамж"], [obs.filter(o => hasArga(o, "Үргээлэг")).length, "Үргээлэг"]]
  .map(([n, t]) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`).join("")}</div>`;
/* Хүлээн авах сум: өмнөх ээлжээс үлдсэн (автомат) + нэмсэн/хассан + тайлбар = нийт */
const AMMO_GUNS = [["sig", "Дохионы бууны сум"], ["gun", "Ангийн бууны сум"]];
const ammoInHtml = (prev, prevLabel = "Өмнөх ээлжээс үлдсэн") => `<div class="ammoin">${AMMO_GUNS.map(([k, l]) => `<div class="ammorow" data-g="${k}">
    <div class="grow"><b>${l}</b><div class="small">${prevLabel}: <b data-prev>${prev[k] ?? 0}</b></div></div>
    <div class="pm" role="group" aria-label="Нэмсэн эсвэл хассан"><button type="button" data-sign="1" aria-pressed="true">+</button><button type="button" data-sign="-1" aria-pressed="false">−</button></div>
    <input type="number" inputmode="numeric" min="0" data-adj placeholder="0" aria-label="${l}: нэмсэн/хассан тоо">
    <div class="tot">= <b data-tot>${prev[k] ?? 0}</b></div></div>`).join("")}
  <div class="field"><span class="label">Тайлбар (нэмсэн, хассан бол)</span><input type="text" data-anote placeholder="жишээ нь агуулахаас авсан, буцааж өгсөн"></div></div>`;
function bindAmmoIn(root, prevOf) {
  const box = $(".ammoin", root), adj = k => { const r = $(`[data-g="${k}"]`, box), n = Math.max(0, +$("[data-adj]", r).value || 0); return $("[data-sign='-1']", r).getAttribute("aria-pressed") === "true" ? -n : n; };
  const refresh = () => AMMO_GUNS.forEach(([k]) => { const r = $(`[data-g="${k}"]`, box), p = prevOf()[k] ?? 0; $("[data-prev]", r).textContent = p; $("[data-tot]", r).textContent = Math.max(0, p + adj(k)); });
  $$("[data-sign]", box).forEach(b => b.onclick = () => { $$("[data-sign]", b.parentElement).forEach(x => x.setAttribute("aria-pressed", x === b)); refresh(); });
  $$("[data-adj]", box).forEach(i => i.oninput = refresh);
  refresh();
  return {
    refresh,
    get() { const p = prevOf(), a = { sigPrev: p.sig ?? 0, gunPrev: p.gun ?? 0, sigAdj: adj("sig"), gunAdj: adj("gun"), note: $("[data-anote]", box).value.trim() };
      return { ...a, sig: Math.max(0, a.sigPrev + a.sigAdj), gun: Math.max(0, a.gunPrev + a.gunAdj) }; }
  };
}
/* Сэлфи товч: holder.selfie-д хадгална */
function selfieField(box, holder) {
  const draw = async () => { const u = holder.selfie ? await Store.blobURL(holder.selfie) : ""; box.innerHTML = u ? `<img class="selfie" src="${u}" alt="Сэлфи">` : `<button type="button" class="btn soft selfiebtn">${ICON.cam}<span>Сэлфи</span></button>`; $("button,img", box).onclick = async () => { const b = await pickPhoto("user", { gallery: false }); if (b) { holder.selfie = await Store.putBlob(b, "Сэлфи"); draw(); } }; };
  draw();
}
const lenChips = v => chips("len", SHIFT_LEN.map(String), String(v), { fill: true, own: true, ownType: "number", ownSuffix: " цаг", ownLabel: "Бичих…", labels: SHIFT_LEN.map(n => n + " цаг") });

/* ---------- Дэлгэцүүд ---------- */
const Views = {};

/* Нүүр */
Views.home = async () => {
  const s = Store.shift, i = Store.insp, pend = s ? null : await Store.pendingShift();
  const [shifts, insps, allObs] = await Promise.all([DB.all("shifts"), DB.all("insps"), DB.all("obs")]);
  const past = shifts.filter(x => x.end).sort((a, b) => b.start - a.start).slice(0, 15);
  const extras = insps.filter(x => !x.shiftId).sort((a, b) => b.start - a.start).slice(0, 15);
  const todo = allObs.filter(o => !o.done).length, box = await DB.all("outbox");
  const oldest = box.length ? Math.min(...box.map(x => x.created)) : 0, failed = box.filter(x => x.tries).length;
  const stale = oldest && Date.now() - oldest > 12 * 3600000;
  const liveBanner = i ? `<div class="banner info"><b>${esc(routeName(i.route))}</b><span class="grow">${i.shiftId ? "" : "ээлжийн бус "}үзлэг явагдаж байна · ${fmtDur(Date.now() - i.start)}</span></div>
    <button class="btn p xl" data-go="insp">Үзлэг үргэлжлүүлэх</button>` : "";
  let top = "";
  if (!s && pend) {
    top = `<div class="card hero"><p class="h">Ээлж</p><div class="title">Ээлж хүлээн авах</div>
      <div class="sub"><b>${esc(pend.staff)}</b> ${fmtDT(pend.end)}-д ээлжээ хүлээлцэхгүй дуусгаж, зүйлсээ үлдээсэн.</div>
      ${liveBanner || `<button class="btn p xl" data-go="takeover">Ээлж авах</button>
      <button class="btn" data-go="inspStart">${ICON.plus} Ээлжийн бус үзлэг</button>`}</div>`;
  } else if (!s) {
    top = `<div class="card hero"><p class="h">Ээлж</p><div class="title">Ээлж эхлээгүй байна</div>
      ${liveBanner || `<div class="sub">Үндсэн ээлжийг эхлүүлнэ. Нэмэлт машин, илүү цагаар гарсан бол ээлжийн бус үзлэг хийнэ.</div>
      <button class="btn p xl" data-go="shiftStart">Ээлж эхлүүлэх</button>
      <button class="btn" data-go="inspStart">${ICON.plus} Ээлжийн бус үзлэг</button>`}</div>`;
  } else {
    const sI = insps.filter(x => x.shiftId === s.id).sort((a, b) => b.start - a.start), sO = allObs.filter(o => o.shiftId === s.id);
    const over = Date.now() > shiftEnd(s);
    top = `<div class="card hero"><p class="h">Одоогийн ээлж</p>
      <div class="title">${esc(s.staff)}</div>
      <div class="sub">${fmtDT(s.start)} – ${fmtTime(shiftEnd(s))} (${s.len} цаг) · ${esc(s.car)}${s.coworkers?.length ? "<br>" + coLine(s) : ""}</div>
      ${shiftStats(sI, sO)}
      ${ammoInTxt(s) ? `<div class="small">Хүлээн авсан сум: ${esc(ammoInTxt(s))}${s.from ? " (өмнөх ээлжээс)" : ""}</div>` : ""}
      ${over ? `<div class="banner warn"><b>!</b><span class="grow">Ээлжийн хугацаа дууссан. Ээлжээ хүлээлгэнэ үү.</span></div>` : ""}
      ${s.supplies?.length ? `<div class="small">Дундуур авсан: ${esc(supplyTxt(s))}</div>` : ""}
      ${liveBanner || `<button class="btn p xl" data-go="inspStart">${ICON.plus} Үзлэг эхлүүлэх</button>`}
      <div class="row">${i ? "" : `<button class="btn soft" data-go="inspStart" data-kind="extra">Ээлжийн бус үзлэг</button>`}<button class="btn soft" id="supply">± Буу, сум</button></div>
      <button class="btn" data-go="handover">Ээлж хүлээлгэх</button>
      <button class="btn solo" data-go="handover" data-kind="solo">Хүлээлцэхгүй дуусгах</button></div>
      ${sI.length ? fold("cur-insps", "Энэ ээлжийн үзлэг", `<div class="list">${sI.map(x => inspItem(x, allObs)).join("")}</div>`, { open: true, count: sI.length }) : ""}`;
  }
  const shiftCard = x => { const o = allObs.filter(b => b.shiftId === x.id), n = insps.filter(b => b.shiftId === x.id).length;
    return `<button class="item card2 kshift" data-shift="${x.id}"><span class="t">${shiftLine(x)}</span>${x.handover?.pending ? `<span class="s">Хүлээлцээгүй, зүйлсээ үлдээсэн</span>` : x.handover?.receiver?.name ? `<span class="s">→ ${x.handover.solo ? "Үлдээсэн, шалгаж авсан" : "Хүлээлгэсэн"}: <b>${esc(x.handover.receiver.name)}</b></span>` : ""}<span class="s">${countLine(n, o)}</span></button>`; };
  return {
    title: "Nubia Bird",
    html: `${top}
      ${StorageWarn ? `<div class="banner crit"><b>!</b><span class="grow">${StorageWarn} Лавлах → «Бүх өгөгдлийг татах»-аар нөөцлөөд, утасны зай гаргана уу.</span></div>` : ""}
      ${stale || failed ? `<button class="banner crit" data-go="ref" style="border:0;cursor:pointer;text-align:left"><b>${box.length}</b><span class="grow">зүйл Sheet рүү ${stale ? "12-оос дээш цаг " : ""}илгээгдээгүй${failed ? `, ${failed} нь алдаатай` : ""}. Интернэт, тохиргоогоо шалгана уу. Илгээгээгүй байхад аппыг утаснаас бүү устга.</span><span>›</span></button>` : ""}
      ${todo ? `<button class="banner warn" data-go="todo" style="border:0;cursor:pointer;text-align:left"><b>${todo}</b><span class="grow">ажиглалт дутуу байна. Дарж бөглөнө үү.</span><span>›</span></button>` : ""}
      ${fold("routes", "Үзлэгийн маршрут", `<div class="routes">${ROUTES.map(routeCard).join("")}</div>`, { open: true })}
      ${past.length ? fold("past", "Өмнөх үндсэн ээлжүүд", `<div class="list">${past.map(shiftCard).join("")}</div>`, { count: past.length }) : ""}
      ${fold("extras", "Өмнөх ээлжийн бус ажиглалт", extras.length ? `<div class="list">${extras.map(x => inspItem(x, allObs, true)).join("")}</div>` : `<div class="empty">Ээлжийн бус үзлэг хийгээгүй байна.</div>`, { open: true, count: extras.length })}`,
    mount(m) {
      $$("[data-go]", m).forEach(b => b.onclick = () => App.go(b.dataset.go, b.dataset.kind ? { kind: b.dataset.kind } : {}));
      $("#supply", m)?.addEventListener("click", supplySheet);
      $$("[data-route]", m).forEach(b => b.onclick = () => App.go("route", { id: b.dataset.route }));
      $$("[data-insp]", m).forEach(b => b.onclick = () => App.go(b.dataset.insp === Store.insp?.id ? "insp" : "inspView", { id: b.dataset.insp }));
      $$("[data-shift]", m).forEach(b => b.onclick = () => App.go("shiftView", { id: b.dataset.shift }));
    }
  };
};
/* Ээлжийн дунд буу, сум авсныг бүртгэх */
function supplySheet() {
  const st = { item: SUPPLY_ITEMS[1], dir: "Авсан" };
  openSheet("Буу, сум авсан, өгсөн", `<div class="field" id="dirf">${chips("dir", ["Авсан", "Буцааж өгсөн"], st.dir, { fill: true })}</div>
    <div class="field"><span class="label">Юу</span>${chips("item", SUPPLY_ITEMS, st.item, { fill: true })}</div>
    <div class="field" id="nf"><span class="label">Хэдэн ширхэг</span><input type="number" inputmode="numeric" id="sn" min="1" placeholder="Тоо"></div>
    <div class="field"><span class="label">Тайлбар (заавал биш)</span><input type="text" id="snote" placeholder="жишээ нь хэнээс авсан"></div>
    <button class="btn p xl" id="sok">Хадгалах</button>`, (b, close) => {
    bindChips(b, (k, v) => { if (k === "dir") st.dir = v; else { st.item = v; $("#nf", b).hidden = v === "Ангийн буу"; $("#dirf", b).hidden = v === "Ангийн буу"; } });
    $("#sok", b).onclick = once(async () => {
      const n = st.item === "Ангийн буу" ? 1 : +$("#sn", b).value;
      if (!(n > 0)) { toast("Тоогоо бичнэ үү"); $("#sn", b).focus(); return; }
      const back = st.dir !== "Авсан" && st.item !== "Ангийн буу";
      await Store.addSupply(st.item, back ? -n : n, $("#snote", b).value.trim());
      close(); toast(`${st.item} ${back ? "буцааж өгсөн" : "авсан"} бүртгэгдлээ`); App.render();
    });
  });
}
const routeCard = r => `<button class="route" data-route="${r.id}"><img src="${r.thumb}" alt=""><div><b>${r.id}</b> <span class="small">· ${r.km} км</span><div class="s">${esc(r.short)}</div></div><span class="go">›</span></button>`;
function inspItem(x, allObs, long) {
  const o = allObs.filter(b => b.inspId === x.id);
  return `<button class="item card2 ${x.shiftId ? "kshift" : "kextra"}" data-insp="${x.id}"><span class="t">${long ? esc(x.staff) + " · " + fmtDate(x.start) + " " : ""}${esc(routeName(x.route))} · ${fmtTime(x.start)}–${x.end ? fmtTime(x.end) : "одоо"}</span>
    ${long && x.coworkers?.length ? `<span class="s">${coLine(x)}</span>` : ""}
    ${x.km || x.routeNote ? `<span class="s">${[x.km ? x.km + " км" : "", esc(x.routeNote || "")].filter(Boolean).join(" · ")}</span>` : ""}
    <span class="s">${x.noBird ? "Шувуугүй" : countLine(null, o)}</span></button>`;
}

/* Ээлж эхлүүлэх (анх удаа, эсвэл хүлээлцэлгүйгээр) */
Views.shiftStart = async () => {
  if (Store.shift) { setTimeout(() => App.go("home", {}, { reset: true })); return { title: "", html: "" }; }
  const staff = await Store.staffList();
  const st = { staff: null, pos: "", coworkers: [], len: 24, car: CARS[0] }, cars = await Store.carList(), prev = await Store.lastAmmo();
  return {
    title: "Ээлж эхлүүлэх", tab: "home",
    html: `<div class="card"><p class="h">1. Ажилтан</p><div id="sp">${staffPicker(staff, st)}</div></div>
      <div class="card"><p class="h">2. Ээлжийн хугацаа</p>${lenChips(24)}</div>
      <div class="card"><p class="h">3. Машин</p>${chips("car", cars, CARS[0], { fill: true, own: true, ownKeep: KEEP_CAR })}</div>
      <div class="card"><p class="h">4. Хүлээн авсан сум</p>${ammoInHtml(prev)}
        <div class="small">Ээлжийн дундуур буу, сум авсан, өгсөн бол нүүрэн дээрх «± Буу, сум» товчоор бүртгэнэ.</div></div>
      <button class="btn p xl" id="go" disabled>Ээлж эхлүүлэх</button>`,
    mount(m) {
      bindStaffPicker($("#sp", m), st, () => $("#go", m).disabled = !st.staff);
      const ammo = bindAmmoIn(m, () => prev);
      bindChips(m, (k, v, b) => { if (k === "len") st.len = +v; if (k === "car") { st.car = v; if (b?.dataset.keep) Store.addCar(v); } });
      $("#go", m).onclick = once(async () => {
        if (Store.shift) { toast("Ээлж аль хэдийн эхэлсэн байна"); return; }
        if (!(st.len > 0)) { toast("Ээлжийн хугацааг сонгоно уу"); return; }
        const a = ammo.get();
        await Store.startShift({ staff: st.staff, pos: st.pos, coworkers: st.coworkers, len: st.len, car: st.car, sigAmmo: a.sig, gunAmmo: a.gun, ammoIn: a });
        toast("Ээлж эхэллээ"); App.go("home", {}, { reset: true });
      });
    }
  };
};

/* Маршрут харах */
Views.route = async ({ id }) => {
  const r = ROUTES.find(x => x.id === id), canStart = !Store.insp;
  return {
    title: `Маршрут ${r.id}`, tab: "home",
    html: `<div class="card"><div class="row between"><div class="title">${r.id}</div><span class="badge" style="color:var(--brand)">${r.km} км</span></div>
      <div class="sub">${esc(r.short)}</div>
      <button type="button" class="zoombtn" id="zoom" aria-label="Зургийг томоор харах"><img class="zoomimg" src="${r.img}" alt="Маршрут ${r.id}-ийн зураг"></button>
      <div class="small">Зураг дээр дарж томоор харна.</div></div>
      <div class="card"><p class="h">Хэзээ хэрэглэх</p><ul style="margin:0;padding-left:20px;display:grid;gap:6px">${r.when.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      ${["М-1", "М-2", "М-3"].includes(r.id) ? `<p class="h" style="margin-top:6px">Урьдчилан сэргийлэх үзлэг</p><ul style="margin:0;padding-left:20px;display:grid;gap:4px">${ROUTE_RULES.map(w => `<li class="sub">${esc(w)}</li>`).join("")}</ul>` : ""}</div>
      ${canStart ? `<button class="btn p xl" id="start">Энэ маршрутаар үзлэг эхлүүлэх</button>` : ""}`,
    mount(m) {
      $("#zoom", m).onclick = () => imgViewer(r.img, `Маршрут ${r.id}`);
      $("#start", m)?.addEventListener("click", () => App.go("inspStart", { route: r.id }, { replace: true }));
    }
  };
};

/* Үзлэг эхлүүлэх: ээлжийн, эсвэл ээлжийн бус */
Views.inspStart = async ({ route, kind }) => {
  if (Store.insp) { setTimeout(() => App.go("insp", {}, { replace: true })); return { title: "", html: "" }; }
  const s = Store.shift, staff = await Store.staffList();
  const cond = await Store.lastCond();
  const st = { kind: s && kind !== "extra" ? "shift" : "extra", route: route || null, note: "", cond: { ...cond } };
  const who = { shift: { staff: s?.staff || null, pos: s?.pos || "", coworkers: [...(s?.coworkers || [])] }, extra: { staff: null, pos: "", coworkers: [] } };
  const rows = ROUTES.map(r => `<div class="rp" data-rp="${r.id}" aria-pressed="${r.id === st.route}"><button type="button" class="pick" data-pick="${r.id}"><span class="id">${r.id}</span><span class="sub">${esc(r.short)} · ${r.km} км</span></button><button type="button" class="btn sm soft" data-see="${r.id}">${ICON.map} Харах</button></div>`).join("")
    + `<div class="rp free" data-rp="${FREE_ROUTE}" aria-pressed="${st.route === FREE_ROUTE}"><button type="button" class="pick" data-pick="${FREE_ROUTE}"><span class="id">Чөлөөт</span><span class="sub">Төлөвлөгөөт бус маршрут. Явсан зам GPS-ээр бичигдэнэ.</span></button><span></span></div>`;
  return {
    title: "Үзлэг эхлүүлэх", tab: "home",
    html: `${s ? `<div class="card"><p class="h">Үзлэгийн төрөл</p>${chips("kind", ["shift", "extra"], st.kind, { fill: true, labels: ["Ээлжийн", "Ээлжийн бус"] })}
        <div class="small" id="kindhint"></div></div>`
        : `<div class="banner info"><b>i</b><span class="grow">Ээлж эхлээгүй тул <b>ээлжийн бус үзлэг</b> болно. Нэмэлт машин, илүү цагаар гарсан үед хэрэглэнэ.</span></div>`}
      <div class="card"><p class="h">1. Ажилтан</p><div id="sp"></div></div>
      <div class="card"><p class="h">2. Маршрут</p><div class="routepick">${rows}</div>
        <div class="field" id="freebox" ${st.route === FREE_ROUTE ? "" : "hidden"}><span class="label">Хаана, ямар зорилгоор (заавал биш)</span><input type="text" id="note" placeholder="жишээ нь Бөхөг голын эх, сүрэг шалгах"></div></div>
      <div class="card"><p class="h">3. Нөхцөл</p><div class="small">Өмнөх үзлэгээс хуулсан. Өөрчлөгдсөнийг л дарж солино.</div>
      ${COND.map(c => `<div class="field"><span class="label">${c.label}</span>${chips(c.key, c.opts, cond[c.key])}</div>`).join("")}
      <div class="field"><span class="label">Температур (°C, заавал биш)</span><input type="number" inputmode="decimal" id="temp"></div></div>
      <button class="btn p xl" id="go">Үзлэг эхлэх</button>
      <div class="small" style="text-align:center">Эхлэхэд явсан замыг GPS-ээр бичиж, дэлгэцийг асаалттай байлгана.</div>`,
    mount(m) {
      const drawStaff = () => {
        $("#sp", m).innerHTML = staffPicker(staff, who[st.kind]); bindStaffPicker($("#sp", m), who[st.kind]);
        if ($("#kindhint", m)) $("#kindhint", m).textContent = st.kind === "shift" ? "Одоогийн ээлжийн үзлэг. Ээлжийн тайланд орно." : "Нэмэлт машин, илүү цагаар ажиллаж буй хүний үзлэг. Ээлжид орохгүй, тайланд тусдаа харагдана.";
      };
      drawStaff();
      $$("[data-pick]", m).forEach(b => b.onclick = () => { st.route = b.dataset.pick; $$("[data-rp]", m).forEach(x => x.setAttribute("aria-pressed", x.dataset.rp === st.route)); $("#freebox", m).hidden = st.route !== FREE_ROUTE; });
      $$("[data-see]", m).forEach(b => b.onclick = () => App.go("route", { id: b.dataset.see }));
      bindChips(m, (k, v) => { if (k === "kind") { st.kind = v; drawStaff(); } else st.cond[k] = v; });
      $("#go", m).onclick = once(async () => {
        const w = who[st.kind];
        if (!w.staff) { toast("Үндсэн ажилтнаа сонгоно уу"); $("#sp details", m).open = true; $("#sp", m).scrollIntoView({ block: "center" }); return; }
        if (!st.route) { toast("Маршрутаа сонгоно уу"); $(".routepick", m).scrollIntoView({ block: "center" }); return; }
        const t = $("#temp", m).value;
        await Store.startInsp({ kind: st.kind, route: st.route, routeNote: st.route === FREE_ROUTE ? $("#note", m).value.trim() : "", cond: st.cond, temp: t === "" ? "" : +t, staff: w.staff, pos: w.pos, coworkers: w.coworkers });
        Tracker.start(); App.go("insp", {}, { replace: true });
      });
    }
  };
};

/* Явагдаж буй үзлэг */
Views.insp = async () => {
  const i = Store.insp;
  if (!i) { setTimeout(() => App.go("home", {}, { reset: true })); return { title: "", html: "" }; }
  Tracker.start();
  const obs = await Store.obsOf(o => o.inspId === i.id);
  return {
    title: `Үзлэг ${routeName(i.route)}`, tab: "home",
    html: `<div class="card hero live"><div class="row between"><p class="h" style="text-transform:none;letter-spacing:0">${i.shiftId ? "" : "Ээлжийн бус · "}${esc(i.staff)} · эхэлсэн ${fmtTime(i.start)}</p><span class="gps" id="gps"><i></i><span></span></span></div>
        <div class="clock" id="clock">0:00</div><div class="sub" id="km"></div>${i.coworkers.length ? `<div class="small">${coLine(i)}</div>` : ""}${i.routeNote ? `<div class="small">${esc(i.routeNote)}</div>` : ""}</div>
      <button class="btn p xl" id="add" style="min-height:76px;font-size:20px">${ICON.plus} Шувуу / амьтан</button>
      <div class="small" style="text-align:center;margin-top:-6px">Завгүй бол зүйлээ сонгоод «Хадгалаад дараа бөглөх» дарна.</div>
      <div class="row"><button class="btn" id="nobird">Шувуугүй</button><button class="btn d" id="end">Үзлэг дуусгах</button></div>
      <p class="sec">Ажиглалт (<span id="obscnt">${obs.length}</span>)</p>
      <div class="list" id="obs">${obs.length ? obs.slice().reverse().map(obsItem).join("") : `<div class="empty">Шувуу, амьтан харвал дээрх товчийг дарна.</div>`}</div>
      <div class="row between" style="margin:6px 0 -4px"><p class="sec" style="margin:0 2px">Явсан зам</p><button type="button" class="btn sm quickbtn" id="quick" aria-pressed="false">⚡ Хялбар бүртгэл</button></div>
      <div class="small" id="quickhint" hidden>Шувуу харвал газрын зураг дээр байгаа цэг дээр нь дараад зүйлээ сонгоно. Шууд хадгалагдана.</div><div id="map"></div>
      ${i.route !== FREE_ROUTE ? `<button class="btn sm soft" id="see" style="justify-self:start">${ICON.map} ${esc(i.route)} маршрут харах</button>` : ""}
      <button type="button" class="btn sm ghost delinsp" id="delinsp">Үзлэг устгах</button>`,
    mount(m) {
      const clock = () => { const d = Date.now() - i.start, h = Math.floor(d / 3600000), mm = Math.floor(d / 60000) % 60, ss = Math.floor(d / 1000) % 60; $("#clock", m).textContent = (h ? h + ":" + pad(mm) : mm) + ":" + pad(ss); };
      const meNow = () => Tracker.last ? [Tracker.last.lat, Tracker.last.lon] : null, marks = () => obs.filter(o => o.pts.length).map(o => o.pts[0]);
      let quick = false; try { quick = localStorage.getItem("quickMode") === "1"; } catch (e) { }
      let pm = null;
      const makeMap = () => {
        pm?.destroy(); const box = $("#map", m); box.className = ""; box.innerHTML = "";
        box.classList.toggle("big", quick); $("#quick", m).setAttribute("aria-pressed", quick); $("#quickhint", m).hidden = !quick;
        pm = PathMap(box, quick ? { pts: [], track: i.track.map(p => [p[0], p[1]]), me: meNow(), readonly: true, fill: true, follow: true, marks: marks(), onTap: px => quickPick(px, saved) }
          : { pts: [], track: i.track.map(p => [p[0], p[1]]), me: meNow(), readonly: true });
      };
      // Хялбар бүртгэлээр хадгалсны дараа жагсаалт, тэмдгийг шинэчилнэ
      const saved = async () => {
        obs.length = 0; obs.push(...await Store.obsOf(o => o.inspId === i.id));
        $("#obs", m).innerHTML = obs.length ? obs.slice().reverse().map(obsItem).join("") : `<div class="empty">Шувуу, амьтан харвал дээрх товчийг дарна.</div>`;
        $("#obscnt", m).textContent = obs.length; bindObsItems(m); pm?.set({ marks: marks() });
      };
      makeMap();
      $("#quick", m).onclick = () => { quick = !quick; try { localStorage.setItem("quickMode", quick ? "1" : "0"); } catch (e) { } makeMap(); if (quick) $("#map", m).scrollIntoView({ behavior: "smooth", block: "start" }); };
      const gps = () => {
        const [c, t] = Tracker.status(); $("#gps", m).className = "gps " + c; $("#gps span", m).textContent = t;
        $("#km", m).textContent = `Явсан: ${(Store.insp?.km || 0).toFixed(2)} км · ${Store.insp?.track.length || 0} цэг`;
        if (Store.insp) pm.set({ track: Store.insp.track.map(p => [p[0], p[1]]), me: meNow() });
      };
      clock(); gps();
      const t = setInterval(clock, 1000); Tracker.listeners.add(gps);
      App.onCleanup(() => { clearInterval(t); Tracker.listeners.delete(gps); pm.destroy(); quickBar.hide(); });
      bindObsItems(m);
      $("#see", m)?.addEventListener("click", () => App.go("route", { id: i.route }));
      $("#delinsp", m).onclick = once(async () => { if (await askDelInsp(i, obs.length)) { Tracker.stop(); App.go("home", {}, { reset: true }); } });
      $("#add", m).onclick = () => App.go("obs", { draft: freshObs() });
      $("#nobird", m).onclick = once(async () => {
        if (obs.length) { toast("Ажиглалттай үзлэгийг «Үзлэг дуусгах»-аар дуусгана"); return; }
        if (!await confirmBox("Шувуу, амьтан ажиглагдаагүй гэж тэмдэглээд үзлэгээ дуусгах уу?")) return;
        await finishInsp(true);
      });
      $("#end", m).onclick = once(async () => {
        const todo = obs.filter(o => !o.done).length;
        if (!obs.length) {
          const r = await confirmBox("Ажиглалт алга байна. «Шувуугүй» гэж дуусгах уу?", { ok: "Шувуугүй", cancel: "Болих" });
          if (r) await finishInsp(true); return;
        }
        if (todo) {
          const r = await confirmBox(`${todo} ажиглалт дутуу байна. Одоо бөглөх үү, дараа бөглөх үү?`, { ok: "Дараа бөглөнө", cancel: "Буцах", alt: "Одоо бөглөх" });
          if (r === "alt") { const first = obs.find(o => !o.done); App.go("obs", { id: first.id }); return; }
          if (!r) return;
        }
        await finishInsp(false);
      });
    }
  };
};
/* Үзлэг устгах: 2 удаа асууна */
async function askDelInsp(i, n) {
  if (!await confirmBox(`Та энэ үзлэгийг${n ? ` (${n} ажиглалттай)` : ""} устгахдаа итгэлтэй байна уу?`, { ok: "Тийм", cancel: "Үгүй" })) return false;
  if (!await confirmBox(`<b>Устгалаа шүү!</b><br>${esc(routeName(i.route))} · ${fmtDT(i.start)} үзлэг${n ? ` болон ${n} ажиглалт` : ""} утас, Sheet-ээс устана. Дахин сэргээх боломжгүй.`, { ok: "Бүрмөсөн устгах", cancel: "Болих", danger: true })) return false;
  await Store.delInsp(i); toast("Үзлэг устгагдлаа"); return true;
}
/* ⚡ Хялбар бүртгэл: зураг дээр дарсан цэгт зүйл сонгоод шууд хадгална. Тоо толгойг доорх мөрөөс сонгоно (заавал биш). */
function quickPick(px, onSaved) {
  const cell = pathCells([px])[0];
  openSheet(`Ямар зүйл? · ${cell}`, `<input type="search" id="qq" placeholder="Нэрээр хайх…" autocomplete="off"><div class="sugg" id="qs" hidden></div><div id="qlist"></div>`, async (b, close) => {
    const btn = (n, big) => `<button type="button" class="chip${big ? " big" : ""}" data-sp="${esc(n)}"><span class="r${riskOf(n)} dot">●</span>${esc(n)}</button>`;
    const today = await todaySpecies("Шувуу"), common = (await usageSorted(QUICK_BIRD, typeGroup("Шувуу"))).filter(n => !today.includes(n)).slice(0, 12);
    $("#qlist", b).innerHTML = (today.length ? `<div class="splabel">Өнөөдөр ажиглагдсан</div><div class="chips">${today.map(n => btn(n, true)).join("")}</div>` : "")
      + `<div class="splabel">Түгээмэл</div><div class="chips">${common.map(n => btn(n)).join("")}</div>`;
    const q = $("#qq", b), sg = $("#qs", b);
    q.addEventListener("input", () => { const v = q.value.trim(); sg.hidden = !v; sg.innerHTML = searchSpecies(v, null).map(s => `<button type="button" data-sp="${esc(s[0])}"><span>${esc(s[0])} <em>${esc(s[3])}</em></span>${riskBadge(s[0])}</button>`).join("") + (v ? `<button type="button" data-sp="${esc(v)}"><span>«${esc(v)}» гэж өөрөө бичих</span></button>` : ""); });
    let busy = false;
    b.addEventListener("click", async e => {
      const c = e.target.closest("[data-sp]"); if (!c || busy) return; busy = true;
      const sp = c.dataset.sp, g = (SP_INDEX.get(sp) || [])[1], o = freshObs(); delete o._new;
      const prev = (await Store.obsOf(x => x.inspId === o.inspId)).pop(); if (prev) { o.loc = prev.loc; o.tools = [...prev.tools]; }
      Object.assign(o, { sp, type: !g || g === "Ш" ? "Шувуу" : "Амьтан", n: null, arga: ["Ажиглалт"], pts: [px] });
      await Store.saveObs(o); close(); await onSaved?.(); quickBar.show(o, onSaved);
    });
    setTimeout(() => q.blur());
  });
}
const quickBar = {
  el: null, timer: null,
  show(o, onSaved) {
    this.hide();
    const el = this.el = document.createElement("div"); el.className = "quickbar";
    el.innerHTML = `<div class="qt"><b>${esc(o.sp)}</b> хадгалагдлаа · тоо толгой?</div><div class="qn">${[1, 2, 5, 10, 20].map(n => `<button type="button" data-n="${n}">${n}</button>`).join("")}<button type="button" class="undo" data-undo>Буцаах</button></div>`;
    document.body.appendChild(el);
    el.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      clearTimeout(this.timer); this.hide();
      const cur = await DB.get("obs", o.id); if (!cur) return;
      if (b.dataset.undo != null) { await Store.delObs(cur); toast("Буцаалаа"); }
      else { cur.n = +b.dataset.n; await Store.saveObs(cur); toast(`${cur.sp} × ${cur.n}`); }
      await onSaved?.();
    };
    this.timer = setTimeout(() => this.hide(), 6000);
  },
  hide() { clearTimeout(this.timer); this.el?.remove(); this.el = null; }
};
async function finishInsp(noBird) {
  const i = await Store.endInsp(noBird); Tracker.stop();
  toast(`Үзлэг дууслаа · ${fmtTime(i.end)}${i.km ? " · " + i.km + " км" : ""}`);
  App.go("home", {}, { reset: true });
}
/* Шинэ ажиглалт: цаг, GPS автоматаар; байршил, багажийг энэ үзлэгийн өмнөх ажиглалтаас авна */
function freshObs() {
  const o = Store.newObs();
  if (Tracker.last && Date.now() - Tracker.last.t < 120000) { o.lat = +Tracker.last.lat.toFixed(6); o.lon = +Tracker.last.lon.toFixed(6); o.acc = Math.round(Tracker.last.acc); }
  o._new = true; return o;
}

/* Ажиглалт: бүх талбар нэг дор. "Хадгалах" бол бүрэн байх ёстой, "Хадгалаад дараа бөглөх" бол дутуу хадгална. */
Views.obs = async ({ id, inspId, draft }) => {
  let o = draft || (id ? await DB.get("obs", id) : null);
  if (!o && inspId) { const ins = await DB.get("insps", inspId); o = Store.newObs({ inspId, shiftId: ins.shiftId, observer: ins.staff, coworkers: ins.coworkers || [], route: ins.route, t: ins.start }); o._new = true; }
  if (!o) return { title: "Ажиглалт", html: `<div class="empty">Ажиглалт олдсонгүй.</div>` };
  if (!draft) o = structuredClone(o);
  o.coworkers ||= []; o.photoNotes ||= {}; o.arga = asList(o.arga); o.beh = asList(o.beh);
  if (o._new && !o._prefilled && o.inspId) { // өмнөх ажиглалтын байршил, багаж
    o._prefilled = true;
    const prev = (await Store.obsOf(x => x.inspId === o.inspId)).pop();
    if (prev) { o.loc = prev.loc; o.tools = [...prev.tools]; }
  }
  const behFor = t => (t === "Шувуу" ? BEH_BIRD : BEH_MAMMAL);
  const behChips = () => chips("beh", behFor(o.type).map(b => b[0]), o.beh, { multi: true, own: true, limit: 10, search: true, labels: behFor(o.type).map(b => `${esc(b[0])} <small>(${esc(b[1])})</small>`) });
  const REQ = [["sp", "Зүйл"], ["arga", "Юу хийсэн"], ["n", "Тоо толгой"], ["beh", "Зан төрх"], ["res", "Үр дүн"]];
  const dt = new Date(o.t), uses = t => o.tools.includes(t) || o.acts.includes(t), gun = () => uses("Ангийн буу"), sig = () => uses("Дохионы буу");
  return {
    title: o._new ? "Шинэ ажиглалт" : (o.done ? "Ажиглалт" : "Ажиглалт бөглөх"), tab: "home",
    html: `<div id="miss"></div>
      <div class="small" style="padding:0 2px">${fmtTime(o.t)}${o.lat ? ` · ${Geo.cellOfLL([o.lat, o.lon])} нүд (GPS ±${o.acc} м)` : ""} · ${esc(o.observer)}${o.route ? " · " + esc(routeName(o.route)) : ""}</div>
      <div class="card" data-req="sp"><p class="h">Зүйл</p>${chips("type", TYPES, o.type, { fill: true })}
        <div id="spsel"></div>
        <div class="field"><input type="search" id="q" placeholder="Нэрээр хайх… (жишээ нь «элээ»)" autocomplete="off"><div class="sugg" id="sugg" hidden></div></div>
        <div id="spquick"></div></div>
      <div class="card" data-req="arga"><p class="h">Юу хийсэн <span class="small">(олныг сонгож болно)</span></p>${chips("arga", ARGA, o.arga, { multi: true, own: true })}</div>
      <div class="card" data-req="n"><p class="h">Тоо толгой</p><div class="counter"><button type="button" data-d="-1" aria-label="Хасах">−</button><input type="number" inputmode="numeric" id="n" value="${o.n || ""}" min="1" placeholder="?"><button type="button" data-d="1" aria-label="Нэмэх">+</button></div>
        <div class="presets">${[1, 2, 5, 10, 20, 50, 100].map(n => `<button type="button" data-n="${n}">${n}</button>`).join("")}</div></div>
      <div class="card" data-req="beh"><p class="h">Зан төрх <span class="small">(олныг сонгож болно)</span></p><div id="behbox">${behChips()}</div></div>
      <div class="card"><p class="h">Нислэгийн зам</p><div id="pathprev"></div>
        <div class="row"><span class="seq grow" id="seq"></span><button type="button" class="btn soft" id="draw" style="flex:none">${ICON.map} <span></span></button></div>
        <div class="field"><span class="label">Байршил</span><select id="loc"><option value="">— Сонгох —</option>${LOCS.concat(o.loc && !LOCS.includes(o.loc) ? [o.loc] : []).map(l => `<option ${l === o.loc ? "selected" : ""}>${esc(l)}</option>`).join("")}<option value="__own">Өөрөө бичих…</option></select></div></div>
      <div class="card"><p class="h">Багаж техник</p>${chips("tools", TOOLS, o.tools, { multi: true, own: true, limit: 6, search: true })}
        <div class="row"><div class="field grow" id="agf" ${gun() ? "" : "hidden"}><span class="label">Ангийн бууны сум</span><input type="number" inputmode="numeric" id="ag" value="${o.ammoGun || ""}" min="0" placeholder="0"></div>
        <div class="field grow" id="asf" ${sig() ? "" : "hidden"}><span class="label">Дохионы бууны сум</span><input type="number" inputmode="numeric" id="as" value="${o.ammoSig || ""}" min="0" placeholder="0"></div></div></div>
      <div class="card"><p class="h">Авсан арга хэмжээ</p>${chips("acts", ACTIONS, o.acts, { multi: true, own: true, search: true })}</div>
      <div class="card" data-req="res"><p class="h">Үр дүн</p>${chips("res", RESULT, o.res)}</div>
      <div class="card"><p class="h">Зураг (заавал биш)</p><div class="photo" id="ph"></div></div>
      <div class="card"><p class="h">Тэмдэглэл</p><textarea id="note" placeholder="Нэмэлт тайлбар">${esc(o.note)}</textarea></div>
      <details class="fold"><summary><span class="grow">Цаг</span><b class="sumv">${fmtDT(o.t)}</b></summary><div class="foldbody">
        <div class="row"><input type="date" id="d" value="${isoDay(o.t)}" style="flex:1.3"><input type="time" id="tm" value="${pad(dt.getHours())}:${pad(dt.getMinutes())}" style="flex:1"></div></div></details>
      <button class="btn ghost" id="del">${o._new ? "Хадгалахгүй болих" : "Ажиглалт устгах"}</button>
      <div class="formfoot"><button class="btn p xl" id="save">Хадгалах</button><button class="btn" id="later">Хадгалаад дараа бөглөх</button></div>`,
    async mount(m) {
      let dirty = false, tried = false;
      const missing = () => REQ.filter(([k]) => k === "n" ? !(o.n > 0) : !asList(o[k]).length);
      const showMiss = () => {
        const x = missing();
        $$("[data-req]", m).forEach(c => c.classList.toggle("miss", tried && x.some(([k]) => k === c.dataset.req)));
        $("#miss", m).innerHTML = tried && x.length ? `<div class="banner warn"><b>Дутуу:</b><span class="grow">${x.map(y => y[1]).join(", ")}. Бөглөх эсвэл «Хадгалаад дараа бөглөх» дарна уу.</span></div>`
          : !o._new && !x.length ? `<div class="banner ok"><b>✓</b><span class="grow">Бүх гол талбар бөглөгдсөн</span></div>` : "";
      };
      const spSel = () => {
        $("#spsel", m).innerHTML = o.sp ? `<div class="spsel"><div class="row"><div class="grow"><div class="spname ${riskOf(o.sp) === 3 ? "r3" : ""}">${esc(o.sp)}</div><div class="small"><i>${esc(latinOf(o.sp))}</i></div></div>${riskBadge(o.sp)}</div>
          ${riskLine(o.sp)}${isNewSp(o) ? `<div class="banner info"><b>Шинэ</b><span class="grow"><b>Шинэ зүйл бүртгэлээ.</b> Нисэх буудлын жагсаалтад өмнө бүртгэгдээгүй.</span></div>` : ""}</div>` : "";
        showMiss();
      };
      const spBtn = (n, big) => `<button type="button" class="chip${big ? " big" : ""}" data-sp="${esc(n)}" aria-pressed="${o.sp === n}"><span class="r${riskOf(n)} dot">●</span>${esc(n)}</button>`;
      const quick = async () => {
        const today = await todaySpecies(o.type);
        const common = (o.type === "Бусад" ? QUICK_OTHER : await usageSorted(o.type === "Шувуу" ? QUICK_BIRD : QUICK_MAMMAL, typeGroup(o.type))).filter(n => !today.includes(n)).slice(0, 10);
        $("#spquick", m).innerHTML = (today.length ? `<div class="splabel">Өнөөдөр ажиглагдсан</div><div class="chips">${today.map(n => spBtn(n, true)).join("")}</div>` : "")
          + `<div class="splabel">Түгээмэл</div><div class="chips">${common.map(n => spBtn(n)).join("")}</div>`;
      };
      const setSp = n => { o.sp = n; dirty = true; $$("#spquick [data-sp]", m).forEach(x => x.setAttribute("aria-pressed", x.dataset.sp === n)); spSel(); };
      spSel(); quick(); showMiss();
      $("#spquick", m).addEventListener("click", e => { const c = e.target.closest("[data-sp]"); if (c) setSp(c.dataset.sp); });
      const q = $("#q", m), sg = $("#sugg", m);
      q.addEventListener("input", () => { const L = searchSpecies(q.value, o.type), v = q.value.trim(); sg.hidden = !v; sg.innerHTML = L.map(s => `<button type="button" data-n="${esc(s[0])}"><span>${esc(s[0])} <em>${esc(s[3])}</em></span>${riskBadge(s[0])}</button>`).join("") + (v ? `<button type="button" data-n="${esc(v)}"><span>«${esc(v)}» гэж өөрөө бичих</span></button>` : ""); });
      sg.addEventListener("click", e => { const c = e.target.closest("[data-n]"); if (!c) return; q.value = ""; sg.hidden = true; setSp(c.dataset.n); });
      const onPick = (k, v) => {
        dirty = true;
        if (k === "type") { o.type = v; o.sp = ""; o.beh = []; $("#behbox", m).innerHTML = behChips(); bindChips($("#behbox", m), onPick); quick(); spSel(); }
        if (k === "beh") o.beh = v;
        if (["arga", "res", "tools", "acts"].includes(k)) o[k] = v;
        if (k === "tools" || k === "acts") { $("#agf", m).hidden = !gun(); $("#asf", m).hidden = !sig(); }
        showMiss();
      };
      bindChips(m, onPick);
      m.addEventListener("input", () => dirty = true);
      const n = $("#n", m);
      const setN = () => { o.n = +n.value > 0 ? Math.round(+n.value) : null; dirty = true; showMiss(); };
      n.addEventListener("input", setN);
      $$(".counter button", m).forEach(x => x.onclick = () => { n.value = Math.max(1, (+n.value || 0) + +x.dataset.d); setN(); });
      $$(".presets button", m).forEach(x => x.onclick = () => { n.value = x.dataset.n; setN(); });
      // Нислэгийн зам: бүтэн дэлгэцээр зурж, "Болсон" дарна
      const ins = o.inspId ? await DB.get("insps", o.inspId) : null, track = ins ? ins.track.map(p => [p[0], p[1]]) : [], me = o.lat ? [o.lat, o.lon] : null;
      let prev = null;
      const drawPath = () => {
        $("#seq", m).textContent = o.pts.length ? pathTxt(o.pts) : "Зам зураагүй";
        $("#draw span", m).textContent = o.pts.length ? "Зам засах" : "Зам зурах";
        prev?.destroy(); prev = null; $("#pathprev", m).innerHTML = "";
        if (o.pts.length) prev = PathMap($("#pathprev", m), { pts: o.pts, track, me, readonly: true });
      };
      drawPath(); App.onCleanup(() => prev?.destroy());
      $("#draw", m).onclick = () => pathEditor({ pts: o.pts, track, me }, pts => { o.pts = pts; dirty = true; drawPath(); });
      $("#loc", m).onchange = async e => { if (e.target.value === "__own") { const v = await promptText("Байршил"); if (v) { e.target.insertAdjacentHTML("afterbegin", `<option selected>${esc(v)}</option>`); } else e.target.value = ""; } };
      const drawPh = async () => {
        const urls = await Promise.all(o.photos.map(id => Store.blobURL(id)));
        $("#ph", m).innerHTML = urls.map((u, k) => `<div class="phrow"><div class="thumbwrap"><img src="${u}" alt="Зураг ${k + 1}"><button type="button" data-rm="${k}" aria-label="Устгах">✕</button></div>
          <textarea data-cap="${o.photos[k]}" rows="2" placeholder="Зургийн тайлбар (заавал биш)">${esc(o.photoNotes[o.photos[k]] || "")}</textarea></div>`).join("") + `<button type="button" class="btn sm soft" id="addph" style="height:84px;min-width:84px">${ICON.cam} Зураг</button>`;
        $$("[data-cap]", m).forEach(x => x.oninput = () => { o.photoNotes[x.dataset.cap] = x.value.trim(); });
        $("#addph", m).onclick = async () => { const b = await photoChoice(); if (!b) return; o.photos.push(await Store.putBlob(b, "Ажиглалтын зураг")); dirty = true; drawPh(); };
        $$("[data-rm]", m).forEach(x => x.onclick = () => { delete o.photoNotes[o.photos[+x.dataset.rm]]; o.photos.splice(+x.dataset.rm, 1); dirty = true; drawPh(); });
      };
      drawPh();
      const collect = () => {
        o.n = +n.value > 0 ? Math.round(+n.value) : null;
        o.ammoGun = gun() ? Math.max(0, +$("#ag", m).value || 0) : 0; o.ammoSig = sig() ? Math.max(0, +$("#as", m).value || 0) : 0;
        o.loc = $("#loc", m).value === "__own" ? "" : $("#loc", m).value; o.note = $("#note", m).value.trim();
        const [hh, mi] = ($("#tm", m).value || "0:0").split(":").map(Number), d = new Date($("#d", m).value + "T00:00"); if (!isNaN(d)) { d.setHours(hh, mi); o.t = d.getTime(); }
      };
      const save = async () => {
        collect(); const wasNew = o._new; delete o._new; delete o._prefilled;
        await Store.saveObs(o); App.guard = null; dirty = false; await DB.setMeta("obsDraft", null);
        toast(o.done ? "Хадгалагдлаа" : "Хадгалагдлаа · дараа нь бөглөнө"); return wasNew;
      };
      $("#save", m).onclick = once(async () => {
        tried = true; showMiss();
        const x = missing();
        if (x.length) { toast("Дутуу: " + x.map(y => y[1]).join(", "), 3000); $(`[data-req="${x[0][0]}"]`, m).scrollIntoView({ behavior: "smooth", block: "center" }); return; }
        await save(); App.back();
      });
      $("#later", m).onclick = once(async () => { await save(); App.back(); });
      $("#del", m).addEventListener("click", async () => {
        if (!await confirmBox(o._new ? "Энэ ажиглалтыг хадгалахгүй болих уу?" : "Энэ ажиглалтыг устгах уу?", { ok: o._new ? "Болих" : "Устгах", cancel: "Үлдэх", danger: true })) return;
        if (!o._new) await Store.delObs(o); App.guard = null; dirty = false; await DB.setMeta("obsDraft", null); toast(o._new ? "Хадгалсангүй" : "Устгагдлаа"); App.back();
      });
      // Апп гэнэт хаагдвал алдагдахгүйн тулд 3 секунд тутам ноорог хадгална
      const dt = setInterval(() => { if (dirty || (o._new && o.sp)) { collect(); DB.setMeta("obsDraft", structuredClone(o)).catch(() => {}); } }, 3000);
      App.onCleanup(() => clearInterval(dt));
      // Хадгалахгүй гарвал мэдээлэл алдагдахгүйн тулд "Дутуу" гэж автоматаар хадгална
      App.guard = async () => {
        if (!dirty && !(o._new && o.sp)) return true;
        await save(); return true;
      };
    }
  };
};

/* Дутуу ажиглалтууд */
Views.todo = async () => {
  const L = (await DB.all("obs")).filter(o => !o.done).sort((a, b) => b.t - a.t);
  return { title: "Дутуу ажиглалт", tab: "home", html: L.length ? `<div class="small">Дарж бөглөнө. Зүйл, юу хийсэн, зан төрх, үр дүн бөглөгдвөл «Бүрэн» болно.</div><div class="list">${L.map(o => obsItem(o).replace('<span class="s">', `<span class="s">${fmtDate(o.t)} · ${esc(o.observer)} · ${esc(routeName(o.route))} · `)).join("")}</div>` : `<div class="empty">Дутуу ажиглалт алга. 👍</div>`, mount: bindObsItems };
};

/* Дууссан үзлэг харах */
Views.inspView = async ({ id }) => {
  const i = await DB.get("insps", id); if (!i) return { title: "Үзлэг", html: `<div class="empty">Олдсонгүй.</div>` };
  const obs = await Store.obsOf(o => o.inspId === i.id);
  return {
    title: `Үзлэг ${routeName(i.route)}`, tab: "home",
    html: `<div class="card"><div class="title">${esc(routeName(i.route))} · ${fmtDate(i.start)}</div><div class="sub">Үзлэгийн төрөл: <b>${kindName(i)}</b><br>${fmtTime(i.start)}–${i.end ? fmtTime(i.end) : "одоо"} · ${esc(i.staff)} · ${i.km || 0} км${i.coworkers?.length ? "<br>" + coLine(i) : ""}${i.routeNote ? "<br>" + esc(i.routeNote) : ""}</div>
      <dl class="kv">${COND.map(c => `<dt>${c.label}</dt><dd>${esc(i.cond?.[c.key] || "")}</dd>`).join("")}${i.temp !== "" ? `<dt>Температур</dt><dd>${i.temp}°C</dd>` : ""}</dl></div>
      <p class="sec">Явсан зам</p><div id="map"></div>
      <p class="sec">Ажиглалт (${obs.length})</p>
      <div class="list">${i.noBird ? `<div class="empty">Шувуу ажиглагдаагүй</div>` : obs.map(obsItem).join("")}</div>
      <button class="btn soft" id="add">${ICON.plus} Энэ үзлэгт ажиглалт нэмэх</button>
      <button type="button" class="btn sm ghost delinsp" id="delinsp">Үзлэг устгах</button>`,
    mount(m) {
      bindObsItems(m);
      $("#delinsp", m).onclick = once(async () => { if (await askDelInsp(i, obs.length)) App.back(); });
      const pm = PathMap($("#map", m), { pts: [], track: i.track.map(p => [p[0], p[1]]), readonly: true }); App.onCleanup(() => pm.destroy());
      $("#add", m).onclick = () => App.go("obs", { inspId: i.id });
    }
  };
};

/* Өмнөх ээлж */
Views.shiftView = async ({ id }) => {
  const s = await DB.get("shifts", id); if (!s) return { title: "Ээлж", html: `<div class="empty">Олдсонгүй.</div>` };
  const insps = (await DB.all("insps")).filter(i => i.shiftId === s.id).sort((a, b) => a.start - b.start);
  const obs = (await DB.all("obs")).filter(o => o.shiftId === s.id), h = s.handover;
  const [gs, rs] = await Promise.all([h?.giver?.selfie, h?.receiver?.selfie].map(x => x ? Store.blobURL(x) : ""));
  const missEq = h ? EQUIPMENT.filter(e => h.equipment?.[e] === false) : [];
  return {
    title: "Ээлж", tab: "home",
    html: `<div class="card"><div class="title" style="font-size:18px">${shiftLine(s)}</div><div class="sub">${esc(s.pos)} · ${esc(s.car)}${s.coworkers?.length ? "<br>" + coLine(s) : ""}</div>
      ${shiftStats(insps, obs)}
      ${ammoInTxt(s) ? `<div class="small">Хүлээн авсан сум: ${esc(ammoInTxt(s))}</div>` : ""}</div>
      ${h ? `<div class="card"><p class="h">${h.pending ? "Хүлээлцээгүй, үлдээсэн" : h.solo ? "Үлдээсэн, шалгаж авсан" : "Хүлээлцсэн"} · ${fmtDT(h.at)}${h.solo && h.takenAt ? " → " + fmtDT(h.takenAt) : ""}</p><div class="row" style="justify-content:space-around;text-align:center">
        <div>${gs ? `<img class="selfie" src="${gs}" alt="">` : ""}<div class="small">Өгсөн</div><b>${esc(h.giver.name)}</b></div>
        <div>${rs ? `<img class="selfie" src="${rs}" alt="">` : ""}<div class="small">Авсан</div><b>${esc(h.receiver.name || "—")}</b></div></div>
        <dl class="kv"><dt>Машин</dt><dd>${esc(h.car.name)} · ${esc(h.car.km)} км</dd><dt>Түлш</dt><dd>${esc(h.car.fuel)}</dd><dt>Цэвэрхэн байдал</dt><dd>${esc(h.car.clean)}</dd><dt>Дохионы сум</dt><dd>${h.sigAmmo ?? "—"}</dd><dt>Ангийн сум</dt><dd>${h.gunAmmo ?? "—"}</dd>${s.supplies?.length ? `<dt>Дундуур авсан, өгсөн</dt><dd>${esc(supplyTxt(s))}</dd>` : ""}${h.ammoAdj && (h.ammoAdj.sigAdj || h.ammoAdj.gunAdj) ? `<dt>Шинэ ээлжид сум</dt><dd>Дохионы ${h.ammoAdj.sigAdj}, Ангийн ${h.ammoAdj.gunAdj}${h.ammoAdj.note ? " · " + esc(h.ammoAdj.note) : ""}</dd>` : ""}${h.check?.note ? `<dt>Шалгаж авсан тэмдэглэл</dt><dd>${esc(h.check.note)}</dd>` : ""}
        ${missEq.map(e => `<dt>${esc(e)}</dt><dd class="r3">Байхгүй${h.equipNotes?.[e] ? ": " + esc(h.equipNotes[e]) : ""}</dd>`).join("")}</dl></div>` : ""}
      <p class="sec">Үзлэгүүд</p><div class="list">${insps.map(x => `<button class="item" data-insp="${x.id}"><span class="t">${esc(routeName(x.route))} · ${fmtTime(x.start)}–${x.end ? fmtTime(x.end) : ""}</span><span class="small">${x.km || 0} км</span><span class="s">${x.noBird ? "Шувуугүй" : countLine(null, obs.filter(o => o.inspId === x.id))}</span></button>`).join("") || `<div class="empty">Үзлэг алга</div>`}</div>`,
    mount(m) { $$("[data-insp]", m).forEach(b => b.onclick = () => App.go("inspView", { id: b.dataset.insp })); }
  };
};

/* Ээлж хүлээлцэх */
Views.handover = async ({ kind } = {}) => {
  const s = Store.shift, solo = kind === "solo", T = solo ? "Хүлээлцэхгүй дуусгах" : "Ээлж хүлээлгэх";
  if (!s) return { title: T, html: `<div class="empty">Идэвхтэй ээлж алга.</div>` };
  if (Store.insp) return { title: T, tab: "home", html: `<div class="banner warn"><b>!</b><span class="grow">${esc(routeName(Store.insp.route))} үзлэг явагдаж байна. Эхлээд үзлэгээ дуусгана уу.</span></div><button class="btn p" id="g">Үзлэг рүү очих</button>`, mount: m => $("#g", m).onclick = () => App.go("insp") };
  const insps = (await DB.all("insps")).filter(i => i.shiftId === s.id), obs = (await DB.all("obs")).filter(o => o.shiftId === s.id);
  const routes = Object.fromEntries(ROUTE_IDS.map(r => [r, insps.filter(i => i.route === r).length]));
  const used = sum(obs, o => +o.ammoSig || 0), gunUsed = sum(obs, o => +o.ammoGun || 0), kills = obs.filter(o => hasArga(o, "Устгал"));
  // Байх ёстой сум = эхэнд авсан + ээлжийн дундуур авсан − зарцуулсан
  const sigIn = supplyN(s, "Дохионы бууны сум"), gunIn = supplyN(s, "Ангийн бууны сум");
  const expected = s.sigAmmoStart != null || sigIn ? (s.sigAmmoStart || 0) + sigIn - used : null, gunExp = s.gunAmmoStart != null || gunIn ? (s.gunAmmoStart || 0) + gunIn - gunUsed : null;
  const todo = obs.filter(o => !o.done).length, staff = await Store.staffList();
  const byArga = ARGA.map(a => [a, obs.filter(o => hasArga(o, a)).length]).filter(x => x[1]);
  const h = { equipment: Object.fromEntries(EQUIPMENT.map(e => [e, true])), equipNotes: {}, sigAmmo: expected, sigExpected: expected, gunAmmo: gunExp, gunExpected: gunExp,
    car: { name: s.car, km: "", fuel: "", checks: Object.fromEntries(CAR_CHECKS.map(c => [c, "Ажилладаг"])), checkNotes: {}, clean: "", damage: "", photos: [] },
    giver: { name: s.staff, pos: s.pos, selfie: null, sign: null }, receiver: { name: "", pos: "", selfie: null, sign: null }, len: 24 };
  const rcv = { staff: null, pos: "", coworkers: [] };
  return {
    title: T, tab: "home",
    html: `${solo ? `<div class="banner info"><b>i</b><span class="grow">Хүлээн авах хүн одоо байхгүй үед ашиглана. Бүх зүйлээ бичиж үлдээнэ. Дараагийн ажилтан «Ээлж авах» дарж шалгаад, сэлфи хийж авна.</span></div>` : ""}${todo ? `<div class="banner warn"><b>${todo}</b><span class="grow">ажиглалт дутуу байна. Хүлээлгэхээс өмнө бөглөхийг зөвлөж байна.</span><button class="btn sm" id="todo">Бөглөх</button></div>` : ""}
      <div class="card"><p class="h">1. Ээлжийн тэмдэглэл (автомат)</p>
        <div class="stats">${ROUTE_IDS.map(r => `<div class="stat"><b>${routes[r]}</b><span>${r === FREE_ROUTE ? "Чөлөөт" : r}</span></div>`).join("")}<div class="stat"><b>${insps.length}</b><span>Нийт үзлэг</span></div></div>
        <dl class="kv"><dt>Зүйл</dt><dd>${new Set(obs.filter(o => o.sp).map(o => o.sp)).size}</dd><dt>Бодгаль</dt><dd>${sum(obs, o => +o.n || 0)}</dd><dt>Давтамж</dt><dd>${obs.length}</dd>${byArga.map(([a, n]) => `<dt>${esc(a)}</dt><dd>${n}</dd>`).join("")}
        <dt>Ангийн бууны сум</dt><dd>${gunUsed}</dd><dt>Дохионы бууны сум</dt><dd>${used}</dd><dt>Устгал</dt><dd>${kills.length ? kills.map(k => esc(k.sp) + " " + k.n).join(", ") : "байхгүй"}</dd>
        <dt>III түвшний шувуу</dt><dd>${obs.filter(o => riskOf(o.sp) === 3).length ? "Харсан" : "Хараагүй"}</dd></dl></div>
      <div class="card"><p class="h">2. Тоног төхөөрөмж</p><div class="small">Байхгүй, эвдэрсэн бол унтрааж, шалтгааныг бичнэ.</div>
        ${EQUIPMENT.map((e, k) => `<div class="eq"><label class="check"><span>${esc(e)}</span><span class="row" style="gap:8px;flex-wrap:nowrap"><span class="small" data-eqs="${k}">Бий</span><input type="checkbox" class="toggle" data-eq="${k}" checked></span></label>
          <input type="text" class="eqnote" data-eqn="${k}" placeholder="Тайлбар: юу болсон, хаана байгаа" hidden></div>`).join("")}
        <div class="row" style="margin-top:6px"><div class="field grow"><span class="label">Дохионы бууны сум</span><input type="number" inputmode="numeric" id="sig" value="${expected ?? ""}" placeholder="Тоолсон"></div>
        <div class="field grow"><span class="label">Ангийн бууны сум</span><input type="number" inputmode="numeric" id="gun" value="${gunExp ?? ""}" placeholder="Тоолсон"></div></div>
        <div class="small">${expected != null ? `Дохионы: хүлээн авсан ${s.sigAmmoStart || 0}${sigIn ? ` ${sigIn < 0 ? "−" : "+"} дундуур ${Math.abs(sigIn)}` : ""} − зарцуулсан ${used} = ${expected}` : `Дохионы сум зарцуулсан: ${used}`} · ${gunExp != null ? `Ангийн: хүлээн авсан ${s.gunAmmoStart || 0}${gunIn ? ` ${gunIn < 0 ? "−" : "+"} дундуур ${Math.abs(gunIn)}` : ""} − зарцуулсан ${gunUsed} = ${gunExp}` : `Ангийн сум зарцуулсан: ${gunUsed}`}</div>
        ${s.supplies?.length ? `<div class="small">Ээлжийн дунд авсан, өгсөн: ${esc(supplyTxt(s))}</div>` : ""}
        <div id="ammoWarn"></div></div>
      <div class="card"><p class="h">3. Машин</p>${chips("car", await Store.carList(), s.car, { fill: true, own: true, ownKeep: KEEP_CAR })}
        <div class="field"><span class="label">Гүйлт (км)</span><input type="number" inputmode="numeric" id="km" placeholder="Одометрийн заалт"></div>
        <div class="field"><span class="label">Түлш</span>${chips("fuel", FUEL, "")}</div>
        ${CAR_CHECKS.map((c, k) => `<div class="field"><span class="label">${esc(c)}</span>${chips("chk" + k, ["Ажилладаг", "Гэмтэлтэй"], "Ажилладаг", { fill: true })}<input type="text" data-chkn="${k}" placeholder="Тайлбар: юу гэмтсэн" hidden></div>`).join("")}
        <div class="field"><span class="label">Цэвэрхэн байдал</span>${chips("clean", CLEAN, "", { fill: true })}</div>
        <div class="field"><span class="label">Гэмтэл, тэмдэглэл</span><textarea id="dmg" placeholder="Байвал бичнэ"></textarea></div>
        <div class="photo" id="carph"></div></div>
      <div class="card"><p class="h">4. ${solo ? "Ээлж үлдээх" : "Хүлээлгэн өгөх"}: ${esc(s.staff)}</p>
        <div class="row"><div id="gself"></div><div class="grow small"><b>Сэлфи заавал.</b> Гарын үсэг заавал биш.</div></div>
        <details class="fold inner"><summary><span class="grow">Гарын үсэг <span class="small">(заавал биш)</span></span></summary><div class="foldbody"><div id="gsig"></div><button type="button" class="btn sm" id="gclr" style="justify-self:end">Арилгах</button></div></details></div>
      ${solo ? "" : `<div class="card"><p class="h">5. Хүлээн авах</p><div id="recv">${staffPicker(staff.filter(x => x[0] !== s.staff), rcv, { mainLabel: "Хүлээн авах ажилтан", coLabel: "Хамт ажиллах" })}</div>
        <div class="field"><span class="label">Шинэ ээлжийн хугацаа</span>${lenChips(24)}</div>
        <p class="h" style="margin-top:6px">Шинэ ээлжийн сум</p>${ammoInHtml({ sig: expected ?? 0, gun: gunExp ?? 0 }, "Тоолсон үлдэгдэл")}
        <div class="row"><div id="rself"></div><div class="grow small">Хүлээн авах ажилтан <b>сэлфи заавал</b> авна.</div></div>
        <details class="fold inner"><summary><span class="grow">Гарын үсэг <span class="small">(заавал биш)</span></span></summary><div class="foldbody"><div id="rsig"></div><button type="button" class="btn sm" id="rclr" style="justify-self:end">Арилгах</button></div></details></div>`}
      <button class="btn p xl" id="done">${solo ? "Үлдээгээд ээлж дуусгах" : "Ээлж хүлээлгэх"}</button>
      <div class="small" style="text-align:center">${solo ? "Дараагийн ажилтан шалгаж авсны дараа ээлжийн ZIP имэйлээр явна." : "Хүлээлгэсний дараа ээлжийн өгөгдөл ZIP болж имэйлээр автоматаар явна."}</div>`,
    mount(m) {
      $("#todo", m)?.addEventListener("click", () => App.go("todo"));
      const warn = () => {
        const w = [], v = $("#sig", m).value, n = +v, g = $("#gun", m).value;
        if (v !== "" && n < AMMO_MIN) w.push(`Дохионы сум ${AMMO_MIN}-өөс цөөн (${n}) байна.`);
        if (v !== "" && expected != null && n !== expected) w.push(`Дохионы сум таарахгүй: байх ёстой ${expected}, тоолсон ${n}.`);
        if (g !== "" && gunExp != null && +g !== gunExp) w.push(`Ангийн сум таарахгүй: байх ёстой ${gunExp}, тоолсон ${+g}.`);
        $("#ammoWarn", m).innerHTML = w.length ? `<div class="banner crit"><b>!</b><span class="grow">${w.join(" ")}</span></div>` : "";
      };
      const cnt = () => { const v = id => $(id, m).value; return { sig: v("#sig") === "" ? 0 : +v("#sig"), gun: v("#gun") === "" ? 0 : +v("#gun") }; };
      const ammo = solo ? null : bindAmmoIn(m, cnt);
      $("#sig", m).oninput = () => { warn(); ammo?.refresh(); }; $("#gun", m).oninput = () => { warn(); ammo?.refresh(); }; warn();
      $$("[data-eq]", m).forEach(x => x.onchange = () => {
        const k = x.dataset.eq; h.equipment[EQUIPMENT[k]] = x.checked;
        $(`[data-eqs="${k}"]`, m).textContent = x.checked ? "Бий" : "Байхгүй"; $(`[data-eqs="${k}"]`, m).classList.toggle("r3", !x.checked);
        const nt = $(`[data-eqn="${k}"]`, m); nt.hidden = x.checked; if (!x.checked) nt.focus();
      });
      bindChips(m, (k, v, b) => {
        if (k === "car") { h.car.name = v; if (b?.dataset.keep) Store.addCar(v); } if (k === "fuel") h.car.fuel = v; if (k === "clean") h.car.clean = v; if (k === "len") h.len = +v;
        if (k.startsWith("chk")) { h.car.checks[CAR_CHECKS[+k.slice(3)]] = v; const nt = $(`[data-chkn="${k.slice(3)}"]`, m); nt.hidden = v !== "Гэмтэлтэй"; if (!nt.hidden) nt.focus(); }
      });
      if (!solo) bindStaffPicker($("#recv", m), rcv);
      selfieField($("#gself", m), h.giver); if (!solo) selfieField($("#rself", m), h.receiver);
      let gp = null, rp = null; // гарын үсгийн талбарыг нээх үед л үүсгэнэ
      $("#gsig", m).closest("details").addEventListener("toggle", e => { if (e.target.open && !gp) { gp = SigPad($("#gsig", m)); $("#gclr", m).onclick = () => gp.clear(); } });
      $("#rsig", m)?.closest("details").addEventListener("toggle", e => { if (e.target.open && !rp) { rp = SigPad($("#rsig", m)); $("#rclr", m).onclick = () => rp.clear(); } });
      const drawCar = async () => {
        const urls = await Promise.all(h.car.photos.map(id => Store.blobURL(id)));
        $("#carph", m).innerHTML = urls.map(u => `<img src="${u}" alt="">`).join("") + `<button type="button" class="btn sm soft" id="addc" style="height:84px">${ICON.cam} Гэмтлийн зураг</button>`;
        $("#addc", m).onclick = async () => { const b = await photoChoice(); if (b) { h.car.photos.push(await Store.putBlob(b, "Машины зураг")); drawCar(); } };
      };
      drawCar();
      $("#done", m).onclick = once(async () => {
        h.car.km = $("#km", m).value; h.car.damage = $("#dmg", m).value.trim();
        const num = id => { const v = $(id, m).value; return v === "" ? null : +v; };
        h.sigAmmo = num("#sig"); h.gunAmmo = num("#gun");
        EQUIPMENT.forEach((e, k) => { if (!h.equipment[e]) h.equipNotes[e] = $(`[data-eqn="${k}"]`, m).value.trim(); });
        CAR_CHECKS.forEach((c, k) => { if (h.car.checks[c] === "Гэмтэлтэй") h.car.checkNotes[c] = $(`[data-chkn="${k}"]`, m).value.trim(); });
        h.receiver.name = rcv.staff || ""; h.receiver.pos = rcv.pos; h.receiver.coworkers = rcv.coworkers;
        const miss = [];
        if (!solo && !h.receiver.name) miss.push("хүлээн авах ажилтан");
        if (!h.giver.selfie) miss.push(solo ? "сэлфи" : "өгөх ажилтны сэлфи");
        if (!solo && !h.receiver.selfie) miss.push("авах ажилтны сэлфи");
        if (!h.car.km) miss.push("машины гүйлт");
        if (!solo && !(h.len > 0)) miss.push("ээлжийн хугацаа");
        const noNote = EQUIPMENT.filter(e => !h.equipment[e] && !h.equipNotes[e]);
        if (noNote.length) miss.push("тайлбар (" + noNote.join(", ") + ")");
        if (miss.length) { toast("Дутуу: " + miss.join(", "), 4000); return; }
        if (solo) {
          if (!await confirmBox(`Хүлээлцэхгүйгээр ээлжээ дуусгаж, зүйлсээ үлдээх үү?<br><span class="small">Дараагийн ажилтан «Ээлж авах» дарж шалгаж авна.</span>`)) return;
          if (gp && !gp.isEmpty()) h.giver.sign = await Store.putBlob(await gp.blob(), "Гарын үсэг");
          h.at = Date.now(); h.solo = true;
          await Store.closeShift(h, { solo: true });
          toast("Ээлж дууслаа. Зүйлс үлдээгдлээ.", 3500); App.go("home", {}, { reset: true }); return;
        }
        if (!await confirmBox(`<b>${esc(s.staff)}</b> → <b>${esc(h.receiver.name)}</b><br>Ээлж хүлээлгэх үү?`)) return;
        if (gp && !gp.isEmpty()) h.giver.sign = await Store.putBlob(await gp.blob(), "Гарын үсэг");
        if (rp && !rp.isEmpty()) h.receiver.sign = await Store.putBlob(await rp.blob(), "Гарын үсэг");
        h.at = Date.now();
        const a = ammo.get(); h.ammoAdj = { sigAdj: a.sigAdj, gunAdj: a.gunAdj, note: a.note };
        const old = await Store.closeShift(h);
        await Store.startShift({ staff: h.receiver.name, pos: h.receiver.pos, coworkers: rcv.coworkers, len: h.len, car: h.car.name, sigAmmo: a.sig, gunAmmo: a.gun, ammoIn: a, from: old.id });
        toast(`Ээлж хүлээлгэлээ. ${h.receiver.name}-ийн ээлж эхэллээ.`, 3500);
        App.go("home", {}, { reset: true });
      });
    }
  };
};

/* Хүлээлцэлгүй үлдээсэн ээлжийг шалгаж авах */
Views.takeover = async () => {
  const old = await Store.pendingShift();
  if (!old || Store.shift) { setTimeout(() => App.go("home", {}, { reset: true })); return { title: "", html: "" }; }
  const h = old.handover, staff = await Store.staffList(), rcv = { staff: null, pos: "", coworkers: [] }, me = { selfie: null }, st = { len: 24 };
  const items = [
    ...EQUIPMENT.map(e => `${e}: ${h.equipment?.[e] === false ? "Байхгүй" + (h.equipNotes?.[e] ? " (" + h.equipNotes[e] + ")" : "") : "Бий"}`),
    `Дохионы бууны сум: ${h.sigAmmo ?? 0}`, `Ангийн бууны сум: ${h.gunAmmo ?? 0}`,
    `Машин: ${h.car?.name || ""} · ${h.car?.km || "—"} км · түлш ${h.car?.fuel || "—"} · ${h.car?.clean || "—"}`,
    ...CAR_CHECKS.map(c => `${c}: ${h.car?.checks?.[c] || ""}${h.car?.checkNotes?.[c] ? " (" + h.car.checkNotes[c] + ")" : ""}`),
    ...(h.car?.damage ? [`Гэмтэл, тэмдэглэл: ${h.car.damage}`] : [])];
  const gs = h.giver?.selfie ? await Store.blobURL(h.giver.selfie) : "";
  return {
    title: "Ээлж авах", tab: "home",
    html: `<div class="card hero"><div class="row">${gs ? `<img class="selfie" src="${gs}" alt="">` : ""}<div class="grow"><div class="title" style="font-size:19px">${esc(old.staff)}-ээс ээлж авч байна</div>
        <div class="sub">${fmtDT(h.at)}-д үлдээсэн. Үлдээсэн зүйлсийг шалгаад авна уу.</div></div></div></div>
      <div class="card"><div class="row between"><p class="h">1. Үлдээсэн зүйлс</p><button type="button" class="btn sm soft" id="all">Бүгдийг шалгасан</button></div>
        ${items.map((t, k) => `<label class="check tk"><span>${esc(t)}</span><input type="checkbox" class="toggle" data-ck="${k}"></label>`).join("")}
        <div class="field"><span class="label">Зөрүү, тайлбар (заавал биш)</span><textarea id="cnote" placeholder="Тоо таарахгүй, дутуу зүйл байвал бичнэ"></textarea></div></div>
      <div class="card"><p class="h">2. Хүлээн авах ажилтан</p><div id="recv">${staffPicker(staff.filter(x => x[0] !== old.staff), rcv, { mainLabel: "Хүлээн авах ажилтан", coLabel: "Хамт ажиллах" })}</div>
        <div class="field"><span class="label">Ээлжийн хугацаа</span>${lenChips(24)}</div></div>
      <div class="card"><p class="h">3. Хүлээн авсан сум</p>${ammoInHtml({ sig: h.sigAmmo ?? 0, gun: h.gunAmmo ?? 0 })}</div>
      <div class="card"><p class="h">4. Сэлфи</p><div class="row"><div id="rself"></div><div class="grow small"><b>Сэлфи заавал.</b> Гарын үсэг заавал биш.</div></div>
        <details class="fold inner"><summary><span class="grow">Гарын үсэг <span class="small">(заавал биш)</span></span></summary><div class="foldbody"><div id="rsig"></div><button type="button" class="btn sm" id="rclr" style="justify-self:end">Арилгах</button></div></details></div>
      <button class="btn p xl" id="done">Ээлж авах</button>`,
    mount(m) {
      bindStaffPicker($("#recv", m), rcv);
      bindChips(m, (k, v) => { if (k === "len") st.len = +v; });
      const ammo = bindAmmoIn(m, () => ({ sig: h.sigAmmo ?? 0, gun: h.gunAmmo ?? 0 }));
      selfieField($("#rself", m), me);
      let rp = null;
      $("#rsig", m).closest("details").addEventListener("toggle", e => { if (e.target.open && !rp) { rp = SigPad($("#rsig", m)); $("#rclr", m).onclick = () => rp.clear(); } });
      $("#all", m).onclick = () => $$("[data-ck]", m).forEach(x => x.checked = true);
      $("#done", m).onclick = once(async () => {
        const left = $$("[data-ck]", m).filter(x => !x.checked).length, miss = [];
        if (left) miss.push(`${left} зүйл шалгаагүй`);
        if (!rcv.staff) miss.push("хүлээн авах ажилтан");
        if (!me.selfie) miss.push("сэлфи");
        if (!(st.len > 0)) miss.push("ээлжийн хугацаа");
        if (miss.length) { toast("Дутуу: " + miss.join(", "), 4000); return; }
        if (!await confirmBox(`<b>${esc(old.staff)}</b> → <b>${esc(rcv.staff)}</b><br>Ээлжийг шалгаж авах уу?`)) return;
        const a = ammo.get(), sign = rp && !rp.isEmpty() ? await Store.putBlob(await rp.blob(), "Гарын үсэг") : null;
        h.ammoAdj = { sigAdj: a.sigAdj, gunAdj: a.gunAdj, note: a.note };
        await Store.takeOver(old, { name: rcv.staff, pos: rcv.pos, coworkers: rcv.coworkers, selfie: me.selfie, sign }, { items: items.length, note: $("#cnote", m).value.trim() });
        await Store.startShift({ staff: rcv.staff, pos: rcv.pos, coworkers: rcv.coworkers, len: st.len, car: h.car?.name || CARS[0], sigAmmo: a.sig, gunAmmo: a.gun, ammoIn: a, from: old.id });
        toast(`${rcv.staff}-ийн ээлж эхэллээ.`, 3500); App.go("home", {}, { reset: true });
      });
    }
  };
};

/* Тайлан */
const RState = { preset: "7", from: null, to: null, who: "" };
function presetRange(p) {
  const now = new Date(), end = dayStart(now) + 86400000;
  if (p === "1") return [dayStart(now), end];
  if (p === "3" || p === "7") return [end - +p * 86400000, end];
  if (p === "m") return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end];
  if (p === "q") return [new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime(), end];
  if (p === "y") return [new Date(now.getFullYear(), 0, 1).getTime(), end];
}
Views.report = async () => {
  if (!RState.from) [RState.from, RState.to] = presetRange(RState.preset);
  const staff = await Store.staffList();
  const R = await Report.compute(RState.from, RState.to, RState.who || null), k = R.k;
  const mx = R.top[0]?.[1] || 1, hm = Math.max(1, ...R.hours), cmax = R.cells[0]?.[1] || 1, rmax = Math.max(1, ...Object.values(R.routes));
  const P = [["1", "Өнөөдөр"], ["3", "3 хоног"], ["7", "7 хоног"], ["m", "Сар"], ["q", "Улирал"], ["y", "Жил"]];
  return {
    title: "Тайлан",
    html: `<div class="card"><div class="seg" role="group" aria-label="Хугацаа">${P.map(([v, l]) => `<button type="button" data-p="${v}" aria-pressed="${RState.preset === v}">${l}</button>`).join("")}</div>
        <div class="dates"><div class="field"><span class="label">Эхлэх</span><input type="date" id="f" value="${isoDay(RState.from)}"></div><div class="field"><span class="label">Дуусах</span><input type="date" id="t" value="${isoDay(RState.to - 1)}"></div></div>
        <div class="field"><span class="label">Ажилтан</span><select id="who"><option value="">Бүгд</option>${staff.map(s => `<option ${s[0] === RState.who ? "selected" : ""}>${esc(s[0])}</option>`).join("")}</select></div></div>
      <div class="card"><p class="h">${esc(Report.title(R).replace("Nubia Bird тайлан ", ""))}</p>
        <div class="stats"><div class="stat"><b>${R.shifts.length}</b><span>Ээлж</span></div><div class="stat"><b>${k.insp}</b><span>Үзлэг${k.extra ? ` (ээлжийн бус ${k.extra})` : ""}</span></div><div class="stat"><b>${k.species}</b><span>Зүйл</span></div>
        <div class="stat"><b>${k.ind}</b><span>Бодгаль</span></div><div class="stat"><b>${k.obs}</b><span>Давтамж</span></div><div class="stat"><b>${k.disp}</b><span>Үргээлэг</span></div>
        <div class="stat"><b>${k.success == null ? "—" : k.success + "%"}</b><span>Үргээлгийн амжилт</span></div>
        <div class="stat"><b>${k.gun}</b><span>Ангийн сум</span></div><div class="stat"><b>${k.sig}</b><span>Дохионы сум</span></div><div class="stat"><b>${k.km}</b><span>Явсан км</span></div></div>
        ${R.flock.freq ? `<div class="flock"><span>Сүрэг (нэг бүртгэлд)</span><b>дундаж ${R.flock.avg}</b><b>min ${R.flock.min}</b><b>max ${R.flock.max}</b></div>` : ""}
        ${k.todo ? `<div class="banner warn"><b>${k.todo}</b><span class="grow">ажиглалт дутуу байна</span></div>` : ""}</div>
      ${k.obs ? `
      <div class="card"><p class="h">Маршрут бүрээр (үзлэг)</p><div class="bars">${ROUTE_IDS.map(r => `<div class="bar"><span>${esc(routeName(r))}</span><i style="width:${R.routes[r] / rmax * 100}%"></i><b>${R.routes[r]}</b></div>`).join("")}</div></div>
      <div class="card"><p class="h">Зүйл бүрээр</p><div class="tblwrap"><table class="sptbl"><thead><tr><th>Зүйл</th><th>Давтамж</th><th>Бодгаль</th><th>Дундаж</th><th>Min</th><th>Max</th></tr></thead><tbody>
        ${R.spStats.map((x, i) => `<tr${i >= 8 ? " hidden data-moresp" : ""}><td><span class="r${riskOf(x.sp)}">●</span> ${esc(x.sp)}</td><td>${x.freq}</td><td><b>${x.ind}</b></td><td>${x.avg}</td><td>${x.min}</td><td>${x.max}</td></tr>`).join("")}</tbody></table></div>
        ${R.spStats.length > 8 ? `<button type="button" class="btn sm soft" id="moresp">Бусад ${R.spStats.length - 8} зүйл</button>` : ""}</div>
      ${R.newSp.length ? `<div class="card"><p class="h">Шинэ зүйл (${R.newSp.length})</p><div class="list">${R.newSp.slice().reverse().map(obsItem).join("")}</div></div>` : ""}
      ${[[3, R.risk3], [2, R.risk2]].map(([lv, L]) => `<div class="card"><p class="h">Эрсдэлийн ${lv === 3 ? "III" : "II"} түвшний ажиглагдсан шувууд</p>
        ${L.length ? L.map(x => `<details class="fold inner"><summary><span class="grow"><span class="r${lv}">●</span> ${esc(x.sp)}</span><span class="small">${x.ind} бодгаль · ${x.obs.length} ажиглалт</span></summary><div class="foldbody"><div class="list">${x.obs.slice().reverse().map(o => obsItem(o).replace('<span class="s">', `<span class="s">${fmtDate(o.t)} · `)).join("")}</div></div></details>`).join("") : `<div class="small">Ажиглагдаагүй</div>`}</div>`).join("")}
      <div class="card"><p class="h">Шувуу их бүртгэгдсэн нүд</p><div id="heat"></div><div class="small">${R.cells.slice(0, 5).map(([c, n]) => `${c}: ${n}`).join(" · ") || "Нислэгийн зам зураагүй"}</div></div>
      <div class="card"><p class="h">Өдрийн цагаар</p><div class="hours">${R.hours.map(h => `<i style="height:${h / hm * 100}%" title="${h}"></i>`).join("")}</div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>
      <div class="card"><p class="h">Ажиглалтууд (${R.obs.length})</p><div class="list">${R.obs.slice(-30).reverse().map(o => obsItem(o).replace('<span class="s">', `<span class="s">${fmtDate(o.t)} · ${esc(o.observer)} · `)).join("")}</div>${R.obs.length > 30 ? `<div class="small">Сүүлийн 30-ыг харуулав. Бүгд PDF, Excel-д орно.</div>` : ""}</div>`
      : `<div class="empty">Энэ хугацаанд ажиглалт алга.</div>`}
      <div class="row"><button class="btn" id="pdf">PDF татах</button><button class="btn" id="xls">Excel татах</button></div>
      <button class="btn soft" id="mail">Имэйлээр илгээх (PDF)</button>`,
    mount(m) {
      $$("[data-p]", m).forEach(b => b.onclick = () => { RState.preset = b.dataset.p; [RState.from, RState.to] = presetRange(b.dataset.p); App.render(); });
      const dates = () => { const f = new Date($("#f", m).value + "T00:00").getTime(), t = new Date($("#t", m).value + "T00:00").getTime() + 86400000; if (f && t && f < t) { RState.from = f; RState.to = t; RState.preset = ""; App.render(); } };
      $("#f", m).onchange = dates; $("#t", m).onchange = dates;
      $("#who", m).onchange = e => { RState.who = e.target.value; App.render(); };
      if ($("#heat", m)) { const pm = PathMap($("#heat", m), { readonly: true, heat: R.cells.map(([c, n]) => [c, n, cmax]) }); App.onCleanup(() => pm.destroy()); }
      bindObsItems(m);
      $("#moresp", m)?.addEventListener("click", e => { $$("[data-moresp]", m).forEach(x => x.hidden = false); e.target.remove(); });
      $("#pdf", m).onclick = () => Report.print(R);
      $("#xls", m).onclick = async () => download(await Export.xlsx({ shifts: R.shifts, insps: R.insps, obs: R.obs }), Report.title(R).replace(/[^\p{L}\p{N}.–-]+/gu, "_") + ".xlsx");
      $("#mail", m).onclick = async () => {
        if (!Store.settings.to.trim()) { toast("Лавлах → Тохиргоонд хүлээн авах имэйл оруулна уу", 3500); return; }
        await Store.queue({ op: "mail", kind: "report", id: uid(), subject: Report.title(R), html: Report.html(R, true) });
        toast(navigator.onLine && Sync.configured() ? "Имэйл илгээж байна…" : "Интернэт орохоор илгээгдэнэ");
      };
    }
  };
};

/* Лавлах ба тохиргоо */
const REPORT_LIST = [...REPORT_SPECIES].map(n => SP_INDEX.get(n)).filter(Boolean);
Views.ref = async () => {
  const S = Store.settings, n = await Store.pending(), staff = await Store.staffList();
  const birds = REPORT_LIST.filter(s => s[1] === "Ш").length;
  return {
    title: "Лавлах",
    html: `<div class="card"><p class="h">Маршрут</p><div class="routes">${ROUTES.map(routeCard).join("")}</div></div>
      <div class="card"><p class="h">Чингис хаан ОУНБ-д тохиолдох зүйлийн жагсаалт</p><div class="sub">${REPORT_LIST.length} зүйл: шувуу ${birds}, хөхтөн ${REPORT_LIST.length - birds}. III түвшний ${REPORT_LIST.filter(s => s[2] === 3).length}, II түвшний ${REPORT_LIST.filter(s => s[2] === 2).length} зүйлд үргээх зөвлөмжтэй.</div>
        <button class="btn soft" data-go="species">Жагсаалт харах</button></div>
      <div class="card"><p class="h">Ажилтан (${staff.length})</p><div class="small">${staff.map(s => esc(s[0]) + " — " + esc(s[1])).join("<br>")}</div></div>
      <p class="sec">Тохиргоо</p>
      <div class="card"><p class="h">Google Sheet холболт</p>
        <div class="field"><span class="label">Apps Script вэб апп хаяг</span><input type="url" id="url" value="${esc(S.url)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
        <div class="field"><span class="label">Нууц түлхүүр</span><input type="text" id="key" value="${esc(S.key)}" autocomplete="off"></div>
        <div class="field"><span class="label">Имэйл хүлээн авагчид (таслалаар)</span><input type="email" id="to" multiple value="${esc(S.to)}" placeholder="name@example.com, …"></div>
        <label class="check"><span>Ээлж хүлээлцсэний дараа ZIP-ийг автоматаар имэйлдэх</span><input type="checkbox" class="toggle" id="auto" ${S.autoMail ? "checked" : ""}></label>
        <div class="row"><button class="btn p" id="saveS">Хадгалах</button><button class="btn" id="test">Шалгах</button></div>
        <div class="banner ${n ? "warn" : "ok"}"><b>${n}</b><span class="grow">илгээгдээгүй зүйл${Sync.lastError ? ` · Алдаа: ${esc(Sync.lastError)}` : ""}</span><button class="btn sm" id="now">Одоо илгээх</button></div>${await outboxIssues()}</div>
      <div class="card"><p class="h">Харагдах байдал</p>${chips("theme", ["auto", "light", "dark"], S.theme || "auto", { fill: true, labels: ["Автомат", "Өдөр", "Шөнө"] })}</div>
      <div class="card"><p class="h">Офлайн газрын зураг</p><div class="small">Хиймэл дагуулын зургийг интернэттэй үед нэг удаа татаж авбал офлайн ажиллана (~20 МБ).</div><button class="btn" id="tiles">Газрын зураг татах</button><div class="small" id="tprog"></div></div>
      <div class="card"><p class="h">Нөөц хуулбар</p><div class="small">Бүх өгөгдөл, зургийг нэг ZIP файлд татна.</div><button class="btn" id="bak">Бүх өгөгдлийг татах</button></div>
      <div class="card"><p class="h">Эх сурвалж</p><div class="row" style="align-items:flex-start;flex-wrap:nowrap"><img src="img/gombobaatar.jpg" alt="Номын нүүр" style="width:84px;border-radius:6px;border:1px solid var(--line)">
        <div class="cite">Зүйлийн нэр: Gombobaatar, S. 2019. <i>Biodiversity of Mongolia: names, distribution and identification of vertebrate species.</i> Mongolica Publishing, NUM & Mongolian Ornithological Society. 468 pp.</div></div>
        <div class="cite">Эрсдэлийн түвшин, зөвлөмж: Биологийн нөөцийг хамгаалах төв (BRCC), Чингис хаан ОУНБ орчмын шувуу, хөхтөн амьтны судалгааны тайлан, 2025.</div>
        <div class="cite">Маршрут, үзлэгийн журам: Зэрлэг амьтан, шувууны аюулаас урьдчилан сэргийлэх хөтөлбөр.</div></div>
      <div class="card about"><div class="row" style="justify-content:center;gap:18px"><img src="img/nubia.png" alt="Nubia" style="height:52px"><img src="img/brcc.jpg" alt="BRCC" style="height:52px"></div>
        <div style="font-weight:700">Nubia Bird ${APP_VERSION}</div>
        <div class="small">${esc(ABOUT)}</div>
        <div class="small"><b>${esc(COPYRIGHT)}</b></div>
        <div class="contact"><p class="h">BRCC-тэй холбогдох</p>
          <a class="btn sm soft" href="mailto:${CONTACT.email}">✉ ${CONTACT.email}</a>
          <a class="btn sm soft" href="tel:${CONTACT.phone}">☎ ${CONTACT.phone}</a></div></div>`,
    mount(m) {
      $$("[data-route]", m).forEach(b => b.onclick = () => App.go("route", { id: b.dataset.route }));
      $$("[data-go]", m).forEach(b => b.onclick = () => App.go(b.dataset.go));
      const read = () => ({ url: $("#url", m).value.trim(), key: $("#key", m).value.trim(), to: $("#to", m).value.trim(), autoMail: $("#auto", m).checked });
      $("#saveS", m).onclick = async () => { await Store.saveSettings(read()); toast("Хадгалагдлаа"); Sync.kick(); };
      $("#test", m).onclick = async () => { await Store.saveSettings(read()); try { const j = await Sync.post({ op: "ping" }); toast("Холбогдлоо ✓ " + (j.sheet || ""), 3500); } catch (e) { toast("Холбогдсонгүй: " + e.message, 4000); } };
      $("#now", m).onclick = async () => { await Sync.run(); App.render(); };
      bindChips(m, async (k, v) => { if (k === "theme") { await Store.saveSettings({ theme: v }); applyTheme(); } });
      $("#bak", m).onclick = async () => { toast("Бэлтгэж байна…"); download(await Export.backup(), `NubiaBird_noots_${isoDay(Date.now())}.zip`); };
      $("#tiles", m).onclick = () => downloadTiles($("#tprog", m));
    }
  };
};
async function outboxIssues() {
  const box = await DB.all("outbox"), bad = box.filter(x => x.tries), mails = box.filter(x => x.op === "mail").length;
  const name = x => ({ file: "Зураг", track: "GPS зам", path: "Нислэгийн зам", shiftpath: "Ээлжийн нислэгийн зам", upsert: "Мөр", delete: "Устгал", mail: "Имэйл" }[x.op] || x.op) + (x.table ? ` (${SHEET_NAMES[x.table] || x.table})` : "");
  return (mails && !Store.settings.to.trim() ? `<div class="banner warn"><b>${mails}</b><span class="grow">имэйл хүлээгдэж байна. Хүлээн авагчийн имэйл оруулбал илгээгдэнэ.</span></div>` : "")
    + (bad.length ? `<div class="small"><b>Алдаатай (${bad.length}):</b><br>${bad.slice(0, 8).map(x => `${esc(name(x))}: ${esc(x.err || "")} · ${x.tries} оролдлого`).join("<br>")}</div>` : "");
}
Views.species = async () => ({
  title: "Тохиолдох зүйлс", tab: "ref",
  html: `<div class="small">Чингис хаан ОУНБ-д тохиолдох зүйлийн жагсаалт (BRCC, 2025). Зүйл дээр дарж эрсдэл, үргээх аргыг харна.</div>
    <input type="search" id="q" placeholder="Нэр, латин нэрээр хайх…">${chips("g", ["Бүгд", "Шувуу", "Хөхтөн", "Эрсдэлтэй"], "Бүгд")}<div class="list" id="L"></div>`,
  mount(m) {
    let g = "Бүгд";
    const draw = () => {
      const q = $("#q", m).value.trim().toLowerCase();
      const L = REPORT_LIST.filter(s => (g === "Бүгд" || (g === "Эрсдэлтэй" ? s[2] > 1 : g === "Шувуу" ? s[1] === "Ш" : s[1] !== "Ш")) && (!q || s[0].toLowerCase().includes(q) || s[3].toLowerCase().includes(q)))
        .sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0], "mn"));
      $("#L", m).innerHTML = L.map(s => `<button type="button" class="item" data-risk="${esc(s[0])}"><span class="t">${esc(s[0])}</span>${riskBadge(s[0])}<span class="s"><i>${esc(s[3])}</i>${riskInfoOf(s[0]) ? " · үргээх зөвлөмжтэй" : ""}</span></button>`).join("") || `<div class="empty">Олдсонгүй</div>`;
    };
    $("#q", m).oninput = draw; bindChips(m, (k, v) => { g = v; draw(); }); draw();
  }
});

/* Хиймэл дагуулын зургийг офлайнд хадгалах */
async function downloadTiles(out) {
  if (!navigator.onLine) { toast("Интернэт хэрэгтэй"); return; }
  const t2 = (lat, lon, z) => { const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); return [x, y]; };
  const corners = [[GRID.x0, GRID.y0], [GRID.x0 + GRID.cols * GRID.cw, GRID.y0 + GRID.rows.length * GRID.ch]].map(p => Geo.pxToLL(p));
  const box = [[Math.max(corners[0][0], corners[1][0]) + .005, Math.min(corners[0][1], corners[1][1]) - .007], [Math.min(corners[0][0], corners[1][0]) - .005, Math.max(corners[0][1], corners[1][1]) + .007]];
  const wide = [[ARP[0] + .13, ARP[1] - .19], [ARP[0] - .13, ARP[1] + .19]]; // ~13 км радиус (М-5)
  const urls = [];
  const add = (b, z0, z1) => { for (let z = z0; z <= z1; z++) { const [x0, y0] = t2(b[0][0], b[0][1], z), [x1, y1] = t2(b[1][0], b[1][1], z); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.push(SAT_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y)); } };
  add(wide, 10, 14); add(box, 15, 17);
  const cache = await caches.open("nubia-tiles"); let done = 0, fail = 0;
  const work = async () => { while (urls.length) { const u = urls.pop(); try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: "cors" }); if (r.ok) await cache.put(u, r); else fail++; } } catch (e) { fail++; } done++; out.textContent = `${done} хэсэг татсан${fail ? `, ${fail} алдаа` : ""}…`; } };
  const total = urls.length; out.textContent = `0 / ${total}`;
  await Promise.all(Array.from({ length: 6 }, work));
  out.textContent = `Дууслаа: ${total - fail} / ${total} хэсэг хадгалагдлаа.`;
  await DB.setMeta("tilesAt", Date.now());
}

/* ---------- Эхлүүлэх ---------- */
function applyTheme() { const t = Store.settings.theme; if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
/* Хадгалах үед алдаа гарвал (утасны зай дүүрсэн г.м) чимээгүй өнгөрөхгүй */
let StorageWarn = "";
addEventListener("unhandledrejection", e => {
  const err = e.reason || {}, full = err.name === "QuotaExceededError" || /quota|space/i.test(err.message || "");
  toast(full ? "⚠ Хадгалж чадсангүй: утасны зай дүүрсэн. Зай гаргаад дахин оролдоно уу." : "⚠ Алдаа гарлаа: " + (err.message || err), 7000);
});
async function checkStorage() {
  try { const { usage, quota } = await navigator.storage.estimate(); StorageWarn = quota && usage / quota > .8 ? `Утасны санах ой ${Math.round(usage / quota * 100)}% дүүрсэн байна.` : ""; } catch (e) { }
}
/* Апп гэнэт хаагдсан бол бөглөж байсан ажиглалтыг сэргээнэ */
async function restoreDraft() {
  const d = await DB.meta("obsDraft", null); if (!d) return;
  await DB.setMeta("obsDraft", null);
  if (d._new && !d.sp) return;
  delete d._new; delete d._prefilled; await Store.saveObs(d);
  toast("Хадгалаагүй үлдсэн ажиглалтыг сэргээлээ", 3500);
}
async function boot() {
  await Store.load(); applyTheme();
  await restoreDraft().catch(() => {});
  Store.cleanBlobs().then(checkStorage).catch(() => {});
  $(".top .back").onclick = () => App.back();
  $(".sync").onclick = () => App.go("ref", {}, { reset: true });
  $$(".nav button").forEach(b => b.onclick = () => App.go(b.dataset.tab, {}, { reset: true }));
  App.go(Store.insp ? "insp" : "home", {}, { reset: true });
  if (Store.insp) Tracker.start();
  const sp = $(".splash"); setTimeout(() => sp.classList.add("out"), 2200); sp.onclick = () => sp.classList.add("out");
  setTimeout(() => sp.remove(), 2700);
  Sync.kick();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
