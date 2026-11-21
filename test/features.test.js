'use strict';
// 目標スコアの計算・コース共有ファイル・目標スコアの設定値のテスト
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);
let stats;
let courseFile;
let model;
before(async () => {
  stats = await load('public/js/stats.js');
  courseFile = await load('public/js/shared/courseFile.js');
  model = await load('public/js/shared/model.js');
});

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
// 各ホールの (スコア − パー) を指定してラウンドを作る
function round(id, date, over, { putts = 2, penalties = 0 } = {}) {
  return {
    id, date, course_name: 'テストGC',
    holes: PARS.map((par, i) => ({ hole_no: i + 1, par, strokes: par + over[i % over.length], putts: typeof putts === 'function' ? putts(i) : putts, penalties: typeof penalties === 'function' ? penalties(i) : penalties })),
  };
}

test('目標スコア：次に目指す目標の提案', () => {
  assert.equal(stats.suggestGoal(null), 100);
  assert.equal(stats.suggestGoal(97.4), 95);
  assert.equal(stats.suggestGoal(103), 100);
  assert.equal(stats.suggestGoal(125), 120);
  assert.equal(stats.suggestGoal(70), 75);
});

test('目標スコア：達成回数・あと何打・縮めるポイント', () => {
  // パー72。1 = ボギー、2 = ダブルボギー
  const rounds = [
    round(1, '2026-05-01', [2, 1, 1]), // 72 + 24 = 96
    round(2, '2026-06-01', [1]), // 90
    round(3, '2026-07-01', [2, 2, 1], { putts: (i) => (i % 6 === 0 ? 3 : 2), penalties: (i) => (i % 4 === 0 ? 1 : 0) }), // 102
    round(4, '2026-08-01', [2, 1]), // 99
    round(5, '2026-09-01', [1, 2]), // 99
  ];
  const sums = rounds.map(stats.summarize);
  const p = stats.goalProgress(sums, 100);
  assert.equal(p.rounds, 5);
  assert.equal(p.achieved, 4); // 99 以下
  assert.equal(p.firstAchieved.id, 1);
  assert.equal(p.best.strokes, 90);
  assert.equal(p.recentAvg, (96 + 90 + 102 + 99 + 99) / 5);
  assert.ok(Math.abs(p.gap - (p.recentAvg - 99)) < 1e-9);
  assert.deepEqual(p.last10.map((r) => r.ok), [true, true, false, true, true]);
  assert.ok(p.tips.length >= 1 && p.tips.length <= 2);
  assert.equal(p.tips[0].key, 'double'); // ダブルボギーが一番多い
  for (let i = 1; i < p.tips.length; i++) assert.ok(p.tips[i - 1].save >= p.tips[i].save);
  // 9 ホールだけのラウンドは数えない
  const nine = stats.summarize({ id: 9, date: '2026-10-01', holes: PARS.slice(0, 9).map((par, i) => ({ hole_no: i + 1, par, strokes: par })) });
  assert.equal(stats.goalProgress([...sums, nine], 100).rounds, 5);
});

test('目標スコアの設定値：60〜150 の整数だけ保存し、それ以外は「目標なし」', () => {
  assert.equal(model.normalizeSetting('goal', '100'), '100');
  assert.equal(model.normalizeSetting('goal', 90), '90');
  assert.equal(model.normalizeSetting('goal', ''), '');
  assert.equal(model.normalizeSetting('goal', 'abc'), '');
  assert.equal(model.normalizeSetting('goal', 300), '');
  assert.equal(model.normalizeSetting('goal', 99.5), '');
  assert.ok(model.SETTING_KEYS.includes('goal'));
});

test('コース共有ファイル：作成 → 読み取りで同じコースになる（メモ・スコアは含まない）', () => {
  const courses = [
    { id: 1, name: '東西南カントリー', location: '茨城県', rating: 71.2, slope: 128, memo: '自分用のメモ', nines: ['東', '西', '南'], round_count: 5,
      holes: Array.from({ length: 27 }, (_, i) => ({ course_id: 1, hole_no: i + 1, par: [4, 3, 5][i % 3], yards: 300 + i, hdcp: (i % 27) + 1 })) },
    { id: 2, name: 'シンプルGC', location: null, rating: null, slope: null, memo: null, nines: ['OUT', 'IN'],
      holes: PARS.map((par, i) => ({ course_id: 2, hole_no: i + 1, par, yards: null, hdcp: null })) },
  ];
  const file = courseFile.buildCourseFile(courses, new Date('2026-11-22T00:00:00Z'));
  const text = JSON.stringify(file);
  assert.equal(text.includes('自分用のメモ'), false);
  assert.equal(text.includes('round_count'), false);
  assert.equal(text.includes('course_id'), false);
  const items = courseFile.parseCourseFile(text);
  assert.equal(items.length, 2);
  assert.equal(items[0].error, null);
  assert.equal(items[0].course.name, '東西南カントリー');
  assert.deepEqual(items[0].course.nines, ['東', '西', '南']);
  assert.equal(items[0].course.holes.length, 27);
  assert.deepEqual(items[0].course.holes[26], { hole_no: 27, par: 5, yards: 326, hdcp: 27, memo: null });
  assert.equal(items[0].course.rating, 71.2);
  assert.equal(items[1].course.holes.length, 18);
  assert.deepEqual(items[1].course.nines, ['OUT', 'IN']);
});

test('コース共有ファイル：別のファイルや壊れたコースは読み込まない', () => {
  assert.throws(() => courseFile.parseCourseFile('これはファイルではない'), /読み取れません/);
  assert.throws(() => courseFile.parseCourseFile(JSON.stringify({ kind: 'other', courses: [] })), /このアプリで作った/);
  assert.throws(() => courseFile.parseCourseFile(JSON.stringify({ kind: courseFile.COURSE_FILE_KIND, courses: [] })), /入っていません/);
  const items = courseFile.parseCourseFile(JSON.stringify({ kind: courseFile.COURSE_FILE_KIND, version: 1, courses: [
    { name: '', holes: [] },
    { name: 'パーが変なコース', holes: [{ hole_no: 1, par: 9 }] },
    { name: '正しいコース', holes: [{ hole_no: 1, par: 4 }] },
    'ただの文字',
  ] }));
  assert.equal(items.length, 4);
  assert.match(items[0].error, /コース名は必須/);
  assert.match(items[1].error, /パー/);
  assert.equal(items[2].error, null);
  assert.ok(items[3].error);
  // BOM 付き・前後の空白も読める
  const ok = courseFile.parseCourseFile('﻿  ' + JSON.stringify({ kind: courseFile.COURSE_FILE_KIND, courses: [{ name: 'A', holes: [] }] }) + '\n');
  assert.equal(ok[0].course.name, 'A');
});

test('AI に貼り付ける質問文：目的ごとに必要なデータが入り、名前・同伴者は入らない', async () => {
  const ai = await load('public/js/aiPrompt.js');
  const course = { id: 7, name: 'テストカントリー', location: '千葉県', rating: 70.5, slope: 125, nines: ['OUT', 'IN'],
    holes: PARS.map((par, i) => ({ hole_no: i + 1, par, yards: 300 + i * 10, hdcp: i + 1 })) };
  const rounds = [
    { ...round(1, '2026-09-01', [1, 2]), course_id: 7, course_name: 'テストカントリー', companions: '山田太郎さん', memo: '秘密のメモ', tee: 'レギュラー', party: [{ name: '鈴木一郎', strokes: [5, 4] }] },
    { ...round(2, '2026-10-01', [1]), course_id: 7, course_name: 'テストカントリー', companions: '佐藤花子さん' },
    { ...round(3, '2026-11-01', [0, 1]), course_id: null, course_name: '別のGC' },
  ];
  const clubs = [{ id: 1, name: '7I', category: 'iron', loft: 31, in_bag: 1, avg_carry: 145.4, avg_total: 152, max_carry: 155, min_carry: 130, shot_count: 12 }];
  const data = { rounds, courses: [course], clubs, settings: { player_name: '本名テスト', goal: '100', unit: 'yd' } };
  for (const p of ai.AI_PURPOSES) {
    const text = ai.buildAiPrompt(data, { purpose: p.key, period: p.period, roundId: 1, courseId: 7, holes: true, clubs: true, memo: false });
    assert.match(text, new RegExp(`お願い（${p.label}）`));
    for (const secret of ['本名テスト', '山田太郎', '佐藤花子', '秘密のメモ', '鈴木一郎']) assert.equal(text.includes(secret), false, `${p.key} に ${secret} が入っている`);
    assert.match(text, /100切り/);
    assert.match(text, /7I,アイアン,31°/);
  }
  const overall = ai.buildAiPrompt(data, { purpose: 'overall', period: 'all', holes: true, clubs: false, memo: true });
  assert.match(overall, /ラウンド一覧/);
  assert.match(overall, /2026\/11\/1,別のGC,18,/);
  assert.match(overall, /スコア: /);
  assert.match(overall, /秘密のメモ/); // メモはチェックしたときだけ
  assert.equal(overall.includes('クラブと飛距離'), false);
  const rd = ai.buildAiPrompt(data, { purpose: 'round', roundId: 1, holes: true });
  assert.match(rd, /対象のラウンド/);
  assert.match(rd, /2026\/9\/1（火） ・ テストカントリー/);
  assert.match(rd, /いつもの私/);
  const cs = ai.buildAiPrompt(data, { purpose: 'course', courseId: 7, holes: true, clubs: true });
  assert.match(cs, /テストカントリー」を次に回るとき/);
  assert.match(cs, /ホール,パー,ヤード,HDCP/);
  assert.match(cs, /^1,4,300,1,2,/m); // 1番：パー4・300ヤード・HDCP1・私の回数2
  // データがなくても作れる
  const empty = ai.buildAiPrompt({ rounds: [], courses: [], clubs: [], settings: {} }, { purpose: 'overall' });
  assert.match(empty, /まだラウンドの記録がありません/);
});

test('年間のまとめ：ラウンド数・ベスト・月別・節目・前の年との比較', () => {
  const rounds = [
    round(1, '2025-06-01', [2, 2, 1]), // 102（前の年）
    round(2, '2025-08-01', [2, 1]), // 99（前の年に 100 切り済み）
    round(3, '2026-03-10', [2, 1, 1]), // 96
    round(4, '2026-03-20', [1], { putts: (i) => (i % 2 ? 1 : 2) }), // 90（パット 27）
    round(5, '2026-07-05', [0, 1]), // 81 → 90 切り（初）
    { id: 6, date: '2026-09-01', course_name: '9ホール', holes: PARS.slice(0, 9).map((par, i) => ({ hole_no: i + 1, par, strokes: par })) },
  ];
  const r = stats.yearReview(rounds, 2026);
  assert.equal(r.rounds, 4);
  assert.equal(r.completeRounds, 3);
  assert.equal(r.best.strokes, 81);
  assert.equal(r.avgScore, (96 + 90 + 81) / 3);
  assert.equal(r.months[2].rounds, 2);
  assert.equal(r.months[2].avg, 93);
  assert.equal(r.months[8].rounds, 1);
  assert.equal(r.months[8].avg, null);
  assert.equal(r.records.fewestPutts.putts, 27);
  assert.deepEqual(r.milestones.map((m) => [m.goal, m.everFirst, m.round.id]), [[120, false, 3], [110, false, 3], [100, false, 3], [90, true, 5]]);
  assert.equal(r.prevRounds, 2);
  const avg = r.comparisons.find((c) => c.label === '平均スコア');
  assert.equal(avg.prev, (102 + 99) / 2);
  assert.equal(avg.improved, true);
  assert.equal(r.courses[0].name, 'テストGC');
  assert.equal(r.courses[0].rounds, 3);
  assert.deepEqual(stats.reviewYears(rounds), [2026, 2025]);
  assert.equal(stats.yearReview(rounds, 2024).rounds, 0);
});

test('スコアの CSV：1行 = 1ラウンド、カンマや改行を含む文字は囲む、BOM 付き', async () => {
  const { roundsCsv } = await load('public/js/csv.js');
  const r = { ...round(1, '2026-05-01', [1]), course_name: 'A,B カントリー', memo: '1行目\n"2行目"', companions: '田中さん' };
  const csv = roundsCsv([r, { id: 2, date: '2026-04-01', course_name: '9H', holes: PARS.slice(0, 9).map((par, i) => ({ hole_no: i + 1, par, strokes: par })) }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const rows = csv.slice(1).trim().split('\r\n');
  assert.equal(rows.length, 3); // 見出し + 2 ラウンド（行の区切りは CRLF、メモの中の改行は囲まれた LF）
  assert.match(rows[0], /^日付,コース,回ったコース/);
  assert.match(rows[1], /^2026-04-01,9H,,,,,9,36,36,0,36,,/); // 日付の古い順
  assert.match(csv, /"A,B カントリー"/);
  assert.match(csv, /"1行目\n""2行目"""/);
  assert.match(csv, /2026-05-01,"A,B カントリー",,,,田中さん,18,90,72,18,45,45,36,/);
});

test('スコアの分布（5打ごと）とハンディキャップの推移', () => {
  const sums = [round(1, '2026-01-01', [1]), round(2, '2026-02-01', [2, 1]), round(3, '2026-03-01', [1, 1, 2]), round(4, '2026-04-01', [0, 1])].map(stats.summarize);
  // 90, 99, 96, 81
  assert.deepEqual(stats.scoreDistribution(sums), [
    { from: 80, to: 84, count: 1 }, { from: 85, to: 89, count: 0 }, { from: 90, to: 94, count: 1 }, { from: 95, to: 99, count: 2 },
  ]);
  const t = stats.handicapTrend(sums);
  assert.deepEqual(t.map((x) => x.id), [3, 4]); // 3 ラウンド目から計算できる
  assert.ok(t[1].handicap < t[0].handicap); // 81 で良くなる
  assert.deepEqual(stats.scoreDistribution([]), []);
});

test('目標スコアの配分：合計が「目標 − 1」になり、難しいホールほど多く配る', () => {
  const holes = PARS.map((par, i) => ({ hole_no: i + 1, par }));
  const hdcp = (no) => 19 - no; // 1番が一番難しい（HDCP 1）とする
  const plan = stats.goalPlan(holes, 100, hdcp); // 99 = パー72 + 27
  const sum = [...plan.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum, 99);
  // 全ホールボギー（+18）＋ 難しい 9 ホールはダブルボギー
  assert.equal(plan.get(1), PARS[0] + 2);
  assert.equal(plan.get(18), PARS[17] + 1);
  assert.equal([...plan.entries()].filter(([no, v]) => v - PARS[no - 1] === 2).length, 9);
  const p90 = stats.goalPlan(holes, 90, hdcp); // 89 = +17
  assert.equal([...p90.values()].reduce((a, b) => a + b, 0), 89);
  assert.equal(p90.get(18), PARS[17]); // 一番やさしいホールはパー
  assert.equal(stats.goalPlan(holes, null), null);
  assert.equal(stats.planLabel(5, 4), 'ボギー');
  assert.equal(stats.planLabel(4, 4), 'パー');
  assert.equal(stats.planLabel(8, 4), 'パー+4');
});

test('ラウンドの達成：ベスト更新・初めての目標達成・初めての90切り・初バーディ', () => {
  const others = [round(1, '2026-01-01', [2, 1]), round(2, '2026-02-01', [2, 2, 1])].map(stats.summarize); // 99, 102
  const r88 = stats.summarize({ ...round(3, '2026-03-01', [1, 1, 0]), holes: round(3, '2026-03-01', [1, 1, 0]).holes.map((h, i) => (i === 0 ? { ...h, strokes: h.par - 1 } : h)) });
  // 72 + 12 − 1 = 83 → ベスト更新・目標（100）は 2 回目（99 で達成済み）・初めての90切り・初バーディ
  const a = stats.roundAchievements(r88, others, 100);
  assert.deepEqual(a.map((x) => x.key), ['best', 'goal', 'm90', 'birdie']);
  assert.match(a[0].text, /これまでのベストは 99/);
  assert.equal(a[1].title, '100切り達成！');
  assert.equal(a[1].text, '2 回目の達成です');
  const g90 = stats.roundAchievements(r88, others, 90);
  assert.equal(g90.find((x) => x.key === 'goal').title, '初めての90切り！');
  assert.equal(g90.some((x) => x.key === 'm90'), false); // 目標と同じ節目は重ねない
  assert.deepEqual(stats.roundAchievements(stats.summarize(round(4, '2026-04-01', [2, 2, 2])), others, 100).map((x) => x.key), []);
});

test('パー3 の番手の目安：距離にいちばん近い番手', () => {
  const clubs = [
    { name: '1W', category: 'driver', in_bag: 1, shot_count: 5, avg_carry: 220 },
    { name: '7I', category: 'iron', in_bag: 1, shot_count: 8, avg_carry: 148 },
    { name: '8I', category: 'iron', in_bag: 1, shot_count: 0, avg_carry: null, target_carry: 138 },
    { name: '9I', category: 'iron', in_bag: 1, shot_count: 6, avg_carry: 128 },
    { name: 'PT', category: 'putter', in_bag: 1 },
    { name: '6I', category: 'iron', in_bag: 0, shot_count: 3, avg_carry: 158 },
  ];
  assert.equal(stats.suggestClub(clubs, 148).name, '7I');
  assert.equal(stats.suggestClub(clubs, 141).name, '8I'); // 8I(138) が 7I(148) より近い
  assert.equal(stats.suggestClub(clubs, 143).name, '7I'); // ちょうど中間なら長いほう
  assert.equal(stats.suggestClub(clubs, 137).name, '8I');
  assert.equal(stats.suggestClub(clubs, 137).measured, false);
  assert.equal(stats.suggestClub(clubs, 60), null); // 合う番手がない
  assert.equal(stats.suggestClub(clubs, null), null);
  assert.equal(stats.suggestClub(clubs, 150, 'm').name, '8I');
});
