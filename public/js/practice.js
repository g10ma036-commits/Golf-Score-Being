// 練習データ（弾道測定器）の分析：ミスショットを除いた平均、日ごとの推移、左右の傾向、飛ぶ条件
// 球 = 飛距離の記録のうち弾道のデータがあるもの（carry・total はアプリの単位、スピード m/s、角度 度、高さ m、左右はマイナスが左）

export const hasLaunch = (r) => r.club_speed != null || r.ball_speed != null || r.launch != null || r.spin != null || r.smash != null;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const vals = (rows, k) => rows.map((r) => r[k]).filter((v) => v != null && Number.isFinite(v));
// 最小二乗の傾き（y = a + b x）
function fit(rows, xk, yk) {
  const pts = rows.filter((r) => r[xk] != null && r[yk] != null);
  if (pts.length < 3) return null;
  const mx = mean(pts.map((r) => r[xk]));
  const my = mean(pts.map((r) => r[yk]));
  let sxy = 0;
  let sxx = 0;
  for (const r of pts) { sxy += (r[xk] - mx) * (r[yk] - my); sxx += (r[xk] - mx) ** 2; }
  if (!sxx) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, n: pts.length };
}

export const MISHIT_RATIO = 0.75; // 中央値の 75% に届かない球はミスショット（トップ・チョロなど）
export const STRAIGHT_DEG = 4;    // 左右角がこの範囲ならまっすぐ
// 打ち出し角を測れなかった球（「-」）は、スピン・高さも推定値のことが多いので、その平均には入れない
const AVG_KEYS = ['carry', 'total', 'club_speed', 'ball_speed', 'smash', 'launch', 'side'];

/**
 * @param shots 1 本のクラブの球（弾道のデータがあるもの）
 * @param opts { unit: 'yd' | 'm', today: 'YYYY-MM-DD' }
 */
export function practiceStats(shots, { unit = 'yd', today = new Date().toISOString().slice(0, 10) } = {}) {
  const u = unit;
  const med = median(vals(shots, 'carry'));
  const isMishit = (r) => shots.length >= 10 && med != null && r.carry != null && r.carry < med * MISHIT_RATIO;
  const good = shots.filter((r) => !isMishit(r));
  const mishits = shots.length - good.length;
  const measured = good.filter((r) => r.launch != null);
  const avg = Object.fromEntries(AVG_KEYS.map((k) => [k, mean(vals(good, k))]));
  avg.spin = mean(vals(measured, 'spin'));
  avg.apex = mean(vals(measured, 'apex'));
  const spread = { carry: sd(vals(good, 'carry')), side: sd(vals(good, 'side')) };
  const sides = vals(good, 'side');
  const dir = {
    n: sides.length,
    left: sides.filter((v) => v < -STRAIGHT_DEG).length,
    straight: sides.filter((v) => Math.abs(v) <= STRAIGHT_DEG).length,
    right: sides.filter((v) => v > STRAIGHT_DEG).length,
  };
  const eq = { on: shots.filter((r) => r.equalizer === 1).length, off: shots.filter((r) => r.equalizer === 0).length };

  // 日ごとの平均（ミスショットを除いて 3 球以上の日）
  const byDay = new Map();
  for (const r of good) { if (!byDay.has(r.date)) byDay.set(r.date, []); byDay.get(r.date).push(r); }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).filter(([, rs]) => rs.length >= 3).map(([date, rs]) => {
    const m = rs.filter((r) => r.launch != null);
    return { date, n: rs.length, ...Object.fromEntries(AVG_KEYS.map((k) => [k, mean(vals(rs, k))])), spin: mean(vals(m, 'spin')), apex: mean(vals(m, 'apex')) };
  });

  // キャリーの分布（5 ずつ）
  const cs = vals(good, 'carry');
  const hist = [];
  if (cs.length) {
    const lo = Math.floor(Math.min(...cs) / 5) * 5;
    const hi = Math.floor(Math.max(...cs) / 5) * 5;
    for (let x = lo; x <= hi; x += 5) hist.push({ from: x, to: x + 5, n: cs.filter((v) => v >= x && v < x + 5).length });
  }

  const insights = [];
  const r0 = (v) => Math.round(v);
  // 1) 芯で打てたとき（ミート率の上位 3 分の 1 と下位 3 分の 1 の差）
  const sm = good.filter((r) => r.smash != null && r.carry != null).sort((a, b) => a.smash - b.smash);
  if (sm.length >= 30) {
    const t = Math.floor(sm.length / 3);
    const low = sm.slice(0, t);
    const high = sm.slice(-t);
    const d = mean(vals(high, 'carry')) - mean(vals(low, 'carry'));
    if (d >= 3) insights.push({ type: 'good', key: 'smash', text: `ミート率が高い球（${high[0].smash.toFixed(2)} 以上）は平均 ${r0(mean(vals(high, 'carry')))}${u}、低い球（${low[low.length - 1].smash.toFixed(2)} 以下）は ${r0(mean(vals(low, 'carry')))}${u}。芯で打てると約 ${r0(d)}${u} 伸びています。` });
  }
  // 2) スイングスピードと飛距離
  const sp = fit(good, 'club_speed', 'carry');
  if (sp && sp.n >= 30 && sp.b > 0) insights.push({ type: 'info', key: 'speed', text: `スイングスピードが 1 m/s 速いと、キャリーが約 ${sp.b.toFixed(1)}${u} 伸びる傾向です（今の平均 ${avg.club_speed?.toFixed(1) ?? '—'} m/s）。` });
  // 3) 飛ぶ打ち出し角・スピン：同じボールスピードで比べる（ボールスピードの差の分を差し引いた「飛びの効率」）
  const bs = fit(good, 'ball_speed', 'carry');
  if (bs && bs.n >= 40) {
    const resid = (r) => r.carry - (bs.a + bs.b * r.ball_speed);
    const band = (key, w, label, fmt) => {
      const rs = measured.filter((r) => r[key] != null && r.ball_speed != null && r.carry != null);
      if (rs.length < 40) return null;
      const bins = new Map();
      for (const r of rs) { const b = Math.floor(r[key] / w) * w; if (!bins.has(b)) bins.set(b, []); bins.get(b).push(resid(r)); }
      const minN = Math.max(8, Math.round(rs.length * 0.08));
      const ok = [...bins.entries()].filter(([, v]) => v.length >= minN).map(([b, v]) => ({ b, n: v.length, gain: mean(v) }));
      if (ok.length < 2) return null;
      const best = ok.sort((x, y) => y.gain - x.gain)[0];
      if (best.gain < 1.5) return null;
      return { key, label, from: best.b, to: best.b + w, n: best.n, gain: best.gain, fmt };
    };
    const bands = [
      band('launch', 2, '打ち出し角', (x, y) => `${x}〜${y}°`),
      band('spin', 400, 'スピン', (x, y) => `${x.toLocaleString()}〜${y.toLocaleString()}rpm`),
    ];
    for (const b of bands.filter(Boolean)) {
      const now = b.key === 'spin' ? avg.spin : avg.launch;
      const nowText = now == null ? '' : `今の平均は ${b.key === 'spin' ? `${r0(now).toLocaleString()}rpm` : `${now.toFixed(1)}°`} です。`;
      insights.push({ type: 'good', key: b.key, text: `同じボールスピードで比べると、${b.label} ${b.fmt(b.from, b.to)} の球がいちばん飛んでいます（+${r0(b.gain)}${u}・${b.n}球）。${nowText}` });
    }
  }
  // 4) 左右の傾向
  if (dir.n >= 20) {
    const pl = dir.left / dir.n;
    const pr = dir.right / dir.n;
    const pct = (v) => `${Math.round(v * 100)}%`;
    if (pr >= 0.3 && pr >= pl * 1.5) insights.push({ type: 'bad', key: 'dir', text: `右に出やすい傾向です（右 ${pct(pr)}・左 ${pct(pl)}・まっすぐ ${pct(dir.straight / dir.n)}）。` });
    else if (pl >= 0.3 && pl >= pr * 1.5) insights.push({ type: 'bad', key: 'dir', text: `左に出やすい傾向です（左 ${pct(pl)}・右 ${pct(pr)}・まっすぐ ${pct(dir.straight / dir.n)}）。` });
    else insights.push({ type: 'info', key: 'dir', text: `左右はかたよりが小さめです（左 ${pct(pl)}・まっすぐ ${pct(dir.straight / dir.n)}・右 ${pct(pr)}）。` });
  }
  // 5) 最近（直近 30 日）とそれより前
  const d30 = new Date(`${today}T00:00:00Z`);
  d30.setUTCDate(d30.getUTCDate() - 30);
  const cut = d30.toISOString().slice(0, 10);
  const recent = good.filter((r) => r.date > cut);
  const before = good.filter((r) => r.date <= cut);
  if (recent.length >= 15 && before.length >= 30) {
    const dc = mean(vals(recent, 'carry')) - mean(vals(before, 'carry'));
    const rsp = mean(vals(recent, 'club_speed'));
    const bsp = mean(vals(before, 'club_speed'));
    const ds = rsp != null && bsp != null ? rsp - bsp : null;
    const spText = ds != null ? `・スイングスピード ${ds >= 0 ? '+' : '−'}${Math.abs(ds).toFixed(1)} m/s` : '';
    const diff = `キャリー ${dc >= 0 ? '+' : '−'}${Math.abs(dc).toFixed(1)}${u}${spText}`;
    const flat = Math.abs(dc) < 1 && (ds == null || Math.abs(ds) < 0.2);
    insights.push({ type: dc >= 2 ? 'good' : dc <= -2 ? 'bad' : 'info', key: 'recent', text: flat
      ? `直近30日（${recent.length}球）は、それより前とほぼ同じです（${diff}）。`
      : `直近30日（${recent.length}球）は、それより前と比べて${diff}。` });
  }
  return { n: shots.length, good: good.length, mishits, median: med, avg, spread, dir, eq, days, hist, insights };
}

// 推移のグラフで選べる項目 [キー, 名前, 単位の付け方]
export const PRACTICE_METRICS = [
  ['carry', 'キャリー', (v, u) => `${Math.round(v)}${u}`],
  ['total', 'トータル', (v, u) => `${Math.round(v)}${u}`],
  ['club_speed', 'スイングスピード', (v) => `${v.toFixed(1)} m/s`],
  ['ball_speed', 'ボールスピード', (v) => `${v.toFixed(1)} m/s`],
  ['smash', 'ミート率', (v) => v.toFixed(2)],
  ['launch', '打ち出し角', (v) => `${v.toFixed(1)}°`],
  ['spin', 'スピン', (v) => `${Math.round(v).toLocaleString()} rpm`],
  ['side', '左右角', (v) => `${v > 0 ? '右' : v < 0 ? '左' : ''}${Math.abs(v).toFixed(1)}°`],
];
