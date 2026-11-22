// 年間のまとめ：1年のラウンド数・ベスト・前の年との比較・月別の推移・記録・回ったコース（画像で共有もできる）
import { html, mount, $, $$, fmt, pct, fmtDate, shortDate, icon } from '../util.js';
import { api } from '../api.js';
import { yearReview, reviewYears, achievements } from '../stats.js';
import { barChart, lineChart, chartCard, setupChart } from '../charts.js';
import { navigate } from '../main.js';

// 見せる節目：初めて達成したもの（なければ、この年いちばん良い節目だけ）。良いスコアの順
export function keyMilestones(r) {
  const sorted = [...r.milestones].sort((a, b) => a.goal - b.goal);
  const firsts = sorted.filter((m) => m.everFirst);
  return firsts.length ? firsts : sorted.slice(0, 1);
}
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`;

export async function render(root) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const rounds = await api.get('/api/rounds');
  const years = reviewYears(rounds);
  const thisYear = new Date().getFullYear();
  const year = Number(query.get('y')) || (years.includes(thisYear) ? thisYear : years[0] || thisYear);
  const r = yearReview(rounds, year);

  const tile = (label, value, sub = '') => html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${sub}</div></div>`;
  const avgDelta = r.avgScore != null && r.prevAvg != null ? r.avgScore - r.prevAvg : null;
  const milestones = keyMilestones(r);
  const yearAch = achievements(rounds).filter((a) => a.achieved && a.round?.date.startsWith(String(year)));
  const roundLink = (s, text) => (s ? html`<a href="#/rounds/${s.id}">${text}</a>` : '—');

  mount(root, html`
    <div class="page-header">
      <div><h1>${year}年のまとめ</h1>
        <div class="sub">${r.rounds ? `${shortDate(r.first.date)} 〜 ${shortDate(r.last.date)}・${r.rounds} ラウンド` : 'この年のラウンドはありません'}</div></div>
      <div class="actions">
        ${years.length > 1 ? html`<select id="year" aria-label="年">${years.map((y) => html`<option value="${y}" ${y === year ? 'selected' : ''}>${y}年</option>`)}</select>` : ''}
        <a class="btn" href="#/achievements">🏅 実績</a>
        ${r.rounds ? html`<button class="btn btn-primary" id="share-review">${icon('share')}画像で共有</button>` : ''}
      </div>
    </div>
    ${!r.rounds ? html`<div class="card empty">${icon('score')}<h2>${year}年のラウンドはまだありません</h2><p>スコアを記録すると、1年のまとめが自動で作られます。</p></div>` : html`
      <div class="tiles review-tiles">
        ${tile('ラウンド数', r.rounds, r.prevRounds ? `前の年 ${r.prevRounds}` : `18ホール ${r.completeRounds}`)}
        ${tile('ベストスコア', r.best ? r.best.strokes : '—', r.best ? `${shortDate(r.best.date)} ${r.best.course || ''}` : '18ホールの記録なし')}
        ${tile('平均スコア', fmt(r.avgScore, 1), avgDelta != null ? html`前の年より <strong class="${avgDelta <= 0 ? 'good' : 'bad'}">${avgDelta <= 0 ? '▼' : '▲'} ${Math.abs(avgDelta).toFixed(1)}</strong>` : '18ホール')}
        ${tile('平均パット', fmt(r.puttsPerRound, 1), '18ホール換算')}
        ${tile('バーディ', r.results.birdie + r.results.eagle, r.results.eagle ? `うちイーグル ${r.results.eagle}` : `全 ${r.holes} ホール`)}
        ${tile('パー', r.results.par, `パー以内の率 ${pct((r.results.par + r.results.birdie + r.results.eagle) / (r.holes || 1))}`)}
      </div>

      ${milestones.length ? html`<div class="card section milestones">
        <h2 style="margin-bottom:10px">🎉 この年の節目</h2>
        <ul>${milestones.map((m) => html`<li><span class="ms-badge">${m.goal}切り</span><span>${m.everFirst ? '初めて達成' : 'この年初めて'}：${roundLink(m.round, `${fmtDate(m.round.date)} ${m.round.course || ''}（${m.round.strokes}）`)}</span></li>`)}</ul>
      </div>` : ''}

      ${yearAch.length ? html`<div class="card section">
        <div class="card-header"><div><h2>🏅 この年に達成した実績</h2><div class="sub">${yearAch.length} 個</div></div><a class="small" href="#/achievements">すべての実績 →</a></div>
        <div class="year-ach">${yearAch.map((a) => html`<a class="ya-item" href="#/rounds/${a.round.id}"><span aria-hidden="true">${a.icon}</span><span><strong>${a.title}</strong><span class="small muted">${fmtDate(a.round.date)}</span></span></a>`)}</div>
      </div>` : ''}

      <div class="grid grid-2 section">
        ${chartCard('months', '月別のラウンド数', `${year}年`)}
        ${chartCard('monthAvg', '月別の平均スコア', '18ホールのラウンド')}
      </div>

      <div class="grid grid-2 section">
        <div class="card">
          <h2 style="margin-bottom:10px">記録</h2>
          <dl class="kv review-records">
            <dt>ベストスコア</dt><dd>${r.best ? roundLink(r.best, `${r.best.strokes}（${fmtDate(r.best.date)} ${r.best.course || ''}）`) : '—'}</dd>
            <dt>最少パット</dt><dd>${r.records.fewestPutts ? roundLink(r.records.fewestPutts, `${r.records.fewestPutts.putts}（${fmtDate(r.records.fewestPutts.date)}）`) : '—'}</dd>
            <dt>最多バーディ</dt><dd>${r.records.birdieRound ? roundLink(r.records.birdieRound, `${r.records.birdieRound.results.eagle + r.records.birdieRound.results.birdie} 個（${fmtDate(r.records.birdieRound.date)}）`) : '—'}</dd>
            <dt>パー以内の連続</dt><dd>${r.records.runRound ? roundLink(r.records.runRound, `${r.records.runRound.bestRun} ホール（${fmtDate(r.records.runRound.date)}）`) : '—'}</dd>
          </dl>
        </div>
        ${r.comparisons.length ? html`<div class="card">
          <h2 style="margin-bottom:8px">前の年（${year - 1}年）との比較</h2>
          <div class="table-wrap"><table class="data"><thead><tr><th></th><th class="r">${year}年</th><th class="r">${year - 1}年</th><th class="r">差</th></tr></thead>
            <tbody>${r.comparisons.map((c) => html`<tr><td>${c.label}</td>
              <td class="r"><strong>${c.fmt === 'pct' ? pct(c.cur) : fmt(c.cur, 1)}</strong></td><td class="r">${c.fmt === 'pct' ? pct(c.prev) : fmt(c.prev, 1)}</td>
              <td class="r ${Math.abs(c.diff) < 1e-9 ? '' : c.improved ? 'good' : 'bad'}">${c.fmt === 'pct' ? `${c.diff > 0 ? '+' : ''}${Math.round(c.diff * 100)}pt` : signed(c.diff)}</td></tr>`)}</tbody></table></div>
        </div>` : html`<div class="card"><h2 style="margin-bottom:8px">前の年との比較</h2><p class="muted small">前の年の記録がないため、比較はありません。</p></div>`}
      </div>

      <div class="card section">
        <h2 style="margin-bottom:8px">回ったコース</h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>コース</th><th class="r">回数</th><th class="r">平均</th><th class="r">ベスト</th></tr></thead>
          <tbody>${r.courses.map((c) => html`<tr ${c.courseId ? html`class="link" data-course="${c.courseId}"` : ''}><td class="wrap">${c.name}</td><td class="r">${c.rounds}</td><td class="r">${fmt(c.avg, 1)}</td><td class="r">${c.best ?? '—'}</td></tr>`)}</tbody></table></div>
      </div>
    `}
  `);

  $('#year', root)?.addEventListener('change', (e) => navigate(`/review?y=${e.target.value}`));
  $$('tr[data-course]', root).forEach((tr) => tr.addEventListener('click', () => navigate(`/courses/${tr.dataset.course}`)));
  $('#share-review', root)?.addEventListener('click', async () => {
    const [{ openImagePreview }, { drawReviewImage }] = await Promise.all([import('./shareCard.js'), import('./reviewImage.js')]);
    openImagePreview(`${year}年のまとめを共有`, () => drawReviewImage(r), `${year}年のゴルフ`);
  });
  if (!r.rounds) return;
  const labels = r.months.map((m) => `${m.month}月`);
  setupChart(root, 'months', (el) => barChart(el, {
    bars: r.months.map((m) => ({ label: String(m.month), value: m.rounds, color: 'var(--series-1)', title: `${m.month}月`, tip: [{ value: `${m.rounds} ラウンド` }] })),
    ariaLabel: '月別のラウンド数', valueLabels: (b) => b.value > 0, height: 200,
    yDomain: [0, Math.max(4, ...r.months.map((m) => m.rounds))], yFormat: (v) => (Number.isInteger(v) ? String(v) : ''),
  }), { columns: [{ label: '月' }, { label: 'ラウンド', align: 'r' }], rows: r.months.map((m, i) => [labels[i], String(m.rounds)]) });
  setupChart(root, 'monthAvg', (el) => lineChart(el, {
    labels, series: [{ name: '平均スコア', color: 'var(--series-1)', values: r.months.map((m) => m.avg) }],
    ariaLabel: '月別の平均スコア', height: 200,
  }), { columns: [{ label: '月' }, { label: '平均スコア', align: 'r' }], rows: r.months.filter((m) => m.avg != null).map((m) => [`${m.month}月`, fmt(m.avg, 1)]) });
}
