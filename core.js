// Nubia Bird: өгөгдлийн сан (IndexedDB), газрын солбицол, ZIP/Excel үүсгэгч, туслах функцууд.
"use strict";

/* ---------- Туслах ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, "0");
const fmtDate = t => { const d = new Date(t); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const fmtTime = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDT = t => `${fmtDate(t)} ${fmtTime(t)}`;
const isoDay = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ц ${pad(m % 60)} мин`; };
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x || 0), 0);

const SP_INDEX = new Map(SPECIES.map(s => [s[0], s]));
const riskOf = name => (SP_INDEX.get(name) || [0, 0, 0])[2];
const latinOf = name => (SP_INDEX.get(name) || [0, 0, 0, ""])[3];

/* ---------- IndexedDB ---------- */
const DB = (() => {
  const STORES = ["shifts", "insps", "obs", "blobs", "outbox", "meta"];
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("nubia-bird", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === "meta" ? "k" : "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    get: (st, id) => tx(st, "readonly", s => req(s.get(id))),
    all: (st) => tx(st, "readonly", s => req(s.getAll())),
    put: (st, v) => tx(st, "readwrite", s => req(s.put(v))),
    del: (st, id) => tx(st, "readwrite", s => req(s.delete(id))),
    clear: (st) => tx(st, "readwrite", s => req(s.clear())),
    async meta(k, def) { const r = await this.get("meta", k); return r ? r.v : def; },
    setMeta(k, v) { return this.put("meta", { k, v }); }
  };
})();

/* ---------- Газрын солбицол ↔ торын зураг ----------
   ХБЗ-ын хоёр босгоор (AIP) зургийн пикселийг метр рүү шилжүүлэх ижил төст хувиргалт. */
const Geo = (() => {
  const [A, B] = GEO_REF;
  const lat0 = A.ll[0], lon0 = A.ll[1];
  const mLat = 111132.92 - 559.82 * Math.cos(2 * lat0 * Math.PI / 180);
  const mLon = 111412.84 * Math.cos(lat0 * Math.PI / 180);
  const toM = ([la, lo]) => [(lo - lon0) * mLon, (la - lat0) * mLat];          // (E, N)
  const toLL = ([e, n]) => [lat0 + n / mLat, lon0 + e / mLon];
  // Пиксел → комплекс тоо (y-ийг дээш эргүүлнэ)
  const zi = ([x, y]) => [x - A.px[0], -(y - A.px[1])];
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const k = div(toM(B.ll), zi(B.px)); // пикселийн нэгжийг метр болгох эргэлт+масштаб
  return {
    pxToLL(p) { return toLL(mul(k, zi(p))); },
    llToPx(ll) { const z = div(toM(ll), k); return [z[0] + A.px[0], A.px[1] - z[1]]; },
    cell([x, y]) {
      const c = Math.floor((x - GRID.x0) / GRID.cw) + 1, r = Math.floor((y - GRID.y0) / GRID.ch);
      if (c < 1 || c > GRID.cols || r < 0 || r >= GRID.rows.length) return "Гадна";
      return GRID.rows[r] + c;
    },
    // Торноос гадуурх цэгт хамгийн ойрын нүд
    near([x, y]) {
      const c = Math.min(GRID.cols, Math.max(1, Math.floor((x - GRID.x0) / GRID.cw) + 1)), r = Math.min(GRID.rows.length - 1, Math.max(0, Math.floor((y - GRID.y0) / GRID.ch)));
      return GRID.rows[r] + c;
    },
    cellOfLL(ll) { return this.cell(this.llToPx(ll)); },
    dist(a, b) { // метр, haversine
      const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    },
    trackKm(tr) { let m = 0; for (let i = 1; i < tr.length; i++) m += this.dist(tr[i - 1], tr[i]); return m / 1000; }
  };
})();

/* ---------- ZIP (шахалтгүй) ба Excel (.xlsx) ---------- */
const Zip = (() => {
  const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder();
  async function build(files) { // [{name, data: string|Blob|Uint8Array, date?}]
    const parts = [], central = []; let off = 0;
    const now = new Date();
    const dt = ((now.getFullYear() - 1980) << 25) | ((now.getMonth() + 1) << 21) | (now.getDate() << 16) | (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    for (const f of files) {
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
      const name = enc.encode(f.name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(10, dt, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h, name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint32(12, dt, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(c, name);
      off += 30 + name.length + data.length;
    }
    const csize = sum(central.map(p => p.byteLength));
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e], { type: "application/zip" });
  }
  const x = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const colName = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  async function xlsx(sheets) { // [{name, rows: [[...], ...]}]  эхний мөр = гарчиг
    const sheetXml = rows => {
      const widths = (rows[0] || []).map((_, ci) => Math.min(48, Math.max(8, ...rows.slice(0, 200).map(r => String(r[ci] ?? "").length + 2))));
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
        const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : "";
        return typeof v === "number" && isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
      }).join("")}</row>`).join("")}</sheetData></worksheet>`;
    };
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${x(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDFE7F3"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>` },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) }))
    ];
    const z = await build(files);
    return new Blob([z], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  return { build, xlsx, crc32 };
})();

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(b); });

// Зургийг жижигрүүлж JPEG болгоно (утасны зураг 4–8 МБ байдаг тул)
async function shrinkImage(file, max = 1280, q = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, "image/jpeg", q));
  } finally { URL.revokeObjectURL(url); }
}
