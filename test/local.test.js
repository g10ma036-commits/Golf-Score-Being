'use strict';
// スマホ単独版（ブラウザ内で動く API）が PC版のサーバーと同じ結果を返すかを確かめるテスト
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { createApp } = require('../server/app');

const mod = (p) => import(pathToFileURL(path.join(__dirname, '..', p)).href);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

let L; // { createLocalBackend, memoryStore }
const servers = [];
const tmps = [];

before(async () => { L = await mod('public/js/local/backend.js'); });
after(() => {
  for (const { server, app } of servers) { server.close(); app.close(); }
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
});

async function startServer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-parity-'));
  tmps.push(tmp);
  const app = createApp({ dataDir: tmp, port: 3000 });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push({ server, app });
  return { base: `http://127.0.0.1:${server.address().port}`, tmp };
}
function newLocal() {
  const store = L.memoryStore();
  let n = 0;
  const backend = L.createLocalBackend(store, { createUrl: () => `blob:test/${++n}`, revokeUrl: () => {} });
  return { backend, store };
}

// 両方に同じリクエストを送り、結果を比較できる形にそろえる
function pair() {
  let srv;
  const loc = newLocal();
  const ready = startServer().then((s) => { srv = s; });
  async function server(method, url, body, headers = {}) {
    const h = { 'X-Golf-App': '1', ...headers };
    let payload;
    if (Buffer.isBuffer(body)) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(srv.base + url, { method, headers: h, body: payload });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: data.error };
  }
  async function local(method, url, body, headers = {}) {
    let b = body;
    if (Buffer.isBuffer(body)) b = new Blob([body], { type: headers['Content-Type'] });
    try {
      return { ok: true, data: await loc.backend.handle(method, url, b, headers) };
    } catch (e) {
      if (e.status === undefined) throw e;
      return { ok: false, status: e.status, error: e.message };
    }
  }
  return { ready, server, local, loc, get srv() { return srv; } };
}

// 日時と写真のファイル名（UUID）は環境ごとに違うので、出現順の記号に置き換える
function normalizer() {
  const names = new Map();
  const fileKey = (v) => {
    if (typeof v !== 'string') return v;
    const k = v.replace(/[0-9a-f-]{36}/, (u) => { if (!names.has(u)) names.set(u, `U${names.size + 1}`); return names.get(u); });
    return k;
  };
  const walk = (x) => {
    // 平均の足し算の順番による小数のごく小さな差（SQLite の AVG と JS の合計）は同じとみなす
    if (typeof x === 'number' && !Number.isInteger(x)) return Math.round(x * 1e9) / 1e9;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(x)) {
        if (['created_at', 'updated_at', 'exported_at'].includes(k)) o[k] = v ? '<ts>' : v;
        else if (['filename', 'thumb', 'cover'].includes(k)) o[k] = fileKey(v);
        else o[k] = walk(v);
      }
      return o;
    }
    return x;
  };
  return walk;
}

async function same(p, method, url, body, headers, label = `${method} ${url}`) {
  const [s, l] = [await p.server(method, url, body, headers), await p.local(method, url, body, headers)];
  p.ns ??= normalizer();
  p.nl ??= normalizer();
  assert.deepEqual(p.nl(l), p.ns(s), label);
  return s.data;
}

test('スマホ単独版の API は PC版サーバーと同じ結果を返す（登録・更新・削除・エラー）', async () => {
  const p = pair();
  await p.ready;
  const S = (m, u, b, h) => same(p, m, u, b, h);

  await S('GET', '/api/settings');
  await S('PUT', '/api/settings', { player_name: ' 太郎 ', unit: 'm' });
  await S('PUT', '/api/settings', { theme: 'rainbow' });
  await S('PUT', '/api/settings', { goal: '100' });
  await S('PUT', '/api/settings', { goal: 'abc' });
  await S('PUT', '/api/settings', { goal: 300 });
  await S('PUT', '/api/settings', { goal: 90 });
  await S('PUT', '/api/settings', { accent: 'blue' });
  await S('PUT', '/api/settings', { accent: 'rainbow' });
  await S('PUT', '/api/settings', { text_size: 'xlarge' });
  await S('PUT', '/api/settings', { text_size: 'huge' });
  await S('PUT', '/api/settings', { background: 'sky' });
  await S('PUT', '/api/settings', { background: 'rainbow' });
  await S('PUT', '/api/settings', { home_layout: JSON.stringify({ order: ['goal', 'next', 'evil', 'goal'], hidden: ['photos', 'x'] }) });
  await S('PUT', '/api/settings', { home_layout: '{壊れた' });
  await S('PUT', '/api/settings', { home_layout: { order: ['next', 'summary', 'goal', 'links', 'trend', 'recent', 'memory', 'photos'], hidden: [] } });
  await S('PUT', '/api/settings', { next_round: { date: '2026-12-01', course_id: 1 } });
  await S('PUT', '/api/settings', { next_round: '{"date":"2026-02-30"}' });
  await S('PUT', '/api/settings', { next_round: 'abc' });
  await S('GET', '/api/settings');

  // コース
  const holes = PARS.map((par, i) => ({ hole_no: i + 1, par, yards: 300 + i, hdcp: (i % 18) + 1, ...(i === 0 ? { memo: ' 左はOB ' } : {}) }));
  await S('POST', '/api/courses', { name: 'b テストGC', rating: 71.2, slope: 125, holes });
  await S('POST', '/api/courses', { name: 'A 河川敷', holes: holes.slice(0, 9) });
  await S('POST', '/api/courses', { name: '  ' });
  await S('POST', '/api/courses', { name: 'x', holes: [{ hole_no: 1 }, { hole_no: 1 }] });
  await S('POST', '/api/courses', { name: 'x', rating: 120 });
  await S('PUT', '/api/courses/2', { name: 'A 河川敷コース', location: '東京', holes: holes.slice(0, 9).map((h) => ({ ...h, par: 3 })) });
  await S('PUT', '/api/courses/99', { name: 'none' });
  await S('GET', '/api/courses');
  await S('GET', '/api/courses/1');
  await S('GET', '/api/courses/99');
  await S('GET', '/api/courses/abc');

  // ラウンド
  const rh = PARS.map((par, i) => ({ hole_no: i + 1, par, strokes: par + (i % 3), putts: 2, fairway: ['hit', 'left', 'right'][i % 3], penalties: i % 7 === 0 ? 1 : 0, bunker: i % 5 === 0 ? 1 : null }));
  await S('POST', '/api/rounds', { date: '2026-10-01', course_id: 1, tee: 'レギュラー', weather: '晴れ', holes: rh });
  await S('POST', '/api/rounds', { date: '2026-10-01', course_name: '旅先のコース', holes: rh.slice(0, 9) });
  await S('POST', '/api/rounds', { date: '2026-09-15', course_id: 2, holes: rh.slice(0, 9) });
  await S('POST', '/api/rounds', { date: '2026-10-01', course_id: 42 });
  await S('POST', '/api/rounds', { date: '2026-10-01' });
  await S('POST', '/api/rounds', { date: '2026/10/01', course_name: 'x' });
  await S('POST', '/api/rounds', { date: '2026-10-01', course_name: 'x', holes: [{ hole_no: 1, strokes: 3, putts: 3 }] });
  await S('POST', '/api/rounds', { date: '2026-10-01', course_name: 'x', holes: [{ hole_no: 19 }] });
  await S('POST', '/api/rounds', { date: '2026-10-01', course_name: 'x', holes: [{ hole_no: 1, fairway: 'bunker' }] });
  await S('PUT', '/api/rounds/1', { date: '2026-10-02', course_id: 1, memo: 'メモ', holes: rh.slice(0, 18).reverse() });
  await S('PUT', '/api/rounds/77', { date: '2026-10-02', course_name: 'x' });
  // ラウンドのホールのメモ
  await S('POST', '/api/rounds', { date: '2026-10-07', course_id: 1, holes: [{ hole_no: 1, par: 4, strokes: 6, putts: 3, note: ' 下りのラインを読み違えた ', tee_club: ' 1W ' }, { hole_no: 2, par: 4, strokes: 4, note: '' }] });
  // 同伴者のスコア（不正な値は 400、名前の前後の空白は取り除く、スコアは 18 個にそろえる）
  const party = await S('POST', '/api/rounds', { date: '2026-10-08', course_id: 1, holes: rh.slice(0, 3), party: [{ name: ' 田中 ', strokes: [5, 4, '6'] }, { name: '佐藤', strokes: [] }] });
  assert.deepEqual(party.party, [{ name: '田中', strokes: [5, 4, 6, ...Array(15).fill(null)] }, { name: '佐藤', strokes: Array(18).fill(null) }]);
  await S('PUT', `/api/rounds/${party.id}`, { date: '2026-10-08', course_id: 1, party: [] });
  await S('POST', '/api/rounds', { date: '2026-10-08', course_name: 'x', party: [{ name: '' }] });
  await S('POST', '/api/rounds', { date: '2026-10-08', course_name: 'x', party: [{ name: 'A', strokes: [0] }] });
  await S('POST', '/api/rounds', { date: '2026-10-08', course_name: 'x', party: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] });
  await S('POST', '/api/rounds', { date: '2026-10-08', course_name: 'x', party: 'abc' });
  await S('GET', '/api/rounds');
  await S('GET', '/api/rounds/2');

  // 27 ホールのゴルフ場（9 ホールのまとまりが 3 つ）と、9 ホールだけのコース
  const h27 = Array.from({ length: 27 }, (_, i) => ({ hole_no: i + 1, par: PARS[i % 18], yards: 320 + i, hdcp: i + 1 }));
  const c27 = await S('POST', '/api/courses', { name: 'C 27ホール', nines: ['東コース', '西コース', ' '], holes: h27 });
  assert.deepEqual(c27.nines, ['東コース', '西コース', 'Cコース']);
  assert.equal(c27.holes.length, 27);
  await S('POST', '/api/courses', { name: 'x', nines: ['東', '西'], holes: h27 }); // 2 つなら 19 番以降は範囲外
  await S('POST', '/api/courses', { name: 'x', nines: Array(7).fill('a') });
  const c9 = await S('POST', '/api/courses', { name: 'D 9ホール', nines: ['9H'], holes: holes.slice(0, 9) });
  const r27 = await S('POST', '/api/rounds', { date: '2026-10-03', course_id: c27.id, front_nine: 3, back_nine: 1, holes: rh });
  assert.equal(r27.nines_label, 'Cコース → 東コース');
  assert.deepEqual([r27.front_nine, r27.back_nine], [3, 1]);
  const rDef = await S('POST', '/api/rounds', { date: '2026-10-04', course_id: c27.id, holes: rh.slice(0, 9) });
  assert.deepEqual([rDef.front_nine, rDef.back_nine, rDef.nines_label], [1, 2, '東コース → 西コース']);
  await S('POST', '/api/rounds', { date: '2026-10-05', course_id: c27.id, front_nine: 4 });
  const r9 = await S('POST', '/api/rounds', { date: '2026-10-05', course_id: c9.id, holes: rh });
  assert.deepEqual([r9.front_nine, r9.back_nine, r9.nines_label], [1, 1, null]); // 9 ホールを 2 周
  await S('POST', '/api/rounds', { date: '2026-10-05', course_id: c9.id, back_nine: 2 });
  const rFree = await S('POST', '/api/rounds', { date: '2026-10-06', course_name: '旅先', front_nine: 3 }); // 未登録のコースでは使わない
  assert.deepEqual([rFree.front_nine, rFree.nines_label], [null, null]);
  const r1 = await S('GET', '/api/rounds/1');
  assert.deepEqual([r1.front_nine, r1.back_nine, r1.nines_label], [1, 2, null]);
  await S('PUT', '/api/courses/' + c27.id, { name: 'C 27ホール', nines: ['東コース', '西コース'], holes: h27.slice(0, 18) }); // まとまりを減らす
  await S('GET', '/api/courses/' + c27.id);
  await S('GET', '/api/rounds');

  // クラブ・飛距離
  await S('POST', '/api/clubs', { category: 'iron', name: '7I', loft: 31, target_carry: 150 });
  await S('POST', '/api/clubs', { category: 'driver', name: '1W', loft: 10.5, length: 45.5, flex: 'S' });
  await S('POST', '/api/clubs', { category: 'wedge', name: '56°', loft: 56, in_bag: false, sort_order: 3 });
  await S('POST', '/api/clubs', { category: 'spoon', name: 'x' });
  await S('POST', '/api/clubs', { category: 'iron', name: '' });
  await S('PUT', '/api/clubs/1', { category: 'iron', name: '7番', loft: 30, in_bag: true });
  await S('PUT', '/api/clubs/order', { ids: [2, 1, 3] });
  await S('PUT', '/api/clubs/order', { ids: [1, 'x'] });
  await S('PUT', '/api/clubs/order', {});
  await S('POST', '/api/distances', { records: [148, 150.5, 152].map((carry, i) => ({ club_id: 1, date: `2026-11-0${i + 1}`, carry, total: carry + 8, place: 'range' })) });
  await S('POST', '/api/distances', { club_id: 2, date: '2026-11-03', total: 240, place: 'course', memo: 'ナイスショット' });
  await S('POST', '/api/distances', { club_id: 2, date: '2026-11-03' });
  await S('POST', '/api/distances', { club_id: 9, date: '2026-11-03', carry: 100 });
  await S('POST', '/api/distances', { records: [] });
  await S('PUT', '/api/distances/2', { club_id: 1, date: '2026-11-05', carry: 155, place: 'simulator' });
  await S('PUT', '/api/distances/99', { club_id: 1, date: '2026-11-05', carry: 155 });
  await S('DELETE', '/api/distances/1');
  await S('GET', '/api/distances');
  await S('GET', '/api/distances?club_id=1');
  await S('GET', '/api/clubs');

  // アルバム・写真
  await S('POST', '/api/albums', { title: '夏合宿', date: '2026-08-01', description: '楽しかった' });
  await S('POST', '/api/albums', { title: '練習' });
  await S('POST', '/api/albums', { title: '' });
  const png = { 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('18番.png') };
  await S('POST', '/api/photos?album_id=1&round_id=1&taken_at=2026-10-01%2010:00', PNG, png);
  await S('POST', '/api/photos?album_id=1&taken_at=2026-10-01T11:30', PNG, png);
  await S('POST', '/api/photos', PNG, { 'Content-Type': 'image/png' });
  await S('POST', '/api/photos', Buffer.from('hello'), { 'Content-Type': 'text/plain' });
  await S('POST', '/api/photos?album_id=9', PNG, png);
  await S('POST', '/api/photos?taken_at=yesterday', PNG, png);
  await S('PUT', '/api/photos/2/thumb', PNG, { 'Content-Type': 'image/png' });
  await S('PUT', '/api/photos/2/thumb', PNG, { 'Content-Type': 'image/gif' });
  await S('PUT', '/api/photos/3', { caption: '素振り', album_id: 2, round_id: null, taken_at: '2026-09-01 08:00' });
  await S('PUT', '/api/photos/3', { round_id: 999 });
  await S('PUT', '/api/albums/1', { title: '夏合宿 2026', date: '2026-08-01', cover_photo_id: 1 });
  await S('GET', '/api/albums');
  await S('GET', '/api/albums/1');
  await S('GET', '/api/photos');
  await S('GET', '/api/photos?album_id=none');
  await S('GET', '/api/photos?album_id=1&limit=1');
  await S('GET', '/api/photos?round_id=1');
  await S('GET', '/api/photos?limit=0');
  await S('DELETE', '/api/photos/1');
  await S('GET', '/api/albums');

  // 削除の連鎖（コース削除でもラウンドのコース名は残る、など）
  await S('DELETE', '/api/courses/1');
  await S('GET', '/api/rounds');
  await S('DELETE', '/api/rounds/2');
  await S('DELETE', '/api/clubs/1');
  await S('DELETE', '/api/albums/1');
  await S('DELETE', '/api/albums/1');
  await S('GET', '/api/photos');
  await S('GET', '/api/distances');
  await S('GET', '/api/nothing');
  await S('DELETE', '/api/settings');

  // エクスポート → 加工したデータの復元（参照切れ・不正なファイル名は除外される）
  await S('GET', '/api/export');
  // 写真のファイル名は環境ごとに違うので、それぞれ自分のエクスポートを同じように加工して復元する
  const tamper = (exp) => {
    exp.round_holes.push({ round_id: 999, hole_no: 1, par: 4, strokes: 4 });
    exp.distances.push({ id: 500, club_id: 999, date: '2026-01-01', carry: 100 });
    exp.photos.push({ id: 900, filename: '../golf.db', mime: 'image/png' });
    exp.photos.push({ id: 901, filename: '0f0e0d0c-0b0a-4908-8706-050403020100.png', mime: 'image/png' }); // ファイルがない
    exp.courses.push({ id: 50, name: null });
    exp.rounds.push({ id: 60, date: '2026-01-02', course_id: 12345, course_name: '消えたコース', created_at: null });
    exp.settings.push({ key: 'lan_key', value: 'evil' });
    exp.courses.push({ id: 51, name: '取り込み 27H', nines: '["北","南","中"]' });
    exp.course_holes.push({ course_id: 51, hole_no: 27, par: 5 }, { course_id: 51, hole_no: 28, par: 4 }); // 28 番は範囲外
    exp.rounds.push({ id: 61, date: '2026-01-03', course_id: 51, course_name: 'x', front_nine: 3, back_nine: 9 }); // 9 は範囲外
    return exp;
  };
  const [se, le] = [tamper((await p.server('GET', '/api/export')).data), tamper((await p.local('GET', '/api/export')).data)];
  const [si, li] = [await p.server('POST', '/api/import', se), await p.local('POST', '/api/import', le)];
  assert.deepEqual(li, si, 'POST /api/import');
  assert.equal(si.data.counts.photos, 2);
  for (const u of ['/api/settings', '/api/courses', '/api/rounds', '/api/clubs', '/api/distances', '/api/albums', '/api/photos']) await S('GET', u);
  const imported = (await p.server('GET', '/api/courses/51')).data;
  assert.deepEqual([imported.nines, imported.holes.map((h) => h.hole_no)], [['北', '南', '中'], [27]]);
  const r61 = (await p.server('GET', '/api/rounds/61')).data;
  assert.deepEqual([r61.front_nine, r61.back_nine, r61.nines_label], [3, null, '中 → 南']);
  await S('POST', '/api/import', { app: 'other' });
  await S('POST', '/api/courses', { name: '復元後に追加' }); // ID の続き番号も同じ

  // 全削除 → サンプル
  await S('POST', '/api/delete-all', { confirm: 'delete' });
  await S('POST', '/api/delete-all', { confirm: 'DELETE' });
  await S('POST', '/api/sample');
  for (const u of ['/api/courses', '/api/rounds', '/api/clubs', '/api/distances', '/api/albums', '/api/photos']) await S('GET', u);
  await S('POST', '/api/sample');

  // サンプルだけを削除（自分で登録したデータは残る）
  const info = await S('GET', '/api/sample');
  assert.deepEqual(info, { present: true, counts: { courses: 2, rounds: 24, clubs: 15, distances: 156 } });
  const sampleCourse = (await p.server('GET', '/api/courses')).data.find((c) => c.name.startsWith('サンプル'));
  const mine = await S('POST', '/api/courses', { name: '自分のホームコース', holes });
  await S('POST', '/api/rounds', { date: '2026-11-01', course_id: mine.id, holes: rh });
  await S('POST', '/api/rounds', { date: '2026-11-02', course_id: sampleCourse.id, holes: rh.slice(0, 9) }); // サンプルのコースでの記録はサンプル扱い
  await S('POST', '/api/clubs', { category: 'driver', name: '1W', brand: 'マイブランド' });
  await S('POST', '/api/distances', { club_id: (await p.server('GET', '/api/clubs')).data.find((c) => c.brand === 'マイブランド').id, date: '2026-11-03', carry: 230 });
  const del = await S('DELETE', '/api/sample');
  assert.deepEqual(del.deleted, { courses: 2, rounds: 25, clubs: 15, distances: 156 });
  for (const u of ['/api/courses', '/api/rounds', '/api/clubs', '/api/distances']) await S('GET', u);
  const left = (await p.server('GET', '/api/rounds')).data;
  assert.equal(left.length, 1);
  assert.equal(left[0].course_name, '自分のホームコース');
  assert.equal((await p.server('GET', '/api/clubs')).data.length, 1);
  assert.equal((await p.server('GET', '/api/distances')).data.length, 1);
  assert.deepEqual(await S('GET', '/api/sample'), { present: false, counts: { courses: 0, rounds: 0, clubs: 0, distances: 0 } });
  await S('DELETE', '/api/sample'); // サンプルがなくてもエラーにはならない
});

test('スマホ単独版：写真込みバックアップ（ZIP）を書き出して別の端末で復元できる', async () => {
  const a = newLocal();
  await a.backend.handle('POST', '/api/sample', {});
  await a.backend.handle('POST', '/api/albums', { title: 'アルバム' });
  const ph = await a.backend.handle('POST', '/api/photos?album_id=1', new Blob([PNG], { type: 'image/png' }), { 'X-Filename': 'a.png' });
  await a.backend.handle('PUT', `/api/photos/${ph.id}/thumb`, new Blob([PNG], { type: 'image/jpeg' }));
  const zip = new Blob(await a.backend.exportBackupParts(), { type: 'application/zip' });

  const b = newLocal();
  await b.backend.handle('POST', '/api/courses', { name: '消えるコース' });
  await b.backend.handle('POST', '/api/photos', new Blob([PNG], { type: 'image/png' })); // 置き換えで消える写真
  const res = await b.backend.importBackup(zip);
  assert.equal(res.kind, 'zip');
  assert.equal(res.counts.rounds, 24);
  assert.equal(res.counts.photos, 1);
  for (const u of ['/api/rounds', '/api/clubs', '/api/courses', '/api/albums']) {
    assert.deepEqual(normalizer()(await b.backend.handle('GET', u)), normalizer()(await a.backend.handle('GET', u)), u);
  }
  const photos = await b.backend.handle('GET', '/api/photos');
  assert.equal(photos[0].filename, ph.filename);
  assert.ok(b.backend.fileUrl(photos[0].thumb).startsWith('blob:'));
  // 元の写真ファイルと、置き換えで不要になったファイルの片付け
  assert.deepEqual([...b.store._files.keys()].sort(), [photos[0].filename, photos[0].thumb].sort());
  assert.deepEqual(new Uint8Array(await b.store._files.get(ph.filename).arrayBuffer()), new Uint8Array(PNG));
});

test('PC版とスマホ単独版の間で ZIP バックアップをやり取りできる', async () => {
  const p = pair();
  await p.ready;
  // PC → スマホ
  await p.server('POST', '/api/sample');
  await p.server('POST', '/api/albums', { title: 'PC のアルバム' });
  await p.server('POST', '/api/photos?album_id=1', PNG, { 'Content-Type': 'image/png' });
  const res = await fetch(p.srv.base + '/api/export?format=zip');
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /golf-backup-\d{4}-\d{2}-\d{2}\.zip/);
  const zip = new Blob([await res.arrayBuffer()]);
  await p.loc.backend.importBackup(zip);
  for (const u of ['/api/rounds', '/api/clubs', '/api/photos', '/api/albums']) {
    const [s, l] = [await p.server('GET', u), await p.local('GET', u)];
    assert.deepEqual(normalizer()(l), normalizer()(s), u);
  }
  // スマホで追加 → PC へ戻す
  await p.local('POST', '/api/rounds', { date: '2026-11-15', course_name: 'スマホで入力', holes: [{ hole_no: 1, par: 4, strokes: 5 }] });
  await p.local('POST', '/api/photos?album_id=1', Buffer.from(PNG), { 'Content-Type': 'image/png' });
  const back = Buffer.from(await new Blob(await p.loc.backend.exportBackupParts()).arrayBuffer());
  const imp = await p.server('POST', '/api/import/zip', back, { 'Content-Type': 'application/zip' });
  assert.equal(imp.ok, true);
  assert.equal(imp.data.counts.rounds, 25);
  assert.equal(imp.data.counts.photos, 2);
  const photos = (await p.server('GET', '/api/photos')).data;
  for (const ph of photos) assert.ok(fs.existsSync(path.join(p.srv.tmp, 'photos', ph.filename)), ph.filename);
  const img = await fetch(`${p.srv.base}/photos/${photos[0].filename}`);
  assert.equal(img.status, 200);
  // 壊れた ZIP は 400
  const bad = await p.server('POST', '/api/import/zip', Buffer.from('PK\x03\x04broken'), { 'Content-Type': 'application/zip' });
  assert.equal(bad.status, 400);
});

test('バックアップ ZIP：不正なファイル名は取り込まない・deflate 圧縮も読める', async () => {
  const { readBackup } = await mod('public/js/shared/backup.js');
  const { readZip, crc32 } = await mod('public/js/shared/zip.js');
  const data = { app: 'golf-enjoy-manager', photos: [] };
  // Node の zlib で deflate 圧縮した ZIP を手作りする（他のソフトで作り直された ZIP を想定）
  const entries = [['data.json', Buffer.from(JSON.stringify(data))], ['photos/../../evil.jpg', PNG], ['photos/0f0e0d0c-0b0a-4908-8706-050403020100.png', PNG]];
  const parts = [];
  const cds = [];
  let off = 0;
  for (const [name, buf] of entries) {
    const comp = zlib.deflateRawSync(buf);
    const n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc32(buf), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(buf.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc32(buf), 16);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(buf.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, comp); cds.push(c, n); off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(cds);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(3, 8); e.writeUInt16LE(3, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  const zip = Buffer.concat([...parts, cd, e]);
  assert.equal((await readZip(zip)).length, 3);
  const b = await readBackup(new Blob([zip]));
  assert.deepEqual(b.files.map((f) => f.name), ['0f0e0d0c-0b0a-4908-8706-050403020100.png']);
  assert.deepEqual(Buffer.from(await b.files[0].entry.bytes()), PNG);
  await assert.rejects(readBackup(new Blob(['{"app":"x"}'])), /このアプリのバックアップ/);
});

test('復元時の点検：パストラバーサルなファイル名の写真行は除外される（PC版）', async () => {
  const { base, tmp } = await startServer();
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'X-Golf-App': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'x');
  const r = await post('/api/import', { app: 'golf-enjoy-manager', photos: [{ id: 1, filename: '../secret.txt' }, { id: 2, filename: 'x.jpg' }] });
  assert.equal(r.counts.photos, 0);
  assert.ok(fs.existsSync(path.join(tmp, 'secret.txt')));
});

test('スマホ単独版のビルド：モードの印・CSP・オフライン用ファイル一覧', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-build-'));
  tmps.push(out);
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-phone.js'), out], { stdio: 'pipe' });
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(index, /<meta name="golf-mode" content="standalone">/);
  assert.match(index, /Content-Security-Policy/);
  assert.doesNotMatch(index, /<script>/); // インラインスクリプトなし（CSP で禁止しているため）
  assert.ok(!fs.existsSync(path.join(out, 'js', 'package.json')));
  const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
  const assets = JSON.parse(sw.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
  for (const a of assets) assert.ok(fs.existsSync(path.join(out, a)), a);
  for (const must of ['index.html', 'js/main.js', 'js/local/backend.js', 'js/shared/model.js', 'manifest.webmanifest']) assert.ok(assets.includes(must), must);
  // モジュールの import 先がすべて同梱されている
  const files = new Set(assets);
  for (const a of assets.filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(out, a), 'utf8');
    for (const [, spec] of src.matchAll(/(?:from\s+|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(a), spec));
      if (target === 'js/views/mobileConnect.js') continue; // PC版でだけ読み込む
      assert.ok(files.has(target), `${a} → ${spec}`);
    }
  }
  // 出力先に別のファイルがあるフォルダは消さない
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-other-'));
  tmps.push(other);
  fs.writeFileSync(path.join(other, 'keep.txt'), 'x');
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-phone.js'), other], { stdio: 'pipe' }));
  assert.ok(fs.existsSync(path.join(other, 'keep.txt')));
});

test('練習データ（弾道測定器）の取り込み・重複・削除・バックアップが PC版とスマホ単独版で同じ', async () => {
  const p = pair();
  await p.ready;
  const S = (m, u, b, h) => same(p, m, u, b, h);
  const club = await S('POST', '/api/clubs', { category: 'driver', name: '1W', loft: 10.5 });
  await S('POST', '/api/distances', { club_id: club.id, date: '2026-11-01', carry: 205, place: 'course', memo: '手で記録' });
  const shots = [
    { date: '2026-11-23', carry: 215.9, total: 238, club_speed: 41.2, ball_speed: 60.1, launch: 12.6, side: null, smash: 1.46, apex: 21.8, spin: 2710, equalizer: 0 },
    { date: '2026-11-28', carry: 218.3, total: 239.5, club_speed: 42.6, ball_speed: 59.7, launch: 14.8, side: -1.6, smash: 1.4, apex: 27.4, spin: 3060, equalizer: 1 },
    { date: '2026-11-28', carry: 193.2, total: 216.4, club_speed: 42.1, ball_speed: 58, launch: null, side: -6.9, smash: 1.38, apex: 14.9, spin: 4480, equalizer: 1 },
  ];
  await S('POST', '/api/distances/import', { club_id: club.id, shots, source: 'swingcaddie', place: 'range' });
  await S('POST', '/api/distances/import', { club_id: club.id, shots: [...shots, { ...shots[0], date: '2026-11-30' }], source: 'swingcaddie' }); // 取り込み直し：新しい 1 球だけ
  await S('POST', '/api/distances/import', { club_id: 999, shots });
  await S('POST', '/api/distances/import', { club_id: club.id, shots: [] });
  await S('POST', '/api/distances/import', { club_id: club.id, shots: [{ date: '2026-11-30' }] });
  const list = await S('GET', '/api/distances');
  assert.equal(list.length, 5);
  assert.equal(list.filter((d) => d.source === 'swingcaddie').length, 4);
  assert.equal(list.find((d) => d.carry === 218.3).spin, 3060);
  await S('GET', '/api/clubs'); // 平均キャリーに取り込んだ球も入る
  // バックアップ → 復元で弾道のデータも戻る
  const [se, le] = [(await p.server('GET', '/api/export')).data, (await p.local('GET', '/api/export')).data];
  assert.equal(se.distances.find((d) => d.carry === 218.3).launch, 14.8);
  await S('POST', '/api/import', se);
  await S('GET', '/api/distances');
  await S('POST', '/api/import', le);
  // 古いバックアップ（弾道の列がない）もそのまま復元できる
  const old = JSON.parse(JSON.stringify(se));
  for (const d of old.distances) for (const k of ['club_speed', 'ball_speed', 'launch', 'side', 'smash', 'apex', 'spin', 'equalizer', 'source']) delete d[k];
  await S('POST', '/api/import', old);
  assert.equal((await S('GET', '/api/distances')).length, 5);
  await S('POST', '/api/import', se);
  // 取り込んだ球だけまとめて削除（手で記録した球は残る）
  await S('DELETE', `/api/distances/import?club_id=${club.id}`);
  const rest = await S('GET', '/api/distances');
  assert.deepEqual(rest.map((d) => d.memo), ['手で記録']);
});
