'use strict';
// Garmin Golf（Garmin Connect のデータのエクスポート）の取り込み
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);
let G;
before(async () => { G = await load('public/js/shared/garmin.js'); });

// ---- テスト用のエクスポートを作る ----
const SEMI = 180 / 2 ** 31;
const PIN = { lat: 35.5, lon: 140.1 };
const pos = (lat, lon) => ({ lat: Math.round(lat / SEMI), lon: Math.round(lon / SEMI) });
const EAST = [4, 4, 3, 5, 4, 4, 3, 4, 5];
const WEST = [4, 3, 4, 5, 4, 4, 3, 5, 4];
const LAKE = [4, 5, 3, 4, 4, 3, 4, 5, 4, 5, 4, 3, 4, 4, 4, 3, 4, 5];
const YARDS = { 3: 150, 4: 350, 5: 500 };
let shotId = 1;
// pars: 1〜18 番のパー（9 ホールなら 9 個）。noShot: ショットの記録が無いホール
function card({ id, date, time = '09:00', course, back, snapshot, pars, start = 1, hcp = 10, rating, slope, noShot = [], extra = {} }) {
  const shots = [];
  const holes = pars.map((par, i) => {
    const number = start + i;
    const pinLat = PIN.lat + id * 0.01 + i * 0.002;
    if (!noShot.includes(number)) {
      const tee = pos(pinLat + (YARDS[par] * 0.9144) / 111195, PIN.lon);
      shots.push({
        id: shotId++, scorecardId: id, holeNumber: number, shotOrder: 1, clubId: par === 3 ? 16 : par === 5 ? 3 : 1,
        shotType: par === 3 ? 'APPROACH' : 'TEE', startLoc: { ...tee, lie: 'TeeBox' }, endLoc: { ...pos(pinLat, PIN.lon), lie: 'Green' },
      });
      shots.push({ id: shotId++, scorecardId: id, holeNumber: number, shotOrder: 2, clubId: 16, shotType: 'APPROACH', startLoc: { lie: 'Fairway' } });
    }
    return {
      number, strokes: par + 1, putts: 2, penalties: i === 0 ? 1 : 0, handicapScore: par,
      ...(par > 3 ? { fairwayShotOutcome: ['HIT', 'LEFT', 'RIGHT'][i % 3] } : {}),
      pinPositionLat: pos(pinLat, PIN.lon).lat, pinPositionLon: pos(pinLat, PIN.lon).lon,
    };
  });
  const strokes = holes.reduce((a, h) => a + h.strokes, 0);
  const par = pars.reduce((a, b) => a + b, 0);
  return {
    card: {
      id, customerId: '', playerProfileId: 9, roundPlayerName: 'secret-nick', connectDisplayName: 'secret-uuid',
      courseGlobalId: course, ...(back ? { backNineGlobalCourseId: back } : {}), courseSnapshotId: snapshot,
      startTime: `${date}T00:00:00Z`, formattedStartTime: `${date}T${time}:00+09:00`, inProgress: false,
      holesCompleted: holes.length, score: strokes - hcp - par, playerHandicap: hcp, handicappedStrokes: strokes - hcp, strokes,
      teeBox: 'Regular', teeBoxRating: rating, teeBoxSlope: slope, stepsTaken: 9000, distanceWalked: 8000, holes, ...extra,
    },
    shots,
  };
}
function exportFiles() {
  const list = [
    card({ id: 1, date: '2025-05-01', course: 11, back: 12, snapshot: 101, pars: [...EAST, ...WEST], rating: 69.5, slope: 110 }),
    // 同じ日に 9 ホールずつ 2 回（前半・後半で別のラウンドになっている）
    card({ id: 2, date: '2025-06-01', time: '09:00', course: 11, snapshot: 102, pars: EAST, rating: 34, slope: 108 }),
    card({ id: 3, date: '2025-06-01', time: '13:00', course: 12, snapshot: 103, pars: WEST, rating: 35, slope: 110 }),
    // 18 ホールのコース。2 番（パー5）はショットの記録が無い → 合計パーから決まる
    card({ id: 4, date: '2025-07-01', course: 21, snapshot: 201, pars: LAKE, rating: 70.1, slope: 112, noShot: [2] }),
    // 終わっていないラウンドは取り込まない
    card({ id: 5, date: '2025-08-01', course: 21, snapshot: 201, pars: LAKE, extra: { inProgress: true } }),
  ];
  const json = (type, data) => JSON.stringify({ version: 'v1', type, data });
  return [
    { name: 'DI_CONNECT/DI-GOLF/Golf-SCORECARD.json', text: json('SCORECARD', list.map((x) => x.card)) },
    { name: 'DI_CONNECT/DI-GOLF/Golf-SHOT.json', text: json('SHOT', list.flatMap((x) => x.shots)) },
    { name: 'DI_CONNECT/DI-GOLF/Golf-COURSE.json', text: json('COURSE', [{ 101: 'Test Hills CC ~ East/West' }, { 102: 'Test Hills CC ~ East' }, { 103: 'Test Hills CC ~ West' }, { 201: 'Lake Golf Club' }]) },
    { name: 'DI_CONNECT/DI-GOLF/Golf-CLUB.json', text: json('CLUB', [{ id: 1, clubTypeId: 1, name: 'My Driver' }, { id: 3, clubTypeId: 3 }, { id: 16, clubTypeId: 16 }]) },
    { name: 'DI_CONNECT/DI-GOLF/Golf-CLUB_TYPES.json', text: json('CLUB_TYPES', [{ value: 1, name: 'Driver' }, { value: 3, name: '5 Wood' }, { value: 16, name: '7 Iron' }]) },
    { name: 'DI_CONNECT/DI-GOLF/Golf-broken.json', text: '{not json' },
    { name: 'DI_CONNECT/DI-GOLF/Golf-OTHER.json', text: json('SIM_SESSION', [{ a: 1 }]) },
  ];
}

test('Garmin：ファイルの見分け・種類ごとの読み込み', () => {
  assert.ok(G.isGarminJsonName('DI_CONNECT/DI-GOLF/Golf-SCORECARD.json'));
  assert.ok(G.isGarminJsonName('Golf-SHOT.json'));
  assert.ok(!G.isGarminJsonName('DI_CONNECT/DI-FITNESS/user_profile.json'));
  const src = G.readGarminFiles(exportFiles());
  assert.equal(src.SCORECARD.length, 5);
  assert.equal(src.COURSE.length, 4);
  assert.equal(src.CLUB_TYPES.length, 3);
  assert.equal(src.SIM_SESSION, undefined);
});

test('Garmin：ラウンド・パーの推定・9 ホール 2 回をまとめる・ゴルフ場とコース', () => {
  const p = G.parseGarmin(G.readGarminFiles(exportFiles()));
  assert.equal(p.count, 4); // 終わっていないラウンドは数えない
  assert.equal(p.rounds.length, 3);
  assert.deepEqual([p.from, p.to], ['2025-05-01', '2025-07-01']);
  const [a, b, c] = p.rounds;
  assert.deepEqual(a.holes.map((h) => h.par), [...EAST, ...WEST]);
  assert.equal(a.parTotal, 72);
  assert.deepEqual([a.tee, a.rating, a.slope, a.total, a.holesPlayed], ['Regular', 69.5, 110, 90, 18]);
  assert.equal(a.memo, '歩数 9,000 歩・歩いた距離 8.0 km（Garmin）');
  // フェアウェイ・ペナルティ・パット・ティーショットのクラブ（パー3 は記録しない）
  assert.deepEqual(a.holes.slice(0, 4).map((h) => [h.fairway, h.club, h.penalties, h.putts]),
    [['hit', '1W', 1, 2], ['left', '1W', 0, 2], [null, null, 0, 2], ['hit', '5W', 0, 2]]);
  // 9 ホールずつ 2 回 → 18 ホール（コースレートは足し、スロープは平均）
  assert.deepEqual(b.ids, [2, 3]);
  assert.deepEqual([b.holesPlayed, b.total, b.parTotal, b.rating, b.slope], [18, 90, 72, 69, 109]);
  assert.deepEqual(b.nines, a.nines);
  assert.deepEqual(b.holes.map((h) => h.par), [...EAST, ...WEST]);
  // ショットの記録が無いホールも合計パーで決まる
  assert.deepEqual(c.holes.map((h) => h.par), LAKE);
  assert.equal(c.holes.reduce((s, h) => s + h.par, 0), c.parTotal);
  // ゴルフ場：名前の「~」の前がゴルフ場、後ろがコース。18 ホールのコースは OUT・IN
  assert.deepEqual(p.facilities.map((f) => [f.name, f.nines.map((n) => n.name), f.dates.length]),
    [['Test Hills CC', ['東', '西'], 2], ['Lake Golf Club', ['OUT', 'IN'], 1]]);
  assert.deepEqual(p.facilities[0].nines.map((n) => n.pars), [EAST, WEST]);
  assert.deepEqual(p.facilities[1].nines.map((n) => n.pars), [LAKE.slice(0, 9), LAKE.slice(9)]);
  // アカウント名などは持ち込まない
  assert.ok(!JSON.stringify(p).includes('secret'));
});

test('Garmin：クラブの名前（短い名前・アプリに登録したクラブに合わせる）', () => {
  assert.deepEqual(['Driver', '5 Wood', '4 Hybrid', '7 Iron', 'Pitching Wedge', 'Mini Driver', 'Unknown'].map(G.clubShortName),
    ['1W', '5W', '4U', '7I', 'PW', 'ミニドライバー', null]);
  const bag = [
    { name: 'G440 LST', category: 'driver', in_bag: 1 },
    { name: '3W', category: 'wood', in_bag: 1 }, { name: 'G440 5W', category: 'wood', in_bag: 1 },
    { name: '4U', category: 'hybrid', in_bag: 1 }, { name: '古い5U', category: 'hybrid', in_bag: 0 },
  ];
  assert.equal(G.appClubName('1W', bag), 'G440 LST');
  assert.equal(G.appClubName('5W', bag), 'G440 5W');
  assert.equal(G.appClubName('4U', bag), '4U');
  assert.equal(G.appClubName('5U', bag), '5U'); // バッグに無いクラブは短い名前のまま
  assert.equal(G.appClubName('7I', bag), 'アイアン');
  assert.equal(G.appClubName('1W', []), '1W');
  assert.equal(G.appClubName(null, bag), null);
});

test('Garmin：同じ日のラウンドとの組み合わせ・取り込んだデータと手入力の見分け・ゴルフ場の登録先', () => {
  const p = G.parseGarmin(G.readGarminFiles(exportFiles()));
  const holes = (pars, d = 1) => pars.map((par, i) => ({ hole_no: i + 1, par, strokes: par + d }));
  const bulkAt = '2024-09-01 10:00:0';
  const app = [
    // IKScoreCard から取り込んだ（同じ分に 5 件以上）。2025-05-01 は Garmin と同じ日
    { id: 1, date: '2025-05-01', course_id: 7, course_name: 'テストヒルズ', created_at: `${bulkAt}1`, holes: holes([...EAST, ...WEST]) },
    ...[2, 3, 4, 5].map((id) => ({ id, date: `2019-0${id}-01`, course_id: 7, created_at: `${bulkAt}${id}`, holes: holes(EAST) })),
    // 手入力（2025-07-01 は Garmin と同じ日）
    { id: 6, date: '2025-07-01', course_id: null, course_name: '湖のコース', created_at: '2025-07-01 20:00:00', holes: holes(LAKE, 2) },
    // 同じ日でもホール数が大きく違うラウンドは別物
    { id: 7, date: '2025-06-01', course_id: null, course_name: 'ショート', created_at: '2025-06-01 20:00:00', holes: holes([3, 3, 3]) },
  ];
  assert.deepEqual([...G.bulkImportedIds(app)].sort(), [1, 2, 3, 4, 5]);
  const plan = G.planGarmin(p, app, [{ id: 7, name: 'テストヒルズ' }, { id: 8, name: 'lake golf  club' }]);
  assert.deepEqual(plan.add.map((g) => g.date), ['2025-06-01']);
  assert.deepEqual(plan.pairs.map((x) => [x.g.date, x.a.id, x.origin]), [['2025-05-01', 1, 'import'], ['2025-07-01', 6, 'manual']]);
  // 登録先：同じ日のラウンドのコース → 無ければ同じ名前のコース
  assert.deepEqual(plan.facilities.map((f) => [f.target, f.auto]), [[7, 'pair'], [8, 'name']]);
});

test('Garmin：登録済みコースのまとまりとの対応（パーの並び）', () => {
  const f = { nines: [{ key: 'w', pars: WEST }, { key: 'wk', pars: WEST }, { key: 'e', pars: EAST }, { key: 'x', pars: [3, 3, 3, 3, 3, 3, 3, 3, 3] }] };
  const course = (names, ...nines) => ({ nines: names, holes: nines.flatMap((ps, i) => ps.map((par, j) => ({ hole_no: i * 9 + j + 1, par }))) });
  // ベント・高麗のように同じ並びのまとまりは同じコースへ。合うものが無ければ新しいまとまりとして加える
  let r = G.mapNines(f, course(['東', '西', '北'], EAST, WEST, [4, 3, 5, 4, 4, 4, 5, 3, 4]));
  assert.deepEqual([...r.map], [['w', 2], ['wk', 2], ['e', 1], ['x', 4]]);
  assert.deepEqual(r.added.map((n) => n.key), ['x']);
  // パーの並びが同じ OUT・IN は順番どおり
  r = G.mapNines({ nines: [{ key: 'o', pars: EAST }, { key: 'i', pars: EAST }] }, course(['OUT', 'IN'], EAST, EAST));
  assert.deepEqual([...r.map], [['o', 1], ['i', 2]]);
  // 2 ホールまでの違いは同じとみなす（推定のずれ）
  r = G.mapNines({ nines: [{ key: 'o', pars: [5, 4, 3, 4, 4, 4, 3, 4, 5] }] }, course(['OUT', 'IN'], WEST, EAST));
  assert.deepEqual([...r.map], [['o', 2]]);
  // パーが登録されていないコースは順番どおり
  r = G.mapNines({ nines: [{ key: 'o', pars: EAST }, { key: 'i', pars: WEST }] }, { nines: ['OUT', 'IN'], holes: [] });
  assert.deepEqual([...r.map], [['o', 1], ['i', 2]]);
  assert.equal(r.added.length, 0);
});

test('Garmin：重なったラウンドの置き換え（天気・同伴者・メモは残す、インスタートの入れ替え、変わらなければ書き込まない）', () => {
  const p = G.parseGarmin(G.readGarminFiles(exportFiles()));
  const g = p.rounds[0];
  const course = { id: 7, nines: ['East', 'West'], holes: [...EAST, ...WEST].map((par, i) => ({ hole_no: i + 1, par, yards: 300 + i })) };
  const map = new Map([[g.nines[0], 1], [g.nines[1], 2]]);
  // 新しく追加：コースのパーの合計が合うのでコースのパーと距離を使う
  const add = G.roundBody(g, course, map, []);
  assert.deepEqual([add.course_id, add.front_nine, add.back_nine, add.tee, add.rating, add.slope], [7, 1, 2, 'Regular', 69.5, 110]);
  assert.deepEqual(add.holes[0], { hole_no: 1, par: 4, yards: 300, strokes: 5, putts: 2, penalties: 1, fairway: 'hit', tee_club: '1W' });
  // 元のラウンドはアウトとインが逆に記録されていた（インスタート）。同伴者のスコアとホールのメモも入れ替わる
  const gs = g.holes.map((h) => h.strokes);
  const oldStrokes = [...gs.slice(9), ...gs.slice(0, 9)];
  const a = {
    id: 1, date: g.date, course_id: 7, front_nine: 1, back_nine: 2, weather: '晴れ', companions: '田中', memo: '楽しかった', tee: 'White', rating: null, slope: null,
    party: [{ name: '田中', strokes: oldStrokes.map((s) => s + 1) }],
    holes: oldStrokes.map((s, i) => ({ hole_no: i + 1, par: 4, strokes: s, putts: null, note: i === 9 ? '1番のメモ' : null, bunker: i === 0 ? 1 : null })),
  };
  const body = G.mergeBody(g, a, course, map, []);
  assert.equal(body.swapped, true);
  assert.deepEqual([body.weather, body.companions, body.memo, body.tee], ['晴れ', '田中', '楽しかった', 'Regular']);
  assert.deepEqual(body.party[0].strokes, gs.map((s) => s + 1));
  assert.equal(body.holes[0].note, '1番のメモ');
  assert.equal(body.holes[9].bunker, 1);
  assert.deepEqual(body.holes.map((h) => h.par), [...EAST, ...WEST]);
  assert.ok(G.changes(body, a));
  // 置き換えたあとのラウンドにもう一度取り込んでも変わらない
  const after = { ...a, ...body, id: 1, holes: body.holes, party: body.party };
  const again = G.mergeBody(g, after, course, map, []);
  assert.equal(again.swapped, false);
  assert.equal(G.changes(again, after), false);
});

test('Garmin：英語のゴルフ場名・コース名を日本語に', () => {
  assert.equal(G.jaCourseName('JGM Kasama Golf Club'), 'JGM笠間ゴルフクラブ');
  assert.equal(G.jaCourseName('  noshiro   COUNTRY club '), '能代カントリークラブ');
  assert.equal(G.jaCourseName('Unknown Golf Club'), null);
  assert.deepEqual(['East Bent', 'West Korai', 'Sakura West', 'Center Korai', 'Uchibo Right OUT', 'Moritake Onsen IN', 'Out', 'South', 'King A', 'Penkurosu'].map(G.jaNineName),
    ['東ベント', '西高麗', '桜西', '中高麗', '内房右 OUT', '森岳 IN', 'OUT', '南', 'King A', 'Penkurosu']);
  // 名前が分かるゴルフ場は日本語にして、元の英語の名前も残す
  const files = exportFiles().map((x) => (/COURSE/.test(x.name) ? { ...x, text: JSON.stringify({ type: 'COURSE', data: [{ 101: 'Itako Country Club ~ East/West' }, { 102: 'Itako Country Club ~ East' }, { 103: 'Itako Country Club ~ West' }, { 201: 'Lake Golf Club' }] }) } : x));
  const p = G.parseGarmin(G.readGarminFiles(files));
  assert.deepEqual(p.facilities.map((x) => [x.name, x.garminName]), [['潮来カントリー倶楽部', 'Itako Country Club'], ['Lake Golf Club', null]]);
  // 登録済みのゴルフ場と日本語の名前が同じなら、それを登録先にする
  const plan = G.planGarmin(p, [], [{ id: 3, name: '潮来カントリー倶楽部' }]);
  assert.deepEqual(plan.facilities.map((x) => [x.target, x.auto]), [[3, 'name'], [null, null]]);
});
