// 飛距離 › 練習データ（弾道測定器）：スイングキャディの CSV の取り込みと、クラブごとの分析
import { html, mount, $, $$, fmt, fmtDate, shortDate, icon, openModal, confirmDialog, toast, errorToast } from '../util.js';
import { api } from '../api.js';
import { decodeText, parseLaunchCsv, guessClub } from '../shared/launchData.js';
import { practiceStats, hasLaunch, PRACTICE_METRICS, MISHIT_RATIO, STRAIGHT_DEG } from '../practice.js';
import { lineChart, barChart, segmentedBar, setupChart } from '../charts.js';

const view = { eq: 'all', metric: 'carry' }; // アプリを開いている間は覚えておく
const CSV_LIMIT = 20 * 1024 * 1024;

// ---------- 取り込み ----------
export function openShotImport({ clubs, unit, onDone }) {
  const opts = (sel) => html`${clubs.map((c) => html`<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.name}${c.in_bag ? '' : '（保管中）'}</option>`)}`;
  const m = openModal({
    title: '練習データを取り込む（スイングキャディ）',
    body: html`<p class="small secondary">スイングキャディのアプリで書き出した練習データの CSV ファイルを選んでください。ファイルにクラブの名前がないときは、どのクラブのデータかを選びます。</p>
      <label class="btn" style="margin-top:12px">${icon('upload')}CSV ファイルを選ぶ<input type="file" accept=".csv,text/csv,text/plain" id="shot-file" hidden></label>
      <div id="shot-preview" style="margin-top:12px"></div>
      <p class="small muted" style="margin-top:12px">同じファイル（や、あとで書き出した新しいファイル）を取り込み直しても、すでに取り込んだ球は二重に入りません。データはこのアプリの中だけに保存され、外部には送信されません。</p>`,
    footer: html`<button class="btn" data-cancel>キャンセル</button><button class="btn btn-primary" data-import disabled>取り込む</button>`,
  });
  const preview = $('#shot-preview', m.el);
  const go = $('[data-import]', m.el);
  let groups = [];
  $('[data-cancel]', m.el).addEventListener('click', () => m.close());
  $('#shot-file', m.el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    go.disabled = true;
    groups = [];
    if (!file) return;
    try {
      if (file.size > CSV_LIMIT) throw new Error('ファイルが大きすぎます（20MB まで）');
      const parsed = parseLaunchCsv(decodeText(new Uint8Array(await file.arrayBuffer())), { unit });
      // クラブの列があればクラブごとに分ける。なければファイル名から推測したクラブ（選び直せる）
      const byClub = new Map();
      for (const s of parsed.shots) { const k = s.club || ''; if (!byClub.has(k)) byClub.set(k, []); byClub.get(k).push(s); }
      groups = [...byClub.entries()].map(([name, shots]) => ({ name, shots, guess: guessClub(name || file.name, clubs) }));
      const on = parsed.shots.filter((s) => s.equalizer === 1).length;
      const off = parsed.shots.filter((s) => s.equalizer === 0).length;
      mount(preview, html`<div class="notice" style="margin:0"><span>📄 ${file.name}：<strong>${parsed.shots.length.toLocaleString()} 球</strong>（${fmtDate(parsed.from, { weekday: false })}〜${fmtDate(parsed.to, { weekday: false })}）
        ${on || off ? html`<br><span class="small">イコライザー ON ${on.toLocaleString()} 球・OFF ${off.toLocaleString()} 球</span>` : ''}
        ${parsed.skipped ? html`<br><span class="small muted">読めなかった行 ${parsed.skipped} 行は飛ばします</span>` : ''}</span></div>
        ${groups.map((g, i) => html`<label class="field" style="margin-top:10px"><span>${g.name ? `「${g.name}」（${g.shots.length.toLocaleString()} 球）のクラブ` : 'どのクラブのデータですか？'}</span>
          <select data-group="${i}"><option value="">選んでください</option>${opts(g.guess?.id)}</select></label>`)}
        <label class="field" style="margin-top:10px"><span>場所</span><select id="shot-place"><option value="range">練習場</option><option value="simulator">シミュレーター</option></select></label>`);
      const check = () => { go.disabled = !$$('[data-group]', preview).every((s) => s.value); };
      $$('[data-group]', preview).forEach((s) => s.addEventListener('change', check));
      check();
    } catch (err) {
      mount(preview, html`<div class="notice" style="margin:0;border-color:var(--danger)">⚠ ${err.message}</div>`);
    }
  });
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = '取り込み中…';
    const place = $('#shot-place', preview)?.value || 'range';
    let inserted = 0;
    let duplicates = 0;
    let lastClub = null;
    try {
      for (const [i, g] of groups.entries()) {
        const clubId = Number($(`[data-group="${i}"]`, preview).value);
        const shots = g.shots.map(({ club, ...s }) => s);
        const res = await api.post('/api/distances/import', { club_id: clubId, shots, source: 'swingcaddie', place });
        inserted += res.inserted;
        duplicates += res.duplicates;
        lastClub = clubId;
      }
      m.close();
      toast(`${inserted.toLocaleString()} 球を取り込みました${duplicates ? `（すでにある ${duplicates.toLocaleString()} 球は飛ばしました）` : ''}`);
      onDone(lastClub);
    } catch (err) {
      errorToast(err);
      go.disabled = false;
      go.textContent = '取り込む';
    }
  });
}

// ---------- クラブを選んでいないとき：練習データのあるクラブの一覧 ----------
export function practiceListHtml(list, clubs) {
  const counts = new Map();
  for (const r of list) if (hasLaunch(r)) counts.set(r.club_id, (counts.get(r.club_id) || 0) + 1);
  if (!counts.size) return '';
  const order = clubs.map((c) => c.id);
  return html`<div class="card section"><div class="card-header"><div><h2>練習データの分析</h2><div class="sub">弾道測定器から取り込んだ球があるクラブ。選ぶと、スイングスピード・ミート率・打ち出し角・スピンなどを詳しく分析します</div></div></div>
    <div class="chips">${[...counts.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([cid, n]) => html`<button type="button" class="chip" data-practice-club="${cid}">${clubs.find((c) => c.id === cid)?.name}<span class="small muted" style="margin-left:6px">${n.toLocaleString()}球</span></button>`)}</div></div>`;
}

// ---------- 1 本のクラブの分析 ----------
// shots: そのクラブの記録（期間・場所で絞り込んだあと）。redraw：表示の切り替えで画面を描き直す
export function renderPractice(el, { club, shots: all, unit, redraw, onDeleted }) {
  const launch = all.filter(hasLaunch);
  if (!launch.length) { mount(el, ''); return; }
  const both = launch.some((r) => r.equalizer === 1) && launch.some((r) => r.equalizer === 0);
  if (!both) view.eq = 'all';
  const shots = view.eq === 'on' ? launch.filter((r) => r.equalizer === 1) : view.eq === 'off' ? launch.filter((r) => r.equalizer === 0) : launch;
  const st = practiceStats(shots, { unit });
  const u = unit;
  const a = st.avg;
  const f1 = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
  const r0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString());
  const tile = (label, value, sub = '') => html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${sub}</div></div>`;
  const dates = shots.map((r) => r.date).sort();
  const metric = PRACTICE_METRICS.find((x) => x[0] === view.metric) || PRACTICE_METRICS[0];
  const sideText = a.side == null ? '—' : `${a.side > 0 ? '右' : a.side < 0 ? '左' : ''} ${Math.abs(a.side).toFixed(1)}°`;
  const imported = all.filter((r) => r.source).length;
  mount(el, html`
    <div class="card section" id="practice-card">
      <div class="card-header"><div><h2>練習データの分析（${club.name}）</h2>
        <div class="sub">${shots.length.toLocaleString()} 球・${dates.length ? `${fmtDate(dates[0], { weekday: false })}〜${fmtDate(dates[dates.length - 1], { weekday: false })}` : ''}・${st.days.length} 日</div></div>
        ${both ? html`<div class="seg" role="group" aria-label="イコライザー">${[['all', 'すべて'], ['on', 'EQ ON'], ['off', 'EQ OFF']].map(([k, l]) => html`<button type="button" data-eq="${k}" class="${view.eq === k ? 'on' : ''}">${l}</button>`)}</div>` : ''}
      </div>
      ${shots.length ? html`<div class="tiles">
        ${tile('平均キャリー', `${r0(a.carry)}${a.carry == null ? '' : u}`, st.spread.carry != null ? `ばらつき ±${f1(st.spread.carry)}` : '')}
        ${tile('平均トータル', `${r0(a.total)}${a.total == null ? '' : u}`)}
        ${tile('スイングスピード', f1(a.club_speed), 'm/s')}
        ${tile('ボールスピード', f1(a.ball_speed), 'm/s')}
        ${tile('ミート率', f1(a.smash, 2), 'ボール ÷ スイング')}
        ${tile('打ち出し角', a.launch == null ? '—' : `${f1(a.launch)}°`)}
        ${tile('スピン', r0(a.spin), 'rpm')}
        ${tile('最高到達点', f1(a.apex), 'm')}
        ${tile('左右角（平均）', sideText, st.spread.side != null ? `ばらつき ±${f1(st.spread.side)}°` : '')}
      </div>
      <p class="small muted" style="margin-top:10px">平均は、ミスショット（キャリーが中央値の ${Math.round(MISHIT_RATIO * 100)}% 未満）${st.mishits} 球を除いて計算しています。スピン・最高到達点は、打ち出し角を測れた球だけの平均です。${both || st.eq.on ? 'イコライザー ON の球は、スイングキャディのアプリで設定した補正が入った値です。' : ''}</p>` : html`<p class="muted">この条件の球はありません。</p>`}
    </div>
    ${shots.length ? html`
    <div class="grid grid-2 section">
      <div class="card"><h2 style="margin-bottom:10px">わかったこと</h2>
        ${st.insights.length ? html`<ul class="insights">${st.insights.map((it) => html`<li><span class="ico ${it.type}">${it.type === 'good' ? '✓' : it.type === 'bad' ? '!' : 'i'}</span><span>${it.text}</span></li>`)}</ul>`
          : html`<p class="muted small">球が増えると（30 球くらいから）、飛ぶ条件や傾向をお知らせします。</p>`}
        <p class="small muted" style="margin-top:10px">自分のデータの中での傾向です。「AI分析」の「クラブ・飛距離」にも、この練習データのまとめが入ります。</p>
      </div>
      <div class="card" data-chart="pr-dir"><div class="card-header"><div><h2>左右の傾向</h2><div class="sub">左右角 ±${STRAIGHT_DEG}° 以内を「まっすぐ」（マイナスを左として表示）</div></div>
        <button class="btn btn-sm btn-ghost viz-toggle" type="button" aria-pressed="false">表で見る</button></div>
        <div class="chart"></div><div class="chart-table" hidden></div></div>
    </div>
    <div class="card section" data-chart="pr-trend">
      <div class="card-header"><div><h2>練習日ごとの推移</h2><div class="sub">ミスショットを除いた、その日の平均（3 球以上の日）</div></div>
        <button class="btn btn-sm btn-ghost viz-toggle" type="button" aria-pressed="false">表で見る</button></div>
      <select id="pr-metric" aria-label="グラフの項目" style="margin-bottom:8px">${PRACTICE_METRICS.map(([k, l]) => html`<option value="${k}" ${k === metric[0] ? 'selected' : ''}>${l}</option>`)}</select>
      <div class="chart"></div><div class="chart-table" hidden></div>
    </div>
    <div class="card section" data-chart="pr-hist"><div class="card-header"><div><h2>キャリーの分布</h2><div class="sub">5${u} ごとの球数（ミスショットを除く）</div></div>
      <button class="btn btn-sm btn-ghost viz-toggle" type="button" aria-pressed="false">表で見る</button></div>
      <div class="chart"></div><div class="chart-table" hidden></div></div>` : ''}
    ${imported ? html`<div class="danger-zone"><button type="button" class="btn btn-sm btn-danger" data-del-shots>${icon('trash')}${club.name} の取り込んだ練習データを削除（${imported.toLocaleString()} 球）</button></div>` : ''}
  `);

  $$('[data-eq]', el).forEach((b) => b.addEventListener('click', () => { view.eq = b.dataset.eq; redraw(); }));
  $('#pr-metric', el)?.addEventListener('change', (e) => { view.metric = e.target.value; redraw(); });
  $('[data-del-shots]', el)?.addEventListener('click', async () => {
    if (!(await confirmDialog(`${club.name} の、取り込んだ練習データ ${imported.toLocaleString()} 球を削除しますか？\n手で記録した飛距離は残ります。CSV をもう一度取り込めば元に戻せます。`, { danger: true, okText: '削除する' }))) return;
    try {
      const res = await api.del(`/api/distances/import?club_id=${club.id}`);
      toast(`${res.deleted.toLocaleString()} 球を削除しました`);
      onDeleted();
    } catch (e) { errorToast(e); }
  });
  if (!shots.length) return;

  const dirParts = [
    { label: '左', value: st.dir.left, color: 'var(--series-2)', ink: '#fff' },
    { label: 'まっすぐ', value: st.dir.straight, color: 'var(--series-1)', ink: '#fff' },
    { label: '右', value: st.dir.right, color: 'var(--series-3)', ink: '#fff' },
  ];
  setupChart(el, 'pr-dir', (c) => segmentedBar(c, { parts: dirParts, format: (v) => `${v}球`, ariaLabel: '左右の傾向' }), {
    columns: [{ label: '方向' }, { label: '球数', align: 'r' }, { label: '割合', align: 'r' }],
    rows: dirParts.map((p) => [p.label, String(p.value), st.dir.n ? `${Math.round((p.value / st.dir.n) * 100)}%` : '—']),
  });
  const [mk, ml, mf] = metric;
  const days = st.days.filter((d) => d[mk] != null);
  setupChart(el, 'pr-trend', (c) => lineChart(c, {
    labels: days.map((d) => shortDate(d.date)),
    series: [{ name: ml, color: 'var(--series-1)', values: days.map((d) => d[mk]) }],
    yFormat: (v) => (mk === 'smash' ? v.toFixed(2) : mk === 'spin' ? Math.round(v).toLocaleString() : fmt(v, mk === 'carry' || mk === 'total' ? 0 : 1)),
    tooltipTitle: (i) => `${fmtDate(days[i].date)}（${days[i].n} 球）`,
    height: 220,
    ariaLabel: `${ml}の推移`,
  }), {
    columns: [{ label: '日付' }, { label: ml, align: 'r' }, { label: '球数', align: 'r' }],
    rows: [...days].reverse().map((d) => [fmtDate(d.date), mf(d[mk], u), String(d.n)]),
  });
  setupChart(el, 'pr-hist', (c) => barChart(c, {
    bars: st.hist.map((h) => ({ label: String(h.from), value: h.n, title: `${h.from}〜${h.to}${u}`, tip: [{ value: `${h.n} 球`, color: 'var(--series-1)', swatch: true }] })),
    valueLabels: false,
    ariaLabel: 'キャリーの分布',
  }), {
    columns: [{ label: `キャリー（${u}）` }, { label: '球数', align: 'r' }],
    rows: st.hist.map((h) => [`${h.from}〜${h.to}`, String(h.n)]),
  });
}
