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
  // 条件別：2 つ以上に分かれるものだけ（3 ラウンドとも秋なので季節は出ない）
  assert.match(overall, /## 条件別の平均スコア（18ホールのラウンド）\n- 曜日：平日 [\d.]+（2回）、土日 [\d.]+（1回）\n\n/);
  assert.equal(overall.includes('季節：'), false);
  assert.match(overall, /## 距離別の成績（コースに登録したホールの距離）\nパー,距離,ホール数,平均パー比,パー以内の率\n3,/);
  assert.match(overall, /## スコアの流れ（18ホールのラウンド・ホールあたりのパー比）\n- 出だし3ホール [+−±][\d.]+、中盤/);
  const rd =ai.buildAiPrompt(data, { purpose: 'round', roundId: 1, holes: true });
  assert.match(rd, /対象のラウンド/);
  assert.match(rd, /2026\/9\/1（火） ・ テストカントリー/);
  assert.match(rd, /いつもの私/);
  const cs = ai.buildAiPrompt(data, { purpose: 'course', courseId: 7, holes: true, clubs: true });
  assert.match(cs, /テストカントリー」を次に回るとき/);
  assert.match(cs, /ホール,パー,ヤード,HDCP/);
  assert.match(cs, /^1,4,300,1,\d+,2,/m); // 1番：パー4・300ヤード・HDCP1・目標打数・私の回数2
  assert.match(cs, /目標打数（100切りの配分）/);
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
  assert.match(rows[0], /,メモ,ホールのメモ,1番,/);
  // ホールのメモはホール番号の順に 1 つの欄へ（メモが無いラウンドは空欄）
  const noted = { ...round(3, '2026-06-01', [1]) };
  noted.holes = noted.holes.map((h) => (h.hole_no === 7 ? { ...h, note: '池に入れた' } : h.hole_no === 2 ? { ...h, note: '3パット' } : h));
  const csv2 = roundsCsv([noted]).slice(1).trim().split('\r\n')[1];
  assert.match(csv2, /,2番: 3パット／7番: 池に入れた,/);
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

test('次のラウンドの予定（設定）：日付が正しいときだけ保存する', () => {
  assert.equal(model.normalizeSetting('next_round', { date: '2026-12-01', course_id: 3 }), '{"date":"2026-12-01","course_id":3}');
  assert.equal(model.normalizeSetting('next_round', '{"date":"2026-12-01"}'), '{"date":"2026-12-01","course_id":null}');
  assert.equal(model.normalizeSetting('next_round', { date: '2026-02-30' }), '');
  assert.equal(model.normalizeSetting('next_round', 'x'), '');
  assert.equal(model.normalizeSetting('next_round', ''), '');
  assert.deepEqual(model.parseNextRound('{"date":"2026-12-01","course_id":"7"}'), { date: '2026-12-01', course_id: 7 });
  assert.equal(model.parseNextRound(null), null);
});

test('実績：条件を最初に満たしたラウンドを記録し、未達成も一覧に入る', () => {
  const rounds = [
    round(1, '2026-01-01', [2, 1]), // 99 → 100切り・110切り・120切り
    round(2, '2026-02-01', [1]), // 90
    { ...round(3, '2026-03-01', [0, 1, 1]), holes: round(3, '2026-03-01', [0, 1, 1]).holes.map((h, i) => (i === 0 ? { ...h, strokes: h.par - 1 } : h)) }, // 83 + バーディ
  ];
  const a = stats.achievements(rounds);
  const get = (k) => a.find((x) => x.key === k);
  assert.equal(get('first').round.id, 1);
  assert.equal(get('u100').round.id, 1);
  assert.equal(get('u90').round.id, 3);
  assert.equal(get('u80').achieved, false);
  assert.equal(get('birdie').round.id, 3);
  assert.equal(get('r10').achieved, false);
  assert.equal(get('h45').round.id, 3); // 2 ラウンド目は 45・45（45切りではない）、3 ラウンド目の前半 41
  assert.equal(get('even').achieved, false);
  assert.ok(a.length > 20);
});

test('AI の質問文：自由に質問・答えの長さ', async () => {
  const ai = await load('public/js/aiPrompt.js');
  const data = { rounds: [round(1, '2026-09-01', [1])], courses: [], clubs: [], settings: {} };
  const t = ai.buildAiPrompt(data, { purpose: 'free', question: '  雨の日のコツは？  ', length: 'short', holes: false });
  assert.match(t, /お願い（自由に質問）/);
  assert.match(t, /- 質問：雨の日のコツは？\n/);
  assert.match(t, /400 字くらい/);
  assert.match(t, /ラウンド一覧/);
  assert.ok(ai.AI_FOLLOWUPS.free.length >= 1);
  for (const p of ai.AI_PURPOSES) assert.ok(ai.AI_FOLLOWUPS[p.key]?.length, p.key);
});

test('ミスの影響：良い場合とミスの場合のパー比の差、1ラウンドあたりの損失', () => {
  // パー4 だけの 18 ホール。FW キープはパー、外すとボギー、OB はダブルボギー
  const mk = (id, pattern) => ({ id, date: `2026-0${id}-01`, holes: Array.from({ length: 18 }, (_, i) => {
    const p = pattern[i % pattern.length];
    return { hole_no: i + 1, par: 4, strokes: p === 'hit' ? 4 : p === 'ob' ? 6 : 5, putts: 2, fairway: p === 'ob' ? 'right' : p, penalties: p === 'ob' ? 1 : 0 };
  }) });
  const rounds = [mk(1, ['hit', 'left', 'hit']), mk(2, ['hit', 'right', 'ob'])];
  const im = stats.shotImpact(rounds);
  const fw = im.find((x) => x.key === 'fw');
  assert.equal(fw.good.avg, 0);
  assert.ok(Math.abs(fw.loss - (6 * 1 + 6 * 1 + 6 * 2) / 18) < 1e-9); // 外した 18 ホールの平均 +1.33
  assert.equal(fw.perRoundCount, 9); // 2 ラウンドで 18 回
  const pen = im.find((x) => x.key === 'penalty');
  assert.ok(Math.abs(pen.loss - (2 - 12 / 30)) < 1e-9); // なしの 30 ホールはパー比 +12
  assert.equal(im.some((x) => x.key === 'bunker'), false); // データが少ない項目は出さない
  for (let i = 1; i < im.length; i++) assert.ok(im[i - 1].perRound >= im[i].perRound);
});

test('ラウンドを文章にする（LINE などに貼る用）', async () => {
  const { roundText } = await load('public/js/views/shareCard.js');
  const r = { ...round(1, '2026-11-22', [1]), course_name: 'テストGC', companions: '山田さん', party: [{ name: '田中', strokes: Array(18).fill(4) }] };
  const plain = roundText(r);
  assert.match(plain, /^⛳ 2026\/11\/22\(日\) テストGC/);
  assert.match(plain, /スコア 90（\+18）　OUT 45・IN 45/);
  assert.equal(plain.includes('山田'), false); // 同伴者は選んだときだけ
  assert.equal(plain.includes('ランキング'), false);
  const full = roundText(r, { companions: true, party: true });
  assert.match(full, /同伴：山田さん/);
  assert.match(full, /1\. 田中 72\n2\. 自分 90/);
});

test('ボギーオン率・パーオン時のパット・リカバリー率の数え方', () => {
  // パー4: (4,2) パーオン / (5,2) ボギーオン・リカバリー失敗 / (4,1) ボギーオン・リカバリー成功 / (6,2) どちらでもない
  const holes = [[4, 2], [5, 2], [4, 1], [6, 2]].map(([strokes, putts], i) => ({ hole_no: i + 1, par: 4, strokes, putts }));
  const s = stats.summarize({ id: 1, date: '2026-01-01', holes });
  assert.equal(s.gir, 1);
  assert.equal(s.girPutts, 2);
  assert.equal(s.bogeyOn, 3);
  assert.equal(s.scrChances, 3);
  assert.equal(s.scrSaves, 1);
  const a = stats.aggregate([s]);
  assert.equal(a.bogeyOnRate, 3 / 4);
  assert.equal(a.puttsPerGir, 2);
  assert.equal(a.scrambleRate, 1 / 3);
});

test('ティーショットのクラブ別：回数・FWキープ率・OB率・パー比', () => {
  const holes = [
    { hole_no: 1, par: 4, strokes: 5, fairway: 'hit', tee_club: '1W' },
    { hole_no: 2, par: 4, strokes: 7, fairway: 'right', penalties: 1, tee_club: '1W' },
    { hole_no: 3, par: 4, strokes: 4, fairway: 'hit', tee_club: '5W' },
    { hole_no: 4, par: 3, strokes: 3, tee_club: '7I' }, // パー3 は数えない
    { hole_no: 5, par: 5, strokes: 6, fairway: 'left' }, // クラブ未記録
  ];
  const t = stats.teeClubStats([{ id: 1, date: '2026-01-01', holes }]);
  assert.deepEqual(t.map((x) => x.club), ['1W', '5W']);
  assert.equal(t[0].n, 2);
  assert.equal(t[0].fwRate, 0.5);
  assert.equal(t[0].penaltyRate, 0.5);
  assert.equal(t[0].toPar, 2);
  assert.equal(t[1].toPar, 0);
});

test('条件別のスコア：天気・季節・曜日・ティー・同伴者（18ホールのラウンドだけ）', () => {
  const rs = [
    { ...round(1, '2026-04-04', [1]), weather: '晴れ', companions: '田中さん、佐藤さん' }, // 土曜 90
    { ...round(2, '2026-04-08', [2]), weather: '雨', companions: '田中さん', party: [{ name: '鈴木さん', strokes: [] }] }, // 水曜 108
    { ...round(3, '2026-07-12', [0]), weather: '晴れ', tee: 'バック', companions: '田中さん', party: [{ name: '鈴木さん', strokes: [] }] }, // 日曜 72
    { id: 4, date: '2026-07-13', weather: '雨', course_name: '9H', holes: PARS.slice(0, 9).map((par, i) => ({ hole_no: i + 1, par, strokes: par })) }, // 9H は数えない
  ];
  const w = stats.conditionStats(rs, 'weather');
  assert.equal(w.total, 3);
  assert.equal(w.overall, 90);
  assert.deepEqual(w.rows.map((r) => [r.key, r.n, r.avg, r.best, r.diff]), [['晴れ', 2, 81, 72, -9], ['雨', 1, 108, 108, 18]]);
  assert.deepEqual(stats.conditionStats(rs, 'season').rows.map((r) => r.key), ['春（3〜5月）', '夏（6〜8月）']);
  assert.deepEqual(stats.conditionStats(rs, 'day').rows.map((r) => [r.key, r.n]), [['平日', 1], ['土日', 2]]);
  // 同伴者：2 回以上だけ・同伴者のスコアの名前も数える・同じラウンドで重複して数えない
  assert.deepEqual(stats.conditionStats(rs, 'companion').rows.map((r) => [r.key, r.n]), [['田中さん', 3], ['鈴木さん', 2]]);
  assert.deepEqual(stats.conditionStats(rs, 'tee').rows.map((r) => r.key), ['バック']);
  assert.deepEqual(stats.splitNames(' 田中さん、佐藤さん,鈴木さん・高橋さん '), ['田中さん', '佐藤さん', '鈴木さん', '高橋さん']);
});

test('距離別の成績：パーごとに距離で分け、27 ホールのコースは回った 9 ホールの距離を使う', () => {
  const course = { id: 5, holes: [
    ...PARS.map((par, i) => ({ hole_no: i + 1, par, yards: par === 3 ? 150 : par === 4 ? (i < 9 ? 320 : 420) : 500 })),
    ...PARS.slice(0, 9).map((par, i) => ({ hole_no: 19 + i, par, yards: par === 4 ? 380 : par === 3 ? 200 : 540 })),
  ] };
  const r1 = { ...round(1, '2026-05-01', [1]), course_id: 5 }; // 1〜18 番
  const r2 = { ...round(2, '2026-06-01', [0]), course_id: 5, front_nine: 3, back_nine: 1 }; // 3 つ目の 9 ホール → 1 つ目
  const rows = stats.distanceStats([r1, r2, { ...round(3, '2026-07-01', [5]), course_id: null }], [course]);
  const get = (par, label) => rows.find((r) => r.par === par && r.label === label);
  assert.deepEqual(rows.map((r) => `${r.par}:${r.label}:${r.n}`), [
    '3:130〜159y:6', '3:190y以上:2', '4:330y未満:10', '4:370〜409y:5', '4:410y以上:5', '5:470〜519y:6', '5:520y以上:2',
  ]);
  assert.equal(get(4, '410y以上').toPar, 1); // r1 の後半だけ（+1）
  assert.equal(get(4, '370〜409y').parRate, 1); // r2 の前半（3 つ目の 9 ホール）はすべてパー
  // メートルの設定では区切りも換算（330y → 300m）
  assert.deepEqual(stats.distanceStats([r1], [course], 'm').filter((r) => r.par === 4).map((r) => r.label), ['300〜339m', '375m以上']); // 区切り 330/370/410y → 300/340/375m
});

test('スコアの流れ：出だし・上がり・大叩きの後・ボギー以上の連続', () => {
  // 1〜3 番 +2（大叩き）、4 番 +1、5〜15 番 0、16〜18 番 +1
  const over = (i) => (i < 3 ? 2 : i === 3 ? 1 : i >= 15 ? 1 : 0);
  const r = { id: 1, date: '2026-05-01', holes: PARS.map((par, i) => ({ hole_no: i + 1, par, strokes: par + over(i) })) };
  const f1 = stats.roundFlow(r);
  assert.deepEqual(f1, { start: 6, finish: 3, big: 3, recovered: 1, longest: 4, holes: 18 }); // 3 番の次（4 番 +1）だけ立て直し
  const f = stats.flowStats([r, { ...r, id: 2 }, { ...r, id: 3 }, { id: 4, date: '2026-06-01', holes: r.holes.slice(0, 9) }]); // 9H は数えない
  assert.equal(f.rounds, 3);
  assert.equal(f.start, 2);
  assert.equal(f.finish, 1);
  assert.equal(f.middle, 1 / 12);
  assert.equal(f.afterBig.n, 9);
  assert.equal(f.afterBig.avg, (2 + 2 + 1) / 3);
  assert.equal(f.longestMax, 4);
  const texts = stats.flowInsights(f).map((x) => x.text).join('\n');
  assert.match(texts, /出だし3ホールが平均より/);
  assert.match(texts, /上がり3ホールが平均より/);
  assert.match(texts, /引きずる傾向/);
  assert.deepEqual(stats.flowInsights(null), []);
});

test('スコアのシミュレーター：ミスを減らしたときの予想スコアと、目標に届く組み合わせ', () => {
  const impact = [
    { key: 'putt3', good: { n: 100 }, count: 40, perRoundCount: 2, loss: 1 },
    { key: 'penalty', good: { n: 120 }, count: 20, perRoundCount: 1, loss: 2 },
    { key: 'gir', good: { n: 30 }, count: 150, perRoundCount: 15, loss: 0.8 }, // パーオン 3 回/R
    { key: 'fw', good: { n: 50 }, count: 50, perRoundCount: 5, loss: 0.02 }, // 影響が小さいものは出さない
  ];
  const items = stats.simItems(impact);
  assert.deepEqual(items.map((i) => [i.key, i.dir, i.current]), [['penalty', 'down', 1], ['putt3', 'down', 2], ['gir', 'up', 3]]);
  assert.equal(stats.simulate(100, items).projected, 100); // 動かさなければ同じ
  const r = stats.simulate(100, items, { putt3: 1, penalty: 0, gir: 5 });
  assert.equal(r.effects.putt3, -1);
  assert.equal(r.effects.penalty, -2);
  assert.ok(Math.abs(r.effects.gir + 1.6) < 1e-9);
  assert.ok(Math.abs(r.projected - 95.4) < 1e-9);
  assert.equal(stats.simulate(100, items, { putt3: -5 }).effects.putt3, -2); // 範囲の外は丸める
  // 101.5 → 100 切り（99.x）：効き目の大きい OB から（半分まで）
  const plan = stats.simPlan(101.5, items, 100);
  assert.equal(plan.reached, true);
  assert.equal(plan.values.penalty, 0.5);
  assert.ok(plan.projected < 100);
  assert.equal(stats.simPlan(98, items, 100), null); // もう届いている
  assert.equal(stats.simPlan(130, items, 100).reached, false); // 無理のない範囲では届かない
});
