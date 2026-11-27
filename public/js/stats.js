// スコア統計の計算（すべてクライアント側で実施）

export const RESULT_KEYS = ['eagle', 'birdie', 'par', 'bogey', 'double', 'triple'];
export const RESULT_LABELS = {
  eagle: 'イーグル以上', birdie: 'バーディ', par: 'パー', bogey: 'ボギー', double: 'ダブルボギー', triple: 'トリプル以上',
};
export const resultColor = (k) => `var(--score-${k})`;
export const resultInk = (k) => `var(--ink-${k})`;

export function resultKey(strokes, par) {
  const d = strokes - par;
  if (d <= -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  if (d === 2) return 'double';
  return 'triple';
}

export const played = (h) => Number.isFinite(h.strokes) && h.strokes > 0;
export const isGir = (h) => Number.isFinite(h.putts) && h.strokes - h.putts <= h.par - 2;

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const ratio = (a, b) => (b ? a / b : null);

// 1ラウンドの集計
export function summarize(round) {
  const holes = (round.holes || []).filter(played);
  const half = () => ({ strokes: 0, par: 0, holes: 0 });
  const s = {
    id: round.id, date: round.date, course: round.course_name, courseId: round.course_id,
    rating: round.rating, slope: round.slope,
    holes: holes.length, complete: holes.length === 18,
    strokes: 0, par: 0, adjStrokes: 0,
    putts: 0, puttHoles: 0, threePutts: 0, onePutts: 0,
    fwHit: 0, fwLeft: 0, fwRight: 0, fwTotal: 0,
    gir: 0, girKnown: 0, scrChances: 0, scrSaves: 0, bogeyOn: 0, girPutts: 0,
    sandChances: 0, sandSaves: 0, penalties: 0,
    front: half(), back: half(),
    byPar: { 3: { n: 0, strokes: 0, par: 0 }, 4: { n: 0, strokes: 0, par: 0 }, 5: { n: 0, strokes: 0, par: 0 } },
    results: Object.fromEntries(RESULT_KEYS.map((k) => [k, 0])),
    worstHole: null, bestRun: 0,
  };
  let run = 0;
  for (const h of [...holes].sort((a, b) => a.hole_no - b.hole_no)) {
    s.strokes += h.strokes;
    s.par += h.par;
    s.adjStrokes += Math.min(h.strokes, h.par + 3); // 簡易ハンディキャップ用（1ホールの上限をトリプルボギーに）
    const hf = h.hole_no <= 9 ? s.front : s.back;
    hf.strokes += h.strokes; hf.par += h.par; hf.holes++;
    const bp = s.byPar[h.par >= 5 ? 5 : h.par <= 3 ? 3 : 4];
    bp.n++; bp.strokes += h.strokes; bp.par += h.par;
    s.results[resultKey(h.strokes, h.par)]++;
    if (Number.isFinite(h.putts)) {
      s.putts += h.putts; s.puttHoles++;
      if (h.putts >= 3) s.threePutts++;
      if (h.putts === 1) s.onePutts++;
      s.girKnown++;
      if (h.strokes - h.putts <= h.par - 1) s.bogeyOn++; // ボギーオン（パーオンも含む）
      if (isGir(h)) { s.gir++; s.girPutts += h.putts; } else { s.scrChances++; if (h.strokes <= h.par) s.scrSaves++; }
    }
    if (h.par >= 4 && h.fairway) {
      s.fwTotal++;
      if (h.fairway === 'hit') s.fwHit++;
      else if (h.fairway === 'left') s.fwLeft++;
      else if (h.fairway === 'right') s.fwRight++;
    }
    s.penalties += h.penalties || 0;
    if (h.bunker > 0) { s.sandChances++; if (h.strokes <= h.par) s.sandSaves++; }
    const over = h.strokes - h.par;
    if (!s.worstHole || over > s.worstHole.over) s.worstHole = { hole_no: h.hole_no, over, strokes: h.strokes, par: h.par };
    run = over <= 0 ? run + 1 : 0;
    s.bestRun = Math.max(s.bestRun, run);
  }
  s.toPar = s.strokes - s.par;
  return s;
}

// 複数ラウンドの集計
export function aggregate(sums) {
  const complete = sums.filter((s) => s.complete);
  const tot = (k) => sums.reduce((a, s) => a + s[k], 0);
  const holes = tot('holes');
  const puttHoles = tot('puttHoles');
  const fwTotal = tot('fwTotal');
  const byPar = {};
  for (const p of [3, 4, 5]) {
    const n = sums.reduce((a, s) => a + s.byPar[p].n, 0);
    const st = sums.reduce((a, s) => a + s.byPar[p].strokes, 0);
    const pr = sums.reduce((a, s) => a + s.byPar[p].par, 0);
    byPar[p] = { n, avg: ratio(st, n), toPar: n ? (st - pr) / n : null };
  }
  const results = Object.fromEntries(RESULT_KEYS.map((k) => [k, sums.reduce((a, s) => a + s.results[k], 0)]));
  const fullFront = sums.filter((s) => s.front.holes === 9);
  const fullBack = sums.filter((s) => s.back.holes === 9);
  const sortedComplete = [...complete].sort((a, b) => a.strokes - b.strokes || a.date.localeCompare(b.date));
  return {
    rounds: sums.length,
    completeRounds: complete.length,
    holes,
    avgScore: mean(complete.map((s) => s.strokes)),
    avgToPar: mean(complete.map((s) => s.toPar)),
    best: sortedComplete[0] || null,
    worst: sortedComplete[sortedComplete.length - 1] || null,
    puttsPerRound: puttHoles ? (tot('putts') / puttHoles) * 18 : null,
    puttsPerHole: ratio(tot('putts'), puttHoles),
    threePuttRate: ratio(tot('threePutts'), puttHoles),
    onePuttRate: ratio(tot('onePutts'), puttHoles),
    threePuttsPerRound: puttHoles ? (tot('threePutts') / puttHoles) * 18 : null,
    fwRate: ratio(tot('fwHit'), fwTotal),
    fwLeftRate: ratio(tot('fwLeft'), fwTotal),
    fwRightRate: ratio(tot('fwRight'), fwTotal),
    fwHit: tot('fwHit'), fwLeft: tot('fwLeft'), fwRight: tot('fwRight'), fwTotal,
    girRate: ratio(tot('gir'), tot('girKnown')),
    bogeyOnRate: ratio(tot('bogeyOn'), tot('girKnown')),
    puttsPerGir: ratio(tot('girPutts'), tot('gir')),
    scrambleRate: ratio(tot('scrSaves'), tot('scrChances')),
    sandSaveRate: ratio(tot('sandSaves'), tot('sandChances')),
    sandChances: tot('sandChances'),
    penaltiesPerRound: holes ? (tot('penalties') / holes) * 18 : null,
    byPar,
    results,
    parOrBetterRate: holes ? (results.eagle + results.birdie + results.par) / holes : null,
    doublePlusRate: holes ? (results.double + results.triple) / holes : null,
    birdiesPerRound: holes ? ((results.eagle + results.birdie) / holes) * 18 : null,
    frontAvg: mean(fullFront.map((s) => s.front.strokes)),
    backAvg: mean(fullBack.map((s) => s.back.strokes)),
    frontToPar: mean(fullFront.map((s) => s.front.strokes - s.front.par)),
    backToPar: mean(fullBack.map((s) => s.back.strokes - s.back.par)),
    handicap: handicapEstimate(sums),
  };
}

// 推定ハンディキャップ（WHS の考え方を簡略化：直近20ラウンドのうち良い8つのディファレンシャル平均）
const HC_TABLE = { 3: [1, -2], 4: [1, -1], 5: [1, 0], 6: [2, -1], 7: [2, 0], 8: [2, 0], 9: [3, 0], 10: [3, 0], 11: [3, 0], 12: [4, 0], 13: [4, 0], 14: [4, 0], 15: [5, 0], 16: [5, 0], 17: [6, 0], 18: [6, 0], 19: [7, 0], 20: [8, 0] };
export function handicapEstimate(sums) {
  const recent = sums.filter((s) => s.complete).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  if (recent.length < 3) return null;
  const diffs = recent.map((s) => {
    const rating = Number.isFinite(s.rating) ? s.rating : s.par;
    const slope = Number.isFinite(s.slope) ? s.slope : 113;
    return (113 / slope) * (s.adjStrokes - rating);
  }).sort((a, b) => a - b);
  const [use, adj] = HC_TABLE[recent.length];
  const v = mean(diffs.slice(0, use)) + adj;
  return Math.min(54, Math.round(v * 10) / 10);
}

// 期間・コースでの絞り込み
export const PERIODS = [
  ['all', '全期間'], ['year', '今年'], ['12m', '直近12か月'], ['last10', '直近10ラウンド'], ['last20', '直近20ラウンド'],
];
export function filterRounds(rounds, { period = 'all', courseId = '' } = {}) {
  let list = [...rounds].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  if (courseId) list = list.filter((r) => String(r.course_id) === String(courseId));
  const now = new Date();
  if (period === 'year') list = list.filter((r) => r.date.startsWith(String(now.getFullYear())));
  if (period === '12m') {
    const d = new Date(now); d.setFullYear(d.getFullYear() - 1);
    const iso = d.toISOString().slice(0, 10);
    list = list.filter((r) => r.date >= iso);
  }
  if (period === 'last10') list = list.slice(0, 10);
  if (period === 'last20') list = list.slice(0, 20);
  return list;
}

// 移動平均
export function movingAverage(values, w = 5) {
  return values.map((_, i) => {
    if (i < w - 1) return null;
    const win = values.slice(i - w + 1, i + 1).filter(Number.isFinite);
    return win.length === w ? win.reduce((a, b) => a + b, 0) / w : null;
  });
}

// コースのホール別分析
// ラウンドの n 番ホール（1〜18）が、コースの何番ホール（9 ホールのまとまりをまたいだ通し番号）にあたるか。
// 27 ホールのゴルフ場で「東 → 南」と回ったら、後半の 1 番（10 番）は南コースの 1 番（19）
export function courseHoleNo(round, no) {
  const nine = no <= 9 ? (round.front_nine ?? 1) : (round.back_nine ?? 2);
  return (nine - 1) * 9 + ((no - 1) % 9) + 1;
}
// ホール番号をコースの通し番号に置き換えたラウンド（コース別のホール分析用）
export function onCourseHoles(round) {
  return { ...round, holes: (round.holes || []).map((h) => ({ ...h, hole_no: courseHoleNo(round, h.hole_no) })) };
}

// count: 集計するホール数（コースの通し番号で集計するときは 9 × まとまりの数）
export function holeAnalysis(rounds, count = 18) {
  const out = [];
  for (let no = 1; no <= count; no++) {
    const hs = [];
    for (const r of rounds) {
      for (const h of r.holes || []) if (h.hole_no === no && played(h)) hs.push(h);
    }
    if (!hs.length) { out.push({ hole_no: no, n: 0 }); continue; }
    const putts = hs.filter((h) => Number.isFinite(h.putts));
    const results = Object.fromEntries(RESULT_KEYS.map((k) => [k, 0]));
    hs.forEach((h) => results[resultKey(h.strokes, h.par)]++);
    out.push({
      hole_no: no,
      par: hs[0].par,
      n: hs.length,
      avg: mean(hs.map((h) => h.strokes)),
      toPar: mean(hs.map((h) => h.strokes - h.par)),
      best: Math.min(...hs.map((h) => h.strokes)),
      avgPutts: mean(putts.map((h) => h.putts)),
      parOrBetter: (results.eagle + results.birdie + results.par) / hs.length,
      results,
    });
  }
  return out;
}

// ラウンドの振り返りコメント（他のラウンドの平均と比較）
export function roundInsights(sum, base, { isBest = false } = {}) {
  const items = [];
  const good = (text) => items.push({ type: 'good', text });
  const bad = (text) => items.push({ type: 'bad', text });
  const info = (text) => items.push({ type: 'info', text });
  const hasBase = base && base.rounds > 0;

  if (isBest && sum.complete) good(`ベストスコア ${sum.strokes} を記録しました！`);
  if (hasBase && sum.complete && base.avgScore != null) {
    const d = sum.strokes - base.avgScore;
    if (d <= -2) good(`平均スコア（${base.avgScore.toFixed(1)}）より ${Math.abs(d).toFixed(1)} 打良いラウンドでした。`);
    else if (d >= 3) bad(`平均スコア（${base.avgScore.toFixed(1)}）より ${d.toFixed(1)} 打多く叩きました。`);
  }
  if (sum.puttHoles === sum.holes && sum.holes > 0) {
    const pr = (sum.putts / sum.holes) * 18;
    if (hasBase && base.puttsPerRound != null) {
      const d = pr - base.puttsPerRound;
      if (d <= -1.5) good(`パットが好調：18H換算 ${pr.toFixed(1)} 回（平均より ${Math.abs(d).toFixed(1)} 回少ない）。`);
      else if (d >= 1.5) bad(`パットに課題：18H換算 ${pr.toFixed(1)} 回（平均より ${d.toFixed(1)} 回多い）。`);
    }
  }
  if (sum.threePutts >= 3) bad(`3パット以上が ${sum.threePutts} 回ありました。ファーストパットの距離感を意識しましょう。`);
  if (sum.fwTotal >= 5 && hasBase && base.fwRate != null) {
    const r = sum.fwHit / sum.fwTotal;
    const d = r - base.fwRate;
    if (d >= 0.1) good(`ティーショットが安定：FWキープ率 ${Math.round(r * 100)}%（平均 +${Math.round(d * 100)}pt）。`);
    else if (d <= -0.1) {
      const side = sum.fwLeft > sum.fwRight * 1.5 ? '（左へのミスが多め）' : sum.fwRight > sum.fwLeft * 1.5 ? '（右へのミスが多め）' : '';
      bad(`FWキープ率 ${Math.round(r * 100)}%（平均 ${Math.round(d * 100)}pt）${side}。`);
    }
  }
  if (sum.girKnown >= 9 && hasBase && base.girRate != null) {
    const r = sum.gir / sum.girKnown;
    const d = r - base.girRate;
    if (d >= 0.08) good(`パーオン率 ${Math.round(r * 100)}%：ショットの精度が高いラウンドでした。`);
    else if (d <= -0.08) bad(`パーオン率 ${Math.round(r * 100)}%（平均 ${Math.round(d * 100)}pt）。セカンドショットを見直しましょう。`);
  }
  if (sum.holes >= 9) {
    if (sum.penalties === 0) good('OB・ペナルティなしのクリーンなラウンド。');
    else if (sum.penalties >= 3) bad(`OB・ペナルティが ${sum.penalties} 打。安全なクラブ選択でスコアを守れる可能性があります。`);
  }
  if (sum.bestRun >= 3) good(`パー以上が ${sum.bestRun} ホール連続しました。`);
  if (sum.worstHole && sum.worstHole.over >= 3) bad(`${sum.worstHole.hole_no}番（Par${sum.worstHole.par}）で ${sum.worstHole.strokes} 打の大叩き。ここを抑えれば ${sum.worstHole.over - 1} 打縮まります。`);
  if (sum.front.holes === 9 && sum.back.holes === 9) {
    const d = (sum.back.strokes - sum.back.par) - (sum.front.strokes - sum.front.par);
    if (d >= 4) info(`後半に ${d} 打崩れました（前半 ${sum.front.strokes} / 後半 ${sum.back.strokes}）。体力・集中力の配分を意識しましょう。`);
    else if (d <= -4) info(`後半に ${Math.abs(d)} 打巻き返しました（前半 ${sum.front.strokes} / 後半 ${sum.back.strokes}）。`);
  }
  if (hasBase) {
    for (const p of [3, 4, 5]) {
      const bp = sum.byPar[p];
      const ba = base.byPar[p];
      if (bp.n < 3 || ba.toPar == null) continue;
      const tp = (bp.strokes - bp.par) / bp.n;
      if (tp - ba.toPar <= -0.4) good(`パー${p}が好調（平均 ${tp >= 0 ? '+' : ''}${tp.toFixed(2)}／ホール）。`);
      else if (tp - ba.toPar >= 0.5) bad(`パー${p}で苦戦（平均 +${tp.toFixed(2)}／ホール）。`);
    }
  }
  if (!items.length) info('平均的な内容のラウンドでした。ラウンドを重ねると比較コメントが充実します。');
  return items;
}

// 全体傾向のコメント（直近と以前の比較）
export function trendInsights(sums) {
  const complete = sums.filter((s) => s.complete).sort((a, b) => b.date.localeCompare(a.date));
  const items = [];
  if (complete.length < 6) return items;
  const recent = aggregate(complete.slice(0, 5));
  const prev = aggregate(complete.slice(5, 15));
  const cmp = (label, a, b, { better = 'lower', fmt = (v) => v.toFixed(1), threshold = 0 }) => {
    if (a == null || b == null) return;
    const d = a - b;
    if (Math.abs(d) <= threshold) return;
    const improved = better === 'lower' ? d < 0 : d > 0;
    items.push({ type: improved ? 'good' : 'bad', text: `${label}：直近5R ${fmt(a)}（以前 ${fmt(b)}）` });
  };
  const p = (v) => `${Math.round(v * 100)}%`;
  cmp('平均スコア', recent.avgScore, prev.avgScore, { threshold: 1 });
  cmp('平均パット', recent.puttsPerRound, prev.puttsPerRound, { threshold: 0.8 });
  cmp('FWキープ率', recent.fwRate, prev.fwRate, { better: 'higher', fmt: p, threshold: 0.05 });
  cmp('パーオン率', recent.girRate, prev.girRate, { better: 'higher', fmt: p, threshold: 0.04 });
  cmp('ペナルティ/R', recent.penaltiesPerRound, prev.penaltiesPerRound, { threshold: 0.5 });
  return items;
}

// ---------- 目標スコア（例: 100 =「100切り」= 99 以下で達成） ----------
export const GOAL_CHOICES = [120, 110, 100, 95, 90, 85, 80, 75];
// 直近の平均から、次に目指す目標を選ぶ（平均 97 なら 95切り）
export function suggestGoal(avg) {
  if (avg == null) return 100;
  const next = GOAL_CHOICES.filter((g) => g <= avg);
  return next.length ? Math.max(...next) : Math.min(...GOAL_CHOICES);
}

export function goalProgress(sums, goal) {
  const complete = sums.filter((s) => s.complete).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const achieved = complete.filter((s) => s.strokes < goal);
  const recentAvg = mean(complete.slice(-5).map((s) => s.strokes));
  const sorted = [...complete].sort((a, b) => a.strokes - b.strokes || a.date.localeCompare(b.date));
  // 縮めるポイント：直近 10 ラウンド（18 ホール）の傾向から、打数を減らしやすいところを大きい順に 2 つ
  const a = aggregate(complete.slice(-10));
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const tips = [];
  const dbl = a.holes ? ((a.results.double + a.results.triple) / a.holes) * 18 : 0;
  if (dbl >= 1) {
    tips.push({ key: 'double', save: dbl / 2, text: `ダブルボギー以上（1ラウンド平均 ${f1(dbl)} ホール）の半分をボギーで止めると、約 ${f1(dbl / 2)} 打縮まります`, hint: 'トラブルのときは無理をせず、まず安全に出すことを優先しましょう' });
  }
  if (a.penaltiesPerRound != null && a.penaltiesPerRound >= 1) {
    const v = a.penaltiesPerRound;
    tips.push({ key: 'penalty', save: v / 2, text: `OB・ペナルティ（1ラウンド平均 ${f1(v)} 回）を半分にすると、約 ${f1(v / 2)} 打縮まります`, hint: 'OB が出やすいホールは、曲がっても安全なクラブ・方向を選びましょう' });
  }
  if (a.threePuttsPerRound != null && a.threePuttsPerRound >= 1) {
    const v = a.threePuttsPerRound;
    tips.push({ key: 'putt', save: v / 2, text: `3パット（1ラウンド平均 ${f1(v)} 回）を半分にすると、約 ${f1(v / 2)} 打縮まります`, hint: '長いパットは入れるより、カップの周り 1m に寄せる距離感を重視しましょう' });
  }
  tips.sort((x, y) => y.save - x.save);
  return {
    goal,
    rounds: complete.length,
    achieved: achieved.length,
    firstAchieved: achieved[0] || null,
    best: sorted[0] || null,
    recentAvg,
    gap: recentAvg != null ? recentAvg - (goal - 1) : null, // 平均でこれだけ縮めれば達成（0 以下なら達成ペース）
    last10: complete.slice(-10).map((s) => ({ id: s.id, date: s.date, course: s.course, strokes: s.strokes, ok: s.strokes < goal })),
    tips: tips.slice(0, 2),
  };
}

// ---------- 年間のまとめ ----------
export function reviewYears(rounds) {
  return [...new Set(rounds.map((r) => Number(r.date.slice(0, 4))))].filter(Boolean).sort((a, b) => b - a);
}

export function yearReview(rounds, year) {
  const ys = String(year);
  const sums = rounds.filter((r) => r.date.startsWith(ys)).map(summarize).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const prevSums = rounds.filter((r) => r.date.startsWith(String(year - 1))).map(summarize);
  const earlier = rounds.filter((r) => r.date < `${ys}-01-01`).map(summarize).filter((s) => s.complete);
  const a = aggregate(sums);
  const p = prevSums.length ? aggregate(prevSums) : null;
  const complete = sums.filter((s) => s.complete);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = sums.filter((s) => Number(s.date.slice(5, 7)) === i + 1);
    return { month: i + 1, rounds: m.length, avg: mean(m.filter((s) => s.complete).map((s) => s.strokes)) };
  });
  const courses = new Map();
  for (const s of sums) {
    const key = s.course || '不明';
    if (!courses.has(key)) courses.set(key, { name: key, courseId: s.courseId, rounds: 0, scores: [] });
    const c = courses.get(key);
    c.rounds++;
    if (s.complete) c.scores.push(s.strokes);
  }
  const courseList = [...courses.values()].map((c) => ({ name: c.name, courseId: c.courseId, rounds: c.rounds, avg: mean(c.scores), best: c.scores.length ? Math.min(...c.scores) : null }))
    .sort((x, y) => y.rounds - x.rounds || (x.avg ?? 999) - (y.avg ?? 999));
  const pick = (list, score, better) => list.reduce((best, s) => (best == null || better(score(s), score(best)) ? s : best), null);
  const fullPutts = sums.filter((s) => s.puttHoles === 18);
  const fewestPutts = pick(fullPutts, (s) => s.putts, (x, y) => x < y);
  const birdieRound = pick(sums.filter((s) => s.results.eagle + s.results.birdie > 0), (s) => s.results.eagle + s.results.birdie, (x, y) => x > y);
  const runRound = pick(sums.filter((s) => s.bestRun > 0), (s) => s.bestRun, (x, y) => x > y);
  // 節目（100・90・80 を初めて切ったラウンド。前の年までに切っていれば「今年初」）
  const milestones = [];
  for (const goal of [120, 110, 100, 90, 80, 72]) {
    const first = complete.find((s) => s.strokes < goal);
    if (!first) continue;
    milestones.push({ goal, round: first, everFirst: !earlier.some((s) => s.strokes < goal) });
  }
  const cmp = (label, cur, prev, better, fmt) => (cur == null || prev == null ? null : { label, cur, prev, diff: cur - prev, improved: better === 'lower' ? cur < prev : cur > prev, fmt });
  const comparisons = p ? [
    cmp('平均スコア', a.avgScore, p.avgScore, 'lower', 'num'),
    cmp('平均パット', a.puttsPerRound, p.puttsPerRound, 'lower', 'num'),
    cmp('FWキープ率', a.fwRate, p.fwRate, 'higher', 'pct'),
    cmp('パーオン率', a.girRate, p.girRate, 'higher', 'pct'),
    cmp('OB・ペナルティ/R', a.penaltiesPerRound, p.penaltiesPerRound, 'lower', 'num'),
    cmp('ダブルボギー以上の率', a.doublePlusRate, p.doublePlusRate, 'lower', 'pct'),
  ].filter(Boolean) : [];
  return {
    year, rounds: sums.length, completeRounds: complete.length, holes: a.holes,
    avgScore: a.avgScore, best: a.best, puttsPerRound: a.puttsPerRound, fwRate: a.fwRate, girRate: a.girRate,
    results: a.results, prevRounds: prevSums.length, prevAvg: p?.avgScore ?? null,
    months, courses: courseList,
    records: { fewestPutts, birdieRound, runRound },
    milestones, comparisons,
    first: sums[0] || null, last: sums[sums.length - 1] || null,
  };
}

// ---------- スコアの分布・ハンディキャップの推移 ----------
// 18 ホールのスコアを 5 打ごとに数える（例: 85〜89 が 4 回）
export function scoreDistribution(sums, width = 5) {
  const scores = sums.filter((s) => s.complete).map((s) => s.strokes);
  if (!scores.length) return [];
  const lo = Math.floor(Math.min(...scores) / width) * width;
  const hi = Math.floor(Math.max(...scores) / width) * width;
  const out = [];
  for (let b = lo; b <= hi; b += width) out.push({ from: b, to: b + width - 1, count: scores.filter((v) => v >= b && v < b + width).length });
  return out;
}

// ラウンドを重ねるごとの推定ハンディキャップ（その時点までの直近 20 ラウンドで計算）
export function handicapTrend(sums) {
  const complete = sums.filter((s) => s.complete).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const out = [];
  for (let i = 0; i < complete.length; i++) {
    const hc = handicapEstimate(complete.slice(0, i + 1));
    if (hc != null) out.push({ id: complete[i].id, date: complete[i].date, course: complete[i].course, handicap: hc });
  }
  return out;
}

// ---------- 目標スコアの配分（例: 100切り → 99 打を 18 ホールに配る） ----------
// holes: [{ hole_no, par }]（そのラウンドで回る 18 ホール）。difficulty(no) は難しいほど大きい値（過去のパー比や HDCP から）
// 返り値: Map(hole_no → 目標打数)。難しいホールから順に 1 打ずつ多く配る
export function goalPlan(holes, goal, difficulty = () => 0) {
  const list = holes.filter((h) => Number.isFinite(h.par));
  if (!goal || !list.length) return null;
  const target = goal - 1;
  const par = list.reduce((a, h) => a + h.par, 0);
  const over = target - par;
  const base = Math.floor(over / list.length);
  const extra = over - base * list.length;
  const ranked = [...list].sort((a, b) => difficulty(b.hole_no) - difficulty(a.hole_no) || b.par - a.par || a.hole_no - b.hole_no);
  const plan = new Map();
  ranked.forEach((h, i) => plan.set(h.hole_no, Math.max(1, h.par + base + (i < extra ? 1 : 0))));
  return plan;
}
export const planLabel = (strokes, par) => ({ '-2': 'イーグル', '-1': 'バーディ', 0: 'パー', 1: 'ボギー', 2: 'ダブルボギー', 3: 'トリプルボギー' })[strokes - par] ?? `パー${strokes - par > 0 ? '+' : ''}${strokes - par}`;

// ---------- ラウンドの達成（ベスト更新・目標達成・初めての 100 切り・初バーディなど） ----------
export function roundAchievements(sum, otherSums, goal = null) {
  const out = [];
  const oc = otherSums.filter((s) => s.complete);
  if (sum.complete && oc.length && oc.every((s) => s.strokes > sum.strokes)) {
    out.push({ key: 'best', icon: '🏆', title: 'ベストスコア更新！', text: `${sum.strokes}（これまでのベストは ${Math.min(...oc.map((s) => s.strokes))}）` });
  }
  if (goal && sum.complete && sum.strokes < goal) {
    const n = oc.filter((s) => s.strokes < goal).length;
    out.push({ key: 'goal', icon: '🎯', title: n === 0 && oc.length ? `初めての${goal}切り！` : `${goal}切り達成！`, text: n === 0 ? '目標を達成しました。おめでとうございます！' : `${n + 1} 回目の達成です` });
  }
  for (const m of [80, 90, 100]) {
    if (m === goal || !sum.complete || sum.strokes >= m || !oc.length || oc.some((s) => s.strokes < m)) continue;
    out.push({ key: `m${m}`, icon: '🎉', title: `初めての${m}切り！`, text: `${sum.strokes} で回りました` });
    break;
  }
  if (sum.results.eagle && !otherSums.some((s) => s.results.eagle)) out.push({ key: 'eagle', icon: '🦅', title: '初イーグル！', text: '' });
  else if (sum.results.birdie + sum.results.eagle && otherSums.length && !otherSums.some((s) => s.results.birdie + s.results.eagle)) out.push({ key: 'birdie', icon: '🐦', title: '初バーディ！', text: '' });
  return out;
}

// ---------- パー3 の番手の目安 ----------
// clubs: API のクラブ（バッグの中だけ使う）。yards: ホールの距離（ヤード）。unit: 飛距離の単位（'yd' | 'm'）
export function suggestClub(clubs, yards, unit = 'yd') {
  if (!Number.isFinite(yards) || yards <= 0) return null;
  const target = unit === 'm' ? yards * 0.9144 : yards;
  const cands = clubs.filter((c) => c.in_bag && c.category !== 'putter' && c.category !== 'driver')
    .map((c) => ({ club: c, carry: c.shot_count ? c.avg_carry : c.target_carry }))
    .filter((x) => Number.isFinite(x.carry) && x.carry > 0);
  if (!cands.length) return null;
  // いちばん近い番手（同じくらいなら長いほう。ショートしやすいため）
  cands.sort((x, y) => Math.abs(x.carry - target) - Math.abs(y.carry - target) || y.carry - x.carry);
  const best = cands[0];
  if (Math.abs(best.carry - target) > target * 0.25) return null; // 合う番手がない
  return { name: best.club.name, carry: Math.round(best.carry), measured: Boolean(best.club.shot_count) };
}

// ---------- 実績（初めての100切り・初バーディ・ラウンド数など） ----------
// 古い順に見て、それぞれの条件を最初に満たしたラウンドを記録する
export function achievements(rounds) {
  const sums = rounds.map(summarize).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const list = [];
  const add = (key, icon, title, desc, test) => {
    const hit = test ? sums.find(test) : null;
    list.push({ key, icon, title, desc, achieved: Boolean(hit), round: hit || null });
  };
  const nth = (n) => (sums.length >= n ? sums[n - 1] : null);
  list.push({ key: 'first', icon: '⛳', title: 'はじめてのラウンド', desc: 'ラウンドを1つ記録する', achieved: sums.length > 0, round: sums[0] || null });
  for (const n of [10, 25, 50, 100]) list.push({ key: `r${n}`, icon: '📅', title: `${n}ラウンド`, desc: `ラウンドを${n}回記録する`, achieved: Boolean(nth(n)), round: nth(n) });
  for (const g of [120, 110, 100, 90, 80]) add(`u${g}`, g <= 90 ? '🏅' : '🎯', `${g}切り`, `18ホールで ${g - 1} 以下`, (s) => s.complete && s.strokes < g);
  add('even', '👑', 'パープレー', '18ホールをパー以下で回る', (s) => s.complete && s.toPar <= 0);
  for (const h of [50, 45, 40]) add(`h${h}`, '✌️', `ハーフ${h}切り`, `9ホールで ${h - 1} 以下（前半か後半）`, (s) => (s.front.holes === 9 && s.front.strokes < h) || (s.back.holes === 9 && s.back.strokes < h));
  add('birdie', '🐦', 'はじめてのバーディ', 'バーディを取る', (s) => s.results.birdie + s.results.eagle > 0);
  add('birdie2', '🐦', '1ラウンド2バーディ', '1ラウンドでバーディ以上を2つ', (s) => s.results.birdie + s.results.eagle >= 2);
  add('eagle', '🦅', 'イーグル', 'イーグル以上を取る', (s) => s.results.eagle > 0);
  for (const n of [3, 5, 9]) add(`run${n}`, '🔥', `パー以内${n}連続`, `パー以内を${n}ホール続ける`, (s) => s.bestRun >= n);
  add('putt30', '🎳', '30パット以下', '18ホールすべてパットを記録して 30 以下', (s) => s.puttHoles === 18 && s.putts <= 30);
  add('no3putt', '🧘', '3パットなし', '18ホールすべてパットを記録して 3パット 0 回', (s) => s.puttHoles === 18 && s.threePutts === 0);
  add('fw70', '🎯', 'FWキープ率 70%', 'パー4・5 のティーショットを10回以上記録して 70% 以上', (s) => s.fwTotal >= 10 && s.fwHit / s.fwTotal >= 0.7);
  const courseFirst = new Map();
  for (const s of sums) { const k = s.courseId ? `c${s.courseId}` : `n${s.course}`; if (!courseFirst.has(k)) courseFirst.set(k, s); }
  const firsts = [...courseFirst.values()];
  for (const n of [5, 10]) list.push({ key: `c${n}`, icon: '🗾', title: `${n}つのコース`, desc: `${n}か所のゴルフ場で記録する`, achieved: firsts.length >= n, round: firsts[n - 1] || null });
  return list;
}

// ---------- ミスの影響（ホールあたりの打数の差） ----------
// rounds: ホールつきのラウンド。それぞれの項目で「良い場合」と「ミスの場合」のホールのパー比の平均と、その差（ミス 1 回の損失）を出す
const MIN_N = 5;
// 項目ごとの「良い場合」と「ミスの場合」のホール。unit は 1 ラウンドあたりの回数の単位（パーオンは出さない）、per は回数を割るラウンド数の種類
function impactGroups(holes) {
  const fw = holes.filter((h) => h.par >= 4 && h.fairway);
  const withPutts = holes.filter((h) => Number.isFinite(h.putts));
  return [
    { key: 'fw', title: 'ティーショット（パー4・5）', unit: '回', per: 'fw', good: { label: 'FWキープ', list: fw.filter((h) => h.fairway === 'hit') },
      bads: [{ label: '左に外す', list: fw.filter((h) => h.fairway === 'left') }, { label: '右に外す', list: fw.filter((h) => h.fairway === 'right') }] },
    { key: 'gir', title: 'パーオン', unit: null, per: 'putts', good: { label: 'パーオンした', list: withPutts.filter(isGir) }, bads: [{ label: 'パーオンしない', list: withPutts.filter((h) => !isGir(h)) }] }, // パーオンしないのが普通なので 1 ラウンドの合計は出さない
    { key: 'penalty', title: 'OB・ペナルティ', unit: 'ホール', per: 'all', good: { label: 'なし', list: holes.filter((h) => !(h.penalties > 0)) }, bads: [{ label: 'あり', list: holes.filter((h) => h.penalties > 0) }] },
    { key: 'bunker', title: 'バンカー', unit: 'ホール', per: 'all', good: { label: '入らない', list: holes.filter((h) => !(h.bunker > 0)) }, bads: [{ label: '入った', list: holes.filter((h) => h.bunker > 0) }] },
    { key: 'putt3', title: '3パット', unit: 'ホール', per: 'putts', good: { label: '2パット以下', list: withPutts.filter((h) => h.putts <= 2) }, bads: [{ label: '3パット以上', list: withPutts.filter((h) => h.putts >= 3) }] },
  ];
}
// 回数を割るラウンド数（9 ホールは 0.5 ラウンド）。パットは記録したホールだけ、FW はパー4・5 で FW を記録したラウンドだけを数える
// （記録していないラウンドまで数えると、1 ラウンドあたりの回数が少なく出るため）
function playedHoles(rounds) {
  const holes = [];
  const per = { all: 0, putts: 0, fw: 0 };
  for (const r of rounds) {
    const hs = (r.holes || []).filter(played);
    if (!hs.length) continue;
    holes.push(...hs);
    per.all += hs.length / 18;
    per.putts += hs.filter((h) => Number.isFinite(h.putts)).length / 18;
    if (hs.some((h) => h.par >= 4 && h.fairway)) per.fw += hs.length / 18;
  }
  return { holes, per };
}
export function shotImpact(rounds) {
  const { holes, per } = playedHoles(rounds);
  const avg = (list) => (list.length ? list.reduce((a, h) => a + h.strokes - h.par, 0) / list.length : null);
  const group = (label, list) => ({ label, n: list.length, avg: avg(list) });
  const out = impactGroups(holes).map(({ key, title, unit, per: perKey, good, bads }) => {
    const bad = bads.flatMap((b) => b.list);
    if (good.list.length < MIN_N || bad.length < MIN_N) return null;
    const g = group(good.label, good.list);
    const loss = avg(bad) - g.avg;
    const n = per[perKey];
    return {
      key, title, good: g, bads: bads.filter((b) => b.list.length).map((b) => group(b.label, b.list)),
      loss, perRound: n && unit ? (bad.length / n) * loss : null, count: bad.length,
      perRoundCount: n ? bad.length / n : null, unit,
    };
  }).filter(Boolean);
  // 1 ラウンドあたりの損失が大きい順（パーオンは最後）
  return out.sort((a, b) => (b.perRound ?? -Infinity) - (a.perRound ?? -Infinity));
}
// 1 ラウンドあたりの回数（ミスの回数。パーオンはパーオンした回数）。シミュレーターで「直近 5 ラウンド」などの今の回数に使う。
// 記録のない項目は入れない（例: パットを記録していなければ 3パット・パーオンは無し）
export function missCounts(rounds) {
  const { holes, per } = playedHoles(rounds);
  const out = {};
  for (const { key, per: perKey, good, bads } of impactGroups(holes)) {
    const n = per[perKey];
    if (n) out[key] = (key === 'gir' ? good.list.length : bads.reduce((a, b) => a + b.list.length, 0)) / n;
  }
  return out;
}

// ---------- ティーショットのクラブ別（パー4・5） ----------
export function teeClubStats(rounds) {
  const by = new Map();
  for (const r of rounds) {
    for (const h of r.holes || []) {
      if (!played(h) || h.par < 4 || !h.tee_club) continue;
      if (!by.has(h.tee_club)) by.set(h.tee_club, []);
      by.get(h.tee_club).push(h);
    }
  }
  return [...by.entries()].map(([club, hs]) => {
    const fw = hs.filter((h) => h.fairway);
    return {
      club, n: hs.length,
      fwRate: fw.length ? fw.filter((h) => h.fairway === 'hit').length / fw.length : null,
      penaltyRate: hs.filter((h) => h.penalties > 0).length / hs.length,
      toPar: mean(hs.map((h) => h.strokes - h.par)),
    };
  }).sort((a, b) => b.n - a.n);
}

// ---------- 条件別のスコア（18 ホール回ったラウンド） ----------
// 同伴者の欄の名前の区切り（例:「田中さん、佐藤さん」）
export const splitNames = (s) => String(s || '').split(/[、,，・\s]+/).map((x) => x.trim()).filter(Boolean);
export const CONDITIONS = [['weather', '天気'], ['season', '季節'], ['day', '曜日'], ['tee', 'ティー'], ['companion', '同伴者']];
const SEASONS = ['春（3〜5月）', '夏（6〜8月）', '秋（9〜11月）', '冬（12〜2月）'];
const seasonOf = (m) => SEASONS[m >= 3 && m <= 5 ? 0 : m >= 6 && m <= 8 ? 1 : m >= 9 && m <= 11 ? 2 : 3];
const CONDITION_ORDER = { weather: ['晴れ', '曇り', '雨', '雪', '強風'], season: SEASONS, day: ['平日', '土日'] };
const conditionKeys = (r, by) => {
  if (by === 'weather') return r.weather ? [r.weather] : [];
  if (by === 'season') return [seasonOf(Number(r.date.slice(5, 7)))];
  if (by === 'day') {
    const [y, m, d] = r.date.split('-').map(Number);
    const w = new Date(y, m - 1, d).getDay();
    return [w === 0 || w === 6 ? '土日' : '平日'];
  }
  if (by === 'tee') return r.tee && r.tee.trim() ? [r.tee.trim()] : [];
  if (by === 'companion') return [...new Set([...splitNames(r.companions), ...(r.party || []).map((p) => p.name)])];
  return [];
};
// rows: [{ key, n, avg, best, diff }]。diff は全体の平均との差（マイナスほど良い）。
// 同伴者は 2 回以上一緒に回った人だけ、回数の多い順に 10 人まで
export function conditionStats(rounds, by) {
  const groups = new Map();
  const all = [];
  for (const r of rounds) {
    const s = summarize(r);
    if (!s.complete) continue;
    all.push(s.strokes);
    for (const k of conditionKeys(r, by)) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s.strokes);
    }
  }
  const overall = mean(all);
  let rows = [...groups.entries()].map(([key, xs]) => {
    const avg = mean(xs);
    return { key, n: xs.length, avg, best: Math.min(...xs), diff: overall == null ? null : avg - overall };
  });
  const order = CONDITION_ORDER[by];
  if (order) {
    const pos = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
    rows.sort((a, b) => pos(a.key) - pos(b.key) || b.n - a.n);
  } else {
    rows = rows.filter((r) => by !== 'companion' || r.n >= 2).sort((a, b) => b.n - a.n || a.avg - b.avg).slice(0, 10);
  }
  return { rows, overall, total: all.length };
}

// ---------- 距離別の成績（コースに登録したホールの距離を使う） ----------
// 区切りはヤード。設定の単位がメートルなら、記録した距離もメートルなので区切りを換算する
const DIST_BANDS = { 3: [130, 160, 190], 4: [330, 370, 410], 5: [470, 520] };
// rows: [{ par, label, from, to, n, toPar, parRate }]（パーごと・距離の短い順）
export function distanceStats(rounds, courses, unit = 'yd') {
  const byId = new Map((courses || []).map((c) => [c.id, c]));
  const k = unit === 'm' ? 0.9144 : 1;
  const u = unit === 'm' ? 'm' : 'y';
  const cut = (y) => Math.round((y * k) / 5) * 5;
  const groups = new Map();
  for (const r of rounds) {
    const c = byId.get(r.course_id);
    if (!c?.holes?.length) continue;
    for (const h of r.holes || []) {
      if (!played(h) || !DIST_BANDS[h.par]) continue;
      const ch = c.holes.find((x) => x.hole_no === courseHoleNo(r, h.hole_no));
      const d = Number(ch?.yards);
      if (!Number.isFinite(d) || d <= 0) continue;
      const cuts = DIST_BANDS[h.par].map(cut);
      const i = cuts.findIndex((t) => d < t);
      const band = i < 0 ? cuts.length : i;
      const key = `${h.par}-${band}`;
      if (!groups.has(key)) {
        const from = band === 0 ? null : cuts[band - 1];
        const to = band === cuts.length ? null : cuts[band];
        const label = from == null ? `${to}${u}未満` : to == null ? `${from}${u}以上` : `${from}〜${to - 1}${u}`;
        groups.set(key, { par: h.par, band, label, from, to, list: [] });
      }
      groups.get(key).list.push(h);
    }
  }
  return [...groups.values()].sort((a, b) => a.par - b.par || a.band - b.band).map(({ list, band, ...g }) => ({
    ...g, n: list.length,
    toPar: mean(list.map((h) => h.strokes - h.par)),
    parRate: list.filter((h) => h.strokes <= h.par).length / list.length,
  }));
}

// ---------- スコアの流れ（出だし・上がり・大叩きの後・ボギー以上の連続） ----------
// ホール番号の順に回ったものとして計算する（10 番スタートは記録していないため）
const sortedPlayed = (r) => (r.holes || []).filter(played).sort((a, b) => a.hole_no - b.hole_no);
// 1 ラウンドの流れ：出だし 3H・上がり 3H のパー比、大叩き（ダボ以上）の回数と次のホールで立て直した回数、ボギー以上の最長連続
export function roundFlow(round) {
  const hs = sortedPlayed(round);
  const seg = (from, to) => { const xs = hs.filter((h) => h.hole_no >= from && h.hole_no <= to); return xs.length === 3 ? xs.reduce((a, h) => a + h.strokes - h.par, 0) : null; };
  let big = 0;
  let recovered = 0;
  let run = 0;
  let longest = 0;
  hs.forEach((h, i) => {
    const d = h.strokes - h.par;
    run = d >= 1 ? run + 1 : 0;
    longest = Math.max(longest, run);
    const next = hs[i + 1];
    if (d >= 2 && next && next.hole_no === h.hole_no + 1) {
      big++;
      if (next.strokes - next.par <= 1) recovered++;
    }
  });
  return { start: seg(1, 3), finish: seg(16, 18), big, recovered, longest, holes: hs.length };
}
// 全体：区間ごとのホールあたりのパー比、大叩きの次のホールの平均と普段の平均、ボギー以上の最長連続の平均
export function flowStats(rounds) {
  const segs = { start: [], middle: [], finish: [] };
  const afterBig = [];
  const afterOther = [];
  const longest = [];
  for (const r of rounds) {
    const hs = sortedPlayed(r);
    if (hs.length < 18) continue;
    hs.forEach((h, i) => {
      const d = h.strokes - h.par;
      segs[h.hole_no <= 3 ? 'start' : h.hole_no >= 16 ? 'finish' : 'middle'].push(d);
      const next = hs[i + 1];
      if (next && next.hole_no === h.hole_no + 1) (d >= 2 ? afterBig : afterOther).push(next.strokes - next.par);
    });
    longest.push(roundFlow(r).longest);
  }
  if (!longest.length) return null;
  const rate = (xs) => (xs.length ? xs.filter((d) => d <= 1).length / xs.length : null);
  return {
    rounds: longest.length,
    all: mean([...segs.start, ...segs.middle, ...segs.finish]),
    start: mean(segs.start), middle: mean(segs.middle), finish: mean(segs.finish),
    afterBig: { avg: mean(afterBig), n: afterBig.length, recover: rate(afterBig) },
    afterOther: { avg: mean(afterOther), n: afterOther.length, recover: rate(afterOther) },
    longestAvg: mean(longest), longestMax: Math.max(...longest),
  };
}
// 流れの傾向をことばで（差が小さいときは出さない）
export function flowInsights(f) {
  if (!f || f.rounds < 3) return [];
  const out = [];
  if (f.start - f.all >= 0.25) out.push({ type: 'bad', text: `出だし3ホールが平均より ${(f.start - f.all).toFixed(1)} 打/H 悪い。スタート前のパター・アプローチ練習が効きそうです` });
  else if (f.all - f.start >= 0.25) out.push({ type: 'good', text: '出だし3ホールは平均より良く、スタートは得意です' });
  if (f.finish - f.all >= 0.25) out.push({ type: 'bad', text: `上がり3ホールが平均より ${(f.finish - f.all).toFixed(1)} 打/H 悪い。後半の体力・集中力を意識しましょう` });
  else if (f.all - f.finish >= 0.25) out.push({ type: 'good', text: '上がり3ホールは平均より良く、最後まで粘れています' });
  if (f.afterBig.n >= 5 && f.afterOther.avg != null) {
    const d = f.afterBig.avg - f.afterOther.avg;
    if (d >= 0.3) out.push({ type: 'bad', text: `大叩き（ダボ以上）の次のホールは普段より ${d.toFixed(1)} 打悪く、引きずる傾向。次のホールは安全なクラブで` });
    else if (d <= 0.1) out.push({ type: 'good', text: '大叩きの次のホールも普段どおり。気持ちを切り替えられています' });
  }
  return out;
}

// ---------- スコアのシミュレーター ----------
// ミスの影響（shotImpact）から、1 ラウンドあたりの回数を動かせる項目を作る。
// dir: 'down' は減らすと良くなる（3パット・OB など）、'up' は増やすと良くなる（パーオン）
const r1 = (x) => Math.round(x * 10) / 10;
const SIM_LABELS = { putt3: '3パット', penalty: 'OB・ペナルティ', bunker: 'バンカー', fw: 'フェアウェイを外す', gir: 'パーオン' };
// counts（missCounts の結果）を渡すと、今の回数はそこから取る（直近 5 ラウンドなど）。1 回あたりの効き目（loss）は impact のまま
export function simItems(impact, counts = null) {
  return (impact || []).filter((it) => SIM_LABELS[it.key] && it.loss > 0.05 && it.perRoundCount > 0).map((it) => {
    const gir = it.key === 'gir';
    const cur = counts ? counts[it.key] : gir ? (it.good.n * it.perRoundCount) / it.count : it.perRoundCount; // パーオンは 1 ラウンドあたりのパーオンした回数
    if (cur == null) return null;
    if (gir) return { key: it.key, label: SIM_LABELS[it.key], dir: 'up', current: cur, min: cur, max: Math.min(18, cur + 6), loss: it.loss };
    return { key: it.key, label: SIM_LABELS[it.key], dir: 'down', current: cur, min: 0, max: cur, loss: it.loss };
  }).filter(Boolean)
    .map((it) => ({ ...it, current: r1(it.current), min: r1(it.min), max: r1(it.max) })) // 表示と同じく 0.1 回単位にそろえる
    .filter((it) => it.dir === 'up' || it.current > 0) // 減らせる回数がない項目（直近は 0 回など）は出さない
    .sort((a, b) => (a.dir === b.dir ? b.loss - a.loss : a.dir === 'down' ? -1 : 1)); // ミスを減らす項目を先に、パーオンは最後
}
// values: { key: 1 ラウンドあたりの回数 }。返り値の effects は項目ごとの打数の変化（マイナスほど良い）
export function simulate(base, items, values = {}) {
  const effects = {};
  let total = 0;
  for (const it of items) {
    const v = Math.min(it.max, Math.max(it.min, values[it.key] ?? it.current));
    const d = (it.dir === 'up' ? -(v - it.current) : -(it.current - v)) * it.loss;
    effects[it.key] = d;
    total += d;
  }
  return { projected: base + total, total, effects };
}
// 目標（例: 100 → 99 以下）に届く組み合わせの例：1 回あたりの効き目が大きい項目から、無理のない範囲（減らすのは半分まで・パーオンは +3 まで）で動かす
export function simPlan(base, items, goal) {
  if (!goal || base == null || base < goal) return null;
  const values = Object.fromEntries(items.map((it) => [it.key, it.current]));
  const limit = (it) => (it.dir === 'up' ? Math.min(it.max, it.current + 3) : it.current / 2);
  for (const it of items) {
    while (simulate(base, items, values).projected >= goal - 0.05) { // 表示（小数 1 桁）でも目標未満になるまで
      const next = r1(it.dir === 'up' ? values[it.key] + 0.1 : values[it.key] - 0.1); // 0.1 回ずつ
      if (it.dir === 'up' ? next > limit(it) + 1e-9 : next < limit(it) - 1e-9) break;
      values[it.key] = next;
    }
  }
  const r = simulate(base, items, values);
  return { values, reached: r.projected < goal - 0.05, projected: r.projected };
}

// ---------- 上達の履歴（全期間） ----------
// years: 年ごとの成績（古い順）。handicap はその年の終わりの時点の推定ハンディキャップ
// bests: ベストスコアを更新したラウンド（古い順）。firsts: 初めての○○切り（初めてのラウンドより後に達成したもの）
const FIRST_GOALS = [120, 110, 100, 95, 90, 85, 80, 75, 70];
export function progressHistory(rounds) {
  const sums = rounds.map(summarize).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const complete = sums.filter((s) => s.complete);
  const byYear = new Map();
  for (const s of sums) {
    const y = Number(s.date.slice(0, 4));
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(s);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b).map((year) => {
    const a = aggregate(byYear.get(year));
    return {
      year, rounds: a.rounds, complete: a.completeRounds, avg: a.avgScore, best: a.best,
      handicap: handicapEstimate(sums.filter((s) => s.date <= `${year}-12-31`)),
      putts: a.puttsPerRound, girRate: a.girRate, fwRate: a.fwRate, penalties: a.penaltiesPerRound, threePutts: a.threePuttsPerRound,
    };
  });
  const bests = [];
  let best = Infinity;
  for (const s of complete) {
    if (s.strokes < best) {
      bests.push({ id: s.id, date: s.date, course: s.course, strokes: s.strokes, prev: Number.isFinite(best) ? best : null });
      best = s.strokes;
    }
  }
  const firsts = [];
  if (complete.length) {
    const start = complete[0].strokes;
    for (const goal of FIRST_GOALS) {
      if (start < goal) continue; // 最初のラウンドからすでに切れていたものは出さない
      const hit = complete.find((s) => s.strokes < goal);
      if (hit) firsts.push({ goal, id: hit.id, date: hit.date, course: hit.course, strokes: hit.strokes, nth: complete.indexOf(hit) + 1 });
    }
    firsts.sort((a, b) => a.date.localeCompare(b.date) || b.goal - a.goal);
  }
  const avgOf = (list) => (list.length ? mean(list.map((s) => s.strokes)) : null);
  const n = Math.min(5, Math.floor(complete.length / 2));
  return {
    years, bests, firsts,
    totalRounds: sums.length, completeRounds: complete.length,
    from: sums[0]?.date || null, to: sums[sums.length - 1]?.date || null,
    firstAvg: n ? avgOf(complete.slice(0, n)) : null, recentAvg: n ? avgOf(complete.slice(-n)) : null, compareN: n,
    firstHandicap: handicapTrend(sums)[0]?.handicap ?? null, handicap: handicapEstimate(sums),
  };
}
