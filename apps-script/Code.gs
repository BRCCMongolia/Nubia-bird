/**
 * Nubia Bird — Google Sheet холболт (Google Apps Script).
 * Шинэ Gmail хаягийн Google Sheet дотор Extensions → Apps Script-д хуулна.
 * Аппаас ирсэн бичлэгийг хуудсуудад хадгалж, зураг/GPS замыг Drive-д хадгалж, имэйл илгээнэ.
 */

// 1) Энэ түлхүүрийг өөрчилж, аппын Лавлах → Тохиргоо → "Нууц түлхүүр"-т яг адилхан оруулна.
const SECRET_KEY = 'ENE-TULKHUURIIG-SOLINO';
const DRIVE_FOLDER = 'Nubia Bird';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.key !== SECRET_KEY) return out({ ok: false, error: 'Нууц түлхүүр буруу' });
    switch (req.op) {
      case 'ping': return out({ ok: true, sheet: SpreadsheetApp.getActive().getName() });
      case 'upsert': return out(upsert(req.sheet, req.rows));
      case 'delete': return out(removeRow(req.sheet, req.id));
      case 'file': return out(saveFile(req));
      case 'mail': return out(sendMail(req));
    }
    return out({ ok: false, error: 'Тодорхойгүй үйлдэл' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doGet() {
  return out({ ok: true, app: 'Nubia Bird', sheet: SpreadsheetApp.getActive().getName() });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Мөрийг ID-аар нь олж шинэчилнэ, байхгүй бол нэмнэ. Шинэ багана гарвал гарчигт нэмнэ. */
function upsert(name, rows) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); }
    for (const row of rows) {
      let head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
      const missing = Object.keys(row).filter(k => head.indexOf(k) < 0);
      if (missing.length) {
        sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
        head = head.concat(missing);
        sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#dfe7f3');
        sh.setFrozenRows(1);
      }
      const values = head.map(h => row[h] === undefined ? '' : row[h]);
      const idCol = head.indexOf('ID') + 1;
      let at = 0;
      if (idCol && sh.getLastRow() > 1) {
        const f = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).createTextFinder(String(row.ID)).matchEntireCell(true).findNext();
        if (f) at = f.getRow();
      }
      if (at) sh.getRange(at, 1, 1, values.length).setValues([values]);
      else sh.appendRow(values);
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function removeRow(name, id) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { ok: true };
  const f = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (f) sh.deleteRow(f.getRow());
  return { ok: true };
}

function folder(sub) {
  const it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  const root = it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
  if (!sub) return root;
  const s = root.getFoldersByName(sub);
  return s.hasNext() ? s.next() : root.createFolder(sub);
}

/** Зураг (base64) эсвэл текст файл (GPS зам KML) хадгалаад холбоосыг буцаана. */
function saveFile(req) {
  const blob = req.text != null
    ? Utilities.newBlob(req.text, req.mime || 'text/plain', req.name)
    : Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'image/jpeg', req.name);
  const f = folder(req.folder).createFile(blob);
  return { ok: true, id: f.getId(), url: f.getUrl() };
}

/** Имэйл: html-ийг PDF болгоно. zip ирвэл PDF-ийг ZIP дотор нэмээд хавсаргана. */
function sendMail(req) {
  const attachments = [];
  let pdf = null;
  if (req.html) {
    const page = '<html><head><meta charset="utf-8"></head><body>' + req.html + '</body></html>';
    pdf = Utilities.newBlob(page, 'text/html', 'tailan.html').getAs('application/pdf').setName(req.pdfName || 'tailan.pdf');
  }
  if (req.zip) {
    const zipIn = Utilities.newBlob(Utilities.base64Decode(req.zip), 'application/zip', req.zipName || 'nubia.zip');
    const files = Utilities.unzip(zipIn);
    if (pdf) files.push(pdf);
    const zipOut = Utilities.zip(files, req.zipName || 'nubia.zip');
    folder('Ээлжийн ZIP').createFile(zipOut);
    attachments.push(zipOut);
  } else if (pdf) {
    attachments.push(pdf);
    folder('Тайлан').createFile(pdf);
  }
  MailApp.sendEmail({
    to: req.to,
    subject: req.subject || 'Nubia Bird',
    body: req.body || '',
    name: 'Nubia Bird',
    attachments: attachments
  });
  return { ok: true };
}

/** Эхний удаа гараар нэг ажиллуулна: хуудсуудыг үүсгэж, Drive, Gmail зөвшөөрөл өгнө. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ['Ээлж', 'Үзлэг', 'Ажиглалт', 'Хүлээлцэх'].forEach(n => { if (!ss.getSheetByName(n)) ss.insertSheet(n); });
  const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Хуудас1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  folder('Зураг');
  Logger.log('Бэлэн. Илгээх имэйлийн үлдэгдэл квот: ' + MailApp.getRemainingDailyQuota());
}
