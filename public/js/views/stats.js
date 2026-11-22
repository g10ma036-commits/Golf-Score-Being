// 統計分析
import { html, mount, $, $$, fmt, pct, toPar, fmtDate, shortDate, icon } from '../util.js';
import { api, getSettings } from '../api.js';
import {
  summarize, aggregate, filterRounds, movingAverage, trendInsights, scoreDistribution, handicapTrend, shotImpact, teeClubStats, PERIODS,
  conditionStats, CONDITIONS, distanceStats,
  RESULT_KEYS, RESULT_LABELS, resultColor, resultInk,
} from '../stats.js';
import { lineChart, barChart, segmentedBar, chartCard, setupChart, clearCharts } from '../charts.js';
import { navigate } from '../main.js';

const state = { period: 'all', course: '', cond: 'weather' };

// ミスの影響：良い場合とミスの場合の「ホールあたりのパー比」を棒で並べ、ミス 1 回・1 ラウンドあたりの損失を示す
const sgn = (v, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`;
function impactCard(items) {
  if (!items.length) return '';
  const max = Math.max(0.5, ...items.flatMap((it) => [it.good.avg, ...it.bads.map((b) => b.avg)]).map((v) => Math.abs(v)));
  const bar = (g, good) => html`<div class="imp-bar ${good ? 'good' : 'bad'}"><span class="imp-label">${g.label}<span class="muted">（${g.n}）</span></span>
    <span class="imp-track"><span style="width:${Math.max(2, Math.round((Math.max(0, g.avg) / max) * 100))}%"></span></span><span class="imp-val">${sgn(g.avg)}</span></div>`;
  return html`<div class="card section">
    <div class="card-header"><div><h2>ミスの影響</h2><div class="sub">ホールあたりのパー比。ミスすると何打多くなっているか、大きい順</div></div></div>
    <div class="impact">${items.map((it) => html`<div class="imp-item">
      <div class="imp-title">${it.title}</div>
      ${bar(it.good, true)}${it.bads.map((b) => bar(b, false))}
      <div class="imp-loss">${it.loss < 0.15
        ? html`<span class="muted">大きな差はありません（スコアへの影響は小さめ）</span>`
        : it.key === 'gir'
          ? html`パーオンが1回増えると、約 <strong>${it.loss.toFixed(1)}打</strong> 少なくなります`
          : html`ミス1回で <strong>${sgn(it.loss, 1)}打</strong>${it.perRound != null ? html`・1ラウンドで約 <strong>${it.perRound.toFixed(1)}打</strong><span class="muted">（平均 ${it.perRoundCount.toFixed(1)}${it.unit}）</span>` : ''}`}</div>
    </div>`)}</div>
    <p class="small muted" style="margin-top:8px">（ ）はホール数。1ラウンドの損失は「ミスの回数 × 1回の差」の目安です。</p>
  </div>`;
}

// 今やるべき練習：ミスの影響が大きい項目（1 ラウンドで 0.8 打以上）から、練習のヒントを出す
const DRILLS = {
  putt3: { title: 'パッティングの距離感', drills: ['10m・15m のパットを、カップの周り 1m に止める練習（各 10 球）', '1m のパットを続けて 10 回入れる（外したら最初から）'] },
  penalty: { title: 'OB・ペナルティを減らすティーショット', drills: ['練習場で1球ごとに狙いを決め、左右 30 ヤード幅に入った数を数える', 'OB が多いホールは、ドライバーではなく曲がりにくいクラブ（UT・FW）を選ぶ練習もしておく'] },
  bunker: { title: 'バンカーから一度で出す', drills: ['ボールの 5cm 手前に入れて、砂ごと飛ばす練習', 'まずは「1回で出す」ことを目標に、グリーンの真ん中を狙う'] },
  fw: { title: 'ティーショットの方向性', drills: ['フェアウェイの幅（約 30 ヤード）を決めて、10 球中何球入るかを数える', '曲がる方向が決まっているなら、逆側を狙って打つ'] },
};
function practiceCard(items) {
  const picks = items.filter((it) => DRILLS[it.key] && it.loss >= 0.3 && (it.perRound ?? 0) >= 0.8).slice(0, 2);
  if (!picks.length) return '';
  return html`<div class="card section practice-card">
    <div class="card-header"><div><h2>🏌️ 今やるべき練習</h2><div class="sub">ミスの影響が大きいところから（くわしい練習メニューは AI分析の「練習メニュー」でも作れます）</div></div>
      <a class="btn btn-sm" href="#/ai?purpose=practice">${icon('ai')}AIに練習メニューを相談</a></div>
    ${picks.map((it) => html`<div class="pr-item"><div class="pr-head"><strong>${DRILLS[it.key].title}</strong><span class="small muted">1ラウンドで約 ${it.perRound.toFixed(1)} 打の差</span></div>
      <ul>${DRILLS[it.key].drills.map((d) => html`<li>${d}</li>`)}</ul></div>`)}
  </div>`;
}

// ティーショットのクラブ別（パー4・5）。スコア入力で「使ったクラブ」を選ぶと集計される
function teeClubCard(rows) {
  if (!rows.length) {
    return html`<div class="card section"><h2 style="margin-bottom:6px">ティーショットのクラブ別</h2>
      <p class="small muted">スコア入力（1ホールずつ）のティーショットで「使ったクラブ」を選ぶと、ドライバーとウッド・UT のどちらが良い結果になっているかを比べられます。</p></div>`;
  }
  return html`<div class="card section">
    <div class="card-header"><div><h2>ティーショットのクラブ別</h2><div class="sub">パー4・5。刻むべきかの判断に（回数が少ないうちは参考程度に）</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>クラブ</th><th class="r">回数</th><th class="r">FWキープ率</th><th class="r">OB・ペナ率</th><th class="r">平均パー比</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td><strong>${r.club}</strong></td><td class="r">${r.n}</td><td class="r">${pct(r.fwRate)}</td><td class="r">${pct(r.penaltyRate)}</td><td class="r">${sgn(r.toPar, 2)}</td></tr>`)}</tbody></table></div>
  </div>`;
}

// コース別の成績（2 コース以上のとき）。ホールあたりのパー比で、コースの難しさも比べられる
function courseTable(sums) {
  const by = new Map();
  for (const s of sums) {
    const k = s.courseId ? `c${s.courseId}` : `n${s.course}`;
    if (!by.has(k)) by.set(k, { name: s.course || '不明', courseId: s.courseId, list: [] });
    by.get(k).list.push(s);
  }
  if (by.size < 2) return '';
  const rows = [...by.values()].map((c) => {
    const a = aggregate(c.list);
    const toParPerHole = a.holes ? c.list.reduce((t, s) => t + s.toPar, 0) / a.holes : null;
    return { ...c, n: c.list.length, avg: a.avgScore, best: a.best?.strokes ?? null, putts: a.puttsPerRound, tph: toParPerHole };
  }).sort((x, y) => y.n - x.n || (x.avg ?? 999) - (y.avg ?? 999));
  return html`<div class="card section">
    <div class="card-header"><div><h2>コース別の成績</h2><div class="sub">「パー比/H」はホールあたりのパー比（小さいほど相性が良い）</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>コース</th><th class="r">回数</th><th class="r">平均</th><th class="r">ベスト</th><th class="r hide-sm">平均パット</th><th class="r">パー比/H</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr ${r.courseId ? html`class="link" data-course="${r.courseId}"` : ''}><td class="wrap">${r.name}</td><td class="r">${r.n}</td><td class="r">${fmt(r.avg, 1)}</td><td class="r">${r.best ?? '—'}</td>
        <td class="r hide-sm">${fmt(r.putts, 1)}</td><td class="r">${r.tph != null ? sgn(r.tph, 2) : '—'}</td></tr>`)}</tbody></table></div>
  </div>`;
}

// 距離別の成績（コースにホールの距離を登録しているラウンド）。パーごとに、距離の帯でパー比を比べる
function distanceCard(rows) {
  if (rows.length < 2 || rows.reduce((a, r) => a + r.n, 0) < 18) return '';
  // 同じパーの中で一番苦手な距離（5 ホール以上・平均との差が 0.3 打以上）
  let weak = null;
  for (const par of [3, 4, 5]) {
    const rs = rows.filter((r) => r.par === par && r.n >= 5);
    if (rs.length < 2) continue;
    const avg = rs.reduce((a, r) => a + r.toPar * r.n, 0) / rs.reduce((a, r) => a + r.n, 0);
    for (const r of rs) if (r.toPar - avg >= 0.3 && (!weak || r.toPar - avg > weak.gap)) weak = { ...r, gap: r.toPar - avg };
  }
  let prevPar = 0;
  return html`<div class="card section">
    <div class="card-header"><div><h2>距離別の成績</h2><div class="sub">コースに登録したホールの距離から。パー比は小さいほど良い</div></div></div>
    ${weak ? html`<p class="dist-weak">苦手な距離：<strong>パー${weak.par}の${weak.label}</strong>（平均 ${sgn(weak.toPar)}・パー${weak.par}全体の平均より約 ${weak.gap.toFixed(1)} 打多い）</p>` : ''}
    <div class="table-wrap"><table class="data"><thead><tr><th>パー</th><th>距離</th><th class="r">ホール数</th><th class="r">平均パー比</th><th class="r">パー以内</th></tr></thead>
      <tbody>${rows.map((r) => {
        const first = r.par !== prevPar;
        prevPar = r.par;
        return html`<tr class="${first ? 'par-first' : ''}"><td>${first ? `パー${r.par}` : ''}</td><td>${r.label}</td><td class="r">${r.n}</td><td class="r">${sgn(r.toPar)}</td><td class="r">${pct(r.parRate)}</td></tr>`;
      })}</tbody></table></div>
    <p class="small muted" style="margin-top:8px">ホールの距離はコースの編集で登録できます。27ホールのゴルフ場は、回った 9 ホールの距離を使います。</p>
  </div>`;
}

// 条件別のスコア（天気・季節・曜日・ティー・同伴者）。2 つ以上に分かれて比べられる条件だけボタンを出す
function drawConditions(box, list) {
  const avail = CONDITIONS.map(([k, l]) => ({ k, l, res: conditionStats(list, k) })).filter((c) => c.res.rows.length >= 2);
  if (!avail.length || avail[0].res.total < 3) { box.innerHTML = ''; return; }
  if (!avail.some((c) => c.k === state.cond)) state.cond = avail[0].k;
  const cur = avail.find((c) => c.k === state.cond);
  const note = { day: '祝日は平日として数えます。', companion: '2回以上一緒に回った人だけ。同伴者の名前は AI 分析には含めません。' }[cur.k] || '';
  mount(box, html`<div class="card section">
    <div class="card-header"><div><h2>条件別のスコア</h2><div class="sub">18ホールの平均。「差」は全体の平均 ${fmt(cur.res.overall, 1)} との比較（マイナスほど良い）</div></div></div>
    <div class="seg cond-seg" role="group" aria-label="比べる条件">${avail.map((c) => html`<button type="button" data-cond="${c.k}" class="${c.k === cur.k ? 'on' : ''}" aria-pressed="${c.k === cur.k}">${c.l}</button>`)}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${cur.l}</th><th class="r">回数</th><th class="r">平均</th><th class="r">ベスト</th><th class="r">差</th></tr></thead>
      <tbody>${cur.res.rows.map((r) => html`<tr><td class="wrap">${r.key}</td><td class="r">${r.n}</td><td class="r">${fmt(r.avg, 1)}</td><td class="r">${r.best}</td><td class="r">${sgn(r.diff, 1)}</td></tr>`)}</tbody></table></div>
    <p class="small muted" style="margin-top:8px">${note}回数が少ないうちは、偶然の差が大きく出ます。</p>
  </div>`);
  $$('[data-cond]', box).forEach((b) => b.addEventListener('click', () => { state.cond = b.dataset.cond; drawConditions(box, list); }));
}

export async function render(root) {
  const [rounds, allCourses, settings] = await Promise.all([api.get('/api/rounds'), api.get('/api/courses').catch(() => []), getSettings().catch(() => ({}))]);
  const courses = [...new Map(rounds.filter((r) => r.course_id).map((r) => [r.course_id, r.course_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ja'));

  mount(root, html`
    <div class="page-header"><div><h1>統計分析</h1><div class="sub">期間とコースで絞り込むと、下のすべての数値・グラフが連動します</div></div>
      <div class="actions"><a class="btn" href="#/review">🗓 年間のまとめ</a><a class="btn" href="#/ai">${icon('ai')}AIに分析してもらう</a></div></div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="期間">${PERIODS.map(([k, l]) => html`<button data-period="${k}" class="${state.period === k ? 'on' : ''}">${l}</button>`)}</div>
      <select id="f-course" aria-label="コース"><option value="">すべてのコース</option>
        ${courses.map(([cid, n]) => html`<option value="${cid}" ${String(cid) === state.course ? 'selected' : ''}>${n}</option>`)}</select>
    </div>
    <div id="body"></div>
  `);
  const body = $('#body', root);

  const draw = () => {
    clearCharts();
    const list = filterRounds(rounds, { period: state.period, courseId: state.course });
    if (!list.length) {
      mount(body, html`<div class="card empty">${icon('stats')}<h2>対象のラウンドがありません</h2><p>期間やコースの条件を変えるか、スコアを入力してください。</p>
        <a class="btn btn-primary" href="#/rounds/new">${icon('plus')}スコアを入力</a></div>`);
      return;
    }
    const sums = list.map(summarize);
    const impact = shotImpact(list);
    const a = aggregate(sums);
    const complete = sums.filter((s) => s.complete).sort((x, y) => x.date.localeCompare(y.date));
    const scores = complete.map((s) => s.strokes);
    const ma = movingAverage(scores, 5);
    const puttRounds = complete.filter((s) => s.puttHoles === 18);
    const rateRounds = complete.filter((s) => s.fwTotal || s.girKnown);
    const insights = trendInsights(sums);
    const top5 = [...complete].sort((x, y) => x.strokes - y.strokes).slice(0, 5);

    // 月別平均（18H）
    const byMonth = new Map();
    for (const s of complete) {
      const k = s.date.slice(0, 7);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(s.strokes);
    }
    const months = [...byMonth.entries()].sort((x, y) => x[0].localeCompare(y[0])).slice(-12)
      .map(([k, v]) => ({ k, n: v.length, avg: v.reduce((p, c) => p + c, 0) / v.length }));

    const t = (label, value, sub = '') => html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${sub}</div></div>`;
    mount(body, html`
      <div class="tiles">
        ${t('ラウンド数', a.rounds, `18ホール ${a.completeRounds} R`)}
        ${t('平均スコア', fmt(a.avgScore, 1), a.avgToPar != null ? `パー比 ${toPar(Math.round(a.avgToPar * 10) / 10)}` : '')}
        ${t('ベストスコア', a.best ? a.best.strokes : '—', a.best ? `${shortDate(a.best.date)}` : '')}
        ${t('推定ハンディキャップ', a.handicap != null ? a.handicap.toFixed(1) : '—', '簡易計算')}
        ${t('平均パット', fmt(a.puttsPerRound, 1), `1ホール ${fmt(a.puttsPerHole, 2)}`)}
        ${t('FWキープ率', pct(a.fwRate), a.fwTotal ? `${a.fwHit}/${a.fwTotal}` : '')}
        ${t('パーオン率', pct(a.girRate), a.puttsPerGir != null ? `パーオン時 ${fmt(a.puttsPerGir, 2)} パット` : '')}
        ${t('ボギーオン率', pct(a.bogeyOnRate), '規定打数-1 までにオン')}
        ${t('1パット率', pct(a.onePuttRate), 'パットを記録したホール')}
        ${t('リカバリー率', pct(a.scrambleRate), 'パーオンせずパー以上')}
        ${t('サンドセーブ率', pct(a.sandSaveRate), a.sandChances ? `バンカー ${a.sandChances} ホール` : '簡易：バンカー後パー以上')}
        ${t('3パット率', pct(a.threePuttRate, 1), `1R あたり ${fmt(a.threePuttsPerRound, 1)} 回`)}
        ${t('OB・ペナ / R', fmt(a.penaltiesPerRound, 1))}
        ${t('バーディ / R', fmt(a.birdiesPerRound, 2), `パー以上率 ${pct(a.parOrBetterRate)}`)}
      </div>

      ${chartCard('trend', 'スコアの推移', `18ホールのラウンド ${complete.length} 件・点をクリックで詳細`, 'section')}

      <div class="grid grid-2 section">
        ${chartCard('dist', 'スコア内訳', `全 ${a.holes} ホールの結果`)}
        ${chartCard('bypar', 'パー別の平均（パー比）', 'ホールあたり。小さいほど良い')}
        ${chartCard('putts', 'パット数の推移', '18ホールすべてパットを記録したラウンド')}
        ${chartCard('rates', 'FWキープ率・パーオン率の推移', 'ラウンドごと')}
        ${chartCard('fw', 'ティーショットの方向', 'パー4・パー5')}
        ${chartCard('months', '月別の平均スコア', '直近12か月分（18ホール）')}
        ${chartCard('scoredist', 'スコアの分布', '18ホールのスコアを5打ごとに')}
        ${chartCard('hctrend', '推定ハンディキャップの推移', '3ラウンド目から・小さいほど良い')}
      </div>

      ${impactCard(impact)}
      ${practiceCard(impact)}
      ${teeClubCard(teeClubStats(list))}
      ${courseTable(sums)}
      <div id="cond-box"></div>
      ${distanceCard(distanceStats(list, allCourses, settings.unit))}

      <div class="grid grid-2 section">
        <div class="card">
          <h2 style="margin-bottom:12px">前半・後半</h2>
          <div class="tiles">
            ${t('前半（OUT）平均', fmt(a.frontAvg, 1), a.frontToPar != null ? `パー比 ${toPar(Math.round(a.frontToPar * 10) / 10)}` : '')}
            ${t('後半（IN）平均', fmt(a.backAvg, 1), a.backToPar != null ? `パー比 ${toPar(Math.round(a.backToPar * 10) / 10)}` : '')}
          </div>
          <h2 style="margin:20px 0 12px">直近の傾向</h2>
          ${insights.length ? html`<ul class="insights">${insights.map((i) => html`<li><span class="ico ${i.type}">${i.type === 'good' ? '↑' : '↓'}</span><span>${i.text}</span></li>`)}</ul>`
            : html`<p class="muted small">18ホールのラウンドが6つ以上で、直近5ラウンドと以前を比較します。</p>`}
        </div>
        <div class="card">
          <h2 style="margin-bottom:8px">ベストスコア TOP5</h2>
          ${top5.length ? html`<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>日付</th><th>コース</th><th class="r">スコア</th><th class="r">パット</th></tr></thead>
            <tbody>${top5.map((s, i) => html`<tr class="link" data-id="${s.id}"><td>${i + 1}</td><td class="nowrap">${fmtDate(s.date)}</td><td class="wrap">${s.course}</td>
              <td class="r"><strong>${s.strokes}</strong></td><td class="r">${s.puttHoles ? s.putts : '—'}</td></tr>`)}</tbody></table></div>`
            : html`<p class="muted small">18ホールのラウンドがありません。</p>`}
        </div>
      </div>
    `);
    $$('tr[data-id]', body).forEach((tr) => tr.addEventListener('click', () => navigate(`/rounds/${tr.dataset.id}`)));
    $$('tr[data-course]', body).forEach((tr) => tr.addEventListener('click', () => navigate(`/courses/${tr.dataset.course}`)));
    drawConditions($('#cond-box', body), list);

    setupChart(body, 'trend', (el) => lineChart(el, {
      labels: complete.map((s) => shortDate(s.date)),
      series: [
        { name: 'スコア', color: 'var(--series-1)', values: scores },
        { name: '5ラウンド移動平均', color: 'var(--series-2)', values: ma, dots: false },
      ],
      tooltipTitle: (i) => `${fmtDate(complete[i].date)} ${complete[i].course}`,
      onClick: (i) => navigate(`/rounds/${complete[i].id}`),
      height: 260,
      ariaLabel: 'スコアの推移',
    }), {
      columns: [{ label: '日付' }, { label: 'コース' }, { label: 'スコア', align: 'r' }, { label: '5R平均', align: 'r' }],
      rows: complete.map((s, i) => [fmtDate(s.date), s.course, String(s.strokes), fmt(ma[i], 1)]),
    });

    setupChart(body, 'dist', (el) => segmentedBar(el, {
      parts: RESULT_KEYS.map((k) => ({ label: RESULT_LABELS[k], value: a.results[k], color: resultColor(k), ink: resultInk(k) })),
      format: (v) => `${v}H`,
      ariaLabel: 'スコア内訳',
    }), {
      columns: [{ label: '結果' }, { label: 'ホール数', align: 'r' }, { label: '割合', align: 'r' }],
      rows: RESULT_KEYS.map((k) => [RESULT_LABELS[k], String(a.results[k]), pct(a.holes ? a.results[k] / a.holes : null, 1)]),
    });

    setupChart(body, 'bypar', (el) => barChart(el, {
      bars: [3, 4, 5].map((p) => ({
        label: `パー${p}`,
        value: a.byPar[p].toPar,
        color: 'var(--series-1)',
        tip: [{ value: toPar(Math.round(a.byPar[p].toPar * 100) / 100), label: 'パー比 / ホール', color: 'var(--series-1)', swatch: true }, { value: fmt(a.byPar[p].avg, 2), label: '平均打数' }, { value: `${a.byPar[p].n} H`, label: 'ホール数' }],
      })),
      yFormat: (v) => (v > 0 ? '+' : '') + (Math.round(v * 100) / 100),
      height: 200,
      ariaLabel: 'パー別の平均パー比',
    }), {
      columns: [{ label: 'パー' }, { label: '平均打数', align: 'r' }, { label: 'パー比', align: 'r' }, { label: 'ホール数', align: 'r' }],
      rows: [3, 4, 5].map((p) => [`パー${p}`, fmt(a.byPar[p].avg, 2), a.byPar[p].toPar != null ? toPar(Math.round(a.byPar[p].toPar * 100) / 100) : '—', String(a.byPar[p].n)]),
    });

    setupChart(body, 'putts', (el) => lineChart(el, {
      labels: puttRounds.map((s) => shortDate(s.date)),
      series: [{ name: 'パット数', color: 'var(--series-1)', values: puttRounds.map((s) => s.putts) }],
      tooltipTitle: (i) => `${fmtDate(puttRounds[i].date)} ${puttRounds[i].course}`,
      onClick: (i) => navigate(`/rounds/${puttRounds[i].id}`),
      height: 200,
      ariaLabel: 'パット数の推移',
    }), {
      columns: [{ label: '日付' }, { label: 'パット', align: 'r' }, { label: '3パット', align: 'r' }],
      rows: puttRounds.map((s) => [fmtDate(s.date), String(s.putts), String(s.threePutts)]),
    });

    const fwVals = rateRounds.map((s) => (s.fwTotal ? (s.fwHit / s.fwTotal) * 100 : null));
    const girVals = rateRounds.map((s) => (s.girKnown ? (s.gir / s.girKnown) * 100 : null));
    setupChart(body, 'rates', (el) => lineChart(el, {
      labels: rateRounds.map((s) => shortDate(s.date)),
      series: [
        { name: 'FWキープ率', color: 'var(--series-1)', values: fwVals },
        { name: 'パーオン率', color: 'var(--series-2)', values: girVals },
      ],
      yFormat: (v) => `${Math.round(v)}%`,
      yDomain: [0, 100],
      tooltipTitle: (i) => `${fmtDate(rateRounds[i].date)} ${rateRounds[i].course}`,
      onClick: (i) => navigate(`/rounds/${rateRounds[i].id}`),
      height: 200,
      ariaLabel: 'FWキープ率とパーオン率の推移',
    }), {
      columns: [{ label: '日付' }, { label: 'FWキープ率', align: 'r' }, { label: 'パーオン率', align: 'r' }],
      rows: rateRounds.map((s, i) => [fmtDate(s.date), fwVals[i] != null ? `${Math.round(fwVals[i])}%` : '—', girVals[i] != null ? `${Math.round(girVals[i])}%` : '—']),
    });

    const fwParts = [
      { label: '左ミス', value: a.fwLeft, color: 'var(--series-2)', ink: '#fff' },
      { label: 'FWキープ', value: a.fwHit, color: 'var(--series-1)', ink: '#fff' },
      { label: '右ミス', value: a.fwRight, color: 'var(--series-3)', ink: '#fff' },
    ];
    setupChart(body, 'fw', (el) => segmentedBar(el, { parts: fwParts, format: (v) => `${v}回`, ariaLabel: 'ティーショットの方向' }), {
      columns: [{ label: '方向' }, { label: '回数', align: 'r' }, { label: '割合', align: 'r' }],
      rows: fwParts.map((p) => [p.label, String(p.value), pct(a.fwTotal ? p.value / a.fwTotal : null, 1)]),
    });

    // 平均スコアは 0 から始まる棒だと差が見えないため、折れ線で表示
    setupChart(body, 'months', (el) => lineChart(el, {
      labels: months.map((m) => `${m.k.slice(2, 4)}/${Number(m.k.slice(5))}`),
      series: [{ name: '平均スコア', color: 'var(--series-1)', values: months.map((m) => m.avg) }],
      yFormat: (v) => fmt(v, Number.isInteger(v) ? 0 : 1),
      tooltipTitle: (i) => `${months[i].k.slice(0, 4)}年${Number(months[i].k.slice(5))}月（${months[i].n} R）`,
      height: 200,
      ariaLabel: '月別の平均スコア',
    }), {
      columns: [{ label: '月' }, { label: '平均スコア', align: 'r' }, { label: 'ラウンド数', align: 'r' }],
      rows: months.map((m) => [m.k, fmt(m.avg, 1), String(m.n)]),
    });

    const dist = scoreDistribution(sums);
    const distMax = Math.max(0, ...dist.map((d) => d.count));
    setupChart(body, 'scoredist', (el) => barChart(el, {
      bars: dist.map((d) => ({ label: `${d.from}`, value: d.count, color: 'var(--series-1)', title: `${d.from}〜${d.to}`, tip: [{ value: `${d.count} 回` }] })),
      valueLabels: (b) => b.value > 0, height: 200, ariaLabel: 'スコアの分布',
      yDomain: [0, Math.max(4, distMax)], yFormat: (v) => (Number.isInteger(v) ? String(v) : ''),
    }), { columns: [{ label: 'スコア' }, { label: '回数', align: 'r' }], rows: dist.map((d) => [`${d.from}〜${d.to}`, String(d.count)]) });

    const hc = handicapTrend(sums);
    setupChart(body, 'hctrend', (el) => lineChart(el, {
      labels: hc.map((x) => shortDate(x.date)),
      series: [{ name: '推定ハンディキャップ', color: 'var(--series-3)', values: hc.map((x) => x.handicap) }],
      tooltipTitle: (i) => `${fmtDate(hc[i].date)} ${hc[i].course || ''}`,
      onClick: (i) => navigate(`/rounds/${hc[i].id}`),
      height: 200, ariaLabel: '推定ハンディキャップの推移',
    }), { columns: [{ label: '日付' }, { label: 'コース' }, { label: 'ハンディキャップ', align: 'r' }], rows: hc.map((x) => [fmtDate(x.date), x.course || '', x.handicap.toFixed(1)]) });
  };

  $$('[data-period]', root).forEach((b) => b.addEventListener('click', () => {
    state.period = b.dataset.period;
    $$('[data-period]', root).forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  $('#f-course', root).addEventListener('change', (e) => { state.course = e.target.value; draw(); });
  draw();
}
