// コース一覧・コース編集モーダル
import { html, raw, mount, $, $$, fmt, icon, openModal, toast, errorToast, numOrNull, debounce } from '../util.js';
import { api } from '../api.js';
import { parseCourseText } from '../shared/courseParse.js';
import { MAX_NINES, defaultNineName } from '../shared/model.js';
import { summarize } from '../stats.js';
import { navigate } from '../main.js';

export const DEFAULT_PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const COURSE_SORTS = [['name', '名前順'], ['count', 'よく行く順'], ['recent', '最近']];

// ---------- 9 ホールのまとまり（東・西・南コースなど）の表示 ----------
export const ninesOf = (c) => (c?.nines?.length ? c.nines : ['OUT', 'IN']);
// コースの通し番号 → 表示名（18 ホールのコースは「12」、まとまりが 3 つ以上なら「南 3」）
export function holeName(names, no) {
  if (names.length <= 2) return String(no);
  return `${names[Math.floor((no - 1) / 9)] ?? '?'} ${((no - 1) % 9) + 1}`;
}
// まとまりごとのパー・ヤード（例: [{ name: '東', par: 36, yards: 3300 }]）
export function nineTotals(c) {
  return ninesOf(c).map((name, i) => {
    const hs = (c.holes || []).filter((h) => Math.ceil(h.hole_no / 9) === i + 1);
    return { name, par: hs.reduce((a, h) => a + h.par, 0), yards: hs.reduce((a, h) => a + (h.yards || 0), 0) };
  });
}

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
      <div class="actions">
        ${courses.length ? html`<button class="btn" id="export">${icon('share')}友達に渡す</button>` : ''}
        <button class="btn" id="import">${icon('download')}読み込む</button>
        <button class="btn btn-primary" id="add">${icon('plus')}コースを追加</button>
      </div>
    </div>
    ${courses.length > 3 ? html`<div class="toolbar">
      ${courses.length > 6 ? html`<input id="course-q" type="search" placeholder="コース名・所在地で検索" aria-label="コースを検索">` : ''}
      <div class="seg" role="group" aria-label="並び順">${COURSE_SORTS.map(([k, l]) => html`<button type="button" data-csort="${k}">${l}</button>`)}</div>
      <span class="small muted" id="course-count"></span></div>` : ''}
    ${courses.length ? html`<div class="album-grid" id="course-grid" style="grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))">
      ${courses.map((c) => {
        const sums = (byCourse.get(c.id) || []).filter((s) => s.complete);
        const best = sums.length ? Math.min(...sums.map((s) => s.strokes)) : null;
        const avg = sums.length ? sums.reduce((a, s) => a + s.strokes, 0) / sums.length : null;
        const nines = nineTotals(c);
        const par = nines.reduce((a, n) => a + n.par, 0);
        const yards = nines.reduce((a, n) => a + n.yards, 0);
        const lastDate = (byCourse.get(c.id) || []).reduce((m, s) => (s.date > m ? s.date : m), '');
        return html`<a class="card album-card" href="#/courses/${c.id}" style="padding:16px" data-search="${`${c.name} ${c.location || ''}`.toLowerCase()}" data-count="${c.round_count}" data-last="${lastDate}">
          <h3>${c.name}</h3>
          <div class="small muted">${c.location || '　'}</div>
          <dl class="kv" style="margin-top:10px">
            ${nines.length > 2
              ? html`<dt>${nines.length * 9}ホール</dt><dd>${nines.map((n) => `${n.name} ${n.par || '—'}`).join('・')}</dd>`
              : html`<dt>パー</dt><dd>${par || '—'}${yards ? html` <span class="muted">/ ${yards.toLocaleString()} yd</span>` : ''}</dd>`}
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
  // 並び替え（名前順・よく行く順・最近回った順）。選んだ並び順は覚えておく
  const grid = $('#course-grid', root);
  const applySort = (k) => {
    if (!grid) return;
    const cards = [...grid.children];
    const name = (a) => a.querySelector('h3').textContent;
    cards.sort((a, b) => (k === 'count' ? Number(b.dataset.count) - Number(a.dataset.count) : k === 'recent' ? b.dataset.last.localeCompare(a.dataset.last) : 0) || name(a).localeCompare(name(b), 'ja'));
    grid.append(...cards);
    $$('[data-csort]', root).forEach((b) => b.classList.toggle('on', b.dataset.csort === k));
    try { localStorage.setItem('golf-course-sort', k); } catch { /* ignore */ }
  };
  $$('[data-csort]', root).forEach((b) => b.addEventListener('click', () => applySort(b.dataset.csort)));
  if ($('[data-csort]', root)) {
    let saved = 'name';
    try { saved = localStorage.getItem('golf-course-sort') || 'name'; } catch { /* ignore */ }
    applySort(COURSE_SORTS.some(([k]) => k === saved) ? saved : 'name');
  }
  $('#course-q', root)?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let n = 0;
    $$('#course-grid [data-search]', root).forEach((a) => { const hit = !q || a.dataset.search.includes(q); a.hidden = !hit; n += hit; });
    $('#course-count', root).textContent = q ? `${n} 件` : '';
  });
  $('#export', root)?.addEventListener('click', async () => (await import('./courseShare.js')).openCourseExport(courses));
  $('#import', root).addEventListener('click', async () => (await import('./courseShare.js')).openCourseImport(courses, () => render(root)));
}

const HOLE_FIELDS = {
  par: { label: 'パー', attrs: 'min="3" max="6"' },
  yards: { label: 'ヤード', attrs: 'min="0" max="900" style="width:48px"' },
  hdcp: { label: 'ハンディキャップ', attrs: 'min="1"' },
};

// コース編集モーダル。保存したコースを返す（キャンセル時は null）
// template: 新規作成時の初期値（スコア入力中のパー・ヤードなど）
export function openCourseEditor(course, template = null) {
  return new Promise((resolve) => {
    let saved = null;
    const src = course || template;
    let names = [...ninesOf(src)];
    // 入力中の値（通し番号 → { par, yards, hdcp }）。まとまりを減らしても、増やし直せば値が戻る
    const vals = new Map();
    const valAt = (no) => {
      if (!vals.has(no)) {
        const h = src?.holes?.find((x) => x.hole_no === no);
        vals.set(no, { par: h?.par ?? DEFAULT_PARS[(no - 1) % 18], yards: h?.yards ?? '', hdcp: h?.hdcp ?? '', memo: h?.memo ?? '' });
      }
      return vals.get(no);
    };
    const holeNos = (i) => Array.from({ length: 9 }, (_, k) => i * 9 + k + 1);

    const m = openModal({
      title: course ? 'コースを編集' : 'コースを追加',
      wide: true,
      body: html`<form id="course-form" autocomplete="off">
        <div class="form-grid">
          <label class="field" style="grid-column:span 2"><span>コース名（ゴルフ場名） *</span><input name="name" required maxlength="200" value="${src?.name || ''}"></label>
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
            <p class="small secondary">ゴルフ場の公式サイトや予約サイト（楽天GORA・じゃらん・GDO など）の「コースガイド」「コースレイアウト」で、<strong>ホール・パー・ヤードの表</strong>を選んでコピーし、下に貼り付けてください。表が 9 ホールずつに分かれているときは、1 つずつ順に貼り付けます。27ホール・36ホールのゴルフ場は、東・西・南コースなどをまとめて貼り付けても読み取れます。</p>
            <textarea rows="4" data-paste-text placeholder="ここに貼り付け（スマホは長押し →「ペースト」）" aria-label="コースガイドの表を貼り付け"></textarea>
            <div data-paste-result aria-live="polite"></div>
          </div>
        </details>
        <div id="nines-box"></div>
        <p class="small muted" style="margin-top:8px"><span id="total-label">合計パー</span> <strong id="total-par"></strong>　コースレート・スロープは推定ハンディキャップの計算に使います（未入力ならパーと113で計算）。</p>
      </form>`,
      footer: html`<button class="btn" data-cancel>キャンセル</button><button class="btn btn-primary" data-save>保存</button>`,
      onClose: () => resolve(saved),
    });
    const form = $('#course-form', m.el);
    const box = $('#nines-box', form);
    const field = (no, k) => $(`[data-h="${no}"][data-k="${k}"]`, form);

    const nineTable = (i) => {
      const multi = names.length > 2;
      const nos = holeNos(i);
      const input = (no, k) => html`<td><input type="number" ${raw(HOLE_FIELDS[k].attrs)} ${k === 'hdcp' ? raw(`max="${multi ? 27 : 18}"`) : ''} data-h="${no}" data-k="${k}" value="${valAt(no)[k]}" aria-label="${holeName(names, no)}番 ${HOLE_FIELDS[k].label}"></td>`;
      return html`<table class="scorecard">
        <thead><tr><th>ホール</th>${nos.map((no) => html`<th>${multi ? ((no - 1) % 9) + 1 : no}</th>`)}<th class="sum">${multi ? '計' : i ? 'IN' : 'OUT'}</th></tr></thead>
        <tbody>
          <tr><td>パー</td>${nos.map((no) => input(no, 'par'))}<td class="sum" data-sum="par-${i}"></td></tr>
          <tr><td>ヤード</td>${nos.map((no) => input(no, 'yards'))}<td class="sum" data-sum="yards-${i}"></td></tr>
          <tr><td>HDCP</td>${nos.map((no) => input(no, 'hdcp'))}<td class="sum"></td></tr>
        </tbody></table>`;
    };
    const drawNines = () => {
      const multi = names.length > 2;
      const help = multi
        ? 'スコア入力のときに、前半・後半に回ったコースを選べます。'
        : names.length === 1
          ? '9ホールだけのコースです（スコア入力では同じ9ホールを2回まわります）。'
          : '27ホール・36ホールのゴルフ場は「9ホールを追加」で、東・西・南コースなどを1つのゴルフ場として登録できます。';
      mount(box, html`${names.map((n, i) => html`<div class="nine-block">
          ${multi ? html`<label class="field nine-name"><span>${i + 1}つ目の9ホールの名前</span><input data-nine-name="${i}" maxlength="30" value="${n}" placeholder="例: 東コース"></label>` : ''}
          <div class="table-wrap">${nineTable(i)}</div></div>`)}
        <div class="nine-actions">
          <button type="button" class="btn btn-sm" data-add-nine ${names.length >= MAX_NINES ? 'disabled' : ''}>${icon('plus')}9ホールを追加</button>
          ${names.length > 1 ? html`<button type="button" class="btn btn-sm btn-ghost" data-remove-nine>最後の9ホールを削除</button>` : ''}
          <span class="small muted">${help}</span>
        </div>
        <details class="hole-memos" ${holeMemoCount() ? 'open' : ''}>
          <summary>📝 ホールごとの攻略メモ${holeMemoCount() ? `（${holeMemoCount()}）` : ''}</summary>
          <p class="small muted">スコア入力（1ホールずつ）の画面に表示されます。例：「左は OB」「グリーン奥に外すと難しい」</p>
          <div class="memo-grid">${names.flatMap((_, i) => holeNos(i)).map((no) => html`<label class="memo-row"><span>${holeName(names, no)}</span><input data-memo="${no}" maxlength="200" value="${valAt(no).memo}" placeholder="メモ"></label>`)}</div>
        </details>`);
      updateSums();
    };
    // 入力欄の値を控える（まとまりを増減して描き直す前に）
    const readInputs = () => {
      $$('[data-h]', form).forEach((el) => { valAt(Number(el.dataset.h))[el.dataset.k] = el.value; });
      $$('[data-nine-name]', form).forEach((el) => { names[Number(el.dataset.nineName)] = el.value; });
      $$('[data-memo]', form).forEach((el) => { valAt(Number(el.dataset.memo)).memo = el.value; });
    };
    const holeMemoCount = () => names.flatMap((_, i) => holeNos(i)).filter((no) => String(valAt(no).memo || '').trim()).length;
    // まとまりの数を変える。既定の名前（OUT・IN ↔ Aコース…）は数に合わせて付け直す
    const setCount = (n) => {
      readInputs();
      const old = names.length;
      names = Array.from({ length: n }, (_, i) => {
        const cur = names[i]?.trim();
        return !cur || cur === defaultNineName(i, old) ? defaultNineName(i, n) : names[i];
      });
      drawNines();
    };
    const nameOf = (i) => $(`[data-nine-name="${i}"]`, form)?.value.trim() || names[i];
    function updateSums() {
      const pars = names.map((_, i) => {
        let par = 0; let yd = 0;
        for (const no of holeNos(i)) {
          par += Number(field(no, 'par')?.value) || 0;
          yd += Number(field(no, 'yards')?.value) || 0;
        }
        $(`[data-sum="par-${i}"]`, form).textContent = par;
        $(`[data-sum="yards-${i}"]`, form).textContent = yd || '';
        return par;
      });
      const multi = names.length > 2;
      $('#total-label', form).textContent = multi ? 'パー' : '合計パー';
      $('#total-par', form).textContent = multi ? pars.map((p, i) => `${nameOf(i)} ${p}`).join('・') : pars.reduce((a, b) => a + b, 0);
    }

    form.addEventListener('input', updateSums);
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-nine]')) setCount(Math.min(MAX_NINES, names.length + 1));
      else if (e.target.closest('[data-remove-nine]')) setCount(Math.max(1, names.length - 1));
    });
    $$('[data-preset]', form).forEach((b) => b.addEventListener('click', () => {
      readInputs();
      for (let no = 1; no <= names.length * 9; no++) valAt(no).par = b.dataset.preset === '72' ? DEFAULT_PARS[(no - 1) % 18] : 4;
      drawNines();
    }));
    drawNines();
    bindPasteImport(form, {
      names: () => { readInputs(); return names; },
      setCount,
      setName: (i, n) => { names[i] = n; },
      valAt,
      redraw: drawNines,
    });
    $('[data-cancel]', m.el).addEventListener('click', () => m.close());
    const save = async () => {
      if (!form.reportValidity()) return;
      readInputs();
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'), location: fd.get('location'), rating: numOrNull(fd.get('rating')), slope: numOrNull(fd.get('slope')), memo: fd.get('memo'),
        nines: names.map((s) => s.trim()),
        holes: Array.from({ length: names.length * 9 }, (_, i) => {
          const v = valAt(i + 1);
          return { hole_no: i + 1, par: numOrNull(v.par) ?? 4, yards: numOrNull(v.yards), hdcp: numOrNull(v.hdcp), memo: String(v.memo || '').trim() || null };
        }),
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
// 読み取った 9 ホールずつのまとまり（ブロック）ごとに、どの 9 ホールに入れるかを選ぶ
function bindPasteImport(form, ed) {
  const box = $('.paste-import', form);
  const ta = $('[data-paste-text]', box);
  const out = $('[data-paste-result]', box);
  let res = null;
  let dest = []; // ブロックごとの入れ先（まとまりの番号の文字列。'' は入れない）
  let tee = '';
  const applied = new Set();
  let count = 2; // 貼り付けた時点のまとまりの数

  const label = (b, i) => {
    if (b.name) return b.name;
    const from = b.firstNo ?? (res.blocks.length <= 2 ? b.start : null); // 表に書かれたホール番号を優先
    return from ? `${from}〜${from + b.holes.length - 1}番` : `${i + 1}つ目の${b.holes.length}ホール`;
  };
  const parOf = (b) => b.holes.reduce((s, h) => s + h.par, 0);
  // 入れ先 i の表示名（今より多い番号は「新しく追加」）
  const destName = (i) => {
    const names = ed.names();
    if (i >= names.length) return `新しく追加（${i + 1}つ目の9ホール）`;
    if (names.length <= 2) return i ? 'IN（10〜18番）' : 'OUT（1〜9番）';
    return names[i].trim() || defaultNineName(i, names.length);
  };
  const finalCount = () => Math.max(count, ...dest.filter((d) => d !== '').map((d) => Number(d) + 1));

  function draw() {
    if (!res) {
      mount(out, ta.value.trim() ? html`<p class="small bad" style="margin-top:8px">表を読み取れませんでした。「ホール」「パー」「ヤード（ティー名）」の行や列が入るように選び直してコピーしてください。</p>` : '');
      return;
    }
    const maxDest = Math.min(MAX_NINES, count + res.blocks.length);
    const chosen = dest.filter((d) => d !== '');
    const dup = new Set(chosen).size !== chosen.length;
    const fc = finalCount();
    const hasHdcp = res.holes.some((h) => h.hdcp != null);
    const preview = (b, d) => html`<table class="scorecard paste-preview">
      <thead><tr><th>ホール</th>${b.holes.map((_, k) => html`<th>${fc > 2 ? k + 1 : Number(d) * 9 + k + 1}</th>`)}</tr></thead>
      <tbody>
        <tr><td>パー</td>${b.holes.map((h) => html`<td>${h.par}</td>`)}</tr>
        ${tee ? html`<tr><td>ヤード</td>${b.holes.map((h) => html`<td>${h.yards[tee] ?? '·'}</td>`)}</tr>` : ''}
        <tr><td>HDCP</td>${b.holes.map((h) => html`<td>${h.hdcp ?? '·'}</td>`)}</tr>
      </tbody></table>`;
    mount(out, html`
      <p class="small good" style="margin:8px 0">✓ ${res.holes.length}ホール分を読み取りました${res.blocks.length > 1 ? `（9ホールのまとまりが${res.blocks.length}つ）` : ''}${hasHdcp ? '' : '。HDCP は表に含まれていません'}</p>
      ${res.tees.length ? html`<div class="paste-opts"><label class="field"><span>ヤードはどのティー？</span><select data-tee>
        ${res.tees.map((t) => html`<option value="${t}" ${tee === t ? 'selected' : ''}>${t}</option>`)}<option value="" ${tee === '' ? 'selected' : ''}>ヤードは入れない</option></select></label></div>` : ''}
      ${res.blocks.map((b, j) => html`<div class="paste-block">
        <label class="field"><span>${label(b, j)}（パー${parOf(b)}）を入れる先</span><select data-dest="${j}">
          ${Array.from({ length: maxDest }, (_, i) => html`<option value="${i}" ${dest[j] === String(i) ? 'selected' : ''}>${destName(i)}</option>`)}
          <option value="" ${dest[j] === '' ? 'selected' : ''}>入れない</option></select></label>
        ${dest[j] !== '' ? html`<div class="table-wrap">${preview(b, dest[j])}</div>` : ''}
      </div>`)}
      ${fc > count ? html`<p class="small muted" style="margin-top:6px">9ホールのまとまりを ${fc} つ（${fc * 9}ホール）に増やして入力します。${fc > 2 ? '名前は表の見出し（「東コース」など）から付けます。' : ''}</p>` : ''}
      ${dup ? html`<p class="small bad" style="margin-top:6px">同じ入れ先が 2 回選ばれています。入れ先を選び直してください。</p>` : ''}
      ${res.rating || res.slope ? html`<p class="small muted" style="margin-top:6px">コースレート ${res.rating ?? '—'} / スロープ ${res.slope ?? '—'} も見つかりました（未入力の欄に入れます）。</p>` : ''}
      <div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" data-apply ${!chosen.length || dup ? 'disabled' : ''}>この内容で入力する</button></div>`);
  }

  const parse = () => {
    res = parseCourseText(ta.value);
    if (res) {
      count = ed.names().length;
      tee = res.tees.includes(tee) ? tee : res.tee ?? ''; // 前に選んだティーがあれば引き継ぐ
      if (res.blocks.length === 1) {
        // 9 ホールだけの表：「10番〜」のように番号があればその位置、なければまだ入力していない最初の 9 ホール
        const first = res.blocks[0].firstNo ?? 0;
        let t = first >= 10 ? Math.floor((first - 1) / 9) : -1;
        if (t < 0 || t >= count) t = Array.from({ length: count }, (_, i) => i).find((i) => !applied.has(i)) ?? count;
        dest = [String(Math.min(t, MAX_NINES - 1))];
      } else {
        dest = res.blocks.map((_, j) => (j < MAX_NINES ? String(j) : ''));
      }
    }
    draw();
  };
  ta.addEventListener('input', debounce(parse, 250));
  out.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset?.dest !== undefined) dest[Number(t.dataset.dest)] = t.value;
    else if (t.hasAttribute?.('data-tee')) tee = t.value;
    else return;
    draw();
  });
  out.addEventListener('click', (e) => {
    if (!e.target.closest('[data-apply]')) return;
    const fc = finalCount();
    if (fc !== ed.names().length) ed.setCount(fc);
    const names = ed.names();
    const changed = [];
    res.blocks.forEach((b, j) => {
      if (dest[j] === '') return;
      const d = Number(dest[j]);
      b.holes.slice(0, 9).forEach((h, k) => {
        const no = d * 9 + k + 1;
        const v = ed.valAt(no);
        v.par = h.par;
        if (tee && h.yards[tee] != null) v.yards = h.yards[tee];
        if (h.hdcp != null) v.hdcp = h.hdcp;
        changed.push(no);
      });
      // 名前が既定のままなら、表の見出し（東コースなど）を名前にする
      const cur = names[d]?.trim();
      if (fc > 2 && b.name && (!cur || cur === defaultNineName(d, fc))) ed.setName(d, b.name);
      applied.add(d);
    });
    ed.redraw();
    if (res.rating && !form.rating.value) form.rating.value = res.rating;
    if (res.slope && !form.slope.value) form.slope.value = res.slope;
    const els = changed.flatMap((no) => $$(`[data-h="${no}"]`, form));
    els.forEach((el) => el.classList.add('filled'));
    setTimeout(() => els.forEach((el) => el.classList.remove('filled')), 2500);
    const done = [...new Set(dest.filter((d) => d !== '').map(Number))].map(destName).join('・');
    ta.value = '';
    res = null;
    count = ed.names().length;
    const rest = Array.from({ length: count }, (_, i) => i).filter((i) => !applied.has(i));
    if (!rest.length) {
      mount(out, '');
      box.open = false;
      box.nextElementSibling?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      toast('ホール情報を入力しました。内容を確認して保存してください');
    } else {
      // 9 ホールずつの表：続けて残りを貼り付けてもらう
      mount(out, html`<p class="small good" style="margin-top:8px">✓ ${done}に入力しました。続けて ${destName(rest[0])} の表を貼り付けてください（入力しない部分があってもこのまま保存できます）。</p>`);
      toast(`${done}に入力しました`);
    }
  });
}
