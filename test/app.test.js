'use strict';
// 自動テスト: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createApp } = require('../server/app');

let server;
let base;
let tmp;
let app;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-test-'));
  // テストでは「X-Test-Remote: 1」ヘッダー付きのリクエストを LAN 内のスマホからのアクセスとみなす
  app = createApp({ dataDir: tmp, port: 3000, isLocal: (req) => req.headers['x-test-remote'] !== '1' });
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(method, url, body, headers = {}) {
  const h = { 'X-Golf-App': '1', ...headers };
  let payload;
  if (Buffer.isBuffer(body)) payload = body;
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await fetch(base + url, { method, headers: h, body: payload });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

test('変更系リクエストはカスタムヘッダーがないと拒否される（CSRF対策）', async () => {
  const res = await fetch(`${base}/api/courses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(res.status, 403);
});

test('コースとラウンドを登録・取得・更新・削除できる', async () => {
  const course = await call('POST', '/api/courses', {
    name: 'テストGC', rating: 71.0, slope: 125,
    holes: PARS.map((par, i) => ({ hole_no: i + 1, par, yards: 300 + i })),
  });
  assert.equal(course.status, 201);
  assert.equal(course.data.holes.length, 18);

  const holes = PARS.map((par, i) => ({ hole_no: i + 1, par, strokes: par + 1, putts: 2, fairway: par >= 4 ? 'hit' : 'left', penalties: 0 }));
  const r = await call('POST', '/api/rounds', { date: '2026-10-01', course_id: course.data.id, holes });
  assert.equal(r.status, 201);
  assert.equal(r.data.course_name, 'テストGC');
  assert.equal(r.data.holes.length, 18);
  // パー3のフェアウェイは保存されない
  assert.equal(r.data.holes.find((h) => h.par === 3).fairway, null);

  const upd = await call('PUT', `/api/rounds/${r.data.id}`, { date: '2026-10-02', course_id: course.data.id, holes: holes.slice(0, 9) });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.date, '2026-10-02');
  assert.equal(upd.data.holes.length, 9);

  const del = await call('DELETE', `/api/rounds/${r.data.id}`);
  assert.equal(del.status, 200);
  assert.equal((await call('GET', `/api/rounds/${r.data.id}`)).status, 404);
});

test('不正な入力はエラーメッセージ付きで 400 になる', async () => {
  const noCourse = await call('POST', '/api/rounds', { date: '2026-10-01', holes: [] });
  assert.equal(noCourse.status, 400);
  const badDate = await call('POST', '/api/rounds', { date: '2026/10/01', course_name: 'x' });
  assert.equal(badDate.status, 400);
  const putts = await call('POST', '/api/rounds', { date: '2026-10-01', course_name: 'x', holes: [{ hole_no: 1, par: 4, strokes: 3, putts: 3 }] });
  assert.equal(putts.status, 400);
  assert.match(putts.data.error, /パット/);
  const dup = await call('POST', '/api/rounds', { date: '2026-10-01', course_name: 'x', holes: [{ hole_no: 1, par: 4 }, { hole_no: 1, par: 4 }] });
  assert.equal(dup.status, 400);
});

test('クラブと飛距離：まとめて登録し平均が集計される', async () => {
  const club = await call('POST', '/api/clubs', { category: 'iron', name: '7I', loft: 31, target_carry: 150 });
  assert.equal(club.status, 201);
  const add = await call('POST', '/api/distances', {
    records: [148, 150, 152].map((carry) => ({ club_id: club.data.id, date: '2026-11-01', carry, place: 'range' })),
  });
  assert.equal(add.data.inserted, 3);
  const clubs = (await call('GET', '/api/clubs')).data;
  const c = clubs.find((x) => x.id === club.data.id);
  assert.equal(c.shot_count, 3);
  assert.equal(c.avg_carry, 150);
  const bad = await call('POST', '/api/distances', { club_id: club.data.id, date: '2026-11-01' });
  assert.equal(bad.status, 400);
});

test('写真のアップロード・情報更新・削除（ファイルも消える）', async () => {
  const album = await call('POST', '/api/albums', { title: 'テストアルバム' });
  // 1x1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await call('POST', `/api/photos?album_id=${album.data.id}&taken_at=2026-11-01%2010:00`, png, { 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('テスト.png') });
  assert.equal(up.status, 200);
  assert.equal(up.data.original_name, 'テスト.png');
  const file = path.join(tmp, 'photos', up.data.filename);
  assert.ok(fs.existsSync(file));

  const notImage = await call('POST', '/api/photos', Buffer.from('hello'), { 'Content-Type': 'text/plain' });
  assert.equal(notImage.status, 415);

  const upd = await call('PUT', `/api/photos/${up.data.id}`, { caption: '18番グリーン', album_id: album.data.id });
  assert.equal(upd.data.caption, '18番グリーン');
  const albums = (await call('GET', '/api/albums')).data;
  assert.equal(albums.find((a) => a.id === album.data.id).photo_count, 1);

  await call('DELETE', `/api/photos/${up.data.id}`);
  assert.ok(!fs.existsSync(file));
});

test('エクスポートしたデータをインポートで復元できる', async () => {
  const exp = (await call('GET', '/api/export')).data;
  assert.equal(exp.app, 'golf-enjoy-manager');
  const courses = exp.courses.length;
  await call('POST', '/api/courses', { name: '一時コース', holes: [] });
  assert.equal((await call('GET', '/api/courses')).data.length, courses + 1);
  const imp = await call('POST', '/api/import', exp);
  assert.equal(imp.status, 201);
  assert.equal((await call('GET', '/api/courses')).data.length, courses);
  const bad = await call('POST', '/api/import', { foo: 1 });
  assert.equal(bad.status, 400);
});

test('統計計算: パーオン・FWキープ・ハンディキャップ', async () => {
  const stats = await import(pathToFileURL(path.join(__dirname, '../public/js/stats.js')).href);
  const holes = PARS.map((par, i) => ({
    hole_no: i + 1, par,
    strokes: i === 0 ? par - 1 : par + (i % 3 === 0 ? 1 : 0), // 1番バーディ
    putts: i === 0 ? 1 : 2,
    fairway: par >= 4 ? (i % 2 ? 'hit' : 'right') : null,
    penalties: i === 5 ? 1 : 0,
  }));
  const s = stats.summarize({ id: 1, date: '2026-01-01', holes });
  assert.equal(s.complete, true);
  assert.equal(s.par, 72);
  assert.equal(s.results.birdie, 1);
  assert.equal(s.penalties, 1);
  // パーオン: strokes - putts <= par - 2
  const expectedGir = holes.filter((h) => h.strokes - h.putts <= h.par - 2).length;
  assert.equal(s.gir, expectedGir);
  assert.equal(s.fwTotal, 14);

  assert.equal(stats.resultKey(2, 4), 'eagle');
  assert.equal(stats.resultKey(7, 4), 'triple');
  assert.equal(stats.handicapEstimate([s, s]), null); // 3ラウンド未満は算出しない
  const hc = stats.handicapEstimate([s, { ...s, date: '2026-01-02' }, { ...s, date: '2026-01-03' }]);
  // 3ラウンド: 最良1つ − 2.0、レーティング未設定ならパー72・スロープ113
  assert.equal(hc, Math.round(((s.adjStrokes - 72) - 2) * 10) / 10);
  assert.deepEqual(stats.movingAverage([1, 2, 3, 4, 5, 6], 5), [null, null, null, null, 3, 4]);
});

test('サンプルデータは空のときだけ読み込める', async () => {
  const r = await call('POST', '/api/sample');
  assert.equal(r.status, 409); // 既にデータがある
});

// ---------- スマホ（LAN）からのアクセス ----------
const REMOTE = { 'X-Test-Remote': '1' };
const remote = (url, opts = {}) => fetch(base + url, { redirect: 'manual', ...opts, headers: { ...REMOTE, ...(opts.headers || {}) } });

test('スマホからのアクセス：許可していないときは 403', async () => {
  const res = await remote('/');
  assert.equal(res.status, 403);
});

test('スマホからのアクセス：未登録の端末は接続コード画面、QRのキーで登録できる', async () => {
  const on = await call('PUT', '/api/lan', { enabled: true });
  assert.equal(on.status, 200);
  assert.equal(on.data.enabled, true);
  assert.match(on.data.pin, /^\d{6}$/);

  const page = await remote('/');
  assert.equal(page.status, 401);
  assert.match(await page.text(), /接続コード/);
  assert.equal((await remote('/api/rounds')).status, 401);
  assert.equal((await remote('/manifest.webmanifest')).status, 200); // ホーム画面追加用は公開

  const key = app.lan.key();
  assert.equal((await remote('/pair?key=wrong')).status, 401);
  const paired = await remote(`/pair?key=${key}`);
  assert.equal(paired.status, 302);
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  assert.match(paired.headers.get('set-cookie'), /HttpOnly/);

  const ok = await remote('/api/rounds', { headers: { Cookie: cookie } });
  assert.equal(ok.status, 200);
  // スマホからは秘密情報（接続コード）を取得できず、設定変更もできない
  const st = await (await remote('/api/lan', { headers: { Cookie: cookie } })).json();
  assert.equal(st.local, false);
  assert.equal(st.pin, undefined);
  const put = await remote('/api/lan', { method: 'PUT', headers: { Cookie: cookie, 'X-Golf-App': '1', 'Content-Type': 'application/json' }, body: '{"enabled":false}' });
  assert.equal(put.status, 403);
});

test('スマホからのアクセス：接続コードは5回間違えるとロック、リセットで解除', async () => {
  const post = (pin) => remote('/pair', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `pin=${pin}` });
  const pin = app.lan.pin();
  const wrong = pin === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await post(wrong)).status, 401);
  assert.equal((await post(wrong)).status, 429);
  assert.equal((await post(pin)).status, 429); // ロック中は正しいコードでも不可

  const reset = await call('POST', '/api/lan/reset');
  assert.notEqual(reset.data.pin, undefined);
  const ok = await post(reset.data.pin);
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('set-cookie'), /golf_key=/);
});

test('スマホからのアクセス：不正な Host ヘッダーは拒否（DNS リバインディング対策）', async () => {
  const status = await new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path: '/', headers: { Host: 'evil.example.com', ...REMOTE } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('接続用の秘密情報は設定 API やバックアップに含まれない', async () => {
  const s = (await call('GET', '/api/settings')).data;
  assert.equal(Object.keys(s).some((k) => k.startsWith('lan_')), false);
  const exp = (await call('GET', '/api/export')).data;
  assert.equal(exp.settings.some((r) => r.key.startsWith('lan_')), false);
});

test('QR コード：サイズとファインダーパターン', async () => {
  const { qrMatrix } = await import(pathToFileURL(path.join(__dirname, '../public/js/qr.js')).href);
  const m = qrMatrix('http://192.168.1.23:3000/pair?key=0123456789abcdef0123456789abcdef');
  assert.equal(m.length, 37); // バージョン5
  // 左上のファインダーパターン（7x7 の外枠が黒、その内側1周が白）
  for (let i = 0; i < 7; i++) { assert.equal(m[0][i], true); assert.equal(m[6][i], true); }
  for (let i = 1; i < 6; i++) assert.equal(m[1][i], false);
  assert.throws(() => qrMatrix('x'.repeat(300)));
});
