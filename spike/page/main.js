import {
  Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, Conversion, CanvasSink,
  canEncodeVideo, canEncodeAudio,
} from 'mediabunny';

const $ = (id) => document.getElementById(id);
const fmtErr = (e) => `${(e && e.name) || 'Error'}: ${(e && e.message) || e}`;
const mb = (n) => (n / 1048576).toFixed(2);
const sec = (ms) => (ms / 1000).toFixed(1);
const now = () => performance.now();
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch { return ''; } return v; };

// ---------- config (inputs + query string) ----------
$('device').textContent = 'Device: ' + navigator.userAgent;
{
  const q = new URLSearchParams(location.search);
  if (q.get('api')) store('kv.api', q.get('api'));
  if (q.get('key')) store('kv.key', q.get('key'));
  $('api').value = store('kv.api') || '';
  $('key').value = store('kv.key') || '';
  for (const id of ['api', 'key']) $(id).addEventListener('input', () => store('kv.' + id, $(id).value.trim()));
}
// Accept the Apps Script Web app URL with or without "https://"; refuse anything else with a clear message,
// because a relative value would be POSTed to GitHub Pages itself (which answers 405 Not Allowed).
const apiUrl = () => {
  let v = $('api').value.trim();
  if (/^script\.google\.com\//i.test(v)) v = 'https://' + v;
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(v)) {
    throw new Error('The Web app URL must look like https://script.google.com/macros/s/…/exec (copy it from Deploy → Manage deployments)');
  }
  return v;
};
const apiKey = () => $('key').value.trim();

// ---------- step helpers ----------
const status = { 1: '—', 2: '—', 3: '—', 4: '—' };
function chip(n, s) { status[n] = s; const c = $('c' + n); c.textContent = s; c.className = 'chip ' + s; }
const logs = { 1: [], 2: [], 3: [], 4: [] };
function log(n, msg, replaceLast) {
  const el = $('l' + n);
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}`;
  if (replaceLast && logs[n].length) logs[n][logs[n].length - 1] = line; else logs[n].push(line);
  el.textContent = logs[n].join('\n');
  el.scrollTop = el.scrollHeight;
}
function reset(n) { logs[n] = []; $('l' + n).textContent = ''; chip(n, 'RUNNING'); }

async function api(req) {
  if (!$('api').value.trim()) throw new Error('Web app URL is empty');
  const url = apiUrl();
  const t0 = now();
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  const text = await res.text();
  const ms = Math.round(now() - t0);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}, not JSON (${ms} ms): ${text.slice(0, 200)}`); }
  return { json, ms, httpStatus: res.status };
}

const R = { uploads: [], ping: null, upload: null, play: null, shrink: null, still: null, features: null, input: null };

// ---------- Step 1 ----------
$('ping').onclick = async () => {
  reset(1); R.ping = null;
  try {
    const { json, ms } = await api({ op: 'ping' });
    log(1, `${ms} ms\n${JSON.stringify(json, null, 2)}`);
    const d = json.data;
    const pass = json.ok && d && d.dstEndCheck === 'Sun 10:00' && d.dstStartCheck === 'Sun 10:00';
    R.ping = { ok: !!json.ok, ms, data: d, error: json.error };
    if (d) log(1, `Prague: ${d.prague} (hour ${d.pragueHour}), script TZ: ${d.scriptTimeZone}`);
    chip(1, pass ? 'PASS' : 'FAIL');
  } catch (e) { log(1, fmtErr(e)); R.ping = { ok: false, error: fmtErr(e) }; chip(1, 'FAIL'); }
};

// ---------- Step 2 ----------
let source = null; // { blob, name, mime }
let uploaded = null; // { fileId, mime }
function setSource(blob, name, mime) {
  source = { blob, name, mime: mime || 'application/octet-stream' };
  $('fileinfo').textContent = `${name} · ${source.mime} · ${mb(blob.size)} MB`;
}
for (const id of ['rec', 'lib']) {
  $(id).addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setSource(f, f.name, f.type);
    e.target.value = '';
  });
}

function putFile(uploadUrl, blob, mime, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded, ev.total); };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error('network/CORS error'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(blob);
  });
}

async function doUpload(src, label) {
  reset(2); R.upload = null; uploaded = null;
  $('prog').value = 0;
  try {
    log(2, `${label || 'Upload'}: ${src.name} · ${src.mime} · ${mb(src.blob.size)} MB`);
    const { json, ms } = await api({ op: 'session', name: src.name, mime: src.mime, size: src.blob.size, origin: location.origin });
    log(2, `session ${ms} ms: ${json.ok ? 'ok' : 'ERROR ' + json.error}`);
    if (!json.ok) throw new Error(json.error);
    const t0 = now();
    const res = await putFile(json.data.uploadUrl, src.blob, src.mime, (l, t) => {
      const el = (now() - t0) / 1000;
      $('prog').value = (l / t) * 100;
      log(2, `${((l / t) * 100).toFixed(0)}%  ${mb(l)}/${mb(t)} MB  ${(l / 1048576 / Math.max(el, 0.001)).toFixed(2)} MB/s  ${el.toFixed(1)} s`, true);
    });
    const elapsed = (now() - t0) / 1000;
    log(2, `PUT status ${res.status}\n${res.text.slice(0, 300)}`);
    let body = null; try { body = JSON.parse(res.text); } catch { /* ignore */ }
    const pass = (res.status === 200 || res.status === 201) && body && body.id;
    R.upload = { label: label || 'Upload', status: res.status, sizeMB: mb(src.blob.size), seconds: elapsed.toFixed(1), mbps: (src.blob.size / 1048576 / elapsed).toFixed(2), fileId: body && body.id, mime: src.mime };
    R.uploads.push(R.upload);
    if (pass) { uploaded = { fileId: body.id, mime: src.mime }; $('prog').value = 100; }
    chip(2, pass ? 'PASS' : 'FAIL');
    return !!pass;
  } catch (e) {
    log(2, fmtErr(e));
    R.upload = { label: label || 'Upload', error: fmtErr(e) };
    R.uploads.push(R.upload);
    chip(2, 'FAIL');
    return false;
  }
}
$('upload').onclick = () => {
  if (!source) { log(2, 'Choose or record a file first.'); return; }
  doUpload(source);
};

// ---------- Step 3 ----------
let media = null; // current <video>/<img>
const ev3 = { loadedmetadata: 0, canplay: 0, playing: 0, seeking: 0, seeked: 0, stalled: 0, error: null, dims: '', duration: null, isImage: false, loaded: false };

async function doShare() {
  reset(3); R.play = null;
  Object.assign(ev3, { loadedmetadata: 0, canplay: 0, playing: 0, seeking: 0, seeked: 0, stalled: 0, error: null, dims: '', duration: null, isImage: false, loaded: false });
  R.play = ev3;
  $('mediabox').textContent = ''; media = null;
  try {
    if (!uploaded) throw new Error('Nothing uploaded yet (run Step 2 first)');
    const { fileId, mime } = uploaded;
    const { json, ms } = await api({ op: 'share', fileId });
    log(3, `share ${ms} ms: ${JSON.stringify(json)}`);
    if (!json.ok) throw new Error(json.error);
    const src = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey())}`;
    const t0 = now();
    const stamp = (name, extra) => log(3, `+${((now() - t0) / 1000).toFixed(2)}s ${name}${extra ? ' ' + extra : ''}`);
    if (mime.startsWith('image/')) {
      ev3.isImage = true;
      const img = document.createElement('img'); img.className = 'media'; media = img;
      img.onload = () => { ev3.loaded = true; ev3.dims = `${img.naturalWidth}x${img.naturalHeight}`; stamp('image load', ev3.dims); chip(3, 'PASS'); finish(); };
      img.onerror = () => { ev3.error = 'image error'; stamp('image error'); chip(3, 'FAIL'); finish(); };
      img.src = src; $('mediabox').append(img);
      return;
    }
    const v = document.createElement('video');
    v.controls = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'metadata';
    media = v;
    const evalPass = () => { if (ev3.loadedmetadata && ev3.seeked && !ev3.error) { chip(3, 'PASS'); } finish(); };
    v.addEventListener('loadedmetadata', () => { ev3.loadedmetadata++; ev3.duration = v.duration; ev3.dims = `${v.videoWidth}x${v.videoHeight}`; stamp('loadedmetadata', `duration ${v.duration.toFixed(2)} s, ${ev3.dims}`); finish(); });
    for (const n of ['canplay', 'playing', 'seeking', 'stalled']) v.addEventListener(n, () => { ev3[n]++; stamp(n, `t=${v.currentTime.toFixed(2)}`); });
    v.addEventListener('seeked', () => { ev3.seeked++; stamp('seeked', `t=${v.currentTime.toFixed(2)}`); evalPass(); });
    v.addEventListener('error', () => {
      const er = v.error; ev3.error = er ? `code ${er.code}: ${er.message || '(no message)'}` : 'unknown';
      stamp('error', ev3.error); chip(3, 'FAIL'); finish();
    });
    v.src = src;
    $('mediabox').append(v);
    log(3, 'Waiting for events. Press play / "Seek to middle". PASS needs loadedmetadata + a completed seek.');
    chip(3, 'RUNNING');
  } catch (e) { log(3, fmtErr(e)); ev3.error = fmtErr(e); chip(3, 'FAIL'); finish(); }
}
function finish() { R.play = ev3; }
$('share').onclick = doShare;
$('seek').onclick = () => {
  if (!media || !(media instanceof HTMLVideoElement) || !isFinite(media.duration)) { log(3, 'No video with known duration yet.'); return; }
  media.currentTime = media.duration / 2;
  media.play().catch((e) => log(3, 'play(): ' + fmtErr(e)));
};

// ---------- Step 4 ----------
let pickedFile = null;
let shrunk = null; // { blob }
const detect = async () => {
  const f = {
    VideoEncoder: typeof VideoEncoder, VideoDecoder: typeof VideoDecoder,
    AudioEncoder: typeof AudioEncoder, AudioDecoder: typeof AudioDecoder,
  };
  const safe = async (fn) => { try { return await fn(); } catch (e) { return 'err ' + fmtErr(e); } };
  f.avc720 = await safe(() => canEncodeVideo('avc', { width: 1280, height: 720, bitrate: 2_500_000 }));
  f.avc1080 = await safe(() => canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: 2_500_000 }));
  f.aac = await safe(() => canEncodeAudio('aac', { bitrate: 128_000 }));
  R.features = f;
  $('feat').textContent = Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n');
};
detect();

$('pick').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  pickedFile = f; shrunk = null; R.input = null; R.shrink = null; R.still = null;
  $('still').hidden = true; chip(4, '—');
  const out = $('meta4');
  out.textContent = `Reading ${f.name} (${mb(f.size)} MB)...`;
  const input = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
  const info = { name: f.name, type: f.type, sizeMB: mb(f.size) };
  try {
    info.format = (await input.getFormat()).name;
    try { info.duration = await input.computeDuration(); } catch (er) { info.duration = null; info.durationErr = fmtErr(er); }
    const v = await input.getPrimaryVideoTrack();
    if (v) {
      info.vcodec = await v.getCodec();
      info.coded = `${await v.getCodedWidth()}x${await v.getCodedHeight()}`;
      info.display = `${await v.getDisplayWidth()}x${await v.getDisplayHeight()}`;
      info.rotation = await v.getRotation();
    } else info.vcodec = 'none';
    const a = await input.getPrimaryAudioTrack();
    info.acodec = a ? await a.getCodec() : 'none';
    try {
      const tags = await input.getMetadataTags();
      const d = tags.creationTime || tags.date;
      info.created = d instanceof Date && !isNaN(d) ? d.toISOString() + (tags.creationTime ? ' (creationTime)' : ' (date)') : 'none found';
      if (info.created === 'none found' && tags.raw) info.rawTagKeys = Object.keys(tags.raw).join(',');
    } catch (er) { info.created = 'none found (' + fmtErr(er) + ')'; }
  } catch (er) { info.error = fmtErr(er); }
  finally { input.dispose(); }
  R.input = info;
  out.textContent = [
    `file: ${info.name} · ${info.type || '?'} · ${info.sizeMB} MB`,
    info.error ? `ERROR: ${info.error}` : '',
    `duration: ${info.duration != null ? info.duration.toFixed(2) + ' s' : '?'}`,
    `container: ${info.format}`,
    `video: ${info.vcodec} coded ${info.coded} display ${info.display} rotation ${info.rotation}`,
    `audio: ${info.acodec}`,
    `recorded: ${info.created}${info.rawTagKeys ? '\nraw tag keys: ' + info.rawTagKeys : ''}`,
  ].filter(Boolean).join('\n');
});

function targetSize(dw, dh) {
  const landscape = dw >= dh;
  const maxW = landscape ? 1280 : 720, maxH = landscape ? 720 : 1280;
  const s = Math.min(1, maxW / dw, maxH / dh);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(dw * s), height: even(dh * s) };
}

async function grabStill(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const v = await input.getPrimaryVideoTrack();
    if (!v) throw new Error('no video track');
    const dw = await v.getDisplayWidth(), dh = await v.getDisplayHeight();
    const s = Math.min(1, 1080 / Math.max(dw, dh));
    const sink = new CanvasSink(v, { width: Math.round(dw * s), height: Math.round(dh * s), fit: 'fill' });
    const first = await v.getFirstTimestamp();
    const dur = await input.computeDuration();
    const ts = Math.min(first + 1, Math.max(first, dur - 0.05));
    const w = await sink.getCanvas(ts);
    if (!w) throw new Error('no frame at ' + ts);
    const c = w.canvas;
    const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
      : await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob returned null'))), 'image/jpeg', 0.85));
    return { blob, w: c.width, h: c.height, t: w.timestamp };
  } finally { input.dispose(); }
}

async function convert(file, discardAudio, onProgress) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const v = await input.getPrimaryVideoTrack();
    if (!v) throw new Error('no video track');
    const size = targetSize(await v.getDisplayWidth(), await v.getDisplayHeight());
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const conv = await Conversion.init({
      input, output,
      video: { codec: 'avc', width: size.width, height: size.height, fit: 'fill', bitrate: 2_500_000, forceTranscode: true },
      audio: discardAudio ? { discard: true } : { codec: 'aac', bitrate: 128_000 },
    });
    if (!conv.isValid) {
      throw new Error('Conversion invalid; discarded: ' + conv.discardedTracks.map((d) => `${d.track.type}(${d.reason})`).join(', '));
    }
    const dropped = conv.discardedTracks.map((d) => `${d.track.type}(${d.reason})`);
    conv.onProgress = onProgress;
    await conv.execute();
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), size, dropped };
  } finally { input.dispose(); }
}

$('shrink').onclick = async () => {
  if (!pickedFile) { log(4, 'Pick a video first.'); return; }
  reset(4); R.shrink = null; R.still = null; shrunk = null; $('prog4').value = 0; $('still').hidden = true;
  const file = pickedFile;
  const t0 = now();
  const onProgress = (p) => {
    $('prog4').value = p * 100;
    log(4, `progress ${(p * 100).toFixed(0)}%  ${((now() - t0) / 1000).toFixed(1)} s`, true);
  };
  let result = null, audioNote = '', err = null;
  try {
    const aacOk = R.features && R.features.aac === true;
    if (!aacOk) { audioNote = 'AAC cannot be encoded here: audio discarded.'; log(4, audioNote); }
    log(4, 'starting');
    try {
      result = await convert(file, !aacOk, onProgress);
    } catch (e1) {
      if (aacOk) {
        log(4, 'First attempt failed: ' + fmtErr(e1) + '\nRetrying with audio discarded.');
        audioNote = 'AAC attempt failed (' + fmtErr(e1) + '): retried with audio discarded.';
        result = await convert(file, true, onProgress);
      } else throw e1;
    }
  } catch (e) { err = fmtErr(e); log(4, err); }
  const seconds = (now() - t0) / 1000;
  if (result) {
    shrunk = { blob: result.blob };
    const outMB = result.blob.size / 1048576, inMB = file.size / 1048576;
    const dur = (R.input && R.input.duration) || 0;
    const pass = outMB <= 25 && seconds <= 90 && dur <= 61;
    R.shrink = { seconds: seconds.toFixed(1), inMB: inMB.toFixed(2), outMB: outMB.toFixed(2), size: `${result.size.width}x${result.size.height}`, audioNote, dropped: result.dropped.join(','), pass, durationOk: dur <= 61 };
    log(4, `done in ${seconds.toFixed(1)} s · ${inMB.toFixed(2)} MB -> ${outMB.toFixed(2)} MB · ${result.size.width}x${result.size.height}${result.dropped.length ? ' · dropped: ' + result.dropped.join(',') : ''}${audioNote ? '\n' + audioNote : ''}`);
    if (!pass) log(4, `Limits: output <= 25 MB, time <= 90 s, input <= 60 s (input ${dur ? dur.toFixed(1) : '?'} s).`);
    $('prog4').value = 100;
    chip(4, pass ? 'PASS' : 'FAIL');
  } else {
    R.shrink = { seconds: seconds.toFixed(1), error: err, audioNote };
    chip(4, 'FAIL');
  }
  try {
    const s = await grabStill(file);
    R.still = { kb: (s.blob.size / 1024).toFixed(0), size: `${s.w}x${s.h}`, t: s.t.toFixed(2) };
    const img = $('still'); if (img.dataset.u) URL.revokeObjectURL(img.dataset.u);
    img.dataset.u = URL.createObjectURL(s.blob); img.src = img.dataset.u; img.hidden = false;
    log(4, `still frame @${s.t.toFixed(2)} s: ${s.w}x${s.h} JPEG ${(s.blob.size / 1024).toFixed(0)} KB`);
  } catch (e) { R.still = { error: fmtErr(e) }; log(4, 'still frame failed: ' + fmtErr(e)); }
};

$('upsmall').onclick = async () => {
  if (!shrunk) { log(4, 'Run "Shrink to 720p" first.'); return; }
  const base = (pickedFile.name || 'video').replace(/\.[^.]+$/, '');
  const ok = await doUpload({ blob: shrunk.blob, name: base + '-720p.mp4', mime: 'video/mp4' }, 'Small upload');
  log(4, `small upload ${ok ? 'finished (see Step 2)' : 'failed (see Step 2)'}`);
  if (ok) { await doShare(); log(4, 'share + play started (see Step 3)'); }
};

// ---------- report ----------
function report() {
  const L = [];
  const ln = (s) => L.push(s);
  ln('Kvestuj spike report');
  ln('Date: ' + new Date().toString() + ' (' + new Date().toISOString() + ')');
  ln('UA: ' + navigator.userAgent);
  ln('Origin: ' + location.origin);
  { let ok = 'no'; try { apiUrl(); ok = 'yes'; } catch { /* reported as no */ } ln('Web app URL valid: ' + ok + ' · API key filled: ' + (apiKey() ? 'yes' : 'no')); }
  ln('');
  ln(`Step 1 Ping: ${status[1]}`);
  if (R.ping) ln('  ' + (R.ping.data ? JSON.stringify(R.ping.data) + ` (${R.ping.ms} ms)` : R.ping.error));
  ln(`Step 2 Upload: ${status[2]}`);
  for (const u of R.uploads) ln(`  [${u.label}] ` + (u.error ? u.error : `size ${u.sizeMB} MB, ${u.seconds} s (${u.mbps} MB/s), HTTP ${u.status}, mime ${u.mime}, fileId ${u.fileId}`));
  ln(`Step 3 Share + play: ${status[3]}`);
  if (R.play) {
    const p = R.play;
    ln(`  ${p.isImage ? 'image' : 'video'} dims ${p.dims || '?'}, duration ${p.duration != null ? p.duration.toFixed(2) : '?'}, loadedmetadata ${p.loadedmetadata}, canplay ${p.canplay}, playing ${p.playing}, seeking ${p.seeking}, seeked ${p.seeked}, stalled ${p.stalled}, error ${p.error || 'none'}`);
    ln('  seek result: ' + (p.seeked ? 'completed' : 'not completed'));
  }
  ln(`Step 4 Shrink: ${status[4]}`);
  if (R.features) ln('  features: ' + Object.entries(R.features).map(([k, v]) => `${k}=${v}`).join(', '));
  if (R.input) {
    const i = R.input;
    ln(`  input: ${i.name} ${i.sizeMB} MB, ${i.duration != null ? i.duration.toFixed(1) : '?'} s, ${i.format}, ${i.vcodec} coded ${i.coded} display ${i.display} rot ${i.rotation}, audio ${i.acodec}`);
    ln('  recorded date: ' + i.created + (i.rawTagKeys ? ` (raw tags: ${i.rawTagKeys})` : ''));
    if (i.error) ln('  input error: ' + i.error);
  }
  if (R.shrink) ln('  shrink: ' + (R.shrink.error ? 'ERROR ' + R.shrink.error : `${R.shrink.seconds} s, ${R.shrink.inMB} MB -> ${R.shrink.outMB} MB, ${R.shrink.size}`) + (R.shrink.audioNote ? ` | ${R.shrink.audioNote}` : ''));
  if (R.still) ln('  still: ' + (R.still.error ? 'ERROR ' + R.still.error : `${R.still.size} JPEG ${R.still.kb} KB at ${R.still.t} s`));
  return L.join('\n');
}
$('copy').onclick = async () => {
  const text = report();
  const fb = $('fallback');
  try {
    await navigator.clipboard.writeText(text);
    $('copy').textContent = 'Copied!';
    setTimeout(() => { $('copy').textContent = 'Copy report'; }, 1500);
    fb.style.display = 'none';
  } catch {
    fb.value = text; fb.style.display = 'block'; fb.focus(); fb.select();
    $('copy').textContent = 'Copy report (select + copy below)';
  }
};
window.__report = report;
