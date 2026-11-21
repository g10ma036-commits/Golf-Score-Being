// コースガイドの表（Web ページからコピーした文字）から、ホールごとのパー・ヤード・HDCP を読み取る。
// 対応する形：
//   1. 横向きの表（行 = ホール/パー/各ティーのヤード/HDCP、列 = ホール）。OUT・IN が別の表でもよい。合計列は無視
//   2. 1 セルずつ改行された横向きの表（スマホでコピーしたときに多い）
//   3. 縦向きの表（1 行 = 1 ホール。見出し行で列の意味を判断）
//   4. ホールごとの説明文（「1番ホール PAR4 380Y HDCP7」など）
// 27 ホールのゴルフ場（東・西・南コースなど）は 9 ホールずつのまとまりとして返す。

const toHalf = (s) => s
  .replace(/[０-９Ａ-Ｚａ-ｚ．：／（）＃，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[　 ]/g, ' ')
  .replace(/[ｙＹ]/g, 'Y');

const NUM_RE = /^(\d{1,2},\d{3}|\d{1,4})(?:\.\d+)?\s*(?:y|yd|yds|yards?|ヤード)?$/i;
function numOf(cell) {
  const m = NUM_RE.exec(cell.trim());
  return m ? Number(m[1].replace(',', '')) : null;
}

const HOLE_LABEL = /^(ホール|hole|holes|no\.?|番号|#|h)$/i;
const MARKER = /^(out|in|total|tot|計|合計|小計|前半|後半|アウト|イン)$/i;
function kindOf(label) {
  const l = label.replace(/\s+/g, '').toLowerCase();
  if (!l) return null;
  if (/hdcp|hcp|^h\/?c$|ハンデ|ハンディ/.test(l)) return 'hdcp';
  if (/パー|^par/.test(l)) return 'par';
  if (HOLE_LABEL.test(l) || /^ホール(番号|no\.?)?$/.test(l)) return 'hole';
  if (MARKER.test(l)) return 'marker';
  return 'other';
}
function teeName(label) {
  const t = label
    .replace(/[(（]\s*(y|yd|yds|ヤード)\s*[)）]/gi, '')
    .replace(/ティー|ティ|tee|ヤーデージ|ヤード|yards?|yds?|距離/gi, '')
    .trim();
  return t || 'ヤード';
}
const isSectionLabel = (l) => /コース|course/i.test(l) && !/ガイド|guide|レイアウト|layout|案内|情報/i.test(l);
// 「西コース (単位:ヤード)」→「西コース」
const sectionName = (l) => l.replace(/[(（][^)）]*[)）]/g, '').replace(/単位\s*[:：]\s*\S*/g, '').trim() || l;

// 行に分ける。タブ区切り（PC でコピーした表）は空のセルも位置として残す
function toRows(text) {
  const rows = [];
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.includes('\t') ? raw.split('\t').map((c) => c.trim()) : raw.trim().split(/\s+/);
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    let i = 0;
    const words = [];
    while (i < cells.length && cells[i] !== '' && numOf(cells[i]) === null) words.push(cells[i++]);
    const values = cells.slice(i).map((c) => (c === '' ? null : numOf(c)));
    const hasNums = values.some((v) => v !== null);
    if (words.length && !hasNums) {
      pending = { label: words.join(' '), words, values: [] };
      rows.push(pending);
    } else if (!words.length && cells.length === 1 && pending) {
      pending.values.push(values[0]); // 1 セルずつ改行された表
    } else {
      pending = null;
      rows.push({ label: words.join(' '), words, values });
    }
  }
  return rows;
}

const inRange = (v, lo, hi) => v !== null && Number.isInteger(v) && v >= lo && v <= hi;

// ---------- 1・2. 横向きの表 ----------
function parseHorizontal(rows) {
  const seqs = new Map(); // `${kind}:${key}` → { kind, key, values: [], sections: [] }
  let section = null;
  let parRows = 0;
  const push = (kind, key, vals) => {
    const id = `${kind}:${key}`;
    if (!seqs.has(id)) seqs.set(id, { kind, key, values: [], sections: [] });
    const s = seqs.get(id);
    for (const v of vals) { s.values.push(v); s.sections.push(section); }
  };
  for (const r of rows) {
    const kind = kindOf(r.label);
    const nums = r.values.filter((v) => v !== null);
    if (!nums.length) {
      if (r.label && isSectionLabel(r.label)) section = sectionName(r.label);
      continue;
    }
    if (kind === 'hole' || kind === 'marker') continue;
    if (kind === 'par') {
      const vals = nums.filter((v) => inRange(v, 3, 6));
      if (vals.length >= 3) { push('par', r.label, vals); parRows++; }
    } else if (kind === 'hdcp') {
      push('hdcp', r.label, nums.filter((v) => inRange(v, 1, 27)));
    } else if (kind === 'other') {
      const vals = nums.filter((v) => inRange(v, 50, 800));
      if (vals.length >= 3) push('yards', teeName(r.label), vals);
    } else if (!r.label && nums.length >= 9) {
      // 見出しのない行は値の範囲で判断
      if (nums.every((v) => inRange(v, 3, 6))) { push('par', '', nums); parRows++; } else if (nums.filter((v) => inRange(v, 50, 800)).length >= 9) push('yards', 'ヤード', nums.filter((v) => inRange(v, 50, 800)));
    }
  }
  if (!parRows) return null;
  const first = (kind) => [...seqs.values()].find((s) => s.kind === kind);
  const par = first('par');
  const hdcp = first('hdcp');
  const tees = [...seqs.values()].filter((s) => s.kind === 'yards');
  if (par.values.length < 3) return null;
  return par.values.map((p, i) => ({
    par: p,
    hdcp: hdcp?.values[i] ?? null,
    yards: Object.fromEntries(tees.filter((t) => t.values[i] != null).map((t) => [t.key, t.values[i]])),
    section: par.sections[i],
  }));
}

// ---------- 3. 縦向きの表 ----------
function holeNoOf(r) {
  const m = /^(?:no\.?\s*|#|hole\s*)?(\d{1,2})\s*(?:番|h|ホール|番ホール)?$/i.exec(r.label.replace(/\s+/g, ''));
  if (r.label && m) return { no: Number(m[1]), vals: r.values };
  if (!r.label && inRange(r.values[0], 1, 27) && r.values.filter((v) => v !== null).length >= 2) return { no: r.values[0], vals: r.values.slice(1) };
  return null;
}
function columnsFromHeader(words) {
  const ws = [...words];
  if (ws.length && kindOf(ws[0]) === 'hole') ws.shift();
  return ws.map((w) => {
    const k = kindOf(w);
    return k === 'other' ? { kind: 'yards', key: teeName(w) } : { kind: k, key: w };
  });
}
function inferColumns(table) {
  const width = Math.max(...table.map((r) => r.length));
  const cols = [];
  let teeNo = 0;
  for (let c = 0; c < width; c++) {
    const vs = table.map((r) => r[c]).filter((v) => v !== null && v !== undefined);
    if (!vs.length) { cols.push({ kind: 'skip' }); continue; }
    if (vs.every((v) => inRange(v, 3, 6)) && !cols.some((x) => x.kind === 'par')) cols.push({ kind: 'par', key: 'パー' });
    else if (vs.every((v) => inRange(v, 50, 800))) cols.push({ kind: 'yards', key: `ヤード${++teeNo}` });
    else if (vs.every((v) => inRange(v, 1, 27)) && new Set(vs).size >= vs.length * 0.8) cols.push({ kind: 'hdcp', key: 'HDCP' });
    else cols.push({ kind: 'skip' });
  }
  return cols;
}
function holesFromTable(table, cols, sections) {
  const parCol = cols.findIndex((c) => c.kind === 'par');
  if (parCol < 0) return null;
  const hdcpCol = cols.findIndex((c) => c.kind === 'hdcp');
  const holes = [];
  table.forEach((vals, i) => {
    const par = vals[parCol];
    if (!inRange(par, 3, 6)) return;
    const yards = {};
    cols.forEach((c, j) => { if (c.kind === 'yards' && inRange(vals[j], 50, 800)) yards[c.key] = vals[j]; });
    holes.push({ par, hdcp: hdcpCol >= 0 && inRange(vals[hdcpCol], 1, 27) ? vals[hdcpCol] : null, yards, section: sections[i] ?? null });
  });
  return holes.length >= 3 ? holes : null;
}
function parseVertical(rows) {
  // a) 1 行 = 1 ホール
  const holeRows = [];
  let header = null;
  let section = null;
  const sections = [];
  for (const r of rows) {
    const h = holeNoOf(r);
    if (h) { holeRows.push(h); sections.push(section); continue; }
    if (!r.values.some((v) => v !== null)) {
      if (r.words.length >= 3 && !holeRows.length) header = r.words;
      else if (isSectionLabel(r.label)) section = sectionName(r.label);
    }
  }
  if (holeRows.length >= 3) {
    const table = holeRows.map((h) => h.vals);
    let cols = header ? columnsFromHeader(header) : null;
    if (!cols || !cols.some((c) => c.kind === 'par')) cols = inferColumns(table);
    const holes = holesFromTable(table, cols, sections);
    if (holes) return holes;
  }
  // b) スマホでコピーした縦向きの表：見出しが 1 語ずつ並び、最後の見出しのあとに全部の数字が続く
  for (let i = 0; i < rows.length; i++) {
    let j = i;
    while (j < rows.length && !rows[j].values.length) j++;
    const k = j - i + 1;
    if (k >= 3 && j < rows.length && rows[j].words.length) {
      const heads = [...rows.slice(i, j).map((r) => r.label), rows[j].label];
      const vals = rows[j].values;
      if (vals.length >= k * 3 && kindOf(heads[0]) === 'hole') {
        const table = [];
        for (let p = 0; p + k <= vals.length; p += k) table.push(vals.slice(p + 1, p + k));
        const holes = holesFromTable(table, columnsFromHeader(heads), []);
        if (holes) return holes;
      }
    }
    i = j;
  }
  return null;
}

// ---------- 4. ホールごとの説明文 ----------
const TEE_WORD = 'back|reg(?:ular)?|front|ladies|lady|champ(?:ion)?|gold|blue|white|red|silver|senior|バック|レギュラー|フロント|レディース|レディス|チャンピオン|シニア|ゴールド|ブルー|ホワイト|レッド|シルバー|金|青|白|赤|黒';
function parseCards(text) {
  const markerRe = /(?:\bno\.?\s*|\bhole\s*|ホール\s*|#)(\d{1,2})(?!\d)|(\d{1,2})\s*(?:番ホール|番|ホール)(?![\d])/gi;
  const marks = [];
  for (const m of text.matchAll(markerRe)) marks.push({ no: Number(m[1] ?? m[2]), at: m.index, end: m.index + m[0].length });
  // 1,2,3… と続く番号だけを使う（9 番の後に 1 に戻るのは次のコース）
  const used = [];
  let expect = 1;
  for (const mk of marks) {
    if (mk.no === expect) { used.push(mk); expect++; } else if (mk.no === 1 && expect > 9) { used.push(mk); expect = 2; }
  }
  if (used.length < 3) return null;
  const holes = [];
  const yardRe = new RegExp(`(?:(${TEE_WORD})\\s*[:：]?\\s*)?(\\d{2,3})\\s*(?:y|yd|yds|yards|ヤード)(?![a-z])|(${TEE_WORD})\\s*[:：]?\\s*(\\d{2,3})(?!\\d)`, 'gi');
  used.forEach((mk, i) => {
    const seg = text.slice(mk.end, i + 1 < used.length ? used[i + 1].at : undefined);
    const par = /(?:par|パー)\s*[:：]?\s*([3-6])(?!\d)/i.exec(seg);
    if (!par) return;
    const hd = /(?:hdcp|hcp|h\/c|ハンディキャップ|ハンデキャップ|ハンディ|ハンデ|\bhc)\s*[:：.]?\s*(\d{1,2})(?!\d)/i.exec(seg);
    const yards = {};
    let n = 0;
    // 合計（6,500Y など 4 桁）の一部を 1 ホールのヤードと読まないよう除く
    for (const y of seg.replace(/\d{1,2},\d{3}|\d{4,}/g, ' ').matchAll(yardRe)) {
      const v = Number(y[2] ?? y[4]);
      if (!inRange(v, 50, 800)) continue;
      const name = y[1] ?? y[3];
      const key = name ? teeName(name) : (n ? `ヤード${n + 1}` : 'ヤード');
      if (!(key in yards)) { yards[key] = v; n++; }
    }
    holes.push({ par: Number(par[1]), hdcp: hd && inRange(Number(hd[1]), 1, 27) ? Number(hd[1]) : null, yards, section: null });
  });
  return holes.length >= 3 ? holes : null;
}

// ---------- まとめ ----------
function ratingSlope(text) {
  const r = /(?:コース\s*レー(?:ト|ティング)|course\s*rating|\bCR)\s*[:：]?\s*(\d{2}\.\d)/i.exec(text);
  const s = /(?:スロープ(?:\s*レー(?:ト|ティング))?|slope(?:\s*rating)?|\bSR)\s*[:：]?\s*(\d{2,3})(?!\d)/i.exec(text);
  const rating = r && Number(r[1]) >= 55 && Number(r[1]) <= 85 ? Number(r[1]) : null;
  const slope = s && Number(s[1]) >= 55 && Number(s[1]) <= 155 ? Number(s[1]) : null;
  return { rating, slope };
}
function pickTee(tees) {
  const reg = tees.find((t) => /レギュラー|reg|白|ホワイト|white/i.test(t));
  if (reg) return reg;
  return tees.length >= 3 ? tees[1] : tees[0] ?? null;
}

/**
 * @returns null（読み取れない）または
 *   { holes: [{ par, hdcp, yards: { ティー名: ヤード }, section }], tees: [ティー名], tee: 初期選択のティー,
 *     blocks: [{ name, start, holes }]（9 ホールごと）, rating, slope }
 */
export function parseCourseText(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const text = toHalf(input);
  const rows = toRows(text);
  const holes = parseHorizontal(rows) || parseCards(text) || parseVertical(rows);
  if (!holes) return null;
  const tees = [];
  for (const h of holes) for (const t of Object.keys(h.yards)) if (!tees.includes(t)) tees.push(t);
  const blocks = [];
  for (let i = 0; i < holes.length; i += 9) {
    const part = holes.slice(i, i + 9);
    blocks.push({ name: part[0].section || null, start: i + 1, holes: part });
  }
  return { holes, tees, tee: pickTee(tees), blocks, ...ratingSlope(text) };
}
