// ラウンドの新規入力・編集（スコアカード形式）
import { html, raw, mount, $, $$, pct, toPar, today, icon, toast, errorToast, numOrNull, confirmDialog, WEATHERS } from '../util.js';
import { api, photoUrl } from '../api.js';
import { summarize, resultKey, played, courseHoleNo, RESULT_LABELS } from '../stats.js';
import { navigate, setLeaveGuard, refreshView } from '../main.js';
import { openCourseEditor, DEFAULT_PARS, ninesOf } from './courses.js';
import { uploadPhotos, isImageFile } from './photoTools.js';
import { loadDraft, saveDraft, clearDraft, draftText, draftTime, draftHref } from '../draft.js';

const HOLE_KEYS = ['par', 'yards', 'strokes', 'putts', 'fairway', 'penalties', 'bunker'];
const META_TEXT = ['date', 'course_name', 'tee', 'weather', 'companions', 'memo'];
const finiteOr = (v, d = null) => (Number.isFinite(v) ? v : d);

const FW_CYCLE = [null, 'hit', 'left', 'right'];
const FW_LABEL = { hit: '○', left: '←', right: '→' };
const FIELD_LABEL = { par: 'パー', yards: 'ヤード', putts: 'パット', penalties: 'OB・ペナルティ', bunker: 'バンカー' };
const FW_TITLE = { hit: 'フェアウェイキープ', left: '左に外した', right: '右に外した' };

export async function render(root, params) {
  const editId = params[0] ? Number(params[0]) : null;
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  let [courses, round, savedPhotos] = await Promise.all([
    api.get('/api/courses'),
    editId ? api.get(`/api/rounds/${editId}`) : Promise.resolve(null),
    editId ? api.get(`/api/photos?round_id=${editId}`) : Promise.resolve([]),
  ]);

  const meta = {
    date: round?.date || today(),
    course_id: round?.course_id ?? (query.get('course') ? Number(query.get('course')) : null),
    course_name: round?.course_name || '',
    tee: round?.tee || '',
    weather: round?.weather || '',
    companions: round?.companions || '',
    memo: round?.memo || '',
    front_nine: round?.front_nine ?? 1, // 27・36 ホールのゴルフ場で前半・後半に回った 9 ホール
    back_nine: round?.back_nine ?? 2,
  };
  const holes = Array.from({ length: 18 }, (_, i) => {
    const h = round?.holes?.find((x) => x.hole_no === i + 1);
    return {
      hole_no: i + 1,
      par: h?.par ?? DEFAULT_PARS[i],
      yards: h?.yards ?? null,
      strokes: h?.strokes ?? null,
      putts: h?.putts ?? null,
      fairway: h?.fairway ?? null,
      penalties: h?.penalties ?? null,
      bunker: h?.bunker ?? null,
    };
  });

  // 入力途中の下書きがあれば、そこから再開する（同じラウンドの新規入力・編集のときだけ）
  const draft = loadDraft();
  const resumed = Boolean(draft && (draft.edit_id ?? null) === editId);
  const otherDraft = draft && !resumed ? draft : null;
  if (resumed) {
    for (const k of META_TEXT) if (typeof draft.meta[k] === 'string') meta[k] = draft.meta[k];
    meta.course_id = finiteOr(draft.meta.course_id);
    if (meta.course_id && !courses.some((c) => c.id === meta.course_id)) meta.course_id = null; // コースが削除されていた
    meta.front_nine = finiteOr(draft.meta.front_nine, 1);
    meta.back_nine = finiteOr(draft.meta.back_nine, 2);
    draft.holes.slice(0, 18).forEach((d, i) => {
      if (!d || typeof d !== 'object') return;
      for (const k of HOLE_KEYS) {
        if (k === 'fairway') holes[i].fairway = FW_CYCLE.includes(d.fairway) ? d.fairway : null;
        else if (k === 'par') holes[i].par = finiteOr(d.par, holes[i].par);
        else holes[i][k] = finiteOr(d[k]);
      }
    });
  }
  const currentCourse = () => courses.find((c) => c.id === meta.course_id) || null;
  // 前半・後半の 9 ホールがコースの範囲に収まるようにする（9 ホールだけのコースは同じ 9 ホールを 2 周）
  const fitNines = (c) => {
    const n = ninesOf(c).length;
    if (!(meta.front_nine >= 1 && meta.front_nine <= n)) meta.front_nine = 1;
    if (!(meta.back_nine >= 1 && meta.back_nine <= n)) meta.back_nine = Math.min(2, n);
  };
  const applyCourse = (c) => {
    if (!c) return;
    fitNines(c);
    for (const h of holes) {
      const ch = c.holes.find((x) => x.hole_no === courseHoleNo(meta, h.hole_no));
      if (!ch) continue;
      h.par = ch.par;
      h.yards = ch.yards;
      if (h.par === 3) h.fairway = null;
    }
  };
  // まとまりが 3 つ以上のゴルフ場のときの、ホールの説明（例:「南コース 3番」）
  const multiNames = () => { const c = currentCourse(); return c && ninesOf(c).length > 2 ? ninesOf(c) : null; };
  const nineOfHole = (no) => { const n = multiNames(); return n ? `${n[(no <= 9 ? meta.front_nine : meta.back_nine) - 1] ?? ''} ${((no - 1) % 9) + 1}番` : ''; };
  if (!round && !resumed && meta.course_id) applyCourse(courses.find((c) => c.id === meta.course_id));

  // 変更があったら少し待って下書きに保存。保存できていれば、画面を離れても確認は出さない（続きから再開できる）
  let dirty = false;
  let draftOk = true;
  let draftTimer = 0;
  setLeaveGuard(() => dirty && !draftOk);
  const writeDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = 0;
    if (!dirty) return;
    const fd = new FormData(form);
    const m = { ...meta };
    for (const k of ['date', 'tee', 'weather', 'companions', 'memo']) m[k] = String(fd.get(k) ?? '');
    draftOk = saveDraft({ edit_id: editId, meta: m, holes });
    const st = $('#draft-status', root);
    if (st) st.textContent = draftOk ? `✓ 下書きを自動保存しました（${draftTime({ saved_at: new Date().toISOString() })}）` : '⚠ この環境では下書きを保存できません。保存するまで画面を閉じないでください';
  };
  const markDirty = () => {
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 400);
  };
  const flushDraft = () => { if (draftTimer) writeDraft(); };
  const onHide = () => { if (document.visibilityState === 'hidden') flushDraft(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flushDraft);
  const dropDraft = () => {
    dirty = false;
    clearTimeout(draftTimer);
    draftTimer = 0;
    clearDraft();
  };

  const courseOptions = () => html`<option value="">コースを選択…</option>
    ${courses.map((c) => html`<option value="${c.id}" ${c.id === meta.course_id ? 'selected' : ''}>${c.name}</option>`)}
    ${!meta.course_id && meta.course_name ? html`<option value="" selected>${meta.course_name}（未登録）</option>` : ''}`;

  const cell = (h, k, attrs = '') => html`<td><input type="number" inputmode="numeric" data-h="${h.hole_no}" data-k="${k}" value="${h[k] ?? ''}" ${attrs ? raw(attrs) : ''} aria-label="${h.hole_no}番 ${FIELD_LABEL[k]}"></td>`;
  const half = (from) => {
    const hs = holes.slice(from, from + 9);
    const tag = from ? 'IN' : 'OUT';
    return html`<p class="small nine-cap" data-cap="${from}" hidden></p><table class="scorecard">
      <thead><tr><th>ホール</th>${hs.map((h) => html`<th>${h.hole_no}</th>`)}<th class="sum">${tag}</th></tr></thead>
      <tbody>
        <tr><td>パー</td>${hs.map((h) => cell(h, 'par', 'min="3" max="6"'))}<td class="sum" data-sum="par-${from}"></td></tr>
        <tr><td>ヤード</td>${hs.map((h) => cell(h, 'yards', 'min="0" max="900" style="width:48px"'))}<td class="sum" data-sum="yards-${from}"></td></tr>
        <tr class="row-score"><td>スコア</td>${hs.map((h) => html`<td><input class="score-in" type="number" inputmode="numeric" min="1" max="20" data-h="${h.hole_no}" data-k="strokes" value="${h.strokes ?? ''}" placeholder="${h.par}" aria-label="${h.hole_no}番 スコア"></td>`)}<td class="sum" data-sum="strokes-${from}"></td></tr>
        <tr><td>パット</td>${hs.map((h) => cell(h, 'putts', 'min="0" max="10"'))}<td class="sum" data-sum="putts-${from}"></td></tr>
        <tr><td>FW</td>${hs.map((h) => html`<td><button type="button" class="fw-btn" data-fw="${h.hole_no}"></button></td>`)}<td class="sum" data-sum="fw-${from}"></td></tr>
        <tr><td>OB・ペナ</td>${hs.map((h) => cell(h, 'penalties', 'min="0" max="10"'))}<td class="sum" data-sum="penalties-${from}"></td></tr>
        <tr><td>バンカー</td>${hs.map((h) => cell(h, 'bunker', 'min="0" max="10"'))}<td class="sum" data-sum="bunker-${from}"></td></tr>
      </tbody>
    </table>`;
  };

  mount(root, html`
    <div class="page-header">
      <div><a class="small" href="${editId ? `#/rounds/${editId}` : '#/rounds'}">← 戻る</a><h1>${editId ? 'ラウンドを編集' : 'スコアを入力'}</h1>
        <div class="sub small" id="draft-status">入力内容は自動で下書き保存されます（途中でアプリを閉じても続きから入力できます）</div></div>
      <div class="actions"><button class="btn btn-primary" data-save>保存する</button></div>
    </div>
    ${resumed ? html`<div class="notice draft-notice" id="draft-notice">
      <span>📝 入力途中のラウンドを再開しました（${draftTime(draft)} に自動保存した内容）。</span>
      <button type="button" class="btn btn-sm" data-discard>破棄して最初から</button></div>` : ''}
    ${otherDraft ? html`<div class="notice draft-notice">
      <span>📝 別の入力途中のラウンドがあります：${draftText(otherDraft)}。ここで入力を始めると、その下書きは置き換わります。</span>
      <a class="btn btn-sm btn-primary" href="${draftHref(otherDraft)}">そちらを開く</a></div>` : ''}
    <form id="round-form" autocomplete="off" novalidate>
      <div class="card">
        <h2 style="margin-bottom:12px">基本情報</h2>
        <div class="form-grid">
          <label class="field"><span>日付 *</span><input type="date" name="date" value="${meta.date}" required></label>
          <div class="field" style="grid-column:span 2"><label for="course">コース *</label>
            <div style="display:flex;gap:6px"><select id="course" name="course_id">${courseOptions()}</select>
            <button type="button" class="btn" id="new-course" title="新しいコースを登録">${icon('plus')}新規</button></div></div>
          <div class="field" id="nine-field" style="grid-column:span 2" hidden><label for="front-nine">回ったコース（前半 → 後半）</label>
            <div class="nine-pick"><select id="front-nine" aria-label="前半のコース"></select><span aria-hidden="true">→</span><select id="back-nine" aria-label="後半のコース"></select></div></div>
          <label class="field"><span>ティー</span><input name="tee" list="tee-list" value="${meta.tee}" placeholder="例: レギュラー">
            <datalist id="tee-list"><option value="レギュラー"><option value="バック"><option value="フロント"><option value="レディース"><option value="チャンピオン"></datalist></label>
          <label class="field"><span>天気</span><select name="weather"><option value="">—</option>${WEATHERS.map((w) => html`<option ${w === meta.weather ? 'selected' : ''}>${w}</option>`)}</select></label>
          <label class="field" style="grid-column:span 2"><span>同伴者</span><input name="companions" value="${meta.companions}" maxlength="300" placeholder="例: 田中さん、佐藤さん"></label>
          <label class="field wide"><span>メモ・振り返り</span><textarea name="memo" rows="2" maxlength="4000" placeholder="良かった点・反省点など">${meta.memo}</textarea></label>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div><h2>スコア</h2><div class="sub" id="mode-help"></div></div>
          <div class="seg" role="group" aria-label="入力方法">
            <button type="button" data-mode="hole">1ホールずつ</button><button type="button" data-mode="card">スコアカード</button>
          </div>
        </div>
        <div id="hole-entry" class="hole-entry"></div>
        <div id="card-entry">
          <div class="table-wrap">${half(0)}</div>
          <div class="table-wrap" style="margin-top:12px">${half(9)}</div>
        </div>
        <div class="tiles" style="margin-top:16px" id="totals"></div>
      </div>
      <div class="card" id="photo-card">
        <div class="card-header">
          <div><h2>思い出の写真</h2><div class="sub">記念撮影やコースの景色など。「保存する」でラウンドと一緒に保存されます</div></div>
          ${savedPhotos.length ? html`<span class="muted small nowrap">保存済み ${savedPhotos.length} 枚</span>` : ''}
        </div>
        <div class="photo-grid" id="photo-list" ${savedPhotos.length ? '' : raw('hidden')}>${savedPhotos.map((p) => html`<div class="ph saved"><img src="${photoUrl(p)}" alt="${p.caption || '保存済みの写真'}" loading="lazy"></div>`)}</div>
        <label class="btn photo-pick"><input type="file" accept="image/*" multiple hidden id="photo-input">${icon('photo')}写真を選ぶ（撮影・写真ライブラリ）</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-cancel>キャンセル</button>
        <button type="button" class="btn btn-primary" data-save>保存する</button>
      </div>
    </form>
  `);

  const form = $('#round-form', root);

  const updateFw = (no) => {
    const h = holes[no - 1];
    const b = $(`[data-fw="${no}"]`, form);
    b.disabled = h.par === 3;
    b.className = `fw-btn ${h.fairway || ''}`;
    b.textContent = h.par === 3 ? '—' : FW_LABEL[h.fairway] || '·';
    b.title = h.par === 3 ? 'パー3（対象外）' : FW_TITLE[h.fairway] || '未記録';
    b.setAttribute('aria-label', `${no}番 フェアウェイ: ${b.title}`);
  };
  const updateScoreClass = (no) => {
    const h = holes[no - 1];
    const inp = $(`[data-h="${no}"][data-k="strokes"]`, form);
    inp.style.borderColor = played(h) ? `var(--score-${resultKey(h.strokes, h.par)})` : '';
    inp.style.borderWidth = played(h) ? '2px' : '';
    inp.placeholder = h.par;
  };
  const updateTotals = () => {
    for (const from of [0, 9]) {
      const hs = holes.slice(from, from + 9);
      const sum = (k) => hs.reduce((a, h) => a + (Number(h[k]) || 0), 0);
      const anyPlayed = hs.some(played);
      $(`[data-sum="par-${from}"]`, form).textContent = sum('par');
      $(`[data-sum="yards-${from}"]`, form).textContent = sum('yards') || '';
      $(`[data-sum="strokes-${from}"]`, form).textContent = anyPlayed ? sum('strokes') : '';
      $(`[data-sum="putts-${from}"]`, form).textContent = hs.some((h) => Number.isFinite(h.putts)) ? sum('putts') : '';
      const fwT = hs.filter((h) => h.par >= 4 && h.fairway).length;
      $(`[data-sum="fw-${from}"]`, form).textContent = fwT ? `${hs.filter((h) => h.fairway === 'hit').length}/${fwT}` : '';
      $(`[data-sum="penalties-${from}"]`, form).textContent = sum('penalties') || '';
      $(`[data-sum="bunker-${from}"]`, form).textContent = sum('bunker') || '';
    }
    const s = summarize({ holes });
    const t = (label, value, sub = '') => html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${sub}</div></div>`;
    mount($('#totals', root), html`
      ${t('スコア', s.holes ? s.strokes : '—', s.holes ? `${s.holes}ホール入力済み` : 'まだ入力がありません')}
      ${t('パー比', s.holes ? toPar(s.toPar) : '—', s.holes ? `パー ${s.par}` : '')}
      ${t('パット', s.puttHoles ? s.putts : '—', s.threePutts ? `3パット ${s.threePutts} 回` : '')}
      ${t('FWキープ', s.fwTotal ? pct(s.fwHit / s.fwTotal) : '—', s.fwTotal ? `${s.fwHit}/${s.fwTotal}` : '')}
      ${t('パーオン', s.girKnown ? pct(s.gir / s.girKnown) : '—', s.girKnown ? `${s.gir}/${s.girKnown}` : 'パット入力で自動計算')}
      ${t('OB・ペナルティ', s.holes ? s.penalties : '—')}`);
  };

  for (let i = 1; i <= 18; i++) { updateFw(i); updateScoreClass(i); }
  updateTotals();

  // 入力 → 状態に反映
  form.addEventListener('input', (e) => {
    markDirty();
    const el = e.target;
    if (el.dataset.h) {
      const h = holes[Number(el.dataset.h) - 1];
      const v = numOrNull(el.value);
      h[el.dataset.k] = v;
      if (el.dataset.k === 'par') {
        if (h.par === 3) h.fairway = null;
        updateFw(h.hole_no);
      }
      updateScoreClass(h.hole_no);
      updateTotals();
    }
  });
  form.addEventListener('change', markDirty);

  // Enter で スコア → パット → 次のホールのスコア へ
  form.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset.h) return;
    e.preventDefault();
    const no = Number(el.dataset.h);
    let next = null;
    if (el.dataset.k === 'strokes') next = $(`[data-h="${no}"][data-k="putts"]`, form);
    else if (no < 18) next = $(`[data-h="${no + 1}"][data-k="strokes"]`, form);
    if (next) { next.focus(); next.select(); }
  });

  $$('[data-fw]', form).forEach((b) => b.addEventListener('click', () => {
    const h = holes[Number(b.dataset.fw) - 1];
    h.fairway = FW_CYCLE[(FW_CYCLE.indexOf(h.fairway) + 1) % FW_CYCLE.length];
    updateFw(h.hole_no);
    updateTotals();
    markDirty();
  }));

  // 表の入力欄を状態に合わせる
  const syncInputs = (no) => {
    const h = holes[no - 1];
    for (const k of ['par', 'yards', 'strokes', 'putts', 'penalties', 'bunker']) {
      $(`[data-h="${no}"][data-k="${k}"]`, form).value = h[k] ?? '';
    }
    updateFw(no);
    updateScoreClass(no);
  };

  // ---- 1ホールずつ入力（スマホ向け：大きなボタンでタップ入力） ----
  const holeEl = $('#hole-entry', form);
  let cur = (holes.find((h) => !played(h)) || holes[0]).hole_no;
  const chip = (field, value, on, label) => html`<button type="button" class="chip ${on ? 'on' : ''}" data-field="${field}" data-value="${value}" aria-pressed="${on}">${label}</button>`;
  const stepper = (field, v, label) => html`<div class="stepper">
    <button type="button" class="btn btn-icon" data-step="${field}" data-d="-1" aria-label="${label}を減らす">−</button>
    <span class="st-val" aria-live="polite">${v ?? '–'}</span>
    <button type="button" class="btn btn-icon" data-step="${field}" data-d="1" aria-label="${label}を増やす">＋</button></div>`;
  const drawHole = () => {
    const h = holes[cur - 1];
    const k = played(h) ? resultKey(h.strokes, h.par) : null;
    mount(holeEl, html`
      <div class="hole-strip">${holes.map((x) => html`<button type="button" class="hs ${x.hole_no === cur ? 'on' : ''} ${played(x) ? `res-${resultKey(x.strokes, x.par)}` : ''}" data-go="${x.hole_no}" aria-label="${x.hole_no}番ホール">
        <span class="hs-no">${x.hole_no}</span><span class="hs-sc">${played(x) ? x.strokes : '·'}</span></button>`)}</div>
      <div class="he-head">
        <button type="button" class="btn btn-icon" data-prev ${cur === 1 ? 'disabled' : ''} aria-label="前のホール">‹</button>
        <div class="he-title"><div class="he-no">${cur}<small> 番ホール</small></div><div class="he-sub">${nineOfHole(cur) ? `${nineOfHole(cur)} ・ ` : ''}Par ${h.par}${h.yards ? ` ・ ${h.yards} yd` : ''}</div></div>
        <button type="button" class="btn btn-icon" data-next ${cur === 18 ? 'disabled' : ''} aria-label="次のホール">›</button>
      </div>
      <div class="he-row"><div class="he-label">スコア <span class="he-res">${k ? RESULT_LABELS[k] : ''}</span></div>
        <div class="he-line"><div class="chips">${[h.par - 1, h.par, h.par + 1, h.par + 2, h.par + 3].map((v) => chip('strokes', v, h.strokes === v, v))}</div>
        ${stepper('strokes', h.strokes, 'スコア')}</div></div>
      <div class="he-row"><div class="he-label">パット</div>
        <div class="chips">${[0, 1, 2, 3, 4].map((v) => chip('putts', v, h.putts === v, v))}</div></div>
      <div class="he-row"><div class="he-label">ティーショット</div>
        <div class="chips fw">${h.par === 3 ? html`<span class="muted small">パー3は対象外</span>`
          : [['left', '← 左'], ['hit', raw('○ FW<wbr>キープ')], ['right', '右 →']].map(([v, l]) => chip('fairway', v, h.fairway === v, l))}</div></div>
      <div class="he-row he-two">
        <div><div class="he-label">OB・ペナルティ</div>${stepper('penalties', h.penalties ?? 0, 'OB・ペナルティ')}</div>
        <div><div class="he-label">バンカー</div>${stepper('bunker', h.bunker ?? 0, 'バンカー')}</div>
      </div>
      <div class="he-row"><div class="he-label">パー（コース未登録のとき）</div>
        <div class="chips">${[3, 4, 5].map((p) => chip('par', p, h.par === p, `Par ${p}`))}</div></div>
      <button type="button" class="btn btn-primary he-nextbig" ${cur === 18 ? 'data-done' : 'data-next'}>${cur < 18 ? `次へ（${cur + 1}番ホール） ›` : '18ホール入力完了 ✓'}</button>
    `);
    holeEl.querySelector('.hs.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };
  holeEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const h = holes[cur - 1];
    if (b.dataset.go) { cur = Number(b.dataset.go); drawHole(); return; }
    if (b.hasAttribute('data-prev')) { cur = Math.max(1, cur - 1); drawHole(); return; }
    if (b.hasAttribute('data-next')) { cur = Math.min(18, cur + 1); drawHole(); holeEl.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (b.hasAttribute('data-done')) { $('#totals', root).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (b.dataset.field) {
      const f = b.dataset.field;
      let v = f === 'fairway' ? b.dataset.value : Number(b.dataset.value);
      if (h[f] === v && f !== 'par') v = null; // もう一度押すと解除
      h[f] = v;
      if (f === 'par' && v === 3) h.fairway = null;
    } else if (b.dataset.step) {
      const f = b.dataset.step;
      const d = Number(b.dataset.d);
      const [min, max] = f === 'strokes' ? [1, 20] : [0, 10];
      const base = h[f] ?? (f === 'strokes' ? (d > 0 ? h.par - 1 : h.par + 1) : 0);
      h[f] = Math.max(min, Math.min(max, base + d));
    } else return;
    markDirty();
    syncInputs(h.hole_no);
    updateTotals();
    drawHole();
  });

  // 入力方法の切り替え（スマホは「1ホールずつ」が既定）
  const setMode = (mode) => {
    try { localStorage.setItem('golf-entry-mode', mode); } catch { /* ignore */ }
    $$('[data-mode]', form).forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    holeEl.hidden = mode !== 'hole';
    $('#card-entry', form).hidden = mode !== 'card';
    $('#mode-help', form).textContent = mode === 'hole'
      ? 'ボタンをタップして入力。上の数字でホールを移動できます。もう一度タップすると解除。'
      : 'スコア入力後に Enter でパット → 次のホールへ移動。FW は押すたびに ○(キープ) → ←(左) → →(右) → 未記録 と切り替わります。';
    if (mode === 'hole') drawHole();
  };
  $$('[data-mode]', form).forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  let savedMode = null;
  try { savedMode = localStorage.getItem('golf-entry-mode'); } catch { /* ignore */ }
  setMode(savedMode || (window.matchMedia('(max-width: 760px)').matches ? 'hole' : 'card'));

  const courseSel = $('#course', form);
  const frontSel = $('#front-nine', form);
  const backSel = $('#back-nine', form);
  // 27・36 ホールのゴルフ場なら「前半 → 後半」の選択を出す
  const drawNinePick = () => {
    const names = multiNames();
    $('#nine-field', form).hidden = !names;
    if (names) {
      fitNines(currentCourse());
      const opts = (sel) => html`${names.map((n, i) => html`<option value="${i + 1}" ${sel === i + 1 ? 'selected' : ''}>${n}</option>`)}`;
      mount(frontSel, opts(meta.front_nine));
      mount(backSel, opts(meta.back_nine));
    }
    for (const from of [0, 9]) {
      const cap = $(`[data-cap="${from}"]`, form);
      cap.hidden = !names;
      cap.textContent = names ? `${from ? '後半' : '前半'}：${names[(from ? meta.back_nine : meta.front_nine) - 1] ?? ''}` : '';
    }
  };
  const syncCourseInputs = () => {
    for (const h of holes) syncInputs(h.hole_no);
    updateTotals();
    drawNinePick();
    if (!holeEl.hidden) drawHole();
  };
  drawNinePick();
  courseSel.addEventListener('change', () => {
    meta.course_id = courseSel.value ? Number(courseSel.value) : null;
    meta.front_nine = 1;
    meta.back_nine = 2;
    const c = currentCourse();
    if (c) { meta.course_name = c.name; applyCourse(c); }
    syncCourseInputs();
  });
  for (const [sel, key] of [[frontSel, 'front_nine'], [backSel, 'back_nine']]) {
    sel.addEventListener('change', () => {
      meta[key] = Number(sel.value);
      applyCourse(currentCourse());
      syncCourseInputs();
    });
  }
  $('#new-course', form).addEventListener('click', async () => {
    const c = await openCourseEditor(null, { holes: holes.map((h) => ({ hole_no: h.hole_no, par: h.par, yards: h.yards })) });
    if (!c) return;
    courses = await api.get('/api/courses');
    meta.course_id = c.id;
    meta.course_name = c.name;
    meta.front_nine = 1;
    meta.back_nine = 2;
    mount(courseSel, courseOptions());
    applyCourse(c);
    syncCourseInputs();
    markDirty();
  });

  // 思い出の写真：選んだ写真は、ラウンドを保存したあとにまとめて保存する
  const pending = []; // { file, url, el }
  const photoList = $('#photo-list', form);
  const photoInput = $('#photo-input', form);
  const syncPhotoList = () => { photoList.hidden = !photoList.childElementCount; };
  const dropPending = (p) => {
    URL.revokeObjectURL(p.url);
    p.el.remove();
    pending.splice(pending.indexOf(p), 1);
    syncPhotoList();
  };
  photoInput.addEventListener('change', () => {
    for (const file of photoInput.files) {
      if (!isImageFile(file)) continue;
      const p = { file, url: URL.createObjectURL(file), el: document.createElement('div') };
      p.el.className = 'ph pending';
      mount(p.el, html`<img src="${p.url}" alt="選んだ写真"><button type="button" class="ph-remove" aria-label="この写真を外す">×</button>`);
      // HEIC などブラウザで表示できない形式はファイル名で表示
      $('img', p.el).addEventListener('error', (e) => {
        const name = document.createElement('span');
        name.className = 'ph-name';
        name.textContent = file.name;
        e.target.replaceWith(name);
      });
      $('.ph-remove', p.el).addEventListener('click', () => dropPending(p));
      photoList.append(p.el);
      pending.push(p);
    }
    photoInput.value = '';
    syncPhotoList();
    if (pending.length) markDirty();
  });

  const save = async () => {
    const fd = new FormData(form);
    if (!fd.get('date')) { errorToast('日付を入力してください'); return; }
    if (!meta.course_id && !meta.course_name) { errorToast('コースを選択するか「新規」で登録してください'); courseSel.focus(); return; }
    const bad = holes.find((h) => played(h) && Number.isFinite(h.putts) && h.putts >= h.strokes);
    if (bad) { errorToast(`${bad.hole_no}番: パット数がスコア以上になっています`); return; }
    if (!holes.some(played) && !window.confirm('スコアが1ホールも入力されていません。このまま保存しますか？')) return;
    const c = courses.find((x) => x.id === meta.course_id);
    const body = {
      date: fd.get('date'),
      course_id: meta.course_id,
      course_name: meta.course_name,
      tee: fd.get('tee'),
      weather: fd.get('weather'),
      companions: fd.get('companions'),
      memo: fd.get('memo'),
      rating: c ? c.rating : round?.rating ?? null,
      slope: c ? c.slope : round?.slope ?? null,
      front_nine: c ? meta.front_nine : null,
      back_nine: c ? meta.back_nine : null,
      holes,
    };
    $$('[data-save]', root).forEach((b) => { b.disabled = true; });
    try {
      const saved = editId ? await api.put(`/api/rounds/${editId}`, body) : await api.post('/api/rounds', body);
      dropDraft();
      toast('ラウンドを保存しました');
      if (pending.length) {
        const btns = $$('[data-save]', root);
        await uploadPhotos(pending.map((p) => p.file), { roundId: saved.id }, (d, n) => btns.forEach((b) => { b.textContent = `写真を保存中… ${d}/${n}`; }));
        [...pending].forEach(dropPending);
      }
      navigate(`/rounds/${saved.id}`);
    } catch (e) {
      errorToast(e);
      $$('[data-save]', root).forEach((b) => { b.disabled = false; });
    }
  };
  $$('[data-save]', root).forEach((b) => b.addEventListener('click', save));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

  // キャンセル：入力した内容（下書き）を破棄して戻る
  $('[data-cancel]', root).addEventListener('click', async () => {
    if (dirty || resumed) {
      if (!(await confirmDialog('入力した内容を破棄して戻りますか？', { okText: '破棄する', danger: true }))) return;
      dropDraft();
    }
    navigate(editId ? `/rounds/${editId}` : '/rounds');
  });
  $('[data-discard]', root)?.addEventListener('click', async () => {
    if (!(await confirmDialog('入力途中の内容を破棄して、最初から入力しますか？', { okText: '破棄する', danger: true }))) return;
    dropDraft();
    refreshView();
  });

  // PC（スコアカード入力）のときだけ最初の欄にフォーカス（スマホでキーボードが勝手に出ないように）
  if (!editId && !resumed && holeEl.hidden) setTimeout(() => (meta.course_id ? $('[data-h="1"][data-k="strokes"]', form) : courseSel).focus(), 0);
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flushDraft);
    flushDraft();
    if (dirty && draftOk) toast('入力途中の内容は下書きに保存しました。「入力」かホームから続きを入力できます');
    setLeaveGuard(null);
    pending.forEach((p) => URL.revokeObjectURL(p.url));
  };
}
