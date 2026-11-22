// 上達の履歴：これまでの全ラウンドのスコアの推移、年ごとの成績、ベストスコアの更新、初めての○○切り
import { html, mount, $, $$, fmt, pct, fmtDate, shortDate, icon } from '../util.js';
import { api } from '../api.js';
import { summarize, movingAverage, progressHistory } from '../stats.js';
import { lineChart, chartCard, setupChart, clearCharts } from '../charts.js';
import { navigate } from '../main.js';

const RANGES = [['all', '全期間'], ['50', '直近50'], ['20', '直近20']];
const state = { range: 'all' };
const signed = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);
// 2 つの日付の間（例:「2年3か月」）
function elapsed(from, to) {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  const months = (y2 - y1) * 12 + (m2 - m1);
  if (months <= 0) return '最初の月';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y ? `${y}年` : ''}${m ? `${m}か月` : ''}`;
}

export async function render(root) {
  const rounds = await api.get('/api/rounds');
  clearCharts(); // 前の画面のグラフの登録を消す
  const h = progressHistory(rounds);
  if (h.completeRounds < 2) {
    mount(root, html`<div class="page-header"><div><h1>上達の履歴</h1></div></div>
      <div class="card empty">${icon('stats')}<h2>18ホールのラウンドが2つ以上になると表示されます</h2><p>これまでのスコアの推移・年ごとの成績・ベストスコアの更新の記録をまとめて見られます。</p>
        <a class="btn btn-primary" href="#/rounds/new">${icon('plus')}スコアを入力</a></div>`);
    return;
  }
  const complete = rounds.map(summarize).filter((s) => s.complete).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const bestNow = h.bests[h.bests.length - 1];
  const diff = h.firstAvg != null && h.recentAvg != null ? h.recentAvg - h.firstAvg : null;
  const tile = (label, value, sub = '') => html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${sub}</div></div>`;
  const firstYear = h.years[0].year;
  const lastYear = h.years[h.years.length - 1].year;

  mount(root, html`
    <div class="page-header"><div><h1>📈 上達の履歴</h1><div class="sub">${firstYear === lastYear ? `${firstYear}年` : `${firstYear}年〜${lastYear}年`}・全 ${h.totalRounds} ラウンド（18ホール ${h.completeRounds}）</div></div>
      <div class="actions"><a class="btn" href="#/review">🗓 年間のまとめ</a><a class="btn" href="#/stats">${icon('stats')}統計分析</a></div></div>
    <div class="tiles">
      ${tile(`最初の${h.compareN}R → 直近${h.compareN}R`, html`${fmt(h.firstAvg, 1)} → ${fmt(h.recentAvg, 1)}`, diff != null ? html`<span class="${diff <= 0 ? 'good' : 'bad'}">${diff <= 0 ? '▼' : '▲'} ${Math.abs(diff).toFixed(1)} 打</span>` : '')}
      ${tile('ベストスコア', bestNow.strokes, `${shortDate(bestNow.date)} ${bestNow.course || ''}`)}
      ${tile('推定ハンディキャップ', h.handicap != null ? h.handicap.toFixed(1) : '—', h.firstHandicap != null && h.handicap != null ? `最初 ${h.firstHandicap.toFixed(1)}（${signed(h.handicap - h.firstHandicap)}）` : '18Hを3R以上で算出')}
      ${tile('続けた期間', elapsed(h.from, h.to), `${fmtDate(h.from)} から`)}
    </div>

    <div class="toolbar section" style="margin-bottom:8px"><div class="seg" role="group" aria-label="スコアの推移の期間">${RANGES.map(([k, l]) => html`<button type="button" data-range="${k}" class="${state.range === k ? 'on' : ''}" aria-pressed="${state.range === k}">${l}</button>`)}</div></div>
    <div id="ptrend-box"></div>

    ${h.years.length >= 2 ? chartCard('pyears', '年ごとの平均スコアとベスト', '18ホールのラウンド', 'section') : ''}

    <div class="card section">
      <div class="card-header"><div><h2>年ごとの成績</h2><div class="sub">行を押すと、その年のまとめを開きます</div></div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>年</th><th class="r">ラウンド</th><th class="r">平均</th><th class="r">前年比</th><th class="r">ベスト</th><th class="r">ハンデ</th><th class="r hide-sm">パット</th><th class="r hide-sm">パーオン</th><th class="r hide-sm">FWキープ</th><th class="r hide-sm">OB/R</th></tr></thead>
        <tbody>${[...h.years].reverse().map((y) => {
          const prev = h.years.find((x) => x.year === y.year - 1);
          const d = y.avg != null && prev?.avg != null ? y.avg - prev.avg : null;
          return html`<tr class="link" data-year="${y.year}" tabindex="0"><td><strong>${y.year}</strong></td><td class="r">${y.rounds}</td><td class="r">${fmt(y.avg, 1)}</td>
            <td class="r ${d == null ? '' : d < 0 ? 'good' : d > 0 ? 'bad' : ''}">${d == null ? '—' : `${d < 0 ? '▼' : d > 0 ? '▲' : '±'}${Math.abs(d).toFixed(1)}`}</td>
            <td class="r">${y.best ? y.best.strokes : '—'}</td><td class="r">${y.handicap != null ? y.handicap.toFixed(1) : '—'}</td>
            <td class="r hide-sm">${fmt(y.putts, 1)}</td><td class="r hide-sm">${pct(y.girRate)}</td><td class="r hide-sm">${pct(y.fwRate)}</td><td class="r hide-sm">${fmt(y.penalties, 1)}</td></tr>`;
        })}</tbody></table></div>
    </div>

    <div class="grid grid-2 section">
      <div class="card">
        <h2 style="margin-bottom:8px">🏆 ベストスコアの更新</h2>
        <ol class="ph-list">${[...h.bests].reverse().map((b) => html`<li><a href="#/rounds/${b.id}"><span class="ph-score">${b.strokes}</span><span class="ph-main">${fmtDate(b.date)}<span class="small muted">${b.course || ''}</span></span><span class="small ${b.prev ? 'good' : 'muted'}">${b.prev ? `−${b.prev - b.strokes}` : '最初'}</span></a></li>`)}</ol>
      </div>
      <div class="card">
        <h2 style="margin-bottom:8px">🎯 初めての○○切り</h2>
        ${h.firsts.length ? html`<ol class="ph-list">${[...h.firsts].reverse().map((f) => html`<li><a href="#/rounds/${f.id}"><span class="ph-goal">${f.goal}切り</span><span class="ph-main">${fmtDate(f.date)}<span class="small muted">${f.strokes} で達成・${f.nth} ラウンド目</span></span><span class="small muted">${elapsed(h.from, f.date)}</span></a></li>`)}</ol>`
          : html`<p class="small muted">次の節目（例：100切り）を達成すると、ここに日付が残ります。</p>`}
      </div>
    </div>
  `);

  $$('tr[data-year]', root).forEach((tr) => {
    const go = () => navigate(`/review?y=${tr.dataset.year}`);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });

  const drawTrend = () => {
    const list = state.range === 'all' ? complete : complete.slice(-Number(state.range));
    const w = list.length >= 30 ? 10 : 5;
    const ma = movingAverage(complete.map((s) => s.strokes), w).slice(complete.length - list.length);
    mount($('#ptrend-box', root), chartCard('ptrend', 'スコアの推移', `18ホール ${list.length} ラウンド・線は直近${w}ラウンドの平均・点を押すと詳細`));
    setupChart(root, 'ptrend', (el) => lineChart(el, {
      labels: list.map((s) => (list.length > 60 ? s.date.slice(2, 7).replace('-', '/') : shortDate(s.date))),
      series: [
        { name: 'スコア', color: 'var(--series-1)', values: list.map((s) => s.strokes), dots: list.length <= 120 },
        { name: `${w}ラウンド移動平均`, color: 'var(--series-2)', values: ma, dots: false },
      ],
      tooltipTitle: (i) => `${fmtDate(list[i].date)} ${list[i].course || ''}`,
      onClick: (i) => navigate(`/rounds/${list[i].id}`),
      height: 260,
      ariaLabel: 'スコアの推移（全期間）',
    }), {
      columns: [{ label: '日付' }, { label: 'コース' }, { label: 'スコア', align: 'r' }, { label: `${w}R平均`, align: 'r' }],
      rows: list.map((s, i) => [fmtDate(s.date), s.course || '', String(s.strokes), fmt(ma[i], 1)]),
    });
  };
  $$('[data-range]', root).forEach((b) => b.addEventListener('click', () => {
    state.range = b.dataset.range;
    $$('[data-range]', root).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    drawTrend();
  }));
  drawTrend();

  const ys = h.years.filter((y) => y.avg != null);
  setupChart(root, 'pyears', (el) => lineChart(el, {
    labels: ys.map((y) => String(y.year)),
    series: [
      { name: '平均スコア', color: 'var(--series-1)', values: ys.map((y) => y.avg) },
      { name: 'ベスト', color: 'var(--series-2)', values: ys.map((y) => y.best?.strokes ?? null) },
    ],
    yFormat: (v) => fmt(v, Number.isInteger(v) ? 0 : 1),
    tooltipTitle: (i) => `${ys[i].year}年（${ys[i].complete} R）`,
    onClick: (i) => navigate(`/review?y=${ys[i].year}`),
    height: 220,
    ariaLabel: '年ごとの平均スコアとベスト',
  }), {
    columns: [{ label: '年' }, { label: '平均', align: 'r' }, { label: 'ベスト', align: 'r' }, { label: 'ラウンド', align: 'r' }],
    rows: ys.map((y) => [String(y.year), fmt(y.avg, 1), String(y.best?.strokes ?? '—'), String(y.complete)]),
  });
}
