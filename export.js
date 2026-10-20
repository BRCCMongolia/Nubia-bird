// Nubia Bird: тайлангийн тооцоо, PDF (хэвлэх) хуудас, Excel, ээлжийн ZIP.
"use strict";

const Report = {
  async compute(from, to, observer) {
    const inRange = t => t >= from && t < to;
    const who = x => !observer || people(x).includes(observer); // үндсэн ажилтан эсвэл хамт ажилласан
    const shifts = (await DB.all("shifts")).filter(s => inRange(s.start) && who(s));
    const insps = (await DB.all("insps")).filter(i => inRange(i.start) && who(i)).sort((a, b) => a.start - b.start);
    const obs = (await DB.all("obs")).filter(o => inRange(o.t) && who(o)).sort((a, b) => a.t - b.t);
    const disp = obs.filter(o => hasArga(o, "Үргээлэг"));
    const bySp = {}; obs.forEach(o => { if (o.sp) bySp[o.sp] = (bySp[o.sp] || 0) + (+o.n || 0); });
    const top = Object.entries(bySp).sort((a, b) => b[1] - a[1]);
    // Сүргийн хэмжээ: нэг бүртгэлд тоолсон бодгаль. Давтамж = бүртгэлийн тоо, дундаж = нийт бодгаль ÷ давтамж
    const flock = L => { const N = L.map(o => +o.n || 0); return { freq: L.length, ind: sum(L, o => +o.n || 0), avg: L.length ? Math.round(sum(L, o => +o.n || 0) / L.length * 10) / 10 : 0, min: N.length ? Math.min(...N) : 0, max: N.length ? Math.max(...N) : 0 }; };
    const spStats = Object.keys(bySp).map(sp => ({ sp, ...flock(obs.filter(o => o.sp === sp)) })).sort((a, b) => b.ind - a.ind || b.freq - a.freq);
    const hours = Array(24).fill(0); obs.forEach(o => hours[new Date(o.t).getHours()] += 1);
    const cells = {}; obs.forEach(o => {
      const c = o.pts.length ? Geo.cell(o.pts[0]) : (o.lat ? Geo.cellOfLL([o.lat, o.lon]) : null);
      if (c && c !== "Гадна") cells[c] = (cells[c] || 0) + (+o.n || 0);
    });
    const routes = Object.fromEntries(ROUTE_IDS.map(r => [r, insps.filter(i => i.route === r).length]));
    const ok = disp.filter(o => o.res === "Амжилттай").length;
    // Эрсдэлийн түвшнээр: зүйл бүрт бодгаль, ажиглалтын тоо
    const riskSp = lv => Object.values(obs.filter(o => o.sp && riskOf(o.sp) === lv).reduce((a, o) => {
      const x = a[o.sp] ||= { sp: o.sp, ind: 0, obs: [] }; x.ind += +o.n || 0; x.obs.push(o); return a; }, {})).sort((a, b) => b.ind - a.ind);
    return {
      from, to, observer, shifts, insps, obs, top, spStats, flock: flock(obs.filter(o => o.sp)), hours, routes,
      cells: Object.entries(cells).sort((a, b) => b[1] - a[1]),
      risk3: riskSp(3), risk2: riskSp(2), newSp: obs.filter(isNewSp),
      kills: obs.filter(o => hasArga(o, "Устгал")),
      k: {
        insp: insps.length, extra: insps.filter(i => !i.shiftId).length, disp: disp.length, obs: obs.length, ind: sum(obs, o => +o.n || 0), species: top.length,
        success: disp.length ? Math.round(ok / disp.length * 100) : null,
        gun: sum(obs, o => +o.ammoGun || 0), sig: sum(obs, o => +o.ammoSig || 0),
        km: Math.round(sum(insps, i => i.km || 0) * 10) / 10, todo: obs.filter(o => !o.done).length
      }
    };
  },
  title(R) {
    const d1 = fmtDate(R.from), d2 = fmtDate(R.to - 1);
    return `Nubia Bird тайлан ${d1 === d2 ? d1 : d1 + "–" + d2}${R.observer ? " · " + R.observer : ""}`;
  },
  // Хэвлэх / PDF болгох HTML (Apps Script ч мөн адил ашиглана)
  html(R, forMail) {
    const k = R.k, css = forMail ? `<style>body{font-family:Arial,sans-serif;font-size:11pt;color:#111}h1{font-size:17pt;margin:0}h2{font-size:12pt;margin:14pt 0 5pt;border-bottom:1px solid #999}table{width:100%;border-collapse:collapse;font-size:9.5pt}th,td{border:1px solid #bbb;padding:3pt 5pt;text-align:left}.kpi td{text-align:center}.kpi b{display:block;font-size:14pt}.foot{margin-top:16pt;font-size:8pt;color:#555}</style>` : "";
    const row = cells => `<tr>${cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`;
    return `${css}<div class="head"><div><h1>${esc(this.title(R))}</h1><div>Чингис хаан олон улсын нисэх буудал · Шувууны үзлэг шалгалт</div></div>${forMail ? "" : `<img src="img/nubia.png" alt="">`}</div>
      <h2>Үндсэн үзүүлэлт</h2>
      <table class="kpi"><tr>${[["Ээлж", R.shifts.length], ["Үзлэг", k.insp], ["Ээлжийн бус үзлэг", k.extra], ["Зүйл", k.species], ["Бодгаль", k.ind], ["Давтамж", k.obs], ["Үргээлэг", k.disp], ["Амжилт", k.success == null ? "—" : k.success + "%"], ["Ангийн сум", k.gun], ["Дохионы сум", k.sig], ["Явсан км", k.km]].map(([a, b]) => `<td><b>${b}</b>${a}</td>`).join("")}</tr></table>
      ${R.flock.freq ? `<p><b>Сүрэг:</b> дундаж ${R.flock.avg}, min ${R.flock.min}, max ${R.flock.max} бодгаль</p>` : ""}
      <h2>Маршрут бүрээр үзлэг</h2><table><tr>${ROUTE_IDS.map(r => `<th>${esc(routeName(r))}</th>`).join("")}</tr><tr>${ROUTE_IDS.map(r => `<td>${R.routes[r]}</td>`).join("")}</tr></table>
      <h2>Зүйл бүрээр</h2>${R.spStats.length ? `<table><tr><th>№</th><th>Зүйл</th><th>Латин нэр</th><th>Эрсдэл</th><th>Давтамж</th><th>Нийт бодгаль</th><th>Дундаж</th><th>Min</th><th>Max</th></tr>${R.spStats.map((x, i) => row([i + 1, x.sp, latinOf(x.sp), RISK_LABEL[riskOf(x.sp)], x.freq, x.ind, x.avg, x.min, x.max])).join("")}</table>` : "<p>Ажиглалт алга.</p>"}
      ${R.newSp.length ? `<h2>Шинэ зүйл</h2><table><tr><th>Огноо цаг</th><th>Зүйл</th><th>Тоо</th><th>Ажигласан</th></tr>${R.newSp.map(o => row([fmtDT(o.t), o.sp, o.n, o.observer])).join("")}</table>` : ""}
      ${[[3, R.risk3], [2, R.risk2]].map(([lv, L]) => `<h2>Эрсдэлийн ${lv === 3 ? "III" : "II"} түвшний ажиглагдсан шувууд</h2>${L.length ? `<table><tr><th>Зүйл</th><th>Латин нэр</th><th>Бодгаль</th><th>Ажиглалт</th><th>Үргээлэг</th><th>Огноо цаг</th></tr>${L.map(x => row([x.sp, latinOf(x.sp), x.ind, x.obs.length, x.obs.filter(o => hasArga(o, "Үргээлэг")).length, x.obs.map(o => fmtDT(o.t)).join(", ")])).join("")}</table>` : "<p>Ажиглагдаагүй.</p>"}`).join("")}
      ${R.kills.length ? `<h2>Устгал</h2><table><tr><th>Огноо</th><th>Зүйл</th><th>Тоо</th><th>Ажилтан</th></tr>${R.kills.map(o => row([fmtDT(o.t), o.sp, o.n, o.observer])).join("")}</table>` : ""}
      <h2>Бүх ажиглалт (${R.obs.length})</h2>
      <table><tr><th>Огноо цаг</th><th>Ажигласан</th><th>Үзлэгийн төрөл</th><th>Маршрут</th><th>Юу хийсэн</th><th>Зүйл</th><th>Тоо</th><th>Зан төрх</th><th>Зам (тор)</th><th>Арга хэмжээ</th><th>Үр дүн</th></tr>
      ${R.obs.map(o => row([fmtDT(o.t), people(o).join(", "), kindName(o), routeName(o.route), listTxt(o.arga), o.sp || "—", o.n, listTxt(o.beh), pathTxt(o.pts, 0, "→"), [o.tools.join(", "), o.acts.join(", ")].filter(Boolean).join("; "), o.res || "Дутуу"])).join("")}</table>
      <div class="foot">Үүсгэсэн: ${fmtDT(Date.now())} · Nubia Bird. Зүйлийн нэр: Gombobaatar 2019. Эрсдэлийн түвшин: BRCC 2025. ${esc(COPYRIGHT)}</div>`;
  },
  print(R) {
    let p = $("#print"); if (!p) { p = document.createElement("div"); p.id = "print"; document.body.appendChild(p); }
    p.innerHTML = this.html(R, false);
    const t = document.title; document.title = this.title(R);
    setTimeout(() => { window.print(); document.title = t; }, 60);
  }
};

const Export = {
  // Excel: Ээлж, Үзлэг, Ажиглалт, Хүлээлцэх хуудсууд
  async xlsx({ shifts, insps, obs }) {
    const toSheet = async (name, recs, fn) => {
      const rows = await Promise.all(recs.map(r => fn(r)));
      const head = rows.length ? Object.keys(rows[0]) : ["ID"];
      return { name, rows: [head, ...rows.map(r => head.map(h => r[h]))] };
    };
    return Zip.xlsx([
      await toSheet("Ээлж", shifts, r => Rows.shifts(r)),
      await toSheet("Үзлэг", insps, r => Rows.insps(r)),
      await toSheet("Ажиглалт", obs, r => Rows.obs(r)),
      await toSheet("Хүлээлцэх", shifts.filter(s => s.handover), r => Rows.handover(r))
    ]);
  },
  async shiftZip(s) {
    const insps = (await DB.all("insps")).filter(i => i.shiftId === s.id).sort((a, b) => a.start - b.start);
    const obs = (await DB.all("obs")).filter(o => o.shiftId === s.id).sort((a, b) => a.t - b.t);
    const base = `NubiaBird_${isoDay(s.start)}_${s.staff.replace(/[^\p{L}\p{N}.]+/gu, "")}`;
    const files = [{ name: base + ".xlsx", data: await this.xlsx({ shifts: [s], insps, obs }) }], captions = [];
    for (const o of obs) for (const [k, id] of o.photos.entries()) {
      const b = await DB.get("blobs", id), name = `zurag/${b?.name || `Зураг_${stamp(o.t)}_${fileSafe(o.sp || "Зүйл тодорхойгүй")}_${k + 1}.jpg`}`;
      if (b) { files.push({ name, data: b.blob }); if (o.photoNotes?.[id]) captions.push(`${name.slice(6)}: ${o.photoNotes[id]}`); }
    }
    if (captions.length) files.push({ name: "zurag/tailbar.txt", data: captions.join("\r\n") });
    const h = s.handover || {};
    for (const [n, id] of [["ogson_selfi", h.giver?.selfie], ["ogson_garin_useg", h.giver?.sign], ["avsan_selfi", h.receiver?.selfie], ["avsan_garin_useg", h.receiver?.sign], ...(h.car?.photos || []).map((id, i) => ["mashin_gemtel_" + (i + 1), id])]) {
      const b = id && await DB.get("blobs", id); if (b) files.push({ name: `huleelceh/${b.name || n + "." + (b.type.includes("png") ? "png" : "jpg")}`, data: b.blob });
    }
    for (const i of insps) if (i.track.length > 1) files.push({ name: `gps/GPS_${fileSafe(routeName(i.route))}_${stamp(i.start)}.kml`, data: trackKml(i) });
    if (obs.some(o => o.pts.length)) files.push({ name: "shuvuunii_zam.kmz", data: await birdKmz(obs, `Шувууны нислэгийн зам ${fmtDate(s.start)} ${s.staff}`) });
    const R = await Report.compute(s.start, (s.end || Date.now()) + 1, null);
    R.shifts = [s]; R.insps = insps; R.obs = obs;
    const html = this.shiftHtml(s, R);
    files.push({ name: base + "_tovch.html", data: `<!doctype html><meta charset="utf-8"><title>${esc(base)}</title>${html}` });
    return {
      zip: await Zip.build(files), zipName: base + ".zip", pdfName: base + "_tovch.pdf", html,
      subject: `Nubia Bird ээлж ${fmtDT(s.start)}–${fmtTime(s.end || Date.now())} · ${s.staff} → ${h.receiver?.name || ""}`,
      body: `Ээлжийн өгөгдлийг хавсаргав.\n\nАжилтан: ${s.staff} (${s.pos})\nЭхэлсэн: ${fmtDT(s.start)}\nДууссан: ${s.end ? fmtDT(s.end) : ""}\nХүлээн авсан: ${h.receiver?.name || ""}\nҮзлэг: ${insps.length}, давтамж: ${obs.length}, бодгаль: ${sum(obs, o => +o.n || 0)}\n\nNubia Bird · ${COPYRIGHT}`
    };
  },
  shiftHtml(s, R) {
    const h = s.handover || {}, k = R.k;
    return `<style>body{font-family:Arial,sans-serif;font-size:11pt}h1{font-size:16pt;margin:0}h2{font-size:12pt;margin:12pt 0 4pt;border-bottom:1px solid #999}table{border-collapse:collapse;width:100%;font-size:9.5pt}td,th{border:1px solid #bbb;padding:3pt 5pt;text-align:left}</style>
      <h1>Ээлжийн тэмдэглэл · ${esc(fmtDate(s.start))}</h1>
      <div>${esc(s.staff)} (${esc(s.pos)})${s.coworkers?.length ? " · Хамт: " + esc(s.coworkers.join(", ")) : ""} · ${fmtDT(s.start)} – ${s.end ? fmtDT(s.end) : ""} · ${esc(s.car)}</div>
      <h2>Тэмдэглэл</h2>
      <table><tr>${ROUTE_IDS.map(r => `<th>${esc(routeName(r))}</th>`).join("")}<th>Нийт үзлэг</th><th>Зүйл</th><th>Бодгаль</th><th>Давтамж</th><th>Үргээлэг</th><th>Ангийн сум</th><th>Дохионы сум</th></tr>
      <tr>${ROUTE_IDS.map(r => `<td>${R.routes[r] || 0}</td>`).join("")}<td>${k.insp}</td><td>${k.species}</td><td>${k.ind}</td><td>${k.obs}</td><td>${k.disp}</td><td>${k.gun}</td><td>${k.sig}</td></tr></table>
      ${ammoInTxt(s) ? `<p>Хүлээн авсан сум: ${esc(ammoInTxt(s))}</p>` : ""}
      ${s.supplies?.length ? `<p>Ээлжийн дунд авсан: ${esc(supplyTxt(s))}</p>` : ""}
      <p>Устгал: ${R.kills.length ? R.kills.map(o => esc(o.sp) + " " + o.n).join(", ") : "байхгүй"}</p>
      <h2>Үзлэгүүд</h2><table><tr><th>Маршрут</th><th>Цаг</th><th>Нөхцөл</th><th>Ажиглалт</th><th>км</th></tr>
      ${R.insps.map(i => `<tr><td>${esc(routeName(i.route))}</td><td>${fmtTime(i.start)}–${i.end ? fmtTime(i.end) : ""}</td><td>${esc(COND.map(c => i.cond?.[c.key]).join(", "))}</td><td>${i.noBird ? "Шувуугүй" : R.obs.filter(o => o.inspId === i.id).length}</td><td>${i.km || 0}</td></tr>`).join("")}</table>
      <h2>Ажиглалтууд</h2><table><tr><th>Цаг</th><th>Зүйл</th><th>Тоо</th><th>Юу хийсэн</th><th>Зан төрх</th><th>Тор</th><th>Арга хэмжээ</th><th>Үр дүн</th></tr>
      ${R.obs.map(o => `<tr><td>${fmtTime(o.t)}</td><td>${esc(o.sp || "—")}</td><td>${o.n}</td><td>${esc(listTxt(o.arga))}</td><td>${esc(listTxt(o.beh))}</td><td>${esc(pathTxt(o.pts, 0, "→"))}</td><td>${esc([...o.tools, ...o.acts].join(", "))}</td><td>${esc(o.res || "Дутуу")}</td></tr>`).join("")}</table>
      <h2>Хүлээлцсэн тоног төхөөрөмж</h2><table>${Object.entries(h.equipment || {}).map(([a, b]) => `<tr><td>${esc(a)}</td><td>${b ? "Бий" : "Байхгүй" + (h.equipNotes?.[a] ? ": " + esc(h.equipNotes[a]) : "")}</td></tr>`).join("")}<tr><td>Дохионы бууны сум</td><td>${h.sigAmmo ?? ""} (байх ёстой ${h.sigExpected ?? "—"})</td></tr>${s.supplies?.length ? `<tr><td>Ээлжийн дунд авсан</td><td>${esc(supplyTxt(s))}</td></tr>` : ""}<tr><td>Ангийн бууны сум</td><td>${h.gunAmmo ?? ""} (байх ёстой ${h.gunExpected ?? "—"})</td></tr></table>
      <h2>Машин</h2><table><tr><td>Машин</td><td>${esc(h.car?.name || "")}</td></tr><tr><td>Гүйлт</td><td>${esc(h.car?.km ?? "")} км</td></tr><tr><td>Түлш</td><td>${esc(h.car?.fuel || "")}</td></tr>${Object.entries(h.car?.checks || {}).map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}${h.car?.checkNotes?.[a] ? ": " + esc(h.car.checkNotes[a]) : ""}</td></tr>`).join("")}<tr><td>Цэвэрхэн байдал</td><td>${esc(h.car?.clean || "")}</td></tr><tr><td>Гэмтэл</td><td>${esc(h.car?.damage || "Байхгүй")}</td></tr></table>
      <h2>Ээлж хүлээлцсэн</h2><p>${h.solo ? "Хүлээлцэлгүй үлдээгээд дуусгасан. " : ""}Хүлээлгэн өгсөн: <b>${esc(h.giver?.name || "")}</b> · ${h.at ? fmtDT(h.at) : ""} · Хүлээн авсан: <b>${esc(h.receiver?.name || "")}</b> (${esc(h.receiver?.pos || "")})${h.solo && h.takenAt ? " · " + fmtDT(h.takenAt) : ""}. Сэлфи, гарын үсэг ZIP дотор.</p>
      ${h.ammoAdj && (h.ammoAdj.sigAdj || h.ammoAdj.gunAdj) ? `<p>Шинэ ээлжид сум нэмсэн/хассан: Дохионы ${h.ammoAdj.sigAdj}, Ангийн ${h.ammoAdj.gunAdj}${h.ammoAdj.note ? " (" + esc(h.ammoAdj.note) + ")" : ""}</p>` : ""}
      ${h.check?.note ? `<p>Шалгаж авсан тэмдэглэл: ${esc(h.check.note)}</p>` : ""}
      <p style="font-size:8pt;color:#555">Nubia Bird · ${esc(COPYRIGHT)}</p>`;
  },
  async backup() {
    const shifts = await DB.all("shifts"), insps = await DB.all("insps"), obs = await DB.all("obs"), blobs = await DB.all("blobs");
    const files = [{ name: "NubiaBird_buh_ogogdol.xlsx", data: await this.xlsx({ shifts, insps, obs }) },
      { name: "nubia-bird.json", data: JSON.stringify({ version: APP_VERSION, at: Date.now(), shifts, insps, obs }, null, 1) }];
    for (const b of blobs) files.push({ name: `files/${b.kind || "zurag"}_${b.id}.${(b.type || "").includes("png") ? "png" : "jpg"}`, data: b.blob });
    return Zip.build(files);
  }
};
