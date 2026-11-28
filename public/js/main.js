// ルーター・ナビゲーション・起動処理
import { $, $$, html, mount, icon, errorToast } from './util.js';
import { clearCharts, hideTooltip } from './charts.js';
import { api, getSettings, STANDALONE } from './api.js';
import { BACKGROUNDS } from './shared/model.js';

// メニュー。よく使う 3 つ（スマホは下のタブ）と、目的ごとのまとまり（スマホは「その他」）
const MAIN = [['/', 'home', 'ホーム'], ['/rounds', 'score', 'スコア'], ['/stats', 'stats', '分析']];
export const MENU_GROUPS = [
  ['振り返る', [['/progress', 'trend', '上達の|履歴'], ['/review', 'calendar', '年間の|まとめ'], ['/achievements', 'medal', '実績'], ['/ai', 'ai', 'AI分析']]],
  ['記録', [['/distances', 'distance', '飛距離'], ['/album', 'album', 'アルバム']]],
  ['準備・道具', [['/courses', 'course', 'コース'], ['/clubs', 'club', 'クラブ']]],
  ['アプリ', [['/settings', 'settings', '設定'], ['/help', 'help', '使い方']]],
];
const SEARCH = ['/search', 'search', '機能をさがす'];
// ラベルの「|」は、狭い画面で 2 行になるときの折り返し位置
const labelParts = (label) => label.split('|').map((p) => html`<span class="nb">${p}</span>`);
const plainLabel = (label) => label.replace(/\|/g, '');
const MORE = [SEARCH, ...MENU_GROUPS.flatMap(([, items]) => items)];
// スマホ用タブバー（中央はスコア入力ボタン）
const TABS = [MAIN[0], MAIN[1], ['/rounds/new', 'plus', '入力'], MAIN[2]];

const ROUTES = [
  [/^\/$/, () => import('./views/dashboard.js')],
  [/^\/rounds$/, () => import('./views/rounds.js')],
  [/^\/rounds\/new$/, () => import('./views/roundForm.js')],
  [/^\/rounds\/(\d+)\/edit$/, () => import('./views/roundForm.js')],
  [/^\/rounds\/(\d+)$/, () => import('./views/roundDetail.js')],
  [/^\/stats$/, () => import('./views/stats.js')],
  [/^\/ai$/, () => import('./views/ai.js')],
  [/^\/review$/, () => import('./views/review.js')],
  [/^\/progress$/, () => import('./views/progress.js')],
  [/^\/compare$/, () => import('./views/compare.js')],
  [/^\/achievements$/, () => import('./views/achievements.js')],
  [/^\/courses$/, () => import('./views/courses.js')],
  [/^\/courses\/(\d+)$/, () => import('./views/courseDetail.js')],
  [/^\/courses\/(\d+)\/sheet$/, () => import('./views/courseSheet.js')],
  [/^\/clubs$/, () => import('./views/clubs.js')],
  [/^\/distances$/, () => import('./views/distances.js')],
  [/^\/album$/, () => import('./views/album.js')],
  [/^\/album\/(all|none|\d+)$/, () => import('./views/albumDetail.js')],
  [/^\/settings$/, () => import('./views/settings.js')],
  [/^\/help$/, () => import('./views/help.js')],
  [/^\/search$/, () => import('./views/search.js')],
];

// 未保存の変更があるときに画面遷移を確認する
let leaveGuard = null;
let currentHash = location.hash || '#/';
export function setLeaveGuard(fn) { leaveGuard = fn; }
window.addEventListener('beforeunload', (e) => {
  if (leaveGuard && leaveGuard()) { e.preventDefault(); e.returnValue = ''; }
});

export function navigate(path) { location.hash = '#' + path; }
// 今の画面を作り直す（後片付けの処理も通常の画面移動と同じように呼ばれる）
export function refreshView() { route(); }

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('golf-theme', theme || 'auto'); } catch { /* ignore */ }
}
// テーマカラー（標準は緑）。ブラウザの上部の色（theme-color）も合わせる
export function applyAccent(accent) {
  const a = accent && accent !== 'green' ? accent : null;
  if (a) document.documentElement.dataset.accent = a;
  else delete document.documentElement.dataset.accent;
  try { localStorage.setItem('golf-accent', a || 'green'); } catch { /* ignore */ }
  requestAnimationFrame(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#17663f';
  });
}

// 文字の大きさ（画面全体を少し拡大する）。iPhone のホーム画面のアプリには文字サイズを変えるメニューが無いので、アプリの設定で選べるようにする
export function applyTextSize(size) {
  const v = size === 'large' || size === 'xlarge' ? size : null;
  if (v) document.documentElement.dataset.text = v;
  else delete document.documentElement.dataset.text;
  try { localStorage.setItem('golf-text-size', v || 'normal'); } catch { /* ignore */ }
}
// 背景のデザイン（標準は無地）
export function applyBackground(bg) {
  const v = bg && bg !== 'plain' && BACKGROUNDS.includes(bg) ? bg : null;
  if (v) document.documentElement.dataset.bg = v;
  else delete document.documentElement.dataset.bg;
  try { localStorage.setItem('golf-bg', v || 'plain'); } catch { /* ignore */ }
}

const isActive = (p, path) => (p === '/' ? path === '/' : path === p || (path.startsWith(p + '/') && !(p === '/rounds' && path === '/rounds/new')));

function renderNav(path) {
  const nav = document.getElementById('nav');
  const tabbar = document.getElementById('tabbar');
  const sheet = document.getElementById('more-sheet');
  if (!nav.childElementCount) {
    const link = ([p, ic, label]) => html`<a href="#${p}" data-path="${p}">${icon(ic)}<span>${plainLabel(label)}</span></a>`;
    mount(nav, html`<a href="#/search" data-path="/search" class="nav-search">${icon('search')}<span>機能をさがす</span></a>${MAIN.map(link)}${MENU_GROUPS.map(([title, items]) => html`<div class="nav-group">${title}</div>${items.map(link)}`)}`);
    mount(tabbar, html`${TABS.map(([p, ic, label]) => html`<a href="#${p}" data-path="${p}" class="${p === '/rounds/new' ? 'fab' : ''}">${icon(ic)}<span>${label}</span></a>`)}
      <button type="button" data-more aria-expanded="false" aria-controls="more-sheet">${icon('menu')}<span>その他</span></button>`);
    mount(sheet, html`<div class="more-panel"><a class="more-search" href="#/search" data-path="/search">${icon('search')}<span>機能をさがす<span class="muted">（例：バックアップ、試算）</span></span></a>${MENU_GROUPS.map(([title, items]) => html`<div class="more-group n${items.length}" role="group" aria-label="${title}">
      <div class="more-head" aria-hidden="true">${title}</div>${items.map(([p, ic, label]) => html`<a href="#${p}" data-path="${p}" aria-label="${plainLabel(label)}">${icon(ic)}<span>${labelParts(label)}</span></a>`)}</div>`)}</div>`);
    const moreBtn = $('[data-more]', tabbar);
    const toggle = (open) => { sheet.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); };
    moreBtn.addEventListener('click', () => toggle(sheet.hidden));
    sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('a')) toggle(false); });
  }
  for (const a of $$('a[data-path]', nav)) {
    const active = isActive(a.dataset.path, path);
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const a of $$('a[data-path]', tabbar)) a.classList.toggle('active', isActive(a.dataset.path, path));
  for (const a of $$('a[data-path]', sheet)) a.classList.toggle('active', isActive(a.dataset.path, path));
  $('[data-more]', tabbar).classList.toggle('active', MORE.some(([p]) => isActive(p, path)));
  sheet.hidden = true;
}

let token = 0;
let cleanup = null;
async function route() {
  if (leaveGuard && leaveGuard() && !window.confirm('保存していない変更があります。このページを離れますか？')) {
    history.replaceState(null, '', currentHash);
    return;
  }
  leaveGuard = null;
  currentHash = location.hash || '#/';
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const my = ++token;
  renderNav(path);
  clearCharts();
  hideTooltip();
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;

  const view = document.getElementById('view');
  const found = ROUTES.find(([re]) => re.test(path));
  if (!found) {
    mount(view, html`<div class="page"><div class="empty"><h2>ページが見つかりません</h2><a class="btn" href="#/">ホームへ</a></div></div>`);
    return;
  }
  const params = path.match(found[0]).slice(1);
  try {
    const mod = await found[1]();
    if (my !== token) return;
    view.replaceChildren();
    const page = document.createElement('div');
    page.className = 'page';
    view.appendChild(page);
    mount(page, html`<div class="loading">読み込み中…</div>`);
    const result = await mod.render(page, params, { isStale: () => my !== token });
    if (my !== token) return;
    cleanup = result || null;
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
    goTo(new URLSearchParams(location.hash.split('?')[1] || '').get('go'));
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    mount(view, html`<div class="page"><div class="card empty"><h2>読み込みに失敗しました</h2><p>${e.message}</p><a class="btn" href="#/">ホームへ</a></div></div>`);
  }
}

window.addEventListener('hashchange', route);

// ?go=（画面の中の場所の id）：そこまでスクロールして、少しのあいだ枠で示す（機能をさがす・お知らせなどから）
function goTo(id) {
  if (!id) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el || !document.getElementById('view').contains(el)) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ block: 'start' });
    el.classList.remove('go-flash');
    void el.offsetWidth;
    el.classList.add('go-flash');
    setTimeout(() => el.classList.remove('go-flash'), 2000);
  });
}

// スマホで文字を入力している間（キーボードが出ている間）は、下部タブバーを隠す。
// 画面の高さから推測すると機種によって誤判定して消えたままになるので、入力欄にフォーカスがあるかだけで決める
const NO_KEYBOARD = /^(checkbox|radio|file|button|submit|reset|range|color|date|time|month|week|datetime-local|hidden|image)$/;
function isTyping() {
  const el = document.activeElement;
  if (!el || !el.isConnected) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return el.tagName === 'INPUT' && !NO_KEYBOARD.test(el.type);
}
function hideTabbarWhileTyping() {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  const touch = window.matchMedia('(pointer: coarse)');
  const update = () => bar.classList.toggle('kb-open', touch.matches && isTyping());
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 50));
  // 入力中に画面を移動したら入力は終わり（入力欄が消えても隠れたままにならないように）
  window.addEventListener('hashchange', () => {
    if (isTyping()) document.activeElement.blur();
    setTimeout(update, 0);
    setTimeout(update, 600);
  });
  window.addEventListener('pageshow', update);
  update();
}

(async function boot() {
  try {
    const s = await getSettings();
    applyTheme(s.theme);
    applyAccent(s.accent);
    applyTextSize(s.text_size);
    applyBackground(s.background);
  } catch (e) {
    errorToast(e);
  }
  route();
  hideTabbarWhileTyping();
  if (STANDALONE) {
    // スマホ単独版：オフライン対応・ホーム画面への追加・データ保護
    document.documentElement.classList.add('standalone');
    import('./standalone.js').then((m) => m.initStandalone({ getLeaveGuard: () => leaveGuard, clearLeaveGuard: () => { leaveGuard = null; } }))
      .catch((e) => console.warn(e));
    return;
  }
  // PC で開いているときだけ「スマホで見る」ボタンを表示
  try {
    const lan = await api.get('/api/lan');
    const btn = document.getElementById('phone-btn');
    if (lan.available && lan.local) {
      mount(btn, html`${icon('phone')}<span>スマホで見る</span>${lan.enabled ? html`<span class="badge accent">ON</span>` : ''}`);
      btn.hidden = false;
      btn.addEventListener('click', async () => (await import('./views/mobileConnect.js')).openMobileConnect());
    }
  } catch { /* ignore */ }
})();

// 「スマホで見る」の ON/OFF 表示を更新
export function updatePhoneBadge(enabled) {
  const btn = document.getElementById('phone-btn');
  if (!btn || btn.hidden) return;
  const b = btn.querySelector('.badge');
  if (enabled && !b) btn.insertAdjacentHTML('beforeend', '<span class="badge accent">ON</span>');
  if (!enabled && b) b.remove();
}
