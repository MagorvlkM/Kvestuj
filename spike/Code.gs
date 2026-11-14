/**
 * Kvestuj platform spike (Task 0). Throwaway: deleted once the results are in README "Platform notes".
 *
 * 1. Paste this whole file into a new Apps Script project (replace the default Code.gs).
 * 2. Put your Drive folder ID below.
 * 3. Run `authorize` once from the editor and allow the permissions.
 * 4. Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */
const FOLDER_ID = 'PASTE_YOUR_DRIVE_FOLDER_ID_HERE';

/** Run this once from the editor (Run button) to grant Drive + external-request permissions. */
function authorize() {
  Logger.log('Folder OK: ' + DriveApp.getFolderById(FOLDER_ID).getName());
  const code = UrlFetchApp.fetch('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest', { muteHttpExceptions: true }).getResponseCode();
  Logger.log('UrlFetchApp OK: HTTP ' + code);
  Logger.log('Ping: ' + JSON.stringify(ping_()));
}

function doGet() {
  return json_({ ok: true, data: { hello: 'kvestuj spike' } });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    switch (req.op) {
      case 'ping':
        return json_({ ok: true, data: ping_() });
      case 'session':
        return json_({ ok: true, data: { uploadUrl: createSession_(req.name, req.mime, req.size, req.origin) } });
      case 'share':
        return json_({ ok: true, data: share_(req.fileId) });
      default:
        return json_({ ok: false, error: 'Unknown op: ' + req.op });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Step 1: does Intl with IANA time zones work in Apps Script V8? */
function ping_() {
  const now = new Date();
  const fmt = (tz, d) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d || now);
  return {
    serverNowUtc: now.toISOString(),
    pragueHour: new Intl.DateTimeFormat('en', { timeZone: 'Europe/Prague', hour: 'numeric' }).format(now),
    prague: fmt('Europe/Prague'),
    newYork: fmt('America/New_York'),
    // 2026-10-25 09:00Z is 10:00 in Vienna (after the DST change). Expect "Sun 10:00".
    dstEndCheck: fmt('Europe/Vienna', new Date(Date.UTC(2026, 9, 25, 9, 0))),
    // 2027-03-28 08:00Z is 10:00 in Vienna (after the DST change). Expect "Sun 10:00".
    dstStartCheck: fmt('Europe/Vienna', new Date(Date.UTC(2027, 2, 28, 8, 0))),
    scriptTimeZone: Session.getScriptTimeZone(),
  };
}

/** Step 2: create a Drive resumable-upload session the phone can PUT to directly. */
function createSession_(name, mime, size, origin) {
  if (!/^https:\/\/[^/]+$/.test(String(origin || ''))) throw new Error('origin must look like https://host');
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': String(mime || 'application/octet-stream'),
      'X-Upload-Content-Length': String(size),
      Origin: origin,
    },
    payload: JSON.stringify({ name: 'spike-' + Date.now() + '-' + String(name || 'file'), parents: [FOLDER_ID] }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Drive said HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const headers = res.getAllHeaders();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'location');
  if (!key) throw new Error('Drive returned no Location header');
  return headers[key];
}

/** Step 3: share the uploaded file "anyone with the link can view" (only files inside the spike folder). */
function share_(fileId) {
  const file = DriveApp.getFileById(String(fileId));
  const parents = file.getParents();
  let inFolder = false;
  while (parents.hasNext()) if (parents.next().getId() === FOLDER_ID) inFolder = true;
  if (!inFolder) throw new Error('That file is not in the spike folder');
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: file.getId(), name: file.getName(), size: file.getSize(), mimeType: file.getMimeType() };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
