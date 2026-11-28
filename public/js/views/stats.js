// 分析
import { html, mount, $, $$, fmt, pct, toPar, fmtDate, shortDate, icon } from '../util.js';
import { api, getSettings } from '../api.js';
import {
  summarize, aggregate, filterRounds, movingAverage, trendInsights, scoreDistribution, handicapTrend, shotImpact, teeClubStats, PERIODS,
  conditionStats, CONDITIONS, distanceStats, flowStats, flowInsights, simItems, simulate, simPlan, missCounts, stepGoal, goalPicture,
  RESULT_KEYS, RESULT_LABELS, resultColor, resultInk,
} from '../stats.js';
import { lineChart, barChart, segmentedBar, chartCard, setupChart, clearCharts } from '../charts.js';
import { navigate } from '../main.js';

const state = { period: 'all', course: '', cond: 'weather', tab: 'summary' };
// 画面をタブで分ける（期間とコースの絞り込みはどのタブにも効く）。選んだタブはアプリを開いている間は覚えておく
const STATS_TABS = [['summary', 'まとめ'], ['practice', 'ミスと|練習'], ['course', 'コース・|条件'], ['charts', 'グラフ']];

// ミスの影響：良い場合とミスの場合の「ホールあたりのパー比」を棒で並べ、ミス 1 回・1 ラウンドあたりの損失を示す
const sgn = (v, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`;
function impactCard(items) {
  if (!items.length) return '';
  const max = Math.max(0.5, ...items.flatMap((it) => [it.good.avg, ...it.bads.map((b) => b.avg)]).map((v) => Math.abs(v)));
  const bar = (g, good) => html`<div class="imp-bar ${good ? 'good' : 'bad'}"><span class="imp-label">${g.label}<span class="muted">（${g.n}）</span></span>
    <span class="imp-track"><span style="width:${Math.max(2, Math.round((Math.max(0, g.avg) / max) * 100))}%"></span></span><span class="imp-val">${sgn(g.avg)}</span></div>`;
  return html`<div class="card section" id="st-impact">
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
  return html`<div class="card section practice-card" id="st-practice">
    <div class="card-header"><div><h2>🏌️ 今やるべき練習</h2><div class="sub">ミスの影響が大きいところから（くわしい練習メニューは AI分析の「練習メニュー」でも作れます）</div></div>
      <a class="btn btn-sm" href="#/ai?purpose=practice">${icon('ai')}AIに練習メニューを相談</a></div>
    ${picks.map((it) => html`<div class="pr-item"><div class="pr-head"><strong>${DRILLS[it.key].title}</strong><span class="small muted">1ラウンドで約 ${it.perRound.toFixed(1)} 打の差</span></div>
      <ul>${DRILLS[it.key].drills.map((d) => html`<li>${d}</li>`)}</ul></div>`)}
  </div>`;
}

// ティーショットのクラブ別（パー4・5）。スコア入力で「使ったクラブ」を選ぶと集計される
function teeClubCard(rows) {
  if (!rows.length) {
    return html`<div class="card section" id="st-tee"><h2 style="margin-bottom:6px">ティーショットのクラブ別</h2>
      <p class="small muted">スコア入力（1ホールずつ）のティーショットで「使ったクラブ」を選ぶと、ドライバーとウッド・UT のどちらが良い結果になっているかを比べられます。</p></div>`;
  }
  return html`<div class="card section" id="st-tee">
    <div class="card-header"><div><h2>ティーショットのクラブ別</h2><div class="sub">パー4・5。刻むべきかの判断に（回数が少ないうちは参考程度に）</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>クラブ</th><th class="r">回数</th><th class="r">FWキープ率</th><th class="r">OB・ペナ率</th><th class="r">平均パー比</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td><strong>${r.club}</strong></td><td class="r">${r.n}</td><td class="r">${pct(r.fwRate)}</td><td class="r">${pct(r.penaltyRate)}</td><td class="r">${sgn(r.toPar, 2)}</td></tr>`)}</tbody></table></div>
  </div>`;
}

// コース別の成績（2 コース以上のとき）。ホールあたりのパー比で、コースの難しさも比べられる
// コースが多いときは、回数の多い順に COURSE_ROWS 件だけ出して、残りはボタンで開く
const COURSE_ROWS = 8;
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
  return html`<div class="card section" id="st-courses">
    <div class="card-header"><div><h2>コース別の成績</h2><div class="sub">「パー比/H」はホールあたりのパー比（小さいほど相性が良い）</div></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>コース</th><th class="r">回数</th><th class="r">平均</th><th class="r">ベスト</th><th class="r hide-sm">平均パット</th><th class="r">パー比/H</th></tr></thead>
      <tbody>${rows.map((r, i) => html`<tr ${r.courseId ? html`class="link" data-course="${r.courseId}"` : ''} ${i >= COURSE_ROWS ? html`data-more-row hidden` : ''}><td class="wrap">${r.name}</td><td class="r">${r.n}</td><td class="r">${fmt(r.avg, 1)}</td><td class="r">${r.best ?? '—'}</td>
        <td class="r hide-sm">${fmt(r.putts, 1)}</td><td class="r">${r.tph != null ? sgn(r.tph, 2) : '—'}</td></tr>`)}</tbody></table></div>
    ${rows.length > COURSE_ROWS ? html`<button type="button" class="btn btn-sm" style="margin-top:10px" data-more-courses>すべてのコースを見る（あと ${rows.length - COURSE_ROWS}）</button>` : ''}
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
  return html`<div class="card section" id="st-distance">
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

// 試算のもとにするラウンド：直近 5・10・20 ラウンド（18 ホール）か、上で絞り込んだすべて。選んだものはこの端末に覚えておく
const SIM_RANGES = [[5, '直近5R'], [10, '直近10R'], [20, '直近20R'], [0, 'すべて']];
const SIM_KEY = 'golf-sim-range';
let simRange = null; // 選んでいる範囲（初めはこの端末に覚えた値。無ければ、ホームの「直近5ラウンドの平均」とそろえて直近 5）
const savedSimRange = () => {
  if (simRange == null) { try { const v = localStorage.getItem(SIM_KEY); simRange = SIM_RANGES.some(([n]) => String(n) === v) ? Number(v) : 5; } catch { simRange = 5; } }
  return simRange;
};

// 目標に届かないとき：どれだけ足りないか、今と目標の例の比較（パー以上・ボギー・ダボ以上）、差の大きいところから縮め方のヒント
function farAdvice({ goal, base, plan, step, pic, nowLabel }) {
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const need = base - goal + 0.1;
  const can = base - plan.limit;
  const tips = [];
  if (pic) {
    const dbl = pic.now.double - pic.target.double;
    const good = pic.target.good - pic.now.good;
    if (dbl >= 1) tips.push({ size: pic.overBogey, body: html`<strong>ダボ以上を減らす</strong>：1ラウンド ${f1(pic.now.double)} 回（例は ${pic.target.double} 回）。すべてボギーで止めると約 <strong>${f1(pic.overBogey)} 打</strong>縮まります（OB・3パットで叩いた分も含む）。林やバンカーからは狙わず、まず安全に出す。グリーンに乗らなくても「寄せて2パットのボギー」で十分です` });
    if (good >= 1) tips.push({ size: good, body: html`<strong>パーを増やす</strong>：パー以上が 1ラウンド ${f1(pic.now.good)} 回（例は ${pic.target.good} 回）。パーオンを増やすか、外しても寄せて1パット（寄せワン）でパーを取る。100ヤード以内の距離感の練習が効きます` });
    tips.sort((a, b) => b.size - a.size);
  }
  return html`<div class="sim-far">
    <h3>${goal}切りに近づくには</h3>
    <p class="small">${goal}切りまで平均で約 ${f1(need)} 打。上の項目を無理のない範囲（ミスは半分まで・パーオンは +3 回まで）で動かしても約 ${f1(can)} 打なので、${step ? html`まずは <strong>${step.goal}切り</strong>を目標にしながら、` : ''}ほかのところでも縮める必要があります。</p>
    ${pic ? html`<div class="table-wrap"><table class="data sim-pic"><thead><tr><th>1ラウンドで</th><th class="r">${nowLabel}</th><th class="r">${goal}切りの例</th></tr></thead>
      <tbody><tr><td>パー以上</td><td class="r">${f1(pic.now.good)}</td><td class="r"><strong>${pic.target.good}</strong></td></tr>
        <tr><td>ボギー</td><td class="r">${f1(pic.now.bogey)}</td><td class="r"><strong>${pic.target.bogey}</strong></td></tr>
        <tr><td>ダボ以上</td><td class="r">${f1(pic.now.double)}</td><td class="r"><strong>${pic.target.double}</strong></td></tr></tbody></table></div>
      <p class="small muted">例はパー${pic.par}で ${pic.score}（+${pic.score - pic.par}）になる組み合わせのひとつです。</p>` : ''}
    ${tips.length ? html`<ul class="sim-tips">${tips.map((t) => html`<li>${t.body}</li>`)}</ul>` : ''}
    <div class="actions"><a class="btn btn-sm" href="#/ai?purpose=goal">${icon('ai')}AIに目標達成プランを相談</a></div>
  </div>`;
}

// スコアのシミュレーター：3パット・OB などの回数を動かすと、予想の平均スコアがすぐ変わる。
// 平均と今の回数は「試算のもと」のラウンドから、1 回あたりの効き目は上の「ミスの影響」と同じ（絞り込んだすべてのラウンド）から
function drawSim(box, { list, sums, impact, avg, goal }) {
  const allItems = simItems(impact);
  if (avg == null || !allItems.length) { box.innerHTML = ''; return; }
  const done = sums.map((s, i) => ({ s, r: list[i] })).filter((x) => x.s.complete); // 新しい順（filterRounds の並び）
  const ranges = SIM_RANGES.filter(([n]) => n === 0 || n < done.length);
  const saved = savedSimRange();
  const range = ranges.some(([n]) => n === saved) ? saved : 0;
  const use = range ? done.slice(0, range) : done;
  const base = range ? use.reduce((a, x) => a + x.s.strokes, 0) / use.length : avg;
  const items = range ? simItems(impact, missCounts(use.map((x) => x.r))) : allItems;
  const from = use[use.length - 1]?.s.date, to = use[0]?.s.date;
  const values = Object.fromEntries(items.map((it) => [it.key, it.current]));
  const v1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const plan = items.length ? simPlan(base, items, goal) : null;
  const far = plan && !plan.reached; // 無理のない範囲では目標に届かない → 手前の目標と、ほかに縮めるところを出す
  const step = far ? stepGoal(base, items, goal) : null;
  const pic = far ? goalPicture(use.map((x) => x.r), goal) : null;
  const nowLabel = range ? `直近${use.length}R` : '今';
  mount(box, html`<div class="card section sim-card" id="simulator">
    <div class="card-header"><div><h2>🧮 スコアのシミュレーター</h2><div class="sub">1ラウンドあたりの回数を動かすと、予想の平均スコアが変わります（あなたの記録から計算した目安）</div></div></div>
    ${ranges.length > 1 ? html`<div class="sim-range"><span class="small secondary">試算のもと</span>
      <div class="seg sim-seg" role="group" aria-label="試算のもとにするラウンド">${ranges.map(([n, l]) => html`<button type="button" data-sim-range="${n}" class="${n === range ? 'on' : ''}" aria-pressed="${n === range}">${l}</button>`)}</div></div>` : ''}
    <p class="small muted sim-note">${range
      ? html`直近 ${use.length} ラウンド（${shortDate(from)}〜${shortDate(to)}）の平均と回数で計算（「1回減らすと」の打数は、ぶれないよう表示中の全ラウンドから）`
      : html`表示中の 18 ホールのラウンド ${done.length} 件${from ? `（${shortDate(from)}〜${shortDate(to)}）` : ''}の平均と回数で計算`}</p>
    ${items.length ? '' : html`<p class="muted">この範囲では、減らせるミスの記録がありません。「すべて」を選ぶか、範囲を広げてください。</p>`}
    <div class="sim-result" aria-live="polite" ${items.length ? '' : 'hidden'}></div>
    <div class="sim-rows">${items.map((it) => html`<div class="sim-row" data-key="${it.key}">
      <div class="sim-head"><label for="sim-${it.key}"><strong>${it.label}</strong></label><span class="small muted">1回${it.dir === 'up' ? '増やす' : '減らす'}と −${it.loss.toFixed(1)}打</span></div>
      <div class="sim-ctl"><button type="button" class="btn btn-icon btn-sm" data-step="-1" aria-label="${it.label}を減らす">−</button>
        <input type="range" id="sim-${it.key}" min="${v1(it.min)}" max="${v1(it.max)}" step="0.1" value="${v1(it.current)}">
        <button type="button" class="btn btn-icon btn-sm" data-step="1" aria-label="${it.label}を増やす">＋</button>
        <span class="sim-val"></span></div>
    </div>`)}</div>
    ${items.length ? html`<div class="sim-actions">${plan ? (plan.reached
        ? html`<button type="button" class="btn btn-sm btn-primary" data-plan>${goal}切りに届く例を見る</button>`
        : step ? html`<button type="button" class="btn btn-sm btn-primary" data-step-plan>まずは ${step.goal}切りに届く例を見る</button>`
          : html`<button type="button" class="btn btn-sm btn-primary" disabled>${goal}切りは、この方法だけでは遠いです</button>`) : ''}
      <button type="button" class="btn btn-sm" data-reset>元に戻す</button></div>
    ${far ? farAdvice({ goal, base, plan, step, pic, nowLabel }) : ''}
    <p class="small muted" style="margin-top:8px">ミスどうしは重なることがある（OB のあとに3パットなど）ので、たくさん動かすと実際より良く出ます。</p>` : ''}
  </div>`);
  $$('[data-sim-range]', box).forEach((b) => b.addEventListener('click', () => {
    simRange = Number(b.dataset.simRange);
    try { localStorage.setItem(SIM_KEY, String(simRange)); } catch { /* 覚えられなくても、この画面では切り替える */ }
    drawSim(box, { list, sums, impact, avg, goal });
    $(`[data-sim-range="${simRange}"]`, box)?.focus();
  }));
  if (!items.length) return;
  const baseLabel = range ? `直近${use.length}Rの平均` : '平均';
  const update = () => {
    const r = simulate(base, items, values);
    const shown = Math.round(r.projected * 10) / 10;
    const goalLine = goal ? (shown < goal ? html`<span class="good">🎯 ${goal}切りペース</span>`
      : html`<span class="muted">${goal}切りまで あと ${Math.max(0.1, r.projected - goal + 0.1).toFixed(1)} 打</span>${step && shown < step.goal ? html`<span class="good">・${step.goal}切りペース</span>` : ''}`) : '';
    mount($('.sim-result', box), html`<div><span class="muted small">${baseLabel}</span> <strong>${base.toFixed(1)}</strong></div><div class="sim-arrow">→</div>
      <div><span class="muted small">予想</span> <strong class="sim-proj">${r.projected.toFixed(1)}</strong> <span class="${r.total < -0.05 ? 'good' : 'muted'}">（${r.total < -0.05 ? '−' : '±'}${Math.abs(r.total).toFixed(1)}）</span></div>
      <div class="sim-goal">${goalLine}</div>`);
    for (const it of items) {
      const row = $(`[data-key="${it.key}"]`, box);
      $('input', row).value = v1(values[it.key]);
      const d = r.effects[it.key];
      mount($('.sim-val', row), html`<span>${v1(values[it.key])}回</span><span class="small ${d < -0.05 ? 'good' : 'muted'}">${d < -0.05 ? `−${Math.abs(d).toFixed(1)}打` : `今 ${v1(it.current)}回`}</span>`);
    }
  };
  for (const it of items) {
    const row = $(`[data-key="${it.key}"]`, box);
    const set = (v) => { values[it.key] = Math.min(it.max, Math.max(it.min, v)); update(); };
    $('input', row).addEventListener('input', (e) => set(Number(e.target.value)));
    $$('[data-step]', row).forEach((b) => b.addEventListener('click', () => set(Math.round((values[it.key] + Number(b.dataset.step) * 0.5) * 2) / 2)));
  }
  $('[data-reset]', box).addEventListener('click', () => { for (const it of items) values[it.key] = it.current; update(); });
  $('[data-plan]', box)?.addEventListener('click', () => { Object.assign(values, plan.values); update(); });
  $('[data-step-plan]', box)?.addEventListener('click', () => { Object.assign(values, step.values); update(); });
  update();
}

// スコアの流れ：出だし・中盤・上がりのホールあたりのパー比、大叩きの後、ボギー以上の連続
function flowCard(f) {
  if (!f || f.rounds < 3) return '';
  const segs = [['出だし', '1〜3番', f.start], ['中盤', '4〜15番', f.middle], ['上がり', '16〜18番', f.finish]];
  const worst = Math.max(...segs.map((s) => s[2]));
  const ins = flowInsights(f);
  const bigDiff = f.afterBig.avg != null && f.afterOther.avg != null ? f.afterBig.avg - f.afterOther.avg : null;
  return html`<div class="card section" id="st-flow">
    <div class="card-header"><div><h2>スコアの流れ</h2><div class="sub">18ホールのラウンド ${f.rounds} 件。1番から順に回ったものとして計算（ホールあたりのパー比）</div></div></div>
    <div class="flow-segs">${segs.map(([l, sub, v]) => html`<div class="flow-seg ${v === worst && v - f.all >= 0.25 ? 'worst' : ''}"><div class="label">${l}<span class="muted">${sub}</span></div><div class="value">${sgn(v)}</div></div>`)}</div>
    <div class="flow-rows">
      ${f.afterBig.n ? html`<div class="fr"><div>大叩き（ダボ以上）の次のホール<div class="small muted">普段 ${sgn(f.afterOther.avg)}${bigDiff != null ? `（差 ${sgn(bigDiff)}）` : ''}</div></div><strong>${sgn(f.afterBig.avg)}</strong></div>
        <div class="fr"><div>大叩きの次をボギー以内で立て直した率<div class="small muted">普段 ${pct(f.afterOther.recover)}・大叩き ${f.afterBig.n} 回</div></div><strong>${pct(f.afterBig.recover)}</strong></div>` : ''}
      <div class="fr"><div>ボギー以上の連続（1ラウンドの最長）<div class="small muted">いちばん長いとき ${f.longestMax} ホール</div></div><strong>平均 ${fmt(f.longestAvg, 1)}</strong></div>
    </div>
    ${ins.length ? html`<ul class="insights" style="margin-top:10px">${ins.map((i) => html`<li><span class="ico ${i.type}">${i.type === 'good' ? '✓' : '!'}</span><span>${i.text}</span></li>`)}</ul>` : ''}
  </div>`;
}

// 条件別のスコア（天気・季節・曜日・ティー・同伴者）。2 つ以上に分かれて比べられる条件だけボタンを出す
function drawConditions(box, list) {
  const avail = CONDITIONS.map(([k, l]) => ({ k, l, res: conditionStats(list, k) })).filter((c) => c.res.rows.length >= 2);
  if (!avail.length || avail[0].res.total < 3) { box.innerHTML = ''; return; }
  if (!avail.some((c) => c.k === state.cond)) state.cond = avail[0].k;
  const cur = avail.find((c) => c.k === state.cond);
  const note = { day: '祝日は平日として数えます。', companion: '2回以上一緒に回った人だけ。同伴者の名前は AI 分析には含めません。' }[cur.k] || '';
  mount(box, html`<div class="card section" id="st-cond">
    <div class="card-header"><div><h2>条件別のスコア</h2><div class="sub">18ホールの平均。「差」は全体の平均 ${fmt(cur.res.overall, 1)} との比較（マイナスほど良い）</div></div></div>
    <div class="seg cond-seg" role="group" aria-label="比べる条件">${avail.map((c) => html`<button type="button" data-cond="${c.k}" class="${c.k === cur.k ? 'on' : ''}" aria-pressed="${c.k === cur.k}">${c.l}</button>`)}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${cur.l}</th><th class="r">回数</th><th class="r">平均</th><th class="r">ベスト</th><th class="r">差</th></tr></thead>
      <tbody>${cur.res.rows.map((r) => html`<tr><td class="wrap">${r.key}</td><td class="r">${r.n}</td><td class="r">${fmt(r.avg, 1)}</td><td class="r">${r.best}</td><td class="r">${sgn(r.diff, 1)}</td></tr>`)}</tbody></table></div>
    <p class="small muted" style="margin-top:8px">${note}回数が少ないうちは、偶然の差が大きく出ます。</p>
  </div>`);
  $$('[data-cond]', box).forEach((b) => b.addEventListener('click', () => { state.cond = b.dataset.cond; drawConditions(box, list); }));
}

export async function render(root) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const want = query.get('sim') === '1' ? 'practice' : query.get('tab');
  if (STATS_TABS.some(([k]) => k === want)) state.tab = want;
  const [rounds, allCourses, settings] = await Promise.all([api.get('/api/rounds'), api.get('/api/courses').catch(() => []), getSettings().catch(() => ({}))]);
  const courses = [...new Map(rounds.filter((r) => r.course_id).map((r) => [r.course_id, r.course_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ja'));

  mount(root, html`
    <div class="page-header"><div><h1>分析</h1><div class="sub">期間とコースで絞り込むと、どのタブの数値・グラフも連動します</div></div></div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="期間">${PERIODS.map(([k, l]) => html`<button data-period="${k}" class="${state.period === k ? 'on' : ''}">${l}</button>`)}</div>
      <select id="f-course" aria-label="コース"><option value="">すべてのコース</option>
        ${courses.map(([cid, n]) => html`<option value="${cid}" ${String(cid) === state.course ? 'selected' : ''}>${n}</option>`)}</select>
    </div>
    <div class="stats-tabs" role="tablist" aria-label="分析の内容">${STATS_TABS.map(([k, l]) => html`<button type="button" role="tab" id="st-tab-${k}" data-tab="${k}" aria-controls="body" aria-selected="${k === state.tab}" tabindex="${k === state.tab ? '0' : '-1'}">${l.split('|').map((p) => html`<span class="nb">${p}</span>`)}</button>`)}</div>
    <div id="body" class="stats-body" role="tabpanel" aria-labelledby="st-tab-${state.tab}"></div>
  `);
  const body = $('#body', root);
  const tabs = $('.stats-tabs', root);

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
    const halves = html`<div class="card section" id="st-halves">
      <h2 style="margin-bottom:12px">前半・後半</h2>
      <div class="tiles">
        ${t('前半（OUT）平均', fmt(a.frontAvg, 1), a.frontToPar != null ? `パー比 ${toPar(Math.round(a.frontToPar * 10) / 10)}` : '')}
        ${t('後半（IN）平均', fmt(a.backAvg, 1), a.backToPar != null ? `パー比 ${toPar(Math.round(a.backToPar * 10) / 10)}` : '')}
      </div></div>`;
    const views = {
      summary: () => html`
        <div class="tiles">
          ${t('ラウンド数', a.rounds, `18ホール ${a.completeRounds} R`)}
          ${t('平均スコア', fmt(a.avgScore, 1), a.avgToPar != null ? `パー比 ${toPar(Math.round(a.avgToPar * 10) / 10)}` : '')}
          ${t('ベストスコア', a.best ? a.best.strokes : '—', a.best ? `${shortDate(a.best.date)}` : '')}
          ${t('推定ハンディキャップ', a.handicap != null ? a.handicap.toFixed(1) : '—', '簡易計算')}
          ${t('平均パット', fmt(a.puttsPerRound, 1), `1ホール ${fmt(a.puttsPerHole, 2)}`)}
          ${t('パーオン率', pct(a.girRate), a.puttsPerGir != null ? `パーオン時 ${fmt(a.puttsPerGir, 2)} パット` : '')}
        </div>
        <details class="more-fields more-tiles" id="st-all-tiles"><summary>すべての数字を見る<span class="small muted">FWキープ率・3パット率・OB など、あと 8 つ</span></summary>
          <div class="tiles">
            ${t('FWキープ率', pct(a.fwRate), a.fwTotal ? `${a.fwHit}/${a.fwTotal}` : '')}
            ${t('3パット率', pct(a.threePuttRate, 1), `1R あたり ${fmt(a.threePuttsPerRound, 1)} 回`)}
            ${t('OB・ペナ / R', fmt(a.penaltiesPerRound, 1))}
            ${t('ボギーオン率', pct(a.bogeyOnRate), '規定打数-1 までにオン')}
            ${t('1パット率', pct(a.onePuttRate), 'パットを記録したホール')}
            ${t('リカバリー率', pct(a.scrambleRate), 'パーオンせずパー以上')}
            ${t('サンドセーブ率', pct(a.sandSaveRate), a.sandChances ? `バンカー ${a.sandChances} ホール` : '簡易：バンカー後パー以上')}
            ${t('バーディ / R', fmt(a.birdiesPerRound, 2), `パー以上率 ${pct(a.parOrBetterRate)}`)}
          </div>
        </details>
        ${chartCard('trend', 'スコアの推移', `18ホールのラウンド ${complete.length} 件・点をタップで詳細`, 'section')}
        <div class="grid grid-2 section">
          <div class="card" id="st-insights">
            <h2 style="margin-bottom:12px">直近の傾向</h2>
            ${insights.length ? html`<ul class="insights">${insights.map((i) => html`<li><span class="ico ${i.type}">${i.type === 'good' ? '↑' : '↓'}</span><span>${i.text}</span></li>`)}</ul>`
              : html`<p class="muted small">18ホールのラウンドが6つ以上で、直近5ラウンドと以前を比較します。</p>`}
          </div>
          <div class="card" id="st-top5">
            <h2 style="margin-bottom:8px">ベストスコア TOP5</h2>
            ${top5.length ? html`<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>日付</th><th>コース</th><th class="r">スコア</th><th class="r">パット</th></tr></thead>
              <tbody>${top5.map((s, i) => html`<tr class="link" data-id="${s.id}"><td>${i + 1}</td><td class="nowrap">${fmtDate(s.date)}</td><td class="wrap">${s.course}</td>
                <td class="r"><strong>${s.strokes}</strong></td><td class="r">${s.puttHoles ? s.putts : '—'}</td></tr>`)}</tbody></table></div>`
              : html`<p class="muted small">18ホールのラウンドがありません。</p>`}
          </div>
        </div>
        <div class="card section">
          <h2 style="margin-bottom:10px">ほかの振り返り</h2>
          <div class="actions"><a class="btn" href="#/progress">${icon('trend')}上達の履歴</a><a class="btn" href="#/review">${icon('calendar')}年間のまとめ</a><a class="btn" href="#/ai">${icon('ai')}AI分析</a></div>
        </div>`,
      practice: () => (impact.length ? html`${impactCard(impact)}${practiceCard(impact)}<div id="sim-box"></div>`
        : html`<div class="card empty">${icon('stats')}<h2>まだ計算できません</h2><p>パット・ティーショット（FW）・OB・バンカーを記録したラウンドが増えると、ミスで何打損しているか、今やるべき練習、スコアのシミュレーターが表示されます。</p></div>`),
      course: () => html`
        ${courseTable(sums)}
        <div id="cond-box"></div>
        ${distanceCard(distanceStats(list, allCourses, settings.unit))}
        ${teeClubCard(teeClubStats(list))}
        ${flowCard(flowStats(list))}
        ${halves}`,
      charts: () => html`<div class="grid grid-2">
        ${chartCard('dist', 'スコア内訳', `全 ${a.holes} ホールの結果`)}
        ${chartCard('bypar', 'パー別の平均（パー比）', 'ホールあたり。小さいほど良い')}
        ${chartCard('putts', 'パット数の推移', '18ホールすべてパットを記録したラウンド')}
        ${chartCard('rates', 'FWキープ率・パーオン率の推移', 'ラウンドごと')}
        ${chartCard('fw', 'ティーショットの方向', 'パー4・パー5')}
        ${chartCard('months', '月別の平均スコア', '直近12か月分（18ホール）')}
        ${chartCard('scoredist', 'スコアの分布', '18ホールのスコアを5打ごとに')}
        ${chartCard('hctrend', '推定ハンディキャップの推移', '3ラウンド目から・小さいほど良い')}
      </div>`,
    };
    mount(body, views[state.tab]());
    $$('tr[data-id]', body).forEach((tr) => tr.addEventListener('click', () => navigate(`/rounds/${tr.dataset.id}`)));
    $$('tr[data-course]', body).forEach((tr) => tr.addEventListener('click', () => navigate(`/courses/${tr.dataset.course}`)));
    $('[data-more-courses]', body)?.addEventListener('click', (e) => { $$('[data-more-row]', body).forEach((tr) => { tr.hidden = false; }); e.currentTarget.hidden = true; });
    if ($('#cond-box', body)) drawConditions($('#cond-box', body), list);
    if ($('#sim-box', body)) drawSim($('#sim-box', body), { list, sums, impact, avg: a.avgScore, goal: Number(settings.goal) || null });

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
  const setTab = (k, focus = false) => {
    state.tab = k;
    for (const b of $$('[data-tab]', tabs)) {
      const on = b.dataset.tab === k;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    body.setAttribute('aria-labelledby', `st-tab-${k}`);
    if (location.hash.includes('?')) history.replaceState(null, '', '#/stats'); // 戻ってきたときに、もとのタブ（試算など）に引き戻されないように
    draw();
    // 下までスクロールしていたら、タブのすぐ下（新しいタブの先頭）へ
    const top = body.getBoundingClientRect().top + window.scrollY - tabs.offsetHeight - 24;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b && b.dataset.tab !== state.tab) setTab(b.dataset.tab); });
  tabs.addEventListener('keydown', (e) => {
    const keys = STATS_TABS.map(([k]) => k);
    const i = keys.indexOf(state.tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: keys.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    setTab(keys[(next + keys.length) % keys.length], true);
  });
  draw();
  // ホームの目標カードの「試算」から来たときはシミュレーターへ
  if (/[?&]sim=1/.test(location.hash)) requestAnimationFrame(() => $("#simulator", root)?.scrollIntoView({ block: "start" }));
}
