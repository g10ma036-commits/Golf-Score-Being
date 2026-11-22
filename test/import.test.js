'use strict';
// ほかのアプリからの取り込み：自作の SQLite 読み取りと、IKScoreCard のバックアップの変換
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);
let sqlite;
let ik;
let dir;
before(async () => {
  sqlite = await load('public/js/shared/sqlite.js');
  ik = await load('public/js/shared/ikscorecard.js');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-import-'));
});
after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows でファイルが使用中のときは残す */ } });

let made = 0;
const makeDb = (name, build) => {
  const sub = path.join(dir, String(++made)); // 作るたびに別のフォルダ（同じ名前のファイルを何度も作れるように）
  fs.mkdirSync(sub);
  const file = path.join(sub, name);
  const db = new DatabaseSync(file);
  build(db);
  db.close();
  return { name, bytes: new Uint8Array(fs.readFileSync(file)) };
};
const p2 = (n) => String(n).padStart(2, '0');

test('SQLite の読み取り：rowid の別名・長い文字列（オーバーフロー）・多くの行（内部ページ）・後から足した列・いろいろな値', () => {
  const long = 'あいうえお'.repeat(3000); // 約 45KB → オーバーフローページ
  const f = makeDb('t.sqlite3', (db) => {
    db.exec('PRAGMA page_size = 1024');
    db.exec('CREATE TABLE "A" (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER, x REAL, b BLOB)');
    const ins = db.prepare('INSERT INTO A (name, n, x, b) VALUES (?, ?, ?, ?)');
    for (let i = 1; i <= 400; i++) ins.run(`名前${i}`, i * (i % 2 ? 1 : -1) * 1000003, i / 4, Buffer.from([i % 256, 1, 2]));
    ins.run(long, 2 ** 40, -1.5, null);
    ins.run(null, 0, 0, null); // 0 と 1 は特別な形で保存される
    db.exec('ALTER TABLE A ADD COLUMN added TEXT');
    db.exec("INSERT INTO A (name, added) VALUES ('後', '追加した列')");
    db.exec('CREATE TABLE B (k TEXT, v INTEGER, PRIMARY KEY (k))'); // TEXT の主キーは rowid の別名ではない
    db.exec("INSERT INTO B VALUES ('a', 1), ('b', 255), ('c', 65536), ('d', -8388608)");
  });
  assert.equal(sqlite.isSqlite(f.bytes), true);
  assert.equal(sqlite.isSqlite(new Uint8Array(200)), false);
  const s = sqlite.openSqlite(f.bytes);
  assert.deepEqual(s.tables().filter((t) => t !== 'sqlite_sequence'), ['A', 'B']);
  const rows = s.rows('A');
  assert.equal(rows.length, 403);
  assert.deepEqual({ ...rows[0], b: [...rows[0].b] }, { id: 1, name: '名前1', n: 1000003, x: 0.25, b: [1, 1, 2], added: null });
  assert.equal(rows[1].n, -2000006);
  assert.equal(rows[400].name, long);
  assert.equal(rows[400].n, 2 ** 40);
  assert.equal(rows[400].x, -1.5);
  assert.deepEqual([rows[401].n, rows[401].x], [0, 0]);
  assert.deepEqual([rows[402].id, rows[402].name, rows[402].added], [403, '後', '追加した列']);
  assert.deepEqual(s.rows('B').map((r) => [r.k, r.v]), [['a', 1], ['b', 255], ['c', 65536], ['d', -8388608]]);
  assert.deepEqual(s.rows('ない'), []);
  assert.throws(() => sqlite.openSqlite(new Uint8Array(100)), /SQLite のファイルではありません/);
  // 列の定義の読み取り
  assert.deepEqual(sqlite.tableColumns('CREATE TABLE x ("a b" INTEGER PRIMARY KEY, [c] TEXT DEFAULT \'(,)\', `d` NUMERIC(10,2), CONSTRAINT u UNIQUE (c))'),
    [{ name: 'a b', ipk: true }, { name: 'c', ipk: false }, { name: 'd', ipk: false }]);
});

// IKScoreCard と同じ形の小さなバックアップを作る
function ikBackup({ withNames = true } = {}) {
  const sc = makeDb('IKScoreCard_sc.sqlite3', (db) => {
    const cols = ['sc_seria INTEGER PRIMARY KEY AUTOINCREMENT', 'sc_place INTEGER', 'sc_weath INTEGER', ...[1, 2, 3, 4].map((i) => `sc_p${i}_no INTEGER`),
      ...[1, 2, 3, 4].flatMap((i) => Array.from({ length: 18 }, (_, j) => `sc_p${i}_${p2(j + 1)} INTEGER`)),
      ...Array.from({ length: 18 }, (_, j) => `sc_p1p${p2(j + 1)} INTEGER`), 'sc_pdate TEXT', 'sc_compe INTEGER', 'sc_total INTEGER',
      ...['ob', 'wh', 'lb', 'ot'].flatMap((k) => Array.from({ length: 18 }, (_, j) => `sc_${k}_${p2(j + 1)} INTEGER`))];
    db.exec(`CREATE TABLE DB_sc (${cols.join(', ')})`);
    db.exec('CREATE TABLE DB_nm (nm_seria INTEGER PRIMARY KEY AUTOINCREMENT, nm_pname TEXT, nm_plsex INTEGER, nm_email TEXT, nm_hd_cp TEXT)');
    db.exec(`CREATE TABLE DB_s3 (s3_seria INTEGER PRIMARY KEY AUTOINCREMENT, s3_scseri INTEGER, s3_htype1 INTEGER, s3_htype2 INTEGER, ${Array.from({ length: 18 }, (_, j) => `s3_pena${p2(j + 1)} INTEGER`).join(', ')})`);
    db.exec(`CREATE TABLE DB_cp (cp_seria INTEGER PRIMARY KEY AUTOINCREMENT, cp_scseri INTEGER, ${Array.from({ length: 10 }, (_, j) => `cp_text${p2(j + 1)} TEXT`).join(', ')})`);
    if (withNames) db.exec("INSERT INTO DB_nm (nm_seria, nm_pname) VALUES (98, '田中'), (99, '佐藤')");
    const put = (o) => {
      const keys = Object.keys(o);
      db.prepare(`INSERT INTO DB_sc (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => o[k]));
    };
    const holes = (pfx, arr) => Object.fromEntries(arr.map((v, j) => [`${pfx}${p2(j + 1)}`, v]));
    // 1: 18 ホール・同伴者 2 人・OB と池
    put({ sc_seria: 681, sc_place: 1000272, sc_weath: 3, sc_p1_no: 1000202, sc_p2_no: 98, sc_p3_no: 99, sc_p4_no: 0, sc_pdate: '2014.08.13', sc_total: 90,
      ...holes('sc_p1_', Array(18).fill(5)), ...holes('sc_p2_', Array(18).fill(4)), ...holes('sc_p3_', Array(18).fill(6)), ...holes('sc_p4_', Array(18).fill(0)),
      ...holes('sc_p1p', [2, 3, 0, ...Array(15).fill(2)]), ...holes('sc_ob_', [1, ...Array(17).fill(0)]), ...holes('sc_wh_', [0, 1, ...Array(16).fill(0)]),
      ...holes('sc_lb_', Array(18).fill(0)), ...holes('sc_ot_', Array(18).fill(0)) });
    // 2: 36 ホールのゴルフ場で 3 つ目 → 4 つ目、パットの記録なし
    put({ sc_seria: 682, sc_place: 1000254, sc_weath: 1, sc_p1_no: 1000202, sc_p2_no: 0, sc_p3_no: 0, sc_p4_no: 0, sc_pdate: '2015.05.03', sc_total: 81,
      ...holes('sc_p1_', [...Array(9).fill(4), ...Array(9).fill(5)]), ...holes('sc_p2_', Array(18).fill(0)), ...holes('sc_p3_', Array(18).fill(0)), ...holes('sc_p4_', Array(18).fill(0)),
      ...holes('sc_p1p', Array(18).fill(0)) });
    // 3: 知らないゴルフ場
    put({ sc_seria: 683, sc_place: 5555, sc_p1_no: 1, sc_pdate: '2016.01.01', ...holes('sc_p1_', Array(18).fill(5)) });
    db.exec('INSERT INTO DB_s3 (s3_scseri, s3_htype1, s3_htype2, s3_pena05) VALUES (681, 1, 2, 1), (682, 3, 4, 0)');
    db.exec("INSERT INTO DB_cp (cp_scseri, cp_text01, cp_text02) VALUES (681, 'よく晴れた', ''), (682, '', NULL)");
  });
  const nineCols = Array.from({ length: 7 }, (_, k) => [`gc_c${p2(k + 1)}nm TEXT`, ...Array.from({ length: 9 }, (_, j) => `gc_p${p2(k + 1)}_${j + 1} INTEGER`)]).flat();
  const g2 = makeDb('IKScoreCard_g2.sqlite3', (db) => {
    db.exec(`CREATE TABLE DB_gc (gc_seria INTEGER PRIMARY KEY AUTOINCREMENT, gc_gname TEXT, gc_gddrs TEXT, gc_gtele TEXT, ${nineCols.join(', ')})`);
    const ins = (id, name, addr, nines) => {
      const o = { gc_seria: id, gc_gname: name, gc_gddrs: addr };
      nines.forEach(([nm, pars], k) => { o[`gc_c${p2(k + 1)}nm`] = nm; pars.forEach((p, j) => { o[`gc_p${p2(k + 1)}_${j + 1}`] = p; }); });
      const keys = Object.keys(o);
      db.prepare(`INSERT INTO DB_gc (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => o[k]));
    };
    ins(1000272, '酒田カントリークラブ', '山形県', [['OUT', [4, 5, 4, 3, 4, 4, 4, 5, 3]], ['IN', [4, 4, 5, 3, 4, 3, 4, 4, 5]]]);
    ins(1000254, '秋田  森岳 36', '秋田県', [['秋田  OUT', Array(9).fill(4)], ['秋田  IN', Array(9).fill(4)], ['森岳  OUT', Array(9).fill(4)], ['森岳  IN', Array(9).fill(5)]]);
  });
  const g3 = makeDb('IKScoreCard_g3.sqlite3', (db) => {
    const tcols = Array.from({ length: 7 }, (_, t) => Array.from({ length: 9 }, (_, j) => `g3_t${p2(t + 1)}_${p2(j + 1)} INTEGER`)).flat();
    db.exec(`CREATE TABLE DB_g3 (g3_seria INTEGER PRIMARY KEY AUTOINCREMENT, ${tcols.join(', ')}, ${Array.from({ length: 7 }, (_, t) => `g3_tnam${t + 1} TEXT`).join(', ')}, g3_cname TEXT, g3_g2ser INTEGER, g3_sepcn INTEGER)`);
    const ins = (g2ser, sepcn, cname, back, reg) => {
      const o = { g3_g2ser: g2ser, g3_sepcn: sepcn, g3_cname: cname, g3_tnam1: 'Back', g3_tnam2: 'Reg.' };
      back.forEach((y, j) => { o[`g3_t01_${p2(j + 1)}`] = y; });
      reg.forEach((y, j) => { o[`g3_t02_${p2(j + 1)}`] = y; });
      const keys = Object.keys(o);
      db.prepare(`INSERT INTO DB_g3 (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => o[k]));
    };
    ins(1000272, 10002721, 'OUT', Array(9).fill(400), Array(9).fill(360));
    ins(1000272, 10002722, 'IN', Array(9).fill(410), Array(9).fill(370));
    // 36 ホール：番号が規則どおりでない行は名前で探す
    ins(8000002, 10002540, '森岳  OUT', Array(9).fill(390), Array(9).fill(350)); // 番号の 1 の位が 0 → 名前で探す（g3_g2ser は仮の番号）
  });
  return [sc, g2, g3];
}

test('IKScoreCard：ラウンド・パット・ペナルティ・同伴者・メモ・回った 9 ホール・コースのパーと距離', () => {
  const files = ikBackup();
  assert.equal(ik.isIkScoreCardFiles(files), true);
  assert.equal(ik.isIkScoreCardFiles([{ name: 'other.sqlite3' }]), false);
  const r = ik.parseIkScoreCard(files);
  assert.equal(r.rounds.length, 3);
  assert.deepEqual([r.from, r.to], ['2014-08-13', '2016-01-01']);
  const [a, b] = r.rounds;
  assert.equal(a.date, '2014-08-13');
  assert.deepEqual(a.holes.slice(0, 5).map((h) => [h.strokes, h.putts, h.penalties]), [[5, 2, 1], [5, 3, 1], [5, 0, 0], [5, 2, 0], [5, 2, 1]]); // OB・池・s3 のペナルティ
  assert.deepEqual(a.party.map((p) => [p.name, p.strokes.reduce((x, y) => x + y, 0)]), [['田中', 72], ['佐藤', 108]]);
  assert.equal(a.memo, 'よく晴れた');
  assert.deepEqual([b.front, b.back], [3, 4]);
  assert.equal(b.holes.every((h) => h.putts === null), true); // パットの記録が無いラウンド
  assert.deepEqual(r.places.map((p) => [p.place, p.name]), [[1000272, '酒田カントリークラブ'], [1000254, '秋田 森岳 36'], [5555, null]]);
  assert.deepEqual(r.tees.map((t) => [t.tee, t.label, t.total]), [[1, 'Back', 7290], [2, 'Reg.', 6570]]); // よく行くコース（最初の 18 ホール）の合計
  const c = r.courseFor(1000272, 2);
  assert.deepEqual(c.nines, ['OUT', 'IN']);
  assert.deepEqual(c.holes.slice(0, 3), [{ hole_no: 1, par: 4, yards: 360 }, { hole_no: 2, par: 5, yards: 360 }, { hole_no: 3, par: 4, yards: 360 }]);
  assert.equal(r.courseFor(1000272, 1).holes[9].yards, 410);
  const c36 = r.courseFor(1000254, 2);
  assert.deepEqual(c36.nines, ['秋田 OUT', '秋田 IN', '森岳 OUT', '森岳 IN']);
  assert.equal(c36.holes.length, 36);
  assert.equal(c36.holes[18].yards, 350); // 3 つ目（森岳 OUT）は名前で見つける
  assert.equal(c36.holes[0].yards, null);
  assert.equal(c36.holes[27].par, 5);
  assert.equal(r.courseFor(5555, 2), null);
  // 名前の表が無いときは「同伴者1」など
  const noNames = ik.parseIkScoreCard(ikBackup({ withNames: false }));
  assert.deepEqual(noNames.rounds[0].party.map((p) => p.name), ['同伴者1', '同伴者2']);
  // スコアのファイルが無い
  assert.throws(() => ik.parseIkScoreCard(files.slice(1)), /IKScoreCard_sc\.sqlite3/);
});
