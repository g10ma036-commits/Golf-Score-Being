// ラウンド一覧
import { html, mount, $, $$, pct, toPar, fmtDate, icon } from '../util.js';
import { api, getSettings } from '../api.js';
import { summarize } from '../stats.js';
import { navigate, previousPath } from '../main.js';

const WEATHER_ICON = { 晴れ: '☀️', 曇り: '☁️', 雨: '☔', 雪: '❄️', 強風: '💨' };

// 絞り込み・並び順とスクロールの位置は、アプリを開いている間は覚えておく（ラウンドを開いて戻っても同じ一覧）
const state = { year: '', course: '', q: '', sort: 'date', scroll: 0, opened: null };
// ラウンド詳細の「前・次」で使う：今の一覧（絞り込んだあと）のラウンド
let shown = null;
export const listContext = () => shown;

export async function render(root) {
  const rounds = await api.get('/api/rounds');
  const sums = new Map(rounds.map((r) => [r.id, summarize(r)]));
  const fullScores = [...sums.values()].filter((s) => s.complete).map((s) => s.strokes);
  const bestScore = fullScores.length ? Math.min(...fullScores) : null;
  const goal = Number((await getSettings().catch(() => ({}))).goal) || null;
  const years = [...new Set(rounds.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const courses = [...new Map(rounds.map((r) => [r.course_id ? String(r.course_id) : `n:${r.course_name}`, r.course_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  // 覚えていた年・コースのラウンドがなくなっていたら、絞り込みを外す
  if (state.year && !years.includes(state.year)) state.year = '';
  if (state.course && !courses.some(([k]) => k === state.course)) state.course = '';

  mount(root, html`
    <div class="page-header">
      <div><h1>スコア</h1><div class="sub">通算 ${rounds.length} ラウンド</div></div>
      <div class="actions"><a class="btn btn-primary" href="#/rounds/new">${icon('plus')}新しいラウンド</a></div>
    </div>
    ${rounds.length ? html`
      <div class="toolbar">
        <select id="f-year" aria-label="年"><option value="">すべての年</option>${years.map((y) => html`<option value="${y}">${y}年</option>`)}</select>
        <select id="f-course" aria-label="コース"><option value="">すべてのコース</option>${courses.map(([k, n]) => html`<option value="${k}">${n}</option>`)}</select>
        <input id="f-q" type="search" placeholder="同伴者・メモで検索" aria-label="検索">
        <div class="seg" role="group" aria-label="並び順"><button data-sort="date">日付順</button><button data-sort="score">スコア順</button></div>
        <span id="count" class="muted small"></span>
        <button type="button" class="btn btn-sm btn-ghost" id="f-clear" hidden>✕ 絞り込みを解除</button>
      </div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="data">
        <thead><tr>
          <th>日付</th><th>コース</th><th class="r">スコア</th><th class="r">パー比</th><th class="r hide-sm">OUT</th><th class="r hide-sm">IN</th>
          <th class="r">パット</th><th class="r hide-sm">FWキープ</th><th class="r hide-sm">パーオン</th><th class="r hide-sm">ペナ</th><th class="hide-sm">天気</th><th class="c hide-sm">写真</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table></div></div>`
    : html`<div class="card empty">${icon('score')}<h2>ラウンドがありません</h2><p>「新しいラウンド」からスコアを入力しましょう。</p>
        <a class="btn btn-primary" href="#/rounds/new">${icon('plus')}新しいラウンド</a></div>`}
  `);
  if (!rounds.length) return;

  const draw = () => {
    let list = rounds.filter((r) => {
      if (state.year && !r.date.startsWith(state.year)) return false;
      const key = r.course_id ? String(r.course_id) : `n:${r.course_name}`;
      if (state.course && key !== state.course) return false;
      if (state.q) {
        const q = state.q.toLowerCase();
        const texts = [r.companions, r.memo, r.course_name, r.tee, ...(r.party || []).map((p) => p.name), ...(r.holes || []).map((h) => h.note)];
        if (!texts.some((v) => v && v.toLowerCase().includes(q))) return false;
      }
      return true;
    });
    const filtered = Boolean(state.year || state.course || state.q);
    shown = { ids: list.map((r) => r.id), filtered };
    $('#f-clear', root).hidden = !filtered;
    if (state.sort === 'score') {
      list = [...list].sort((a, b) => {
        const sa = sums.get(a.id); const sb = sums.get(b.id);
        if (sa.complete !== sb.complete) return sa.complete ? -1 : 1;
        return sa.strokes - sb.strokes;
      });
    }
    // 絞り込んだラウンドの平均・ベスト（18 ホールのみ）
    const full = list.map((r) => sums.get(r.id)).filter((s) => s.complete);
    const avg = full.length ? full.reduce((a, s) => a + s.strokes, 0) / full.length : null;
    $('#count', root).textContent = `${list.length} 件${full.length ? `・平均 ${avg.toFixed(1)}・ベスト ${Math.min(...full.map((s) => s.strokes))}` : ''}`;
    // 日付順のときは月ごとに見出し（回数・18 ホールの平均）
    const byMonth = new Map();
    if (state.sort === 'date') {
      for (const r of list) {
        const k = r.date.slice(0, 7);
        if (!byMonth.has(k)) byMonth.set(k, { n: 0, scores: [] });
        const m = byMonth.get(k);
        const s = sums.get(r.id);
        m.n++;
        if (s.complete) m.scores.push(s.strokes);
      }
    }
    let prevMonth = '';
    mount($('#rows', root), list.map((r) => {
      const s = sums.get(r.id);
      const k = r.date.slice(0, 7);
      const m = byMonth.get(k);
      const head = m && k !== prevMonth
        ? html`<tr class="month-row"><th colspan="12" scope="rowgroup">${Number(k.slice(0, 4))}年${Number(k.slice(5))}月<span class="muted small">${m.n}回${m.scores.length ? `・平均 ${(m.scores.reduce((a, b) => a + b, 0) / m.scores.length).toFixed(1)}` : ''}</span></th></tr>`
        : '';
      prevMonth = k;
      return html`${head}<tr class="link" data-id="${r.id}" tabindex="0">
        <td>${fmtDate(r.date)}</td>
        <td class="wrap">${r.course_name}${r.nines_label ? html` <span class="muted small nowrap">${r.nines_label}</span>` : ''}${r.tee ? html` <span class="muted small nowrap">${r.tee}</span>` : ''}${r.weather && WEATHER_ICON[r.weather] ? html` <span class="only-sm" title="${r.weather}">${WEATHER_ICON[r.weather]}</span>` : ''}${r.photo_count ? html` <span class="only-sm" aria-label="写真 ${r.photo_count} 枚">📷</span>` : ''}</td>
        <td class="r">${s.complete && s.strokes === bestScore ? html`<span title="ベストスコア">🏆</span> ` : goal && s.complete && s.strokes < goal ? html`<span title="${goal}切り達成">🎯</span> ` : ''}<strong>${s.holes ? s.strokes : '—'}</strong>${s.holes && !s.complete ? html` <span class="badge">${s.holes}H</span>` : ''}</td>
        <td class="r">${s.holes ? toPar(s.toPar) : '—'}</td>
        <td class="r hide-sm">${s.front.holes ? s.front.strokes : '—'}</td>
        <td class="r hide-sm">${s.back.holes ? s.back.strokes : '—'}</td>
        <td class="r">${s.puttHoles ? s.putts : '—'}</td>
        <td class="r hide-sm">${s.fwTotal ? pct(s.fwHit / s.fwTotal) : '—'}</td>
        <td class="r hide-sm">${s.girKnown ? pct(s.gir / s.girKnown) : '—'}</td>
        <td class="r hide-sm">${s.holes ? s.penalties : '—'}</td>
        <td class="hide-sm">${r.weather ? `${WEATHER_ICON[r.weather] || ''} ${r.weather}` : ''}</td>
        <td class="c hide-sm">${r.photo_count ? html`<span class="badge">📷 ${r.photo_count}</span>` : ''}</td>
      </tr>`;
    }));
    const open = (id) => { state.scroll = window.scrollY; state.opened = Number(id); navigate(`/rounds/${id}`); };
    $$('#rows tr[data-id]', root).forEach((tr) => {
      tr.addEventListener('click', () => open(tr.dataset.id));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(tr.dataset.id); });
    });
  };
  const yearSel = $('#f-year', root);
  const courseSel = $('#f-course', root);
  const qInput = $('#f-q', root);
  const syncControls = () => {
    yearSel.value = state.year;
    courseSel.value = state.course;
    qInput.value = state.q;
    $$('[data-sort]', root).forEach((x) => x.classList.toggle('on', x.dataset.sort === state.sort));
  };
  yearSel.addEventListener('change', (e) => { state.year = e.target.value; draw(); });
  courseSel.addEventListener('change', (e) => { state.course = e.target.value; draw(); });
  qInput.addEventListener('input', (e) => { state.q = e.target.value.trim(); draw(); });
  $$('[data-sort]', root).forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    syncControls();
    draw();
  }));
  $('#f-clear', root).addEventListener('click', () => {
    Object.assign(state, { year: '', course: '', q: '' });
    syncControls();
    draw();
  });
  syncControls();
  draw();

  // ラウンドの画面から戻ってきたら、見ていたラウンドの行を画面に入れて、少しのあいだ色で示す
  const back = previousPath().match(/^\/rounds\/(\d+)(?:\/edit)?$/);
  const row = back && $(`#rows tr[data-id="${back[1]}"]`, root);
  if (row) {
    requestAnimationFrame(() => {
      if (Number(back[1]) === state.opened) window.scrollTo(0, state.scroll);
      const r = row.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight - 90) row.scrollIntoView({ block: 'center' });
      row.classList.add('row-flash');
      setTimeout(() => row.classList.remove('row-flash'), 2400);
    });
  }
}
