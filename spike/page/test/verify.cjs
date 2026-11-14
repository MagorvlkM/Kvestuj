// Local verification: node test/verify.cjs <media.mp4 for steps 2-3> <input video for step 4> <screenshot.png>
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const [playMp4, shrinkIn, shot] = process.argv.slice(2);
const siteDir = path.resolve(__dirname, '../../site');
const API = 'https://script.example.test/macros/s/FAKE/exec';
const UPLOAD = 'https://upload.example.test/session/abc';
const MEDIA_RE = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/[^?]+\?alt=media&key=TESTKEY/;
const cors = { 'Access-Control-Allow-Origin': '*' };

const server = http.createServer((req, res) => {
  const f = path.join(siteDir, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(siteDir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const t = f.endsWith('.js') ? 'text/javascript' : 'text/html';
  res.writeHead(200, { 'Content-Type': t }); res.end(fs.readFileSync(f));
});

const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
const chipOf = (page, n) => page.textContent('#c' + n);
async function waitChip(page, n, want, timeout) {
  await page.waitForFunction(([n, want]) => ['PASS', 'FAIL'].includes(document.getElementById('c' + n).textContent) && (!want || document.getElementById('c' + n).textContent === want), [n, want], { timeout });
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));

  let uploadedBytes = 0;
  await page.route(API, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*' } });
    const req = JSON.parse(route.request().postData());
    let data;
    if (req.op === 'ping') data = { prague: 'Sat 22:30', pragueHour: '22', scriptTimeZone: 'Europe/Prague', dstEndCheck: 'Sun 10:00', dstStartCheck: 'Sun 10:00' };
    else if (req.op === 'session') { assert(req.origin === base.slice(0, -1) && req.size > 0 && req.mime, 'session request carries origin/size/mime'); data = { uploadUrl: UPLOAD }; }
    else if (req.op === 'share') data = { id: req.fileId, name: 'x', size: 1, mimeType: 'video/mp4' };
    route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data }) });
  });
  await page.route(UPLOAD, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'PUT' } });
    uploadedBytes = route.request().postDataBuffer()?.length || 0;
    route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'fake123', name: 'spike-x', mimeType: 'video/mp4' }) });
  });
  await page.route(MEDIA_RE, async (route) => {
    // support Range requests for seeking
    const buf = fs.readFileSync(playMp4);
    const h = route.request().headers()['range'];
    const base = { ...cors, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
    if (h) {
      const m = /bytes=(\d+)-(\d*)/.exec(h); const s = +m[1]; const e = m[2] ? +m[2] : buf.length - 1;
      return route.fulfill({ status: 206, headers: { ...base, 'Content-Range': `bytes ${s}-${e}/${buf.length}` }, body: buf.subarray(s, e + 1) });
    }
    route.fulfill({ status: 200, headers: base, body: buf });
  });

  await page.goto(base + `?api=${encodeURIComponent(API)}&key=TESTKEY`);
  assert((await page.inputValue('#api')) === API && (await page.inputValue('#key')) === 'TESTKEY', 'query string fills + saves inputs');
  assert((await page.textContent('#device')).includes('Mozilla'), 'device line shown');

  // Step 1
  await page.click('#ping'); await waitChip(page, 1, null, 10000);
  assert((await chipOf(page, 1)) === 'PASS', 'step 1 PASS');

  // Step 2 (via library input)
  await page.setInputFiles('#lib', playMp4);
  assert((await page.textContent('#fileinfo')).includes('MB'), 'file info shown');
  await page.click('#upload'); await waitChip(page, 2, null, 20000);
  assert((await chipOf(page, 2)) === 'PASS', 'step 2 PASS');
  if (uploadedBytes) assert(uploadedBytes === fs.statSync(playMp4).size, 'upload body size matches file'); else console.log('note - Playwright cannot expose Blob PUT body');

  // Step 3
  await page.click('#share');
  await page.waitForFunction(() => document.querySelector('#mediabox video')?.readyState >= 1, null, { timeout: 15000 });
  await page.click('#seek'); await waitChip(page, 3, null, 15000);
  const l3 = await page.textContent('#l3');
  console.log(l3);
  assert((await chipOf(page, 3)) === 'PASS', 'step 3 PASS (loadedmetadata + seeked)');

  // Step 4
  console.log('features:\n' + (await page.textContent('#feat')));
  await page.setInputFiles('#pick', shrinkIn);
  await page.waitForFunction(() => /recorded:/.test(document.getElementById('meta4').textContent), null, { timeout: 15000 });
  console.log('meta4:\n' + (await page.textContent('#meta4')));
  await page.click('#shrink'); await waitChip(page, 4, null, 120000);
  console.log(await page.textContent('#l4'));
  assert((await chipOf(page, 4)) === 'PASS', 'step 4 PASS');
  await page.waitForFunction(() => { const i = document.getElementById('still'); return !i.hidden && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  assert(true, 'still frame displayed');
  await page.click('#upsmall');
  await page.waitForFunction(() => /share \+ play started/.test(document.getElementById('l4').textContent), null, { timeout: 30000 });
  await page.waitForTimeout(500);

  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.click('#copy'); // clipboard may be denied headless: fallback textarea expected
  const rep = await page.evaluate(() => window.__report());
  console.log('---- REPORT ----\n' + rep);
  assert(/Step 1 Ping: PASS/.test(rep) && /fileId fake123/.test(rep) && /Step 4 Shrink: PASS/.test(rep) && /recorded date/.test(rep), 'report has key content');
  const fbShown = await page.evaluate(() => getComputedStyle(document.getElementById('fallback')).display);
  console.log('clipboard path: ' + (fbShown === 'block' ? 'fallback textarea (clipboard denied)' : 'clipboard.writeText worked'));

  await page.screenshot({ path: shot, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: shot.replace(/\.png$/, '-bottom.png') });
  assert(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close();
  console.log('ALL OK');
})().catch(async (e) => { console.error('FAILED', e); process.exit(1); });
