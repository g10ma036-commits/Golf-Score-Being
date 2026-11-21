'use strict';
// コースガイドの表の貼り付け取り込み（public/js/shared/courseParse.js）のテスト
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let parse;
before(async () => {
  ({ parseCourseText: parse } = await import(pathToFileURL(path.join(__dirname, '../public/js/shared/courseParse.js')).href));
});

const PARS = [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const HDCP = [7, 3, 11, 15, 1, 9, 17, 5, 13, 8, 2, 16, 4, 12, 6, 18, 10, 14];
const BACK = [395, 520, 380, 180, 410, 370, 165, 530, 400, 405, 390, 175, 540, 360, 420, 190, 385, 515];
const REG = BACK.map((y) => y - 25);
const LADY = BACK.map((y) => y - 80);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const T = (cells) => cells.join('\t');

function horizontalTsv() {
  const half = (from) => {
    const r = (label, arr, total) => T([label, ...arr.slice(from, from + 9), total ?? sum(arr.slice(from, from + 9))]);
    return [
      T(['ホール', ...Array.from({ length: 9 }, (_, i) => from + i + 1), from ? 'IN' : 'OUT']),
      r('バック', BACK), r('レギュラー', REG), r('レディース', LADY), r('パー', PARS), r('HDCP', HDCP, ''),
    ].join('\n');
  };
  return `コースガイド\nコースレート 71.2 / スロープレート 128\n${half(0)}\n\n${half(9)}`;
}

function check(res, { tees = ['バック', 'レギュラー', 'レディース'], hdcp = true } = {}) {
  assert.ok(res, '読み取れること');
  assert.equal(res.holes.length, 18);
  assert.deepEqual(res.holes.map((h) => h.par), PARS);
  if (hdcp) assert.deepEqual(res.holes.map((h) => h.hdcp), HDCP);
  assert.deepEqual(res.tees, tees);
  assert.deepEqual(res.holes.map((h) => h.yards[tees[0]]), BACK);
  assert.equal(res.blocks.length, 2);
}

test('PC でコピーした横向きの表（OUT・IN の 2 表、合計列あり、3 ティー）', () => {
  const res = parse(horizontalTsv());
  check(res);
  assert.equal(res.tee, 'レギュラー');
  assert.deepEqual(res.holes.map((h) => h.yards['レディース']), LADY);
  assert.equal(res.rating, 71.2);
  assert.equal(res.slope, 128);
});

test('スマホでコピーした横向きの表（1 セルずつ改行）', () => {
  const text = horizontalTsv().split('\n').flatMap((l) => l.split('\t')).join('\n');
  check(parse(text));
});

test('空白区切り・全角数字・ヤードに Y が付いた表', () => {
  const z = (n) => String(n).replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xFEE0));
  const text = [
    `ＨＯＬＥ　${Array.from({ length: 18 }, (_, i) => z(i + 1)).join('　')}`,
    `ＰＡＲ　${PARS.map(z).join('　')}　７２`,
    `Back Tee ${BACK.map((y) => `${y}Y`).join(' ')} 6,630Y`,
    `Regular Tee ${REG.map((y) => `${y}Y`).join(' ')}`,
    `Ladies Tee ${LADY.map((y) => `${y}Y`).join(' ')}`,
    `HDCP ${HDCP.join(' ')}`,
  ].join('\n');
  const res = parse(text);
  check(res, { tees: ['Back', 'Regular', 'Ladies'] });
  assert.equal(res.tee, 'Regular');
});

test('縦向きの表（1 行 = 1 ホール、見出し行あり）', () => {
  const text = [T(['ホール', 'パー', 'バック', 'レギュラー', 'レディース', 'HDCP']),
    ...PARS.map((p, i) => T([`${i + 1}`, p, BACK[i], REG[i], LADY[i], HDCP[i]]))].join('\n');
  check(parse(text));
});

test('縦向きの表（見出しなし → 値の範囲で判断）', () => {
  const text = PARS.map((p, i) => `${i + 1}番 ${p} ${BACK[i]} ${REG[i]} ${HDCP[i]}`).join('\n');
  const res = parse(text);
  check(res, { tees: ['ヤード1', 'ヤード2'] });
});

test('スマホでコピーした縦向きの表（見出しも値も 1 セルずつ改行）', () => {
  const text = ['ホール', 'パー', 'バック', 'HDCP', ...PARS.flatMap((p, i) => [i + 1, p, BACK[i], HDCP[i]])].join('\n');
  check(parse(text), { tees: ['バック'] });
});

test('ホールごとの説明文（カード形式・複数行）', () => {
  const text = PARS.map((p, i) => `${i + 1}番ホール\nPAR ${p}\nBACK ${BACK[i]}Y / REG ${REG[i]}Y\nHDCP ${HDCP[i]}\n左サイドの池に注意。グリーンは2段。`).join('\n\n');
  const res = parse(text);
  check(res, { tees: ['BACK', 'REG'] });
  assert.equal(res.tee, 'REG');
});

test('ホールごとの説明文（1 行ずつ・No. 表記）', () => {
  const text = PARS.map((p, i) => `No.${i + 1}  Par${p}  ${REG[i]}yds  HDCP${HDCP[i]}`).join('\n') + '\nTotal 6,180yds';
  const res = parse(text);
  assert.equal(res.holes.length, 18);
  assert.deepEqual(res.holes.map((h) => h.par), PARS);
  assert.deepEqual(res.holes.map((h) => h.yards['ヤード']), REG);
  assert.deepEqual(res.holes.map((h) => h.hdcp), HDCP);
});

test('27 ホール（東・西・南コース）は 9 ホールずつのまとまりになる', () => {
  const part = (name, pars, yards) => `${name}\n${T(['ホール', 1, 2, 3, 4, 5, 6, 7, 8, 9, '計'])}\n${T(['パー', ...pars, sum(pars)])}\n${T(['ヤード', ...yards, sum(yards)])}`;
  const text = [part('東コース', PARS.slice(0, 9), BACK.slice(0, 9)), part('西コース', PARS.slice(9), BACK.slice(9)), part('南コース', [4, 4, 4, 3, 5, 4, 3, 4, 5], REG.slice(0, 9))].join('\n\n');
  const res = parse(text);
  assert.equal(res.holes.length, 27);
  assert.deepEqual(res.blocks.map((b) => b.name), ['東コース', '西コース', '南コース']);
  assert.deepEqual(res.blocks[2].holes.map((h) => h.par), [4, 4, 4, 3, 5, 4, 3, 4, 5]);
  assert.deepEqual(res.blocks[1].holes.map((h) => h.yards['ヤード']), BACK.slice(9));
});

test('9 ホールだけの表', () => {
  const res = parse(`${T(['Hole', 1, 2, 3, 4, 5, 6, 7, 8, 9])}\n${T(['Par', ...PARS.slice(0, 9)])}\n${T(['Yards', ...REG.slice(0, 9)])}`);
  assert.equal(res.holes.length, 9);
  assert.equal(res.blocks.length, 1);
  assert.deepEqual(res.tees, ['ヤード']);
});

test('関係のない文章は読み取らない', () => {
  assert.equal(parse(''), null);
  assert.equal(parse('本日は晴天なり。スタート時間は 8:30 です。お問い合わせは 03-1234-5678 まで。'), null);
  assert.equal(parse('料金 平日 8,900円 土日 15,800円\n昼食付き\n2サム保証'), null);
});
