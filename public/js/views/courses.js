// コース一覧・コース編集モーダル
import { html, mount, $, $$, fmt, icon, openModal, toast, errorToast, numOrNull, debounce } from '../util.js';
import { api } from '../api.js';
import { parseCourseText } from '../shared/courseParse.js';
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
        <details class="paste-import">
          <summary>📋 コースガイドの表を貼り付けて自動入力</summary>
          <div class="paste-body">
            <p class="small secondary">ゴルフ場の公式サイトや予約サイト（楽天GORA・じゃらん・GDO など）の「コースガイド」「コースレイアウト」で、<strong>ホール・パー・ヤードの表</strong>を選んでコピーし、下に貼り付けてください。表が 9 ホールずつに分かれているときは、OUT → IN の順に 1 つずつ貼り付けます。</p>
            <textarea rows="4" data-paste-text placeholder="ここに貼り付け（スマホは長押し →「ペースト」）" aria-label="コースガイドの表を貼り付け"></textarea>
            <div data-paste-result aria-live="polite"></div>
          </div>
        </details>
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
    bindPasteImport(form, updateSums);
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

// ---------- コースガイドの表の貼り付け取り込み ----------
function bindPasteImport(form, updateSums) {
  const box = $('.paste-import', form);
  const ta = $('[data-paste-text]', box);
  const out = $('[data-paste-result]', box);
  let res = null;
  let pick = { out: '', in: '', tee: '' };
  const field = (no, k) => $(`[data-h="${no}"][data-k="${k}"]`, form);
  const label = (b, i) => {
    if (b.name) return b.name;
    const from = b.firstNo ?? (res.blocks.length <= 2 ? b.start : null); // 表に書かれたホール番号を優先
    return from ? `${from}〜${from + b.holes.length - 1}番` : `${i + 1}つ目の${b.holes.length}ホール`;
  };
  const parOf = (b) => b.holes.reduce((s, h) => s + h.par, 0);
  // 選んだ内容を反映した後の 18 ホール（変更しないホールは null）
  const planned = () => Array.from({ length: 18 }, (_, i) => {
    const sel = i < 9 ? pick.out : pick.in;
    return sel === '' ? null : res.blocks[Number(sel)]?.holes[i % 9] ?? null;
  });

  function draw() {
    if (!res) {
      mount(out, ta.value.trim() ? html`<p class="small bad" style="margin-top:8px">表を読み取れませんでした。「ホール」「パー」「ヤード（ティー名）」の行や列が入るように選び直してコピーしてください。</p>` : '');
      return;
    }
    const opts = (sel) => html`<option value="" ${sel === '' ? 'selected' : ''}>変更しない</option>${res.blocks.map((b, i) => html`<option value="${i}" ${sel === String(i) ? 'selected' : ''}>${label(b, i)}（パー${parOf(b)}）</option>`)}`;
    const plan = planned();
    const half = (from) => html`<table class="scorecard paste-preview">
      <thead><tr><th>ホール</th>${plan.slice(from, from + 9).map((_, i) => html`<th>${from + i + 1}</th>`)}</tr></thead>
      <tbody>
        <tr><td>パー</td>${plan.slice(from, from + 9).map((h) => html`<td>${h ? h.par : '·'}</td>`)}</tr>
        ${pick.tee ? html`<tr><td>ヤード</td>${plan.slice(from, from + 9).map((h) => html`<td>${h?.yards[pick.tee] ?? '·'}</td>`)}</tr>` : ''}
        <tr><td>HDCP</td>${plan.slice(from, from + 9).map((h) => html`<td>${h?.hdcp ?? '·'}</td>`)}</tr>
      </tbody></table>`;
    const hasHdcp = res.holes.some((h) => h.hdcp != null);
    mount(out, html`
      <p class="small good" style="margin:8px 0">✓ ${res.holes.length}ホール分を読み取りました${res.blocks.length > 2 ? `（9ホールのまとまりが${res.blocks.length}つ）` : ''}${hasHdcp ? '' : '。HDCP は表に含まれていません'}</p>
      <div class="paste-opts">
        <label class="field"><span>OUT（1〜9番）に入れる</span><select data-pick="out">${opts(pick.out)}</select></label>
        <label class="field"><span>IN（10〜18番）に入れる</span><select data-pick="in">${opts(pick.in)}</select></label>
        ${res.tees.length ? html`<label class="field"><span>ヤードはどのティー？</span><select data-pick="tee">
          ${res.tees.map((t) => html`<option value="${t}" ${pick.tee === t ? 'selected' : ''}>${t}</option>`)}<option value="" ${pick.tee === '' ? 'selected' : ''}>ヤードは入れない</option></select></label>` : ''}
      </div>
      <div class="table-wrap">${half(0)}</div>
      <div class="table-wrap" style="margin-top:6px">${half(9)}</div>
      ${res.rating || res.slope ? html`<p class="small muted" style="margin-top:6px">コースレート ${res.rating ?? '—'} / スロープ ${res.slope ?? '—'} も見つかりました（未入力の欄に入れます）。</p>` : ''}
      <div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" data-apply ${pick.out === '' && pick.in === '' ? 'disabled' : ''}>この内容で入力する</button></div>`);
  }

  const applied = { out: false, in: false };
  const parse = () => {
    res = parseCourseText(ta.value);
    if (res) {
      // 前に選んだティーがあれば引き継ぐ
      const tee = res.tees.includes(pick.tee) ? pick.tee : res.tee ?? '';
      if (res.blocks.length === 1) {
        // 9 ホールだけの表：10番からの表、または OUT を入力済みなら IN に入れる
        const toIn = (res.blocks[0].firstNo ?? 0) >= 10 || (applied.out && !applied.in);
        pick = { out: toIn ? '' : '0', in: toIn ? '0' : '', tee };
      } else {
        pick = { out: '0', in: '1', tee };
      }
    }
    draw();
  };
  ta.addEventListener('input', debounce(parse, 250));
  out.addEventListener('change', (e) => {
    const k = e.target.dataset?.pick;
    if (!k) return;
    pick[k] = e.target.value;
    draw();
  });
  out.addEventListener('click', (e) => {
    if (!e.target.closest('[data-apply]')) return;
    const changed = [];
    planned().forEach((h, i) => {
      if (!h) return;
      const set = (k, v) => { if (v == null) return; const el = field(i + 1, k); el.value = v; changed.push(el); };
      set('par', h.par);
      if (pick.tee) set('yards', h.yards[pick.tee]);
      set('hdcp', h.hdcp);
    });
    if (res.rating && !form.rating.value) form.rating.value = res.rating;
    if (res.slope && !form.slope.value) form.slope.value = res.slope;
    updateSums();
    changed.forEach((el) => el.classList.add('filled'));
    setTimeout(() => changed.forEach((el) => el.classList.remove('filled')), 2500);
    if (pick.out !== '') applied.out = true;
    if (pick.in !== '') applied.in = true;
    ta.value = '';
    res = null;
    if (applied.out && applied.in) {
      mount(out, '');
      box.open = false;
      box.nextElementSibling?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      toast('ホール情報を入力しました。内容を確認して保存してください');
    } else {
      // 9 ホールずつの表：続けてもう半分を貼り付けてもらう
      const done = applied.out ? 'OUT（1〜9番）' : 'IN（10〜18番）';
      const next = applied.out ? 'IN（10〜18番）' : 'OUT（1〜9番）';
      mount(out, html`<p class="small good" style="margin-top:8px">✓ ${done}に入力しました。続けて ${next} の表を貼り付けてください（9ホールだけのコースならこのまま保存できます）。</p>`);
      toast(`${done}に入力しました`);
    }
  });
}
