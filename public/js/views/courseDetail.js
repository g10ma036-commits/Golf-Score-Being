// コース詳細：ホール別の得意・苦手分析
import { html, mount, $, $$, fmt, pct, toPar, fmtDate, shortDate, icon, confirmDialog, toast, errorToast } from '../util.js';
import { api, getSettings } from '../api.js';
import { summarize, holeAnalysis, onCourseHoles, goalPlan, planLabel } from '../stats.js';
import { lineChart, barChart, chartCard, setupChart } from '../charts.js';
import { openCourseEditor, ninesOf, holeName, nineTotals } from './courses.js';
import { navigate } from '../main.js';

export async function render(root, [idStr]) {
  const id = Number(idStr);
  const [course, allRounds, settings] = await Promise.all([api.get(`/api/courses/${id}`), api.get('/api/rounds'), getSettings().catch(() => ({}))]);
  const rounds = allRounds.filter((r) => r.course_id === id);
  const sums = rounds.map(summarize);
  const complete = sums.filter((s) => s.complete).sort((a, b) => a.date.localeCompare(b.date));
  // ホールはコースの通し番号で集計（27 ホールのゴルフ場は、どの組み合わせで回っても同じホールにまとめる）
  const names = ninesOf(course);
  const multi = names.length > 2;
  const holes = holeAnalysis(rounds.map(onCourseHoles), names.length * 9);
  const par = course.holes.reduce((a, h) => a + h.par, 0);
  const label = (no) => holeName(names, no);
  const shortLabel = (no) => (multi ? `${names[Math.floor((no - 1) / 9)].slice(0, 1)}${((no - 1) % 9) + 1}` : String(no));
  const best = complete.length ? Math.min(...complete.map((s) => s.strokes)) : null;
  const avg = complete.length ? complete.reduce((a, s) => a + s.strokes, 0) / complete.length : null;
  const played = holes.filter((h) => h.n);
  const sorted = [...played].sort((a, b) => b.toPar - a.toPar);
  const hardest = sorted.slice(0, 3);
  const easiest = sorted.slice(-3).reverse();
  // 目標スコアの配分（18 ホールのコースで、目標を設定しているとき）
  const goal = Number(settings.goal) || null;
  const plan = goal && names.length === 2 ? goalPlan(course.holes, goal, (no) => {
    const st = holes[no - 1];
    if (st?.n >= 2) return 100 + st.toPar;
    const hd = course.holes.find((x) => x.hole_no === no)?.hdcp;
    return hd ? 50 - hd : 0;
  }) : null;

  mount(root, html`
    <div class="page-header">
      <div><a class="small" href="#/courses">← コース一覧</a><h1>${course.name}</h1><div class="sub">${course.location || ''}</div></div>
      <div class="actions act-grid">
        <a class="btn" href="#/rounds/new?course=${id}">${icon('plus')}スコア入力</a>
        <a class="btn" href="#/ai?purpose=course&amp;course=${id}">${icon('ai')}AIに作戦を聞く</a>
        <button class="btn" id="edit">${icon('edit')}編集</button>
      </div>
    </div>
    <div class="tiles">
      ${multi
        ? html`<div class="tile"><div class="label">${names.length * 9}ホール</div><div class="value" style="font-size:16px;line-height:1.4">${nineTotals(course).map((n) => `${n.name} ${n.par}`).join('・')}</div><div class="delta">レート ${course.rating ?? '—'} / スロープ ${course.slope ?? '—'}</div></div>`
        : html`<div class="tile"><div class="label">パー</div><div class="value">${par || '—'}</div><div class="delta">レート ${course.rating ?? '—'} / スロープ ${course.slope ?? '—'}</div></div>`}
      <div class="tile"><div class="label">ラウンド数</div><div class="value">${rounds.length}</div></div>
      <div class="tile"><div class="label">ベストスコア</div><div class="value">${best ?? '—'}</div></div>
      <div class="tile"><div class="label">平均スコア</div><div class="value">${fmt(avg, 1)}</div></div>
    </div>
    ${course.memo ? html`<div class="card section"><p style="white-space:pre-wrap;margin:0">${course.memo}</p></div>` : ''}

    ${played.length ? html`
      <div class="grid grid-3 section">
        ${chartCard('holes', 'ホール別 平均パー比', '0より上＝パーより多く叩いている（赤）', 'span-2')}
        <div class="card">
          <h2>苦手ホール</h2>
          <ul class="insights" style="margin:10px 0 16px">${hardest.map((h) => html`<li><span class="ico bad">${multi ? ((h.hole_no - 1) % 9) + 1 : h.hole_no}</span><span>${label(h.hole_no)}番 Par${h.par}：平均 ${fmt(h.avg, 2)}（${toPar(h.toPar)}）</span></li>`)}</ul>
          <h2>得意ホール</h2>
          <ul class="insights" style="margin-top:10px">${easiest.map((h) => html`<li><span class="ico good">${multi ? ((h.hole_no - 1) % 9) + 1 : h.hole_no}</span><span>${label(h.hole_no)}番 Par${h.par}：平均 ${fmt(h.avg, 2)}（${toPar(h.toPar)}）</span></li>`)}</ul>
        </div>
      </div>
      <div class="card section">
        <div class="card-header"><div><h2>ホール別データ</h2>${plan ? html`<div class="sub">「目標」は ${goal}切りのための打数の配分（過去に崩しやすいホール・HDCP の小さいホールに多めに配分）</div>` : ""}</div></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>ホール</th><th class="r">パー</th><th class="r">ヤード</th><th class="r">HDCP</th>${plan ? html`<th class="r" title="${goal}切りのための目標打数">目標</th>` : ''}<th class="r">平均</th><th class="r">パー比</th><th class="r">ベスト</th><th class="r">平均パット</th><th class="r">パー以上率</th><th class="r">回数</th></tr></thead>
          <tbody>${holes.map((h) => {
            const ch = course.holes.find((x) => x.hole_no === h.hole_no) || {};
            return html`<tr><td>${label(h.hole_no)}</td><td class="r">${ch.par ?? h.par ?? '—'}</td><td class="r">${ch.yards ?? '—'}</td><td class="r">${ch.hdcp ?? '—'}</td>
              ${plan ? html`<td class="r" title="${plan.get(h.hole_no) && ch.par ? planLabel(plan.get(h.hole_no), ch.par) : ''}"><strong>${plan.get(h.hole_no) ?? '—'}</strong></td>` : ''}
              <td class="r">${h.n ? fmt(h.avg, 2) : '—'}</td><td class="r ${h.toPar > 0.8 ? 'bad' : h.toPar <= 0.2 ? 'good' : ''}">${h.n ? toPar(h.toPar) : '—'}</td>
              <td class="r">${h.n ? h.best : '—'}</td><td class="r">${fmt(h.avgPutts, 2)}</td><td class="r">${h.n ? pct(h.parOrBetter) : '—'}</td><td class="r">${h.n}</td></tr>`;
          })}</tbody>
        </table></div>
      </div>
      ${complete.length >= 2 ? chartCard('history', 'このコースでのスコア推移', '点をクリックで詳細', 'section') : ''}
    ` : html`<div class="card empty section">${icon('score')}<p>このコースのラウンドはまだありません。</p></div>`}

    ${course.holes.some((h) => h.memo) ? html`<div class="card section"><div class="card-header"><h2>ホールの攻略メモ</h2><button class="btn btn-sm" data-edit-memo>${icon('edit')}編集</button></div>
      <ul class="memo-list">${course.holes.filter((h) => h.memo).map((h) => html`<li><span class="memo-no">${label(h.hole_no)}${multi ? '' : '番'}</span><span class="small muted">Par ${h.par}</span><span>${h.memo}</span></li>`)}</ul></div>` : ''}

    ${rounds.length ? html`<div class="card section"><h2 style="margin-bottom:8px">ラウンド履歴</h2><div class="table-wrap"><table class="data">
      <thead><tr><th>日付</th>${multi ? html`<th>回ったコース</th>` : ''}<th class="r">スコア</th><th class="r">パー比</th><th class="r">パット</th><th>ティー</th><th>同伴者</th></tr></thead>
      <tbody>${sums.map((s, i) => html`<tr class="link" data-id="${s.id}"><td>${fmtDate(s.date)}</td>${multi ? html`<td>${rounds[i].nines_label || ''}</td>` : ''}<td class="r"><strong>${s.holes ? s.strokes : '—'}</strong></td>
        <td class="r">${s.holes ? toPar(s.toPar) : '—'}</td><td class="r">${s.puttHoles ? s.putts : '—'}</td><td>${rounds[i].tee || ''}</td><td>${rounds[i].companions || ''}</td></tr>`)}</tbody>
    </table></div></div>` : ''}

    <div class="danger-zone"><button class="btn btn-sm btn-danger" id="del">${icon('trash')}このコースを削除</button></div>
  `);

  $$('tr[data-id]', root).forEach((tr) => tr.addEventListener('click', () => navigate(`/rounds/${tr.dataset.id}`)));
  $('#edit', root).addEventListener('click', async () => { if (await openCourseEditor(course)) render(root, [idStr]); });
  $('[data-edit-memo]', root)?.addEventListener('click', async () => { if (await openCourseEditor(course)) render(root, [idStr]); });
  $('#del', root).addEventListener('click', async () => {
    const ok = await confirmDialog(`「${course.name}」を削除しますか？\nこのコースのラウンド記録は残ります（コース名のみ保持）。`, { danger: true, okText: '削除する' });
    if (!ok) return;
    try { await api.del(`/api/courses/${id}`); toast('コースを削除しました'); navigate('/courses'); } catch (e) { errorToast(e); }
  });

  if (played.length) {
    setupChart(root, 'holes', (el) => barChart(el, {
      bars: holes.map((h) => ({
        label: shortLabel(h.hole_no),
        value: h.n ? h.toPar : null,
        color: h.toPar > 0 ? 'var(--score-double)' : 'var(--score-birdie)',
        title: `${label(h.hole_no)}番 Par${h.par ?? ''}`,
        tip: h.n ? [{ value: toPar(h.toPar), label: 'パー比（平均）', color: h.toPar > 0 ? 'var(--score-double)' : 'var(--score-birdie)', swatch: true }, { value: fmt(h.avg, 2), label: '平均打数' }, { value: `${h.n} 回`, label: 'プレー回数' }] : undefined,
      })),
      yFormat: (v) => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10),
      valueLabels: false,
      ariaLabel: 'ホール別平均パー比',
    }), {
      columns: [{ label: 'ホール' }, { label: 'パー', align: 'r' }, { label: '平均', align: 'r' }, { label: 'パー比', align: 'r' }],
      rows: played.map((h) => [label(h.hole_no), String(h.par), fmt(h.avg, 2), toPar(h.toPar)]),
    });
    if (complete.length >= 2) {
      setupChart(root, 'history', (el) => lineChart(el, {
        labels: complete.map((s) => shortDate(s.date)),
        series: [{ name: 'スコア', color: 'var(--series-1)', values: complete.map((s) => s.strokes) }],
        onClick: (i) => navigate(`/rounds/${complete[i].id}`),
        tooltipTitle: (i) => fmtDate(complete[i].date),
        height: 200,
      }), { columns: [{ label: '日付' }, { label: 'スコア', align: 'r' }], rows: complete.map((s) => [fmtDate(s.date), String(s.strokes)]) });
    }
  }
}
