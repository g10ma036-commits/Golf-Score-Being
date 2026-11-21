// 年間のまとめを 1 枚の画像にする（共有用）
import { fmtDate } from '../util.js';
import { family, wrap, roundRect } from './shareCard.js';
import { keyMilestones } from './review.js';

const W = 1080;
const PAD = 64;
const C = { bg: '#ffffff', ink: '#16181d', sub: '#6b6a65', muted: '#9a9893', soft: '#f3f2ee', accent: '#17663f', accentSoft: '#e3f0e8', bar: '#3a84e0', good: '#17663f', bad: '#c8322f' };

export async function drawReviewImage(r) {
  const F = family();
  const font = (size, weight = 400) => `${weight} ${size}px ${F}`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const inner = W - PAD * 2;

  const layout = (draw) => {
    let y = 0;
    // 見出し（緑の帯）
    const headH = 220;
    if (draw) {
      ctx.fillStyle = C.accent;
      ctx.fillRect(0, 0, W, headH);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = font(30, 600);
      ctx.fillText('⛳ MY GOLF', PAD, 76);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(72, 800);
      ctx.fillText(`${r.year}年のまとめ`, PAD, 162);
    }
    y = headH + 48;
    // 大きな数字 4 つ
    const big = [
      ['ラウンド', String(r.rounds), r.prevRounds ? `前の年 ${r.prevRounds}` : ''],
      ['ベストスコア', r.best ? String(r.best.strokes) : '—', r.best ? fmtDate(r.best.date) : ''],
      ['平均スコア', r.avgScore != null ? r.avgScore.toFixed(1) : '—', r.prevAvg != null && r.avgScore != null ? `前の年より ${r.avgScore <= r.prevAvg ? '▼' : '▲'}${Math.abs(r.avgScore - r.prevAvg).toFixed(1)}` : ''],
      ['バーディ', String(r.results.birdie + r.results.eagle), r.results.eagle ? `イーグル ${r.results.eagle}` : ''],
    ];
    const gap = 20;
    const tw = (inner - gap) / 2;
    big.forEach(([label, value, sub], i) => {
      const x = PAD + (i % 2) * (tw + gap);
      const ty = y + Math.floor(i / 2) * (196 + gap);
      if (!draw) return;
      ctx.fillStyle = C.soft;
      roundRect(ctx, x, ty, tw, 196, 22);
      ctx.fill();
      ctx.fillStyle = C.sub;
      ctx.font = font(28, 600);
      ctx.fillText(label, x + 28, ty + 50);
      ctx.fillStyle = C.ink;
      ctx.font = font(84, 800);
      ctx.fillText(value, x + 26, ty + 140);
      if (sub) {
        ctx.font = font(24);
        ctx.fillStyle = sub.includes('▼') ? C.good : sub.includes('▲') ? C.bad : C.sub;
        ctx.fillText(sub, x + 28, ty + 176);
      }
    });
    y += 196 * 2 + gap + 52;
    // 月別のラウンド数（棒グラフ）
    if (draw) { ctx.fillStyle = C.ink; ctx.font = font(32, 700); ctx.fillText('月別のラウンド数', PAD, y + 32); }
    y += 56;
    const chartH = 180;
    const maxR = Math.max(1, ...r.months.map((m) => m.rounds));
    const colW = inner / 12;
    if (draw) {
      r.months.forEach((m, i) => {
        const h = m.rounds ? Math.max(8, (m.rounds / maxR) * (chartH - 36)) : 0;
        const x = PAD + i * colW + colW * 0.18;
        const bw = colW * 0.64;
        if (h) {
          ctx.fillStyle = C.bar;
          roundRect(ctx, x, y + chartH - h, bw, h, 6);
          ctx.fill();
          ctx.fillStyle = C.ink;
          ctx.font = font(22, 700);
          ctx.textAlign = 'center';
          ctx.fillText(String(m.rounds), x + bw / 2, y + chartH - h - 8);
        }
        ctx.fillStyle = C.sub;
        ctx.font = font(22);
        ctx.textAlign = 'center';
        ctx.fillText(String(m.month), x + bw / 2, y + chartH + 30);
        ctx.textAlign = 'left';
      });
      ctx.fillStyle = '#e2e0da';
      ctx.fillRect(PAD, y + chartH, inner, 2);
    }
    y += chartH + 64;
    // ひとこと（節目・よく行ったコース）
    const lines = [];
    for (const m of keyMilestones(r).slice(0, 2)) lines.push(`🎉 ${m.goal}切り${m.everFirst ? 'を初めて達成' : '（この年初）'}：${fmtDate(m.round.date)}・${m.round.strokes}`);
    if (r.courses[0]) lines.push(`⛳ いちばん回ったコース：${r.courses[0].name}（${r.courses[0].rounds}回）`);
    const imp = r.comparisons.filter((c) => c.improved).slice(0, 2);
    for (const c of imp) lines.push(`📈 ${c.label}が改善：${c.fmt === 'pct' ? `${Math.round(c.prev * 100)}% → ${Math.round(c.cur * 100)}%` : `${c.prev.toFixed(1)} → ${c.cur.toFixed(1)}`}`);
    ctx.font = font(30);
    for (const text of lines) {
      for (const line of wrap(ctx, text, inner, 2)) {
        if (draw) { ctx.fillStyle = C.ink; ctx.font = font(30); ctx.fillText(line, PAD, y + 30); }
        y += 46;
      }
      y += 8;
    }
    y += 24;
    if (draw) { ctx.fillStyle = C.muted; ctx.font = font(24); ctx.fillText('Golf Enjoy Manager', PAD, y + 24); }
    return y + 24 + 48;
  };

  const h = layout(false);
  canvas.width = W;
  canvas.height = h;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, h);
  layout(true);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('画像を作れませんでした');
  return new File([blob], `golf-${r.year}.png`, { type: 'image/png' });
}
