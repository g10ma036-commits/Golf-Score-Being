// 弾道測定器（スイングキャディなど）の練習データ（CSV）を読む。
// 例：No.,日付,イコライザー,飛距離(yd),総距離(yd),スイング スピード(m/s),ボール スピード(m/s),打ち出し角(deg),左右角(deg),ミート率,最高到達点(m),スピン(rpm)
// ・1 行目が見出し。「平均」の行や空の行は飛ばす。「-」は測れなかった値
// ・距離はアプリの単位（yd / m）に、スピードは m/s に、高さは m にそろえる
// ・ファイルの中身は信用せず、数値の範囲を確かめたものだけを返す

// 列の見つけ方（見出しの言葉）。上から順に調べ、先に見つかった列を使う
const COLS = [
  ['total', /総距離|トータル|total/i],
  ['carry', /飛距離|キャリー|carry/i],
  ['club_speed', /スイング\s*スピード|ヘッド\s*スピード|swing\s*speed|club\s*speed|head\s*speed/i],
  ['ball_speed', /ボール\s*スピード|ボール\s*初速|ball\s*speed/i],
  ['side', /左右角|左右|方向|side|direction/i], // 「Launch Direction」は打ち出し角より先に左右として見る
  ['launch', /打ち出し角|打出角|launch/i],
  ['smash', /ミート率|smash/i],
  ['apex', /最高到達点|最高点|apex|height/i],
  ['spin', /スピン|spin/i],
  ['equalizer', /イコライザー|equalizer/i],
  ['date', /日付|日時|date/i],
  ['club', /^(クラブ|番手|club)$/i],
];

// 数値の範囲（この範囲の外の値は「測れなかった」として扱う）
export const SHOT_RANGES = {
  club_speed: [5, 80], ball_speed: [5, 110], launch: [-20, 80], side: [-90, 90], smash: [0.5, 1.7], apex: [0, 120], spin: [0, 15000],
};

// 文字コード：UTF-8（BOM 付きも）で読めなければ Shift_JIS として読む
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(u8);
  }
}

// CSV を行・列に分ける（"..." の中のカンマ・改行・"" にも対応）
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}

const unitOf = (h) => (h.match(/[(（]([^)）]+)[)）]/)?.[1] || '').trim().toLowerCase();
const numOf = (v) => {
  const t = String(v ?? '').replace(/,/g, '').trim();
  if (!t || /^[-−–—]+$/.test(t)) return null;
  const n = Number(t.normalize('NFKC'));
  return Number.isFinite(n) ? n : null;
};
const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
// 日付：2026-11-28 / 2026/11/28 / 2026/11/28 10:23 など → 2026-11-28
export function normDate(v) {
  const m = String(v ?? '').normalize('NFKC').match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * @param text CSV の文字列
 * @param unit アプリの距離の単位（'yd' | 'm'）
 * @returns { shots: [{ date, carry, total, club_speed, ball_speed, launch, side, smash, apex, spin, equalizer, club }], skipped, columns, from, to }
 */
export function parseLaunchCsv(text, { unit = 'yd' } = {}) {
  const rows = parseCsv(text).filter((r) => r.some((c) => c !== ''));
  const hi = rows.findIndex((r) => r.some((c) => /飛距離|キャリー|carry/i.test(c)) && r.some((c) => /日付|日時|date/i.test(c)));
  if (hi < 0) throw new Error('弾道測定器の練習データ（日付と飛距離の列がある CSV）ではないようです');
  const head = rows[hi];
  const col = {};
  const units = {};
  head.forEach((h, i) => {
    const name = h.replace(/[(（][^)）]*[)）]/g, '').trim();
    const hit = COLS.find(([k, re]) => col[k] == null && re.test(k === 'club' ? name : h));
    if (hit) { col[hit[0]] = i; units[hit[0]] = unitOf(h); }
  });
  if (col.carry == null || col.date == null) throw new Error('日付と飛距離（キャリー）の列が見つかりません');
  // 単位の換算
  const toApp = (u) => {
    const fileUnit = u === 'm' || u === 'メートル' ? 'm' : 'yd';
    if (fileUnit === unit) return 1;
    return fileUnit === 'yd' ? 0.9144 : 1 / 0.9144;
  };
  const speedK = (u) => (/mph/.test(u) ? 0.44704 : /km/.test(u) ? 1 / 3.6 : 1);
  const heightK = (u) => (/ft|feet|フィート/.test(u) ? 0.3048 : /yd|ヤード/.test(u) ? 0.9144 : 1);
  const k = {
    carry: toApp(units.carry), total: col.total != null ? toApp(units.total) : 1,
    club_speed: speedK(units.club_speed || ''), ball_speed: speedK(units.ball_speed || ''), apex: heightK(units.apex || ''),
  };
  const shots = [];
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    const date = normDate(r[col.date]);
    if (!date) { skipped += /平均|average|合計|total/i.test(r.join('')) ? 0 : 1; continue; } // 「平均」の行は数えない
    const get = (key, d) => {
      const v = col[key] == null ? null : numOf(r[col[key]]);
      return v == null ? null : round(v * (k[key] ?? 1), d);
    };
    let carry = get('carry', 1);
    let total = get('total', 1);
    if (carry != null && (carry <= 0 || carry > 450)) carry = null;
    if (total != null && (total <= 0 || total > 500)) total = null;
    if (carry == null && total == null) { skipped++; continue; }
    const shot = { date, carry, total };
    for (const [key, d] of [['club_speed', 1], ['ball_speed', 1], ['launch', 1], ['side', 1], ['smash', 2], ['apex', 1], ['spin', 0]]) {
      const v = get(key, d);
      const [lo, hiV] = SHOT_RANGES[key];
      shot[key] = v != null && v >= lo && v <= hiV ? v : null;
    }
    const eq = col.equalizer == null ? '' : String(r[col.equalizer]).trim().toUpperCase();
    shot.equalizer = eq === 'ON' || eq === 'オン' ? 1 : eq === 'OFF' || eq === 'オフ' ? 0 : null;
    shot.club = col.club != null ? String(r[col.club]).slice(0, 30) || null : null;
    shots.push(shot);
  }
  if (!shots.length) throw new Error('取り込める球がありませんでした');
  // ファイルは新しい順のことが多いので、古い順（同じ日は打った順）にそろえる
  const first = shots[0].date;
  const last = shots[shots.length - 1].date;
  if (first > last || (first === last && noDescending(rows, hi))) shots.reverse();
  const dates = shots.map((s) => s.date).sort();
  return { shots, skipped, columns: Object.keys(col), from: dates[0], to: dates[dates.length - 1] };
}
// 「No.」の列が減っていく（新しい順に並んでいる）なら true
function noDescending(rows, hi) {
  const noCol = rows[hi].findIndex((h) => /^no\.?$|^番号$/i.test(h));
  if (noCol < 0) return false;
  const nos = rows.slice(hi + 1).map((r) => Number(r[noCol])).filter(Number.isFinite);
  return nos.length > 1 && nos[0] > nos[nos.length - 1];
}

// ファイル名やクラブの列から、登録したクラブを推測する（例：「1W」「Driver」「7番アイアン」）
export function guessClub(name, clubs) {
  const s = String(name || '').normalize('NFKC').toUpperCase();
  if (!s) return null;
  const norm = (x) => String(x || '').normalize('NFKC').toUpperCase().replace(/\s+/g, '');
  const compact = s.replace(/\s+/g, '');
  if (/DRIVER|ドライバー|DR\b/.test(s)) return clubs.find((c) => c.category === 'driver') || clubs.find((c) => norm(c.name) === '1W') || null;
  const iron = compact.match(/(\d{1,2})(?:番)?(?:アイアン|IRON)/);
  if (iron) return clubs.find((c) => norm(c.name) === `${iron[1]}I`) || null;
  const wood = compact.match(/(\d{1,2})(?:番)?(?:ウッド|WOOD)/);
  if (wood) return clubs.find((c) => norm(c.name) === `${wood[1]}W`) || null;
  // 登録した名前（例：7I・PW・52°）がそのまま入っている。長い名前から順に
  const byLen = [...clubs].sort((a, b) => norm(b.name).length - norm(a.name).length);
  return byLen.find((c) => {
    const n = norm(c.name);
    if (!n) return false;
    const i = compact.indexOf(n);
    if (i < 0) return false;
    const before = compact[i - 1] || '';
    const after = compact[i + n.length] || '';
    return !/[0-9A-Z]/.test(before) && !/[0-9A-Z]/.test(after);
  }) || null;
}
