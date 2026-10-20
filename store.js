// Nubia Bird: ээлж, үзлэг, ажиглалт хадгалах; Google Sheet рүү илгээх дараалал.
"use strict";

const Store = {
  shift: null, insp: null,
  settings: { url: "", key: "", to: "", autoMail: true, theme: "auto" },

  async load() {
    this.settings = Object.assign(this.settings, await DB.meta("settings", {}));
    const sid = await DB.meta("currentShift", null);
    this.shift = sid ? await DB.get("shifts", sid) : null;
    const iid = await DB.meta("currentInsp", null);
    this.insp = iid ? await DB.get("insps", iid) : null;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  },
  async saveSettings(patch) { Object.assign(this.settings, patch); await DB.setMeta("settings", this.settings); },

  /* ----- Ажилтан ----- */
  async staffList() { return STAFF.concat(await DB.meta("staffExtra", [])); },
  /* ----- Машин: үндсэн жагсаалт + "Цаашид хадгалах" гэж нэмсэн ----- */
  async carList() { return CARS.concat(await DB.meta("carsExtra", [])); },
  async addCar(name) {
    const ex = await DB.meta("carsExtra", []);
    if (!CARS.includes(name) && !ex.includes(name)) { ex.push(name); await DB.setMeta("carsExtra", ex); }
  },
  async addStaff(name, pos) {
    const ex = await DB.meta("staffExtra", []);
    if (!ex.some(s => s[0] === name)) { ex.push([name, pos]); await DB.setMeta("staffExtra", ex); }
  },

  /* ----- Ээлж ----- */
  async startShift({ staff, pos, coworkers, len, car, sigAmmo, gunAmmo, from }) {
    const s = { id: uid(), staff, pos, coworkers: coworkers || [], len, car, start: Date.now(), end: null, sigAmmoStart: sigAmmo ?? null,
      gunAmmoStart: gunAmmo ?? null, from: from || null, handover: null, supplies: [] };
    await DB.put("shifts", s); await DB.setMeta("currentShift", s.id);
    this.shift = s; await this.queue({ op: "upsert", table: "shifts", id: s.id });
    return s;
  },
  async closeShift(handover) {
    const s = this.shift; if (!s) return;
    s.end = Date.now(); s.handover = handover;
    await DB.put("shifts", s); await DB.setMeta("currentShift", null);
    for (const b of [handover.giver?.selfie, handover.giver?.sign, handover.receiver?.selfie, handover.receiver?.sign, ...(handover.car?.photos || [])])
      if (b) await this.queue({ op: "file", id: b });
    await this.queue({ op: "upsert", table: "shifts", id: s.id });
    await this.queue({ op: "upsert", table: "handover", id: s.id });
    if (this.settings.autoMail) await this.queue({ op: "mail", kind: "shift", id: s.id });
    this.shift = null;
    return s;
  },
  /* Ээлжийн дунд буу, сум авсан */
  async addSupply(item, n, note) {
    const s = this.shift; if (!s) return;
    (s.supplies ||= []).push({ t: Date.now(), item, n, note });
    await DB.put("shifts", s); await this.queue({ op: "upsert", table: "shifts", id: s.id });
  },

  /* ----- Үзлэг ----- */
  async lastCond() {
    const all = (await DB.all("insps")).sort((a, b) => b.start - a.start);
    return all[0]?.cond || Object.fromEntries(COND.map(c => [c.key, c.opts[0]]));
  },
  /* kind: "shift" (ээлжийн) эсвэл "extra" (ээлжийн бус: ээлжгүй, өөр утсан дээр ч хийж болно) */
  async startInsp({ kind, route, routeNote, cond, temp, staff, pos, coworkers }) {
    const shiftId = kind === "shift" && this.shift ? this.shift.id : null;
    const i = { id: uid(), shiftId, kind: shiftId ? "shift" : "extra", staff, pos, coworkers: coworkers || [], route, routeNote: routeNote || "",
      cond, temp: temp ?? "", start: Date.now(), end: null, noBird: false, track: [], km: 0, note: "" };
    await DB.put("insps", i); await DB.setMeta("currentInsp", i.id);
    this.insp = i; return i;
  },
  async saveInsp(i) { await DB.put("insps", i); if (this.insp && this.insp.id === i.id) this.insp = i; },
  async endInsp(noBird) {
    const i = this.insp; if (!i) return;
    i.end = Date.now(); i.noBird = !!noBird; i.km = Math.round(Geo.trackKm(i.track) * 100) / 100;
    await DB.put("insps", i); await DB.setMeta("currentInsp", null);
    if (i.track.length > 1) await this.queue({ op: "track", id: i.id });
    await this.queue({ op: "upsert", table: "insps", id: i.id });
    this.insp = null; return i;
  },

  /* ----- Ажиглалт ----- */
  newObs(extra = {}) {
    const i = this.insp, s = this.shift;
    return Object.assign({
      id: uid(), inspId: i?.id || null, shiftId: i ? i.shiftId : s?.id || null, observer: i?.staff || s?.staff || "",
      coworkers: (i || s)?.coworkers || [], route: i?.route || "",
      t: Date.now(), lat: null, lon: null, acc: null,
      arga: ["Ажиглалт"], type: "Шувуу", sp: "", n: 1, beh: [], pts: [], loc: "", tools: [], ammoGun: 0, ammoSig: 0,
      acts: [], res: "", note: "", photos: [], photoNotes: {}, done: false
    }, extra);
  },
  isComplete(o) { return !!(o.sp && o.n > 0 && asList(o.arga).length && asList(o.beh).length && o.res); },
  async saveObs(o) {
    o.done = this.isComplete(o); o.newSp = isNewSp(o); o.updated = Date.now();
    // Нислэгийн зам өөрчлөгдвөл KMZ-ийг дахин илгээнэ
    const sig = JSON.stringify([o.pts, o.sp, o.n]);
    if (sig !== o.pathSig) { o.pathSig = sig; o.pathUrl = ""; }
    else if (!o.pathUrl) o.pathUrl = (await DB.get("obs", o.id))?.pathUrl || ""; // маягт нээлттэй байхад илгээгдсэн бол
    await DB.put("obs", o);
    for (const b of o.photos) await this.queue({ op: "file", id: b });
    if (o.pts.length && !o.pathUrl) await this.queue({ op: "path", id: o.id });
    await this.queue({ op: "upsert", table: "obs", id: o.id });
    await this.bumpUsage(o.sp);
    return o;
  },
  async delObs(o) { await DB.del("obs", o.id); await this.queue({ op: "delete", table: "obs", id: o.id }); },
  async bumpUsage(sp) { if (!sp) return; const u = await DB.meta("usage", {}); u[sp] = (u[sp] || 0) + 1; await DB.setMeta("usage", u); },
  async obsOf(filter) { return (await DB.all("obs")).filter(filter).sort((a, b) => a.t - b.t); },

  /* ----- Зураг, гарын үсэг ----- */
  async putBlob(blob, kind) { const b = { id: uid(), blob, kind, type: blob.type, t: Date.now(), url: null }; await DB.put("blobs", b); return b.id; },
  async blobURL(id) { const b = await DB.get("blobs", id); return b ? URL.createObjectURL(b.blob) : ""; },

  /* ----- Илгээх дараалал. Мөрийг илгээх үед нь хамгийн сүүлийн байдлаар нь бүрдүүлнэ. ----- */
  async queue(item) {
    const all = await DB.all("outbox");
    const dup = all.find(x => x.op === item.op && x.ref === item.id && x.table === (item.table || "") && x.kind === (item.kind || ""));
    if (dup && item.op !== "mail") await DB.del("outbox", dup.id); // дахин дараалалын төгсгөлд оруулна
    await DB.put("outbox", { id: uid(), created: Date.now() + Math.random(), op: item.op, ref: item.id || "", table: item.table || "",
      kind: item.kind || "", html: item.html || "", subject: item.subject || "" });
    Sync.kick();
  },
  async pending() { return (await DB.all("outbox")).length; }
};

/* Тайланд (BRCC 2025) бүртгэгдээгүй зүйл бол шинэ зүйл. Гэрийн амьтан ("Бусад") хамаарахгүй. */
const isNewSp = o => !!(o.sp && o.type !== "Бусад" && !REPORT_SPECIES.has(o.sp));
const kindName = x => x.shiftId ? "Ээлжийн" : "Ээлжийн бус";
/* "Юу хийсэн", "Зан төрх" олон сонголттой (массив). Хуучин бичлэг нь мөр байж болно. */
const asList = v => Array.isArray(v) ? v : v ? [v] : [];
const listTxt = v => asList(v).join(", ");
const hasArga = (o, a) => asList(o.arga).includes(a);
const supplyN = (s, item) => sum((s.supplies || []).filter(x => x.item === item), x => +x.n || 0);
const supplyTxt = s => (s.supplies || []).map(x => `${fmtTime(x.t)} ${x.item}${x.item === "Ангийн буу" ? "" : " " + x.n}${x.note ? " (" + x.note + ")" : ""}`).join("; ");
const captionTxt = o => o.photos.map((id, k) => o.photoNotes?.[id] ? `${k + 1}: ${o.photoNotes[id]}` : "").filter(Boolean).join("; ");
const people = x => [x.staff || x.observer, ...(x.coworkers || [])].filter(Boolean);

/* ---------- Sheet-ийн мөрүүд (гарчиг нь монголоор) ---------- */
const Rows = {
  async shifts(s) {
    const insps = (await DB.all("insps")).filter(i => i.shiftId === s.id);
    const obs = (await DB.all("obs")).filter(o => o.shiftId === s.id);
    return {
      "ID": s.id, "Огноо": fmtDate(s.start), "Ажилтан": s.staff, "Албан тушаал": s.pos, "Хамт ажилласан": (s.coworkers || []).join(", "),
      "Эхэлсэн": fmtDT(s.start), "Дууссан": s.end ? fmtDT(s.end) : "", "Хугацаа (цаг)": s.len, "Машин": s.car,
      "Үзлэг": insps.length, "Үргээлэг": obs.filter(o => hasArga(o, "Үргээлэг")).length, "Ажиглалт": obs.length,
      "Ангийн бууны сум": sum(obs, o => +o.ammoGun || 0), "Дохионы бууны сум": sum(obs, o => +o.ammoSig || 0),
      "Дундуур авсан буу, сум": supplyTxt(s),
      "Хүлээн авсан": s.handover?.receiver?.name || "", "Төлөв": s.end ? "Дууссан" : "Явагдаж буй"
    };
  },
  async insps(i) {
    const obs = (await DB.all("obs")).filter(o => o.inspId === i.id);
    const r = { "ID": i.id, "Үзлэгийн төрөл": kindName(i), "Ээлж ID": i.shiftId || "", "Огноо": fmtDate(i.start), "Ажилтан": i.staff,
      "Хамт ажилласан": (i.coworkers || []).join(", "), "Маршрут": routeName(i.route), "Маршрутын тайлбар": i.routeNote || "",
      "Эхэлсэн": fmtTime(i.start), "Дууссан": i.end ? fmtTime(i.end) : "" };
    COND.forEach(c => r[c.label] = i.cond?.[c.key] || "");
    Object.assign(r, { "Температур": i.temp ?? "", "Шувуугүй": i.noBird ? "Тийм" : "", "Ажиглалт": obs.length, "Явсан км": i.km || 0,
      "GPS зам": i.trackUrl || "", "Тэмдэглэл": i.note || "" });
    return r;
  },
  async obs(o) {
    const photos = [];
    for (const id of o.photos) { const b = await DB.get("blobs", id); if (b?.url) photos.push(b.url); }
    return {
      "ID": o.id, "Үзлэг ID": o.inspId || "", "Ээлж ID": o.shiftId || "", "Огноо": fmtDate(o.t), "Цаг": fmtTime(o.t),
      "Ажигласан": o.observer, "Хамт ажилласан": (o.coworkers || []).join(", "), "Үзлэгийн төрөл": kindName(o), "Маршрут": routeName(o.route), "Юу хийсэн": listTxt(o.arga), "Ангилал": o.type,
      "Зүйл": o.sp, "Латин нэр": latinOf(o.sp), "Шинэ зүйл": isNewSp(o) ? "Тийм" : "",
      "Эрсдэл": RISK_LABEL[riskOf(o.sp)], "Тоо": +o.n || 0, "Зан төрх": listTxt(o.beh),
      "Нислэгийн зам (тор)": o.pts.map(p => Geo.cell(p)).join(" → "), "Нислэгийн зам (KMZ)": o.pathUrl || "", "Байршил": o.loc,
      "Өргөрөг": o.lat ?? "", "Уртраг": o.lon ?? "", "Багаж": o.tools.join(", "),
      "Ангийн бууны сум": +o.ammoGun || 0, "Дохионы бууны сум": +o.ammoSig || 0, "Авсан арга хэмжээ": o.acts.join(", "),
      "Үр дүн": o.res, "Тэмдэглэл": o.note, "Зураг": photos.join(" "), "Зургийн тайлбар": captionTxt(o), "Төлөв": o.done ? "Бүрэн" : "Дутуу"
    };
  },
  async handover(s) {
    const h = s.handover || {}, link = async id => id ? ((await DB.get("blobs", id))?.url || "") : "";
    const r = { "ID": s.id, "Огноо цаг": h.at ? fmtDT(h.at) : "", "Хүлээлгэн өгсөн": h.giver?.name || "", "Хүлээн авсан": h.receiver?.name || "",
      "Хүлээн авсан албан тушаал": h.receiver?.pos || "" };
    EQUIPMENT.forEach(e => r[e] = h.equipment?.[e] === false ? "Байхгүй" + (h.equipNotes?.[e] ? ": " + h.equipNotes[e] : "") : h.equipment?.[e] ? "Бий" : "");
    Object.assign(r, { "Дохионы сум (тоолсон)": h.sigAmmo ?? "", "Дохионы сум (байх ёстой)": h.sigExpected ?? "",
      "Ангийн сум (тоолсон)": h.gunAmmo ?? "", "Ангийн сум (байх ёстой)": h.gunExpected ?? "",
      "Машин": h.car?.name || "", "Гүйлт (км)": h.car?.km ?? "", "Түлш": h.car?.fuel || "" });
    CAR_CHECKS.forEach(c => r[c] = (h.car?.checks?.[c] || "") + (h.car?.checkNotes?.[c] ? ": " + h.car.checkNotes[c] : ""));
    Object.assign(r, { "Цэвэрхэн байдал": h.car?.clean || "", "Гэмтэл, тэмдэглэл": h.car?.damage || "" });
    r["Гэмтлийн зураг"] = (await Promise.all((h.car?.photos || []).map(link))).join(" ");
    r["Өгсөн: сэлфи"] = await link(h.giver?.selfie); r["Өгсөн: гарын үсэг"] = await link(h.giver?.sign);
    r["Авсан: сэлфи"] = await link(h.receiver?.selfie); r["Авсан: гарын үсэг"] = await link(h.receiver?.sign);
    return r;
  }
};
const SHEET_NAMES = { shifts: "Ээлж", insps: "Үзлэг", obs: "Ажиглалт", handover: "Хүлээлцэх" };

function trackKml(i) {
  const coords = i.track.map(p => `${p[1]},${p[0]},0`).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(routeName(i.route))} ${fmtDT(i.start)} ${esc(i.staff)}</name><Style id="r"><LineStyle><color>ff2e32b8</color><width>4</width></LineStyle></Style><Placemark><name>${esc(routeName(i.route))} · ${i.km} км</name><styleUrl>#r</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark></Document></kml>`;
}

/* Шувууны нислэгийн зам: ажиглалт бүр нэг шугам, эрсдэлийн түвшнээр өнгөтэй (KML өнгө aabbggrr) */
function birdKml(obs, title) {
  const col = { 3: "ff3f32b8", 2: "ff0a8fd6", 1: "ffa65a2a", 0: "ff94877d" };
  const pm = o => {
    const ll = o.pts.map(p => Geo.pxToLL(p)), c = ll.map(([la, lo]) => `${lo.toFixed(6)},${la.toFixed(6)},0`).join(" ");
    const d = [`${o.n} бодгаль`, fmtDT(o.t), people(o).join(", "), listTxt(o.arga), listTxt(o.beh), o.pts.map(p => Geo.cell(p)).join(" → "), o.res].filter(Boolean).map(esc).join("<br>");
    const geo = ll.length > 1 ? `<LineString><tessellate>1</tessellate><coordinates>${c}</coordinates></LineString>` : `<Point><coordinates>${c}</coordinates></Point>`;
    return `<Placemark><name>${esc(o.sp || "Зүйл тодорхойгүй")} × ${o.n}</name><description><![CDATA[${d}]]></description><styleUrl>#r${riskOf(o.sp)}</styleUrl>${geo}</Placemark>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(title)}</name>${Object.entries(col).map(([k, v]) => `<Style id="r${k}"><LineStyle><color>${v}</color><width>4</width></LineStyle><IconStyle><color>${v}</color></IconStyle></Style>`).join("")}${obs.filter(o => o.pts.length).map(pm).join("")}</Document></kml>`;
}
const birdKmz = (obs, title) => Zip.build([{ name: "doc.kml", data: birdKml(obs, title) }]);

/* ---------- Google Apps Script руу илгээх ---------- */
const Sync = {
  busy: false, lastError: "", lastOk: 0, timer: null, listeners: new Set(),
  kick() { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 800); },
  notify() { this.listeners.forEach(f => f()); },
  configured() { return !!(Store.settings.url && Store.settings.key); },
  async post(payload) {
    const r = await fetch(Store.settings.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ key: Store.settings.key }, payload)), redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Алдаа");
    return j;
  },
  async run() {
    if (this.busy || !this.configured() || !navigator.onLine) { this.notify(); return; }
    this.busy = true; this.notify();
    try {
      const items = (await DB.all("outbox")).sort((a, b) => a.created - b.created);
      for (const it of items) {
        await this.send(it);
        await DB.del("outbox", it.id);
        this.lastOk = Date.now(); this.lastError = ""; this.notify();
      }
    } catch (e) {
      this.lastError = String(e.message || e);
    } finally { this.busy = false; this.notify(); }
  },
  async send(it) {
    if (it.op === "file") {
      const b = await DB.get("blobs", it.ref); if (!b || b.url) return;
      const ext = (b.type || "image/jpeg").includes("png") ? "png" : "jpg";
      const j = await this.post({ op: "file", folder: b.kind || "Зураг", name: `${b.kind || "zurag"}_${fmtDate(b.t).replace(/\./g, "")}_${b.id}.${ext}`, mime: b.type || "image/jpeg", data: await blobToB64(b.blob) });
      b.url = j.url; await DB.put("blobs", b); return;
    }
    if (it.op === "track") {
      const i = await DB.get("insps", it.ref); if (!i) return;
      const j = await this.post({ op: "file", folder: "GPS зам", name: `${i.route}_${isoDay(i.start)}_${fmtTime(i.start).replace(":", "")}_${i.id}.kml`, mime: "application/vnd.google-earth.kml+xml", text: trackKml(i) });
      i.trackUrl = j.url; await DB.put("insps", i); return;
    }
    if (it.op === "path") {
      const o = await DB.get("obs", it.ref); if (!o || !o.pts.length || o.pathUrl) return;
      const name = `${isoDay(o.t)}_${fmtTime(o.t).replace(":", "")}_${(o.sp || "todorhoigui").replace(/\s+/g, "_")}_${o.id}.kmz`;
      const j = await this.post({ op: "file", folder: "Шувууны нислэгийн зам", name, mime: "application/vnd.google-earth.kmz", data: await blobToB64(await birdKmz([o], `${o.sp} ${fmtDT(o.t)}`)) });
      const cur = await DB.get("obs", o.id); if (cur) { cur.pathUrl = j.url; await DB.put("obs", cur); }
      return;
    }
    if (it.op === "upsert") {
      const store = it.table === "handover" ? "shifts" : it.table;
      const rec = await DB.get(store, it.ref); if (!rec) return;
      await this.post({ op: "upsert", sheet: SHEET_NAMES[it.table], rows: [await Rows[it.table](rec)] });
      return;
    }
    if (it.op === "delete") { await this.post({ op: "delete", sheet: SHEET_NAMES[it.table], id: it.ref }); return; }
    if (it.op === "mail") {
      const to = Store.settings.to.trim(); if (!to) return;
      if (it.kind === "shift") {
        const s = await DB.get("shifts", it.ref); if (!s) return;
        const pack = await Export.shiftZip(s);
        await this.post({ op: "mail", to, subject: pack.subject, body: pack.body, html: pack.html, pdfName: pack.pdfName, zip: await blobToB64(pack.zip), zipName: pack.zipName });
      } else {
        await this.post({ op: "mail", to, subject: it.subject, body: "Nubia Bird тайлан хавсаргав.", html: it.html, pdfName: it.subject + ".pdf" });
      }
    }
  }
};
addEventListener("online", () => Sync.kick());
setInterval(() => Sync.kick(), 60000);
