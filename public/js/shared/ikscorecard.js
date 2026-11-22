// IKScoreCard（スコア管理アプリ）のバックアップを、このアプリのコース・ラウンドの形に変換する。
// バックアップは SQLite のファイルの集まり（ZIP）：
//   IKScoreCard_sc.sqlite3 … DB_sc（ラウンド：4 人 × 18 ホールのスコア、1 人目のパット・OB など）、DB_nm（同伴者の名前）、
//                             DB_s3（前半・後半に回った 9 ホール、ペナルティ）、DB_cp（メモ）
//   IKScoreCard_g2(_update).sqlite3 … DB_gc（ゴルフ場：9 ホールのまとまりの名前とパー）
//   IKScoreCard_g3(_update).sqlite3 … DB_g3（9 ホールごとの距離。ティーは最大 7 つ。1 つ目がバック、2 つ目がレギュラーのことが多い）
//   IKScoreCard_gc.sqlite3 … DB_gc（自分で登録したゴルフ場：18 ホールのパー、バック・レギュラーの距離）
// 1 人目（p1）が自分（パットと合計スコアが記録されている）。天気は番号の意味が分からないので取り込まない。
import { openSqlite, isSqlite } from './sqlite.js';
import { MAX_NINES, MAX_PARTY } from './model.js';

const p2 = (n) => String(n).padStart(2, '0');
const seq = (n) => Array.from({ length: n }, (_, i) => i + 1);
const clean = (s) => (typeof s === 'string' ? s.replace(/[\s　]+/g, ' ').trim() : '');
const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

const baseName = (n) => String(n).split(/[\\/]/).pop();
export const isIkScoreCardFiles = (files) => files.some((f) => /^IKScoreCard_sc\.sqlite3$/i.test(baseName(f.name)));

// files: [{ name, bytes: Uint8Array }]
export function parseIkScoreCard(files) {
  const open = (re) => {
    const f = files.find((x) => re.test(baseName(x.name)));
    return f && isSqlite(f.bytes) ? openSqlite(f.bytes) : null;
  };
  const sc = open(/^IKScoreCard_sc\.sqlite3$/i);
  if (!sc || !sc.has('DB_sc')) throw new Error('IKScoreCard のスコアのデータ（IKScoreCard_sc.sqlite3）が見つかりません');

  // ---- ゴルフ場 ----
  const courseRows = new Map(); // 番号 → { name, location, nines: [{ name, pars }] }
  for (const db of [open(/^IKScoreCard_g2\.sqlite3$/i), open(/^IKScoreCard_g2_update\.sqlite3$/i)]) {
    if (!db) continue;
    for (const r of db.rows('DB_gc')) {
      if (courseRows.has(r.gc_seria) || !clean(r.gc_gname)) continue;
      const nines = seq(7).map((k) => ({ name: clean(r[`gc_c${p2(k)}nm`]), pars: seq(9).map((j) => int(r[`gc_p${p2(k)}_${j}`])) }))
        .filter((n) => n.name || n.pars.some((x) => x > 0));
      courseRows.set(r.gc_seria, { name: clean(r.gc_gname), location: clean(r.gc_gddrs), nines, own: false });
    }
  }
  // 自分で登録したゴルフ場（18 ホール。距離はレギュラー → バックの順に使う）
  const own = open(/^IKScoreCard_gc\.sqlite3$/i);
  const ownYards = new Map();
  if (own) {
    for (const r of own.rows('DB_gc')) {
      if (courseRows.has(r.gc_seria) || !clean(r.gc_gname)) continue;
      courseRows.set(r.gc_seria, {
        name: clean(r.gc_gname), location: clean(r.gc_gddrs), own: true,
        nines: [0, 1].map((n) => ({ name: n ? 'IN' : 'OUT', pars: seq(9).map((j) => int(r[`gc_pa_${p2(n * 9 + j)}`])) })),
      });
      ownYards.set(r.gc_seria, seq(18).map((i) => int(r[`gc_rg_${p2(i)}`]) || int(r[`gc_bk_${p2(i)}`]) || null));
    }
  }
  // 9 ホールごとの距離。g3_sepcn = ゴルフ場の番号 × 10 + 何番目の 9 ホールか
  // （g3_g2ser には仮の番号が入っている行があるので使わない）。ゴルフ場の番号 → 距離の行の一覧
  const yardRows = new Map();
  for (const db of [open(/^IKScoreCard_g3\.sqlite3$/i), open(/^IKScoreCard_g3_update\.sqlite3$/i)]) {
    if (!db) continue;
    for (const r of db.rows('DB_g3')) {
      const place = Math.floor(int(r.g3_sepcn) / 10);
      if (!yardRows.has(place)) yardRows.set(place, { db, list: [] });
      const g = yardRows.get(place);
      if (g.db === db) g.list.push(r); // 先に見つかったファイル（g3）を優先
    }
  }
  // ゴルフ場 place の k 番目の 9 ホールの距離の行：番号で探し、無ければ 9 ホールの名前で探す
  const yardRowOf = (place, k, nineName) => {
    const list = yardRows.get(place)?.list || [];
    return list.find((r) => int(r.g3_sepcn) % 10 === k) || (nineName && list.find((r) => clean(r.g3_cname) === nineName)) || null;
  };

  // ---- ラウンド ----
  const names = new Map(sc.rows('DB_nm').map((r) => [r.nm_seria, clean(r.nm_pname)]));
  const s3 = new Map(sc.rows('DB_s3').map((r) => [r.s3_scseri, r]));
  const memos = new Map();
  for (const r of sc.rows('DB_cp')) {
    const t = seq(10).map((i) => clean(r[`cp_text${p2(i)}`])).filter(Boolean).join('\n');
    if (t) memos.set(r.cp_scseri, t);
  }
  const rounds = [];
  const usedPlaces = new Map(); // 番号 → 回数
  let skipped = 0;
  for (const r of sc.rows('DB_sc')) {
    const m = String(r.sc_pdate || '').match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    const mine = seq(18).map((i) => int(r[`sc_p1_${p2(i)}`]));
    if (!m || !mine.some((v) => v > 0)) { skipped++; continue; }
    const date = `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
    const putts = seq(18).map((i) => int(r[`sc_p1p${p2(i)}`]));
    const hasPutts = putts.some((v) => v > 0);
    const x = s3.get(r.sc_seria);
    const pen = (i) => ['ob', 'wh', 'lb', 'ot'].reduce((a, k) => a + Math.max(0, int(r[`sc_${k}_${p2(i)}`])), 0) + Math.max(0, int(x?.[`s3_pena${p2(i)}`]));
    const party = [];
    for (const n of [2, 3, 4]) {
      const strokes = seq(18).map((i) => int(r[`sc_p${n}_${p2(i)}`]));
      if (!strokes.some((v) => v > 0) || party.length >= MAX_PARTY) continue;
      party.push({ name: (names.get(r[`sc_p${n}_no`]) || `同伴者${party.length + 1}`).slice(0, 30), strokes: strokes.map((v) => (v > 0 && v <= 20 ? v : null)) });
    }
    usedPlaces.set(r.sc_place, (usedPlaces.get(r.sc_place) || 0) + 1);
    rounds.push({
      key: r.sc_seria, date, place: r.sc_place,
      front: int(x?.s3_htype1) || 1, back: int(x?.s3_htype2) || 2,
      // このアプリで保存できる範囲に収める（スコア 1〜20、パットはスコア未満、ペナルティ 10 まで）
      holes: seq(18).map((i) => {
        const s = mine[i - 1] > 0 ? Math.min(20, mine[i - 1]) : null;
        const pt = hasPutts && s != null && putts[i - 1] >= 0 && putts[i - 1] < s && putts[i - 1] <= 10 ? putts[i - 1] : null;
        return { hole_no: i, strokes: s, putts: pt, penalties: s != null ? Math.min(10, pen(i)) : null };
      }),
      party, memo: memos.get(r.sc_seria) || '',
    });
  }
  rounds.sort((a, b) => a.date.localeCompare(b.date) || a.key - b.key);

  // ---- 選べるティー（よく回ったゴルフ場の 9 ホール 2 つ分の合計距離を例に） ----
  const topPlace = [...usedPlaces].sort((a, b) => b[1] - a[1])[0]?.[0];
  const tees = seq(7).map((t) => {
    let total = 0;
    let label = '';
    for (const [place] of usedPlaces) {
      const c = courseRows.get(place);
      if (!c) continue;
      c.nines.slice(0, 2).forEach((nine, i) => {
        const yr = yardRowOf(place, i + 1, nine.name);
        if (!yr) return;
        if (place === topPlace) total += seq(9).reduce((a, j) => a + int(yr[`g3_t${p2(t)}_${p2(j)}`]), 0);
        if (!label && clean(yr[`g3_tnam${t}`])) label = clean(yr[`g3_tnam${t}`]);
      });
    }
    const covered = [...usedPlaces.keys()].filter((place) => int(yardRowOf(place, 1, courseRows.get(place)?.nines[0]?.name)?.[`g3_t${p2(t)}_01`]) > 0).length;
    return { tee: t, label, total, covered };
  }).filter((t) => t.covered > 0);

  // コース（このアプリの形）。tee: 距離に使うティー（1〜7）
  const courseFor = (place, tee) => {
    const c = courseRows.get(place);
    if (!c) return null;
    const nines = c.nines.slice(0, MAX_NINES);
    const holes = [];
    nines.forEach((nine, k) => {
      const yr = c.own ? null : yardRowOf(place, k + 1, nine.name);
      seq(9).forEach((j) => {
        const no = k * 9 + j;
        const par = nine.pars[j - 1];
        const y = c.own ? ownYards.get(place)?.[no - 1] : int(yr?.[`g3_t${p2(tee)}_${p2(j)}`]) || int(yr?.[`g3_t${p2(tee === 1 ? 2 : 1)}_${p2(j)}`]);
        holes.push({ hole_no: no, par: par >= 3 && par <= 6 ? par : null, yards: y > 0 && y <= 900 ? y : null });
      });
    });
    return { name: c.name.slice(0, 200), location: c.location.slice(0, 200) || null, nines: nines.map((n, i) => (n.name || (nines.length === 2 ? ['OUT', 'IN'][i] : `${i + 1}つ目`)).slice(0, 30)), holes };
  };

  return {
    rounds, skipped, tees,
    places: [...usedPlaces].map(([place, n]) => ({ place, n, name: courseRows.get(place)?.name || null })),
    courseFor,
    from: rounds[0]?.date || null, to: rounds[rounds.length - 1]?.date || null,
  };
}
