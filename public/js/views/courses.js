// コース一覧・コース編集モーダル
import { html, mount, $, $$, fmt, icon, openModal, toast, errorToast, numOrNull } from '../util.js';
import { api } from '../api.js';
import { summarize } from '../stats.js';
import { navigate } from '../main.js';

export const DEFAULT_PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

export async function render(root) {
  const [courses, rounds] = await Promise.all([api.get('/api/courses'), api.get('/api/rounds')]);
  const byCourse = new Map();
  for (const r of rounds) {
    if (!r.course_id) continue;
    const s = summarize(r);
    if (!byCourse.has(r.course_id)) byCourse.set(r.course_id, []);
    byCourse.get(r.course_id).push(s);
  }

  mount(root, html`
    <div class="page-header">
      <div><h1>コース</h1><div class="sub">コースのパー・ヤードを登録しておくと、スコア入力が楽になります</div></div>
      <div class="actions"><button class="btn btn-primary" id="add">${icon('plus')}コースを追加</button></div>
    </div>
    ${courses.length ? html`<div class="album-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
      ${courses.map((c) => {
        const sums = (byCourse.get(c.id) || []).filter((s) => s.complete);
        const best = sums.length ? Math.min(...sums.map((s) => s.strokes)) : null;
        const avg = sums.length ? sums.reduce((a, s) => a + s.strokes, 0) / sums.length : null;
        const par = c.holes.reduce((a, h) => a + h.par, 0);
        const yards = c.holes.reduce((a, h) => a + (h.yards || 0), 0);
        return html`<a class="card album-card" href="#/courses/${c.id}" style="padding:16px">
          <h3>${c.name}</h3>
          <div class="small muted">${c.location || '　'}</div>
          <dl class="kv" style="margin-top:10px">
            <dt>パー</dt><dd>${par || '—'}${yards ? html` <span class="muted">/ ${yards.toLocaleString()} yd</span>` : ''}</dd>
            <dt>レート / スロープ</dt><dd>${c.rating ?? '—'} / ${c.slope ?? '—'}</dd>
            <dt>ラウンド数</dt><dd>${c.round_count}</dd>
            <dt>ベスト / 平均</dt><dd>${best ?? '—'} / ${fmt(avg, 1)}</dd>
          </dl>
        </a>`;
      })}
    </div>` : html`<div class="card empty">${icon('course')}<h2>コースが登録されていません</h2>
      <p>よく行くコースを登録しましょう。スコア入力画面からも追加できます。</p></div>`}
  `);
  $('#add', root).addEventListener('click', async () => {
    const c = await openCourseEditor(null);
    if (c) navigate(`/courses/${c.id}`);
  });
}

// コース編集モーダル。保存したコースを返す（キャンセル時は null）
// template: 新規作成時の初期値（スコア入力中のパー・ヤードなど）
export function openCourseEditor(course, template = null) {
  return new Promise((resolve) => {
    let saved = null;
    const src = course || template;
    const holes = Array.from({ length: 18 }, (_, i) => {
      const h = src?.holes?.find((x) => x.hole_no === i + 1);
      return { hole_no: i + 1, par: h?.par ?? DEFAULT_PARS[i], yards: h?.yards ?? '', hdcp: h?.hdcp ?? '' };
    });
    const half = (from) => html`<table class="scorecard">
      <thead><tr><th>ホール</th>${holes.slice(from, from + 9).map((h) => html`<th>${h.hole_no}</th>`)}<th class="sum">${from ? 'IN' : 'OUT'}</th></tr></thead>
      <tbody>
        <tr><td>パー</td>${holes.slice(from, from + 9).map((h) => html`<td><input type="number" min="3" max="6" data-h="${h.hole_no}" data-k="par" value="${h.par}" aria-label="${h.hole_no}番 パー"></td>`)}<td class="sum" data-sum="par-${from}"></td></tr>
        <tr><td>ヤード</td>${holes.slice(from, from + 9).map((h) => html`<td><input type="number" min="0" max="900" data-h="${h.hole_no}" data-k="yards" value="${h.yards}" aria-label="${h.hole_no}番 ヤード" style="width:48px"></td>`)}<td class="sum" data-sum="yards-${from}"></td></tr>
        <tr><td>HDCP</td>${holes.slice(from, from + 9).map((h) => html`<td><input type="number" min="1" max="18" data-h="${h.hole_no}" data-k="hdcp" value="${h.hdcp}" aria-label="${h.hole_no}番 ハンディキャップ"></td>`)}<td class="sum"></td></tr>
      </tbody></table>`;
    const m = openModal({
      title: course ? 'コースを編集' : 'コースを追加',
      wide: true,
      body: html`<form id="course-form" autocomplete="off">
        <div class="form-grid">
          <label class="field" style="grid-column:span 2"><span>コース名 *</span><input name="name" required maxlength="200" value="${src?.name || ''}"></label>
          <label class="field"><span>所在地</span><input name="location" maxlength="200" value="${course?.location || ''}"></label>
          <label class="field"><span>コースレート</span><input name="rating" type="number" step="0.1" min="50" max="90" value="${course?.rating ?? ''}" placeholder="例: 71.2"></label>
          <label class="field"><span>スロープレート</span><input name="slope" type="number" min="55" max="155" value="${course?.slope ?? ''}" placeholder="例: 128"></label>
          <label class="field wide"><span>メモ</span><textarea name="memo" rows="2" maxlength="2000">${course?.memo || ''}</textarea></label>
        </div>
        <div class="card-header" style="margin:16px 0 8px"><h3>ホール情報</h3>
          <div class="actions"><button type="button" class="btn btn-sm" data-preset="72">パー72（標準）</button><button type="button" class="btn btn-sm" data-preset="4">全ホール パー4</button></div></div>
        <div class="table-wrap">${half(0)}</div>
        <div class="table-wrap" style="margin-top:8px">${half(9)}</div>
        <p class="small muted" style="margin-top:8px">合計パー <strong id="total-par"></strong>　コースレート・スロープは推定ハンディキャップの計算に使います（未入力ならパーと113で計算）。</p>
      </form>`,
      footer: html`<button class="btn" data-cancel>キャンセル</button><button class="btn btn-primary" data-save>保存</button>`,
      onClose: () => resolve(saved),
    });
    const form = $('#course-form', m.el);
    const updateSums = () => {
      let total = 0;
      for (const from of [0, 9]) {
        let par = 0; let yd = 0;
        for (let i = from + 1; i <= from + 9; i++) {
          par += Number($(`[data-h="${i}"][data-k="par"]`, form).value) || 0;
          yd += Number($(`[data-h="${i}"][data-k="yards"]`, form).value) || 0;
        }
        $(`[data-sum="par-${from}"]`, form).textContent = par;
        $(`[data-sum="yards-${from}"]`, form).textContent = yd || '';
        total += par;
      }
      $('#total-par', form).textContent = total;
    };
    form.addEventListener('input', updateSums);
    $$('[data-preset]', form).forEach((b) => b.addEventListener('click', () => {
      for (let i = 1; i <= 18; i++) $(`[data-h="${i}"][data-k="par"]`, form).value = b.dataset.preset === '72' ? DEFAULT_PARS[i - 1] : 4;
      updateSums();
    }));
    updateSums();
    $('[data-cancel]', m.el).addEventListener('click', () => m.close());
    const save = async () => {
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'), location: fd.get('location'), rating: numOrNull(fd.get('rating')), slope: numOrNull(fd.get('slope')), memo: fd.get('memo'),
        holes: Array.from({ length: 18 }, (_, i) => ({
          hole_no: i + 1,
          par: numOrNull($(`[data-h="${i + 1}"][data-k="par"]`, form).value) ?? 4,
          yards: numOrNull($(`[data-h="${i + 1}"][data-k="yards"]`, form).value),
          hdcp: numOrNull($(`[data-h="${i + 1}"][data-k="hdcp"]`, form).value),
        })),
      };
      try {
        saved = course ? await api.put(`/api/courses/${course.id}`, body) : await api.post('/api/courses', body);
        toast('コースを保存しました');
        m.close();
      } catch (e) { errorToast(e); }
    };
    $('[data-save]', m.el).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  });
}
