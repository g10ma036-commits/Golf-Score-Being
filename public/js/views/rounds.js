// ラウンド一覧
import { html, mount, $, $$, pct, toPar, fmtDate, icon } from '../util.js';
import { api } from '../api.js';
import { summarize } from '../stats.js';
import { navigate } from '../main.js';

export async function render(root) {
  const rounds = await api.get('/api/rounds');
  const sums = new Map(rounds.map((r) => [r.id, summarize(r)]));
  const years = [...new Set(rounds.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const courses = [...new Map(rounds.map((r) => [r.course_id ? String(r.course_id) : `n:${r.course_name}`, r.course_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  const state = { year: '', course: '', q: '', sort: 'date' };

  mount(root, html`
    <div class="page-header">
      <div><h1>スコア・ラウンド</h1><div class="sub">通算 ${rounds.length} ラウンド</div></div>
      <div class="actions"><a class="btn btn-primary" href="#/rounds/new">${icon('plus')}新しいラウンド</a></div>
    </div>
    ${rounds.length ? html`
      <div class="toolbar">
        <select id="f-year" aria-label="年"><option value="">すべての年</option>${years.map((y) => html`<option value="${y}">${y}年</option>`)}</select>
        <select id="f-course" aria-label="コース"><option value="">すべてのコース</option>${courses.map(([k, n]) => html`<option value="${k}">${n}</option>`)}</select>
        <input id="f-q" type="search" placeholder="同伴者・メモで検索" aria-label="検索">
        <div class="seg" role="group" aria-label="並び順"><button data-sort="date" class="on">日付順</button><button data-sort="score">スコア順</button></div>
        <span id="count" class="muted small"></span>
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
        if (![r.companions, r.memo, r.course_name, r.tee].some((v) => v && v.toLowerCase().includes(q))) return false;
      }
      return true;
    });
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
    mount($('#rows', root), list.map((r) => {
      const s = sums.get(r.id);
      return html`<tr class="link" data-id="${r.id}" tabindex="0">
        <td>${fmtDate(r.date)}</td>
        <td class="wrap">${r.course_name}${r.nines_label ? html` <span class="muted small nowrap">${r.nines_label}</span>` : ''}${r.tee ? html` <span class="muted small nowrap">${r.tee}</span>` : ''}${r.photo_count ? html` <span class="only-sm" aria-label="写真 ${r.photo_count} 枚">📷</span>` : ''}</td>
        <td class="r"><strong>${s.holes ? s.strokes : '—'}</strong>${s.holes && !s.complete ? html` <span class="badge">${s.holes}H</span>` : ''}</td>
        <td class="r">${s.holes ? toPar(s.toPar) : '—'}</td>
        <td class="r hide-sm">${s.front.holes ? s.front.strokes : '—'}</td>
        <td class="r hide-sm">${s.back.holes ? s.back.strokes : '—'}</td>
        <td class="r">${s.puttHoles ? s.putts : '—'}</td>
        <td class="r hide-sm">${s.fwTotal ? pct(s.fwHit / s.fwTotal) : '—'}</td>
        <td class="r hide-sm">${s.girKnown ? pct(s.gir / s.girKnown) : '—'}</td>
        <td class="r hide-sm">${s.holes ? s.penalties : '—'}</td>
        <td class="hide-sm">${r.weather || ''}</td>
        <td class="c hide-sm">${r.photo_count ? html`<span class="badge">📷 ${r.photo_count}</span>` : ''}</td>
      </tr>`;
    }));
    $$('#rows tr', root).forEach((tr) => {
      tr.addEventListener('click', () => navigate(`/rounds/${tr.dataset.id}`));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(`/rounds/${tr.dataset.id}`); });
    });
  };
  $('#f-year', root).addEventListener('change', (e) => { state.year = e.target.value; draw(); });
  $('#f-course', root).addEventListener('change', (e) => { state.course = e.target.value; draw(); });
  $('#f-q', root).addEventListener('input', (e) => { state.q = e.target.value.trim(); draw(); });
  $$('[data-sort]', root).forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    $$('[data-sort]', root).forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  draw();
}
