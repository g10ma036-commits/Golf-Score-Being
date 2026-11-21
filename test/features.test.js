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
  assert.deepEqual(items[0].course.holes[26], { hole_no: 27, par: 5, yards: 326, hdcp: 27 });
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
