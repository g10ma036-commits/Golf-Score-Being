// AI に分析してもらう：スコアのデータから、ChatGPT・Claude・Gemini などに貼り付ける質問文（プロンプト）を作る
import { html, mount, $, $$, fmtDate, icon, toast, errorToast } from '../util.js';
import { api, getSettings } from '../api.js';
import { AI_PURPOSES, AI_PERIODS, buildAiPrompt } from '../aiPrompt.js';
import { summarize } from '../stats.js';

const AI_LINKS = [
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Claude', 'https://claude.ai/new'],
  ['Gemini', 'https://gemini.google.com/app'],
];
const DEFAULTS = { holes: true, clubs: false, memo: false };

export async function render(root) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const [rounds, courses, clubs, settings] = await Promise.all([api.get('/api/rounds'), api.get('/api/courses'), api.get('/api/clubs'), getSettings()]);
  const sorted = [...rounds].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const playedCourses = courses.filter((c) => c.holes?.length);

  const state = {
    purpose: AI_PURPOSES.some((p) => p.key === query.get('purpose')) ? query.get('purpose') : query.get('round') ? 'round' : query.get('course') ? 'course' : 'overall',
    period: '',
    roundId: Number(query.get('round')) || sorted[0]?.id || null,
    courseId: Number(query.get('course')) || (sorted.find((r) => r.course_id)?.course_id ?? playedCourses[0]?.id ?? null),
    ...DEFAULTS,
  };
  const purposeOf = () => AI_PURPOSES.find((p) => p.key === state.purpose);
  // 目的に合わせて、含めるデータの初期値を変える（クラブの飛距離はコース攻略・クラブ相談・練習で役に立つ）
  const applyPurposeDefaults = () => {
    state.clubs = ['course', 'clubs', 'practice'].includes(state.purpose);
    state.holes = state.purpose !== 'clubs';
    state.period = purposeOf().period || '';
  };
  applyPurposeDefaults();

  const roundLabel = (r) => { const s = summarize(r); return `${fmtDate(r.date)} ${r.course_name || ''}（${s.holes ? s.strokes : '—'}）`; };

  mount(root, html`
    <div class="page-header">
      <div><h1>AIに分析してもらう</h1>
        <div class="sub">記録したスコアから、ChatGPT・Claude・Gemini などのAIに貼り付ける「質問文（プロンプト）」を作ります。料金はかかりません（各AIの無料プランで使えます）。</div></div>
    </div>
    <div class="ai-layout">
      <div class="card">
        <h2 style="margin-bottom:10px">1. 何を聞きたいですか？</h2>
        <div class="ai-purposes" role="radiogroup" aria-label="分析の目的">
          ${AI_PURPOSES.map((p) => html`<label class="ai-purpose"><input type="radio" name="purpose" value="${p.key}" ${p.key === state.purpose ? 'checked' : ''}>
            <span class="ai-p-title">${p.label}</span><span class="ai-p-desc">${p.desc}</span></label>`)}
        </div>
        <h2 style="margin:18px 0 10px">2. 使うデータ</h2>
        <div class="form-grid">
          <label class="field" data-show="period"><span>対象の期間</span><select name="period">${AI_PERIODS.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
          <label class="field" data-show="round" style="grid-column:span 2"><span>振り返るラウンド</span>
            <select name="round">${sorted.slice(0, 100).map((r) => html`<option value="${r.id}" ${r.id === state.roundId ? 'selected' : ''}>${roundLabel(r)}</option>`)}</select></label>
          <label class="field" data-show="course" style="grid-column:span 2"><span>攻略するコース</span>
            <select name="course">${playedCourses.map((c) => html`<option value="${c.id}" ${c.id === state.courseId ? 'selected' : ''}>${c.name}</option>`)}</select></label>
        </div>
        <div class="ai-checks">
          <label class="check"><input type="checkbox" name="holes"> ホールごとの記録（スコア・パット・FW など）</label>
          <label class="check"><input type="checkbox" name="clubs"> クラブと飛距離</label>
          <label class="check"><input type="checkbox" name="memo"> ラウンドのメモ・振り返り</label>
        </div>
        <p class="small muted" style="margin-top:8px">名前と同伴者は含めません。メモは、チェックしたときだけ含めます。</p>
      </div>

      <div class="card ai-output">
        <div class="card-header"><div><h2>3. コピーしてAIに貼り付け</h2><div class="sub" id="ai-count"></div></div></div>
        <textarea id="ai-text" readonly rows="14" aria-label="作成した質問文"></textarea>
        <div class="actions" style="margin-top:10px">
          <button type="button" class="btn btn-primary" id="ai-copy">質問文をコピー</button>
          ${navigator.share ? html`<button type="button" class="btn" id="ai-share">共有…</button>` : ''}
        </div>
        <div class="ai-links">
          <span class="small secondary">AIを開く：</span>
          ${AI_LINKS.map(([name, url]) => html`<a class="btn btn-sm" href="${url}" target="_blank" rel="noopener noreferrer">${name}${icon('external')}</a>`)}
        </div>
        <ol class="steps small secondary" style="margin-top:12px">
          <li>「質問文をコピー」を押す</li>
          <li>使いたいAIを開き、入力欄に貼り付けて送信</li>
          <li>答えを読んで気になることがあれば、続けて質問できます（例：「パター練習だけ詳しく」）</li>
        </ol>
        <p class="small muted" style="margin-top:8px">このアプリからAIへ自動で送られることはありません。貼り付けて送信したときに、そのAIサービスへ送られます。AIの答えは参考情報として活用してください。</p>
      </div>
    </div>
  `);

  const form = root;
  const text = $('#ai-text', root);
  const sync = () => {
    $$('[name=purpose]', form).forEach((r) => { r.closest('.ai-purpose').classList.toggle('on', r.checked); });
    $$('[data-show]', form).forEach((el) => {
      const k = el.dataset.show;
      el.hidden = k === 'period' ? !['overall', 'practice', 'goal', 'clubs'].includes(state.purpose) : k !== state.purpose;
    });
    $('[name=period]', form).value = state.period || 'last20';
    for (const k of ['holes', 'clubs', 'memo']) $(`[name=${k}]`, form).checked = state[k];
    let prompt = '';
    try {
      prompt = buildAiPrompt({ rounds, courses, clubs, settings }, { ...state });
    } catch (e) {
      errorToast(e);
    }
    text.value = prompt;
    $('#ai-count', root).textContent = `${prompt.length.toLocaleString()} 文字${prompt.length > 20000 ? '（長いので、AIによっては「ホールごとの記録」を外すか期間を短くしてください）' : ''}`;
  };
  $$('[name=purpose]', form).forEach((r) => r.addEventListener('change', () => { state.purpose = r.value; applyPurposeDefaults(); sync(); }));
  $('[name=period]', form).addEventListener('change', (e) => { state.period = e.target.value; sync(); });
  $('[name=round]', form)?.addEventListener('change', (e) => { state.roundId = Number(e.target.value); sync(); });
  $('[name=course]', form)?.addEventListener('change', (e) => { state.courseId = Number(e.target.value); sync(); });
  for (const k of ['holes', 'clubs', 'memo']) $(`[name=${k}]`, form).addEventListener('change', (e) => { state[k] = e.target.checked; sync(); });

  $('#ai-copy', root).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text.value);
      toast('コピーしました。AIの入力欄に貼り付けてください');
    } catch {
      text.focus();
      text.select();
      toast('自動でコピーできませんでした。選択された文字を長押し（右クリック）でコピーしてください', 'error');
    }
  });
  $('#ai-share', root)?.addEventListener('click', async () => {
    try { await navigator.share({ text: text.value }); } catch (e) { if (e?.name !== 'AbortError') errorToast('共有できませんでした'); }
  });
  sync();
}
