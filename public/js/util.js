// 共通ユーティリティ：安全な HTML テンプレート、書式、トースト、モーダル

export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ESC[c]); }

function toHtml(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return esc(String(v));
}

// 埋め込み値を自動エスケープするタグ付きテンプレート
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += toHtml(vals[i]);
  });
  return new Raw(out);
}

export function mount(el, tpl) { el.innerHTML = toHtml(tpl); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- 書式 ----------
export function fmt(n, d = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Number(n).toFixed(d);
}
export function fmtInt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ja-JP');
}
export function pct(n, d = 0) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(d)}%`;
}
export function toPar(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return 'E';
  const r = Math.round(n * 10) / 10;
  return (r > 0 ? '+' : '') + (Number.isInteger(r) ? r : r.toFixed(1));
}
export function signed(n, d = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = Number(n.toFixed(d));
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
}
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function fmtDate(s, { weekday = true, year = true } = {}) {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${year ? y + '/' : ''}${m}/${d}${weekday ? `(${WD[dt.getDay()]})` : ''}`;
}
export function shortDate(s) {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${y.slice(2)}/${Number(m)}/${Number(d)}`;
}
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function localDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function formObject(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = el.value;
  }
  return o;
}

// ---------- トースト ----------
export function toast(msg, type = 'info') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2600);
}
export function errorToast(e) { toast(e?.message || String(e), 'error'); }

// ---------- モーダル ----------
export function openModal({ title, body, wide = false, footer = null, onClose = null }) {
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  mount(back, html`
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head"><h2>${title}</h2><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="閉じる">✕</button></div>
      <div class="modal-body"></div>
      ${footer ? html`<div class="modal-foot"></div>` : ''}
    </div>`);
  const bodyEl = $('.modal-body', back);
  if (body instanceof Node) bodyEl.appendChild(body); else mount(bodyEl, body);
  if (footer) mount($('.modal-foot', back), footer);
  const prevFocus = document.activeElement;
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('[data-close]', back).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  setTimeout(() => ($('input, select, textarea', bodyEl) || $('.btn-primary', back) || $('[data-close]', back))?.focus(), 0);
  return { el: back, body: bodyEl, close };
}

export function confirmDialog(message, { title = '確認', okText = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      body: html`<p style="white-space:pre-wrap">${message}</p>`,
      footer: html`<button class="btn" data-cancel>キャンセル</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okText}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    $('[data-cancel]', m.el).addEventListener('click', () => m.close());
    $('[data-ok]', m.el).addEventListener('click', () => { done = true; resolve(true); m.close(); });
    setTimeout(() => $('[data-ok]', m.el).focus(), 0);
  });
}

// ---------- アイコン（線画 SVG） ----------
const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  score: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  course: '<path d="M6 21V4l9 4-9 4"/><ellipse cx="12" cy="20" rx="8" ry="1.8"/>',
  club: '<path d="M14 3L8 19"/><path d="M8 19c-1 1.6-3.5 2-4.5 1s0-2.5 1.5-3l3-1"/>',
  distance: '<path d="M3 18C5 9 13 5 19 13"/><circle cx="20" cy="16" r="1.8"/><path d="M2 21h20"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3M8 17h6"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M9 10.8L6 3h4l2 4.5L14 3h4l-3 7.8"/><path d="M12 13v4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  album: '<rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-9 8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v4h16v-4"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  photo: '<rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/>',
  menu: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  share: '<path d="M8 9H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1h-2"/><path d="M12 15V3M8 7l4-4 4 4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  ai: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
};
export function icon(name) {
  return raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);
}

// ---------- 各種ラベル ----------
export const CLUB_CATEGORIES = [
  ['driver', 'ドライバー'], ['wood', 'フェアウェイウッド'], ['hybrid', 'ユーティリティ'],
  ['iron', 'アイアン'], ['wedge', 'ウェッジ'], ['putter', 'パター'],
];
export const clubCategoryLabel = (c) => (CLUB_CATEGORIES.find((x) => x[0] === c) || [c, c])[1];
export const PLACES = [['range', '練習場'], ['course', 'コース'], ['simulator', 'シミュレーター']];
export const placeLabel = (p) => (PLACES.find((x) => x[0] === p) || [p, '—'])[1];
export const WEATHERS = ['晴れ', '曇り', '雨', '雪', '強風'];
