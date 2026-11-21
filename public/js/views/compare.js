// 2 つのラウンドを比べる（数字のまとめ・ホールごと）
import { html, mount, $, fmtDate, pct, toPar } from '../util.js';
import { api } from '../api.js';
import { summarize, resultKey, played } from '../stats.js';
import { navigate } from '../main.js';

const signed = (v) => (v === 0 ? '±0' : v > 0 ? `+${v}` : `−${-v}`);

export async function render(root) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const rounds = (await api.get('/api/rounds')).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  if (rounds.length < 2) {
    mount(root, html`<div class="page-header"><div><h1>ラウンドを比べる</h1></div></div>
      <div class="card empty"><h2>ラウンドが2つ以上必要です</h2><p>スコアを記録すると、2つのラウンドを並べて比べられます。</p></div>`);
    return;
  }
  const byId = new Map(rounds.map((r) => [r.id, r]));
  const a = byId.get(Number(query.get('a'))) || rounds[0];
  // もう一方の初期値：同じコースの、その前のラウンド（なければ 1 つ前のラウンド）
  const b = byId.get(Number(query.get('b')))
    || rounds.find((r) => r.id !== a.id && a.course_id && r.course_id === a.course_id && r.date <= a.date)
    || rounds.find((r) => r.id !== a.id && a.course_id && r.course_id === a.course_id)
    || rounds.find((r) => r.id !== a.id);
  const sa = summarize(a);
  const sb = summarize(b);
  const label = (r) => { const s = summarize(r); return `${fmtDate(r.date)} ${r.course_name || ''}（${s.holes ? s.strokes : '—'}）`; };
  const options = (sel) => html`${rounds.slice(0, 200).map((r) => html`<option value="${r.id}" ${r.id === sel.id ? 'selected' : ''}>${label(r)}</option>`)}`;

  // 数字のまとめ（better: lower / higher）
  const rows = [
    ['スコア', sa.holes ? sa.strokes : null, sb.holes ? sb.strokes : null, 'lower'],
    ['パー比', sa.holes ? sa.toPar : null, sb.holes ? sb.toPar : null, 'lower', toPar],
    ['OUT', sa.front.holes ? sa.front.strokes : null, sb.front.holes ? sb.front.strokes : null, 'lower'],
    ['IN', sa.back.holes ? sa.back.strokes : null, sb.back.holes ? sb.back.strokes : null, 'lower'],
    ['パット', sa.puttHoles ? sa.putts : null, sb.puttHoles ? sb.putts : null, 'lower'],
    ['3パット', sa.puttHoles ? sa.threePutts : null, sb.puttHoles ? sb.threePutts : null, 'lower'],
    ['FWキープ率', sa.fwTotal ? sa.fwHit / sa.fwTotal : null, sb.fwTotal ? sb.fwHit / sb.fwTotal : null, 'higher', pct],
    ['パーオン率', sa.girKnown ? sa.gir / sa.girKnown : null, sb.girKnown ? sb.gir / sb.girKnown : null, 'higher', pct],
    ['OB・ペナルティ', sa.holes ? sa.penalties : null, sb.holes ? sb.penalties : null, 'lower'],
    ['バーディ以上', sa.results.eagle + sa.results.birdie, sb.results.eagle + sb.results.birdie, 'higher'],
    ['ダボ以上', sa.results.double + sa.results.triple, sb.results.double + sb.results.triple, 'lower'],
  ];
  const diffCell = (x, y, better, f) => {
    if (x == null || y == null) return html`<td class="r">—</td>`;
    const d = x - y;
    const good = better === 'lower' ? d < 0 : d > 0;
    const txt = f === pct ? `${d > 0 ? '+' : ''}${Math.round(d * 100)}pt` : signed(Math.round(d * 10) / 10);
    return html`<td class="r ${Math.abs(d) < 1e-9 ? '' : good ? 'good' : 'bad'}">${txt}</td>`;
  };
  const sameCourse = a.course_id && a.course_id === b.course_id;
  const hole = (r, no) => r.holes.find((h) => h.hole_no === no);
  const mark = (h) => (h && played(h) ? html`<span class="mark ${resultKey(h.strokes, h.par)}">${h.strokes}</span>` : '—');

  mount(root, html`
    <div class="page-header"><div><a class="small" href="#/rounds/${a.id}">← ラウンド詳細</a><h1>ラウンドを比べる</h1>
      <div class="sub">${sameCourse ? '同じコースのラウンドどうしを比べています' : '別のコースどうしは、ホールごとの「パー比」で比べます'}</div></div></div>
    <div class="card compare-pick">
      <label class="field"><span><span class="cmp-tag a">A</span></span><select id="pick-a">${options(a)}</select></label>
      <label class="field"><span><span class="cmp-tag b">B</span></span><select id="pick-b">${options(b)}</select></label>
    </div>
    <div class="grid grid-2 section">
      <div class="card">
        <h2 style="margin-bottom:8px">数字のまとめ</h2>
        <div class="table-wrap"><table class="data"><thead><tr><th></th><th class="r"><span class="cmp-tag a">A</span></th><th class="r"><span class="cmp-tag b">B</span></th><th class="r">A − B</th></tr></thead>
          <tbody>${rows.map(([l, x, y, better, f]) => html`<tr><td>${l}</td><td class="r"><strong>${x == null ? '—' : f ? f(x) : x}</strong></td><td class="r">${y == null ? '—' : f ? f(y) : y}</td>${diffCell(x, y, better, f)}</tr>`)}</tbody></table></div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:8px">ホールごと</h2>
        <div class="table-wrap"><table class="data compare-holes"><thead><tr><th>ホール</th><th class="c">パー</th><th class="c"><span class="cmp-tag a">A</span></th><th class="c"><span class="cmp-tag b">B</span></th><th class="r">差</th></tr></thead>
          <tbody>${Array.from({ length: 18 }, (_, i) => {
            const ha = hole(a, i + 1);
            const hb = hole(b, i + 1);
            const both = ha && hb && played(ha) && played(hb);
            const d = both ? (ha.strokes - ha.par) - (hb.strokes - hb.par) : null;
            const par = ha?.par === hb?.par || !hb ? ha?.par ?? '—' : !ha ? hb.par : `${ha.par}/${hb.par}`;
            return html`<tr><td>${i + 1}</td><td class="c">${par}</td><td class="c">${mark(ha)}</td><td class="c">${mark(hb)}</td>
              <td class="r ${d == null || d === 0 ? '' : d < 0 ? 'good' : 'bad'}">${d == null ? '' : signed(d)}</td></tr>`;
          })}</tbody></table></div>
        <p class="small muted" style="margin-top:6px">差がマイナス（緑）のホールは A のほうが良かったホールです。</p>
      </div>
    </div>
  `);
  $('#pick-a', root).addEventListener('change', (e) => navigate(`/compare?a=${e.target.value}&b=${b.id}`));
  $('#pick-b', root).addEventListener('change', (e) => navigate(`/compare?a=${a.id}&b=${e.target.value}`));
}
