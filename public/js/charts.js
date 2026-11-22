// SVG チャート（外部ライブラリなし）
// 方針: 細いマーク・2px 線・控えめなグリッド・ホバーでツールチップ・「表で見る」で数値表を確認可能
import { html, mount, $, debounce } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  if (parent) parent.appendChild(el);
  return el;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- タッチ操作：グラフ以外をタップ／スクロールしたらツールチップを閉じる ----------
let activeHide = null;
function dismissActive() { activeHide?.(); activeHide = null; hideTooltip(); }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.chart')) dismissActive(); }, true);
window.addEventListener('scroll', dismissActive, { passive: true });

// ---------- レスポンシブ再描画 ----------
const registry = new Set();
export function clearCharts() { registry.clear(); hideTooltip(); }
window.addEventListener('resize', debounce(() => {
  for (const rec of [...registry]) {
    if (!rec.el.isConnected) { registry.delete(rec); continue; }
    if (rec.el.clientWidth !== rec.w) rec.draw();
  }
}, 120));
function register(el, drawFn) {
  for (const r of registry) if (r.el === el) registry.delete(r);
  const rec = {
    el, w: 0,
    draw() { el.replaceChildren(); rec.w = el.clientWidth; drawFn(Math.max(rec.w, 240)); },
  };
  registry.add(rec);
  rec.draw();
}
function empty(el, msg = 'データがありません') {
  for (const r of registry) if (r.el === el) registry.delete(r);
  mount(el, html`<div class="chart-empty">${msg}</div>`);
}

// ---------- ツールチップ（textContent のみ使用） ----------
export function showTooltip(x, y, { title, rows }) {
  const el = document.getElementById('viz-tooltip');
  el.replaceChildren();
  if (title) {
    const t = document.createElement('div');
    t.className = 'tt-title';
    t.textContent = title;
    el.appendChild(t);
  }
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tt-row';
    if (r.color) {
      const k = document.createElement('span');
      k.className = r.swatch ? 'tt-sw' : 'tt-key';
      k.style.background = r.color;
      row.appendChild(k);
    }
    const st = document.createElement('strong');
    st.textContent = r.value;
    row.appendChild(st);
    if (r.label) {
      const sp = document.createElement('span');
      sp.textContent = r.label;
      row.appendChild(sp);
    }
    el.appendChild(row);
  }
  el.hidden = false;
  // 画面上の位置で計算してから CSS の値に換算する（設定の「文字の大きさ」で画面全体を拡大していても指の位置に出す）
  el.style.left = '0px';
  el.style.top = '0px';
  const o = el.getBoundingClientRect();
  el.style.left = '100px';
  const scale = (el.getBoundingClientRect().left - o.left) / 100 || 1;
  const pad = 14;
  const w = o.width;
  const h = o.height;
  let left = x + pad;
  let top = y - h - pad;
  if (left + w > window.innerWidth - 8) left = x - w - pad;
  if (left < 8) left = 8;
  if (top < 8) top = y + pad;
  el.style.left = `${(left - o.left) / scale}px`;
  el.style.top = `${(top - o.top) / scale}px`;
}
export function hideTooltip() {
  const el = document.getElementById('viz-tooltip');
  if (el) el.hidden = true;
}

// ---------- 目盛り ----------
function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function barPath(x, y0, w, y1, r = 4) {
  const h = Math.abs(y1 - y0);
  r = Math.min(r, h, w / 2);
  if (y1 <= y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}
function hbarPath(x0, y, x1, h, r = 4) {
  const w = x1 - x0;
  r = Math.min(r, w, h / 2);
  return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
}

function legendEl(items, kind = 'line') {
  const div = document.createElement('div');
  div.className = 'legend';
  for (const it of items) {
    const k = document.createElement('span');
    k.className = 'key';
    const sw = document.createElement('span');
    sw.className = kind === 'line' ? 'ln' : 'sw';
    sw.style.background = it.color;
    const t = document.createElement('span');
    t.textContent = it.label;
    k.append(sw, t);
    div.appendChild(k);
  }
  return div;
}

// ---------- 折れ線（時系列） ----------
// series: [{ name, color, values: (number|null)[] }], labels: string[]
const round1 = (v) => String(Math.round(v * 10) / 10);
export function lineChart(el, { series, labels, height = 240, yFormat = round1, yDomain, onClick, tooltipTitle, ariaLabel = '折れ線グラフ' }) {
  if (!labels.length || !series.some((se) => se.values.some(Number.isFinite))) return empty(el);
  register(el, (W) => {
    const M = { t: 12, r: 44, b: 26, l: 40 };
    const H = height;
    const n = labels.length;
    const svg = s('svg', { width: W, height: H, role: 'img', 'aria-label': ariaLabel, tabindex: 0 }, el);
    const all = series.flatMap((se) => se.values).filter(Number.isFinite);
    const ticks = niceTicks(yDomain?.[0] ?? Math.min(...all), yDomain?.[1] ?? Math.max(...all), 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const iw = W - M.l - M.r;
    const ih = H - M.t - M.b;
    const x = (i) => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => M.t + ih - ((v - lo) / (hi - lo || 1)) * ih;

    const g = s('g', { class: 'tick' }, svg);
    for (const t of ticks) {
      s('line', { class: 'gridline', x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }, g);
      s('text', { x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end', text: yFormat(t) }, g);
    }
    const maxLabels = Math.max(2, Math.floor(iw / 64));
    const stepL = Math.ceil(n / maxLabels);
    for (let i = 0; i < n; i += stepL) s('text', { x: x(i), y: H - 6, 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : 'middle', text: labels[i] }, g);
    s('line', { class: 'baseline', x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih }, svg);

    const placedEnds = [];
    series.forEach((se, si) => {
      let d = '';
      let pen = false;
      se.values.forEach((v, i) => {
        if (!Number.isFinite(v)) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      s('path', { d, fill: 'none', style: `stroke:${se.color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round` }, svg);
      if (se.dots !== false && n <= 60) {
        se.values.forEach((v, i) => {
          if (Number.isFinite(v)) s('circle', { cx: x(i), cy: y(v), r: 4, style: `fill:${se.color};stroke:var(--surface-1);stroke-width:2` }, svg);
        });
      }
      // 終点に値ラベル（他の系列と重なる場合は省略し、凡例とツールチップに任せる）
      let last = -1;
      se.values.forEach((v, i) => { if (Number.isFinite(v)) last = i; });
      if (last >= 0) {
        const ly = y(se.values[last]) + 4;
        if (!placedEnds.some((p) => Math.abs(p - ly) < 13)) {
          placedEnds.push(ly);
          s('text', { class: `value-label${si === 0 ? ' strong' : ''}`, x: x(last) + 8, y: ly, text: yFormat(se.values[last]) }, svg);
        }
      }
    });

    // ホバー：十字線が最も近い X にスナップし、全系列の値を表示
    const cross = s('line', { class: 'crosshair', y1: M.t, y2: M.t + ih, visibility: 'hidden' }, svg);
    const hl = series.map((se) => s('circle', { r: 5.5, visibility: 'hidden', style: `fill:${se.color};stroke:var(--surface-1);stroke-width:2;pointer-events:none` }, svg));
    const overlay = s('rect', { x: M.l - 12, y: 0, width: iw + 24, height: H - M.b, fill: 'transparent', style: onClick ? 'cursor:pointer' : '' }, svg);
    let cur = -1;
    const show = (i, cx, cy) => {
      if (activeHide !== hide) activeHide?.();
      activeHide = hide;
      cur = i;
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      series.forEach((se, si) => {
        const v = se.values[i];
        if (Number.isFinite(v)) {
          hl[si].setAttribute('cx', x(i));
          hl[si].setAttribute('cy', y(v));
          hl[si].setAttribute('visibility', 'visible');
        } else hl[si].setAttribute('visibility', 'hidden');
      });
      showTooltip(cx, cy, {
        title: tooltipTitle ? tooltipTitle(i) : labels[i],
        rows: series.map((se) => ({ value: Number.isFinite(se.values[i]) ? yFormat(se.values[i]) : '—', label: se.name, color: se.color })),
      });
    };
    const hide = () => {
      cur = -1;
      cross.setAttribute('visibility', 'hidden');
      hl.forEach((c) => c.setAttribute('visibility', 'hidden'));
      hideTooltip();
    };
    const idxAt = (e) => {
      const r = svg.getBoundingClientRect();
      return clamp(Math.round(((e.clientX - r.left - M.l) / (iw || 1)) * (n - 1)), 0, n - 1);
    };
    // マウス：ホバーで表示・クリックで詳細へ ／ タッチ：タップで表示、同じ点をもう一度タップで詳細へ
    let lastType = 'mouse';
    let navOk = false;
    overlay.addEventListener('pointerdown', (e) => {
      lastType = e.pointerType;
      if (e.pointerType === 'mouse') return;
      const i = idxAt(e);
      navOk = cur === i;
      show(i, e.clientX, e.clientY);
    });
    overlay.addEventListener('pointermove', (e) => show(idxAt(e), e.clientX, e.clientY));
    overlay.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    if (onClick) overlay.addEventListener('click', (e) => { if (lastType === 'mouse' || navOk) onClick(idxAt(e)); });
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const ni = clamp(cur < 0 ? n - 1 : cur + (e.key === 'ArrowRight' ? 1 : -1), 0, n - 1);
        const r = svg.getBoundingClientRect();
        show(ni, r.left + x(ni), r.top + M.t + 20);
        e.preventDefault();
      } else if (e.key === 'Enter' && cur >= 0 && onClick) onClick(cur);
    });
    svg.addEventListener('blur', hide);

    if (series.length >= 2) el.appendChild(legendEl(series.map((se) => ({ label: se.name, color: se.color }))));
  });
}

// ---------- 縦棒 ----------
// bars: [{ label, value, color?, tip?: [{value,label}], title? }]
export function barChart(el, { bars, height = 220, yFormat = (v) => String(v), valueLabels = true, onClick, ariaLabel = '棒グラフ', yDomain }) {
  if (!bars.length || !bars.some((b) => Number.isFinite(b.value))) return empty(el);
  register(el, (W) => {
    const M = { t: 18, r: 8, b: 26, l: 40 };
    const H = height;
    const n = bars.length;
    const svg = s('svg', { width: W, height: H, role: 'img', 'aria-label': ariaLabel }, el);
    const vals = bars.map((b) => b.value).filter(Number.isFinite);
    const ticks = niceTicks(Math.min(0, yDomain?.[0] ?? Math.min(...vals)), Math.max(0, yDomain?.[1] ?? Math.max(...vals)), 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const iw = W - M.l - M.r;
    const ih = H - M.t - M.b;
    const y = (v) => M.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
    const band = iw / n;
    const bw = Math.min(24, band * 0.62);

    const g = s('g', { class: 'tick' }, svg);
    for (const t of ticks) {
      if (t !== 0) s('line', { class: 'gridline', x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }, g);
      s('text', { x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end', text: yFormat(t) }, g);
    }
    const labelEvery = Math.ceil(28 / band);
    bars.forEach((b, i) => {
      if (i % labelEvery === 0) s('text', { x: M.l + band * i + band / 2, y: H - 6, 'text-anchor': 'middle', text: b.label }, g);
    });

    bars.forEach((b, i) => {
      const x0 = M.l + band * i + (band - bw) / 2;
      const v = b.value;
      const markG = s('g', { class: 'mark-hover' }, svg);
      if (Number.isFinite(v) && v !== 0) {
        s('path', { d: barPath(x0, y(0), bw, y(v)), style: `fill:${b.color || 'var(--series-1)'}` }, markG);
        if (valueLabels === true || (typeof valueLabels === 'function' && valueLabels(b, i))) {
          s('text', { class: 'value-label', x: x0 + bw / 2, y: v > 0 ? y(v) - 5 : y(v) + 13, 'text-anchor': 'middle', text: yFormat(v) }, svg);
        }
      }
      const hit = s('rect', { class: 'hit', x: M.l + band * i, y: M.t, width: band, height: ih, tabindex: 0, 'aria-label': `${b.title || b.label}: ${Number.isFinite(v) ? yFormat(v) : 'データなし'}` }, svg);
      if (!onClick) hit.style.cursor = 'default';
      const show = (cx, cy) => {
        if (activeHide !== hide) activeHide?.();
        activeHide = hide;
        markG.style.opacity = '0.75';
        showTooltip(cx, cy, { title: b.title || b.label, rows: b.tip || [{ value: Number.isFinite(v) ? yFormat(v) : '—', color: b.color || 'var(--series-1)', swatch: true }] });
      };
      const hide = () => { markG.style.opacity = ''; hideTooltip(); };
      hit.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      hit.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') show(e.clientX, e.clientY); });
      hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
      hit.addEventListener('focus', () => { const r = hit.getBoundingClientRect(); show(r.left + r.width / 2, r.top + 20); });
      hit.addEventListener('blur', hide);
      if (onClick) {
        hit.addEventListener('click', () => onClick(b, i));
        hit.addEventListener('keydown', (e) => { if (e.key === 'Enter') onClick(b, i); });
      }
    });
    s('line', { class: 'baseline', x1: M.l, x2: W - M.r, y1: y(0), y2: y(0) }, svg);
  });
}

// ---------- 横棒（値は棒の先端に表示） ----------
// rows: [{ label, value, color?, note?, tip? }]
export function hBarChart(el, { rows, format = (v) => String(v), labelWidth = 56, barH = 16, gap = 12, ariaLabel = '横棒グラフ', onClick, legend }) {
  if (!rows.length || !rows.some((r) => Number.isFinite(r.value))) return empty(el);
  register(el, (W) => {
    const M = { t: 4, r: 96, b: 22, l: labelWidth };
    const rowH = barH + gap;
    const H = M.t + rows.length * rowH + M.b;
    const svg = s('svg', { width: W, height: H, role: 'img', 'aria-label': ariaLabel }, el);
    const max = Math.max(...rows.map((r) => r.value).filter(Number.isFinite));
    const ticks = niceTicks(0, max, Math.max(2, Math.floor((W - M.l - M.r) / 80)));
    const hi = ticks[ticks.length - 1];
    const iw = W - M.l - M.r;
    const x = (v) => M.l + (v / (hi || 1)) * iw;
    const g = s('g', { class: 'tick' }, svg);
    for (const t of ticks) {
      if (t !== 0) s('line', { class: 'gridline', x1: x(t), x2: x(t), y1: M.t, y2: H - M.b }, g);
      s('text', { x: x(t), y: H - 6, 'text-anchor': 'middle', text: format(t) }, g);
    }
    rows.forEach((r, i) => {
      const y0 = M.t + i * rowH + gap / 2;
      s('text', { class: 'value-label', x: M.l - 8, y: y0 + barH / 2 + 4, 'text-anchor': 'end', text: r.label }, svg);
      const markG = s('g', { class: 'mark-hover' }, svg);
      if (Number.isFinite(r.value) && r.value > 0) {
        s('path', { d: hbarPath(M.l, y0, x(r.value), barH), style: `fill:${r.color || 'var(--series-1)'}` }, markG);
        const t = s('text', { class: 'value-label strong', x: x(r.value) + 6, y: y0 + barH / 2 + 4, text: format(r.value) }, svg);
        if (r.note) {
          const ts = s('tspan', { class: 'axis-label', dx: 6, text: r.note }, t);
          ts.style.fontWeight = '400';
        }
      } else {
        s('text', { class: 'axis-label', x: M.l + 4, y: y0 + barH / 2 + 4, text: r.empty || 'データなし' }, svg);
      }
      const hit = s('rect', { class: 'hit', x: 0, y: y0 - gap / 2, width: W, height: rowH, tabindex: 0, 'aria-label': `${r.label}: ${Number.isFinite(r.value) ? format(r.value) : 'データなし'}` }, svg);
      if (!onClick) hit.style.cursor = 'default';
      const show = (cx, cy) => {
        if (activeHide !== hide) activeHide?.();
        activeHide = hide;
        markG.style.opacity = '0.75';
        showTooltip(cx, cy, { title: r.title || r.label, rows: r.tip || [{ value: Number.isFinite(r.value) ? format(r.value) : '—', color: r.color || 'var(--series-1)', swatch: true }] });
      };
      const hide = () => { markG.style.opacity = ''; hideTooltip(); };
      hit.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      hit.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') show(e.clientX, e.clientY); });
      hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
      hit.addEventListener('focus', () => { const b = hit.getBoundingClientRect(); show(b.left + 120, b.top); });
      hit.addEventListener('blur', hide);
      if (onClick) hit.addEventListener('click', () => onClick(r, i));
    });
    s('line', { class: 'baseline', x1: M.l, x2: M.l, y1: M.t, y2: H - M.b }, svg);
    if (legend) el.appendChild(legendEl(legend, 'swatch'));
  });
}

// ---------- レンジ（最小〜最大の帯 + 平均の点） ----------
// rows: [{ label, min, max, avg, n, tip? }]
export function rangeChart(el, { rows, format = (v) => String(v), labelWidth = 56, ariaLabel = '飛距離の分布' }) {
  const valid = rows.filter((r) => Number.isFinite(r.avg));
  if (!valid.length) return empty(el);
  register(el, (W) => {
    const M = { t: 6, r: 56, b: 22, l: labelWidth };
    const rowH = 28;
    const H = M.t + rows.length * rowH + M.b;
    const svg = s('svg', { width: W, height: H, role: 'img', 'aria-label': ariaLabel }, el);
    const lo0 = Math.min(...valid.map((r) => r.min));
    const hi0 = Math.max(...valid.map((r) => r.max));
    const ticks = niceTicks(Math.max(0, lo0 - 10), hi0, Math.max(2, Math.floor((W - M.l - M.r) / 80)));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const iw = W - M.l - M.r;
    const x = (v) => M.l + ((v - lo) / (hi - lo || 1)) * iw;
    const g = s('g', { class: 'tick' }, svg);
    for (const t of ticks) {
      s('line', { class: 'gridline', x1: x(t), x2: x(t), y1: M.t, y2: H - M.b }, g);
      s('text', { x: x(t), y: H - 6, 'text-anchor': 'middle', text: format(t) }, g);
    }
    rows.forEach((r, i) => {
      const cy = M.t + i * rowH + rowH / 2;
      s('text', { class: 'value-label', x: M.l - 8, y: cy + 4, 'text-anchor': 'end', text: r.label }, svg);
      if (!Number.isFinite(r.avg)) {
        s('text', { class: 'axis-label', x: M.l + 4, y: cy + 4, text: '記録なし' }, svg);
        return;
      }
      const markG = s('g', { class: 'mark-hover' }, svg);
      const x1 = x(r.min);
      const x2 = Math.max(x(r.max), x1 + 8);
      s('rect', { x: x1, y: cy - 4, width: x2 - x1, height: 8, rx: 4, style: 'fill:var(--series-1-soft)' }, markG);
      s('circle', { cx: x(r.avg), cy, r: 5, style: 'fill:var(--series-1);stroke:var(--surface-1);stroke-width:2' }, markG);
      s('text', { class: 'value-label strong', x: x2 + 8, y: cy + 4, text: format(r.avg) }, svg);
      const hit = s('rect', { class: 'hit', x: 0, y: cy - rowH / 2, width: W, height: rowH, tabindex: 0, 'aria-label': `${r.label}: 平均 ${format(r.avg)}` }, svg);
      hit.style.cursor = 'default';
      const show = (cx, cyy) => {
        if (activeHide !== hide) activeHide?.();
        activeHide = hide;
        markG.style.opacity = '0.75';
        showTooltip(cx, cyy, {
          title: r.label,
          rows: r.tip || [
            { value: format(r.avg), label: '平均', color: 'var(--series-1)' },
            { value: format(r.max), label: '最大' },
            { value: format(r.min), label: '最小' },
            { value: `${r.n} 球`, label: '記録数' },
          ],
        });
      };
      const hide = () => { markG.style.opacity = ''; hideTooltip(); };
      hit.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      hit.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') show(e.clientX, e.clientY); });
      hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
      hit.addEventListener('focus', () => { const b = hit.getBoundingClientRect(); show(b.left + 120, b.top); });
      hit.addEventListener('blur', hide);
    });
  });
}

// ---------- セグメントバー（全体の構成比） ----------
// parts: [{ label, value, color, ink }]
export function segmentedBar(el, { parts, format = (v) => String(v), ariaLabel = '構成比' }) {
  const total = parts.reduce((a, p) => a + (p.value || 0), 0);
  if (!total) return empty(el);
  register(el, () => {
    const bar = document.createElement('div');
    bar.className = 'segbar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${ariaLabel}: ${parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join('、')}`);
    el.appendChild(bar);
    const blocks = [];
    for (const p of parts) {
      if (!p.value) continue;
      const share = p.value / total;
      const d = document.createElement('div');
      d.className = 'part';
      d.style.flex = `${share} 1 0`;
      d.style.background = p.color;
      d.style.color = p.ink || '#fff';
      d.tabIndex = 0;
      d.textContent = `${Math.round(share * 100)}%`;
      d.setAttribute('aria-label', `${p.label} ${(share * 100).toFixed(1)}%（${format(p.value)}）`);
      const show = (cx, cy) => showTooltip(cx, cy, { title: p.label, rows: [{ value: `${(share * 100).toFixed(1)}%`, label: format(p.value), color: p.color, swatch: true }] });
      d.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      d.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') show(e.clientX, e.clientY); });
      d.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTooltip(); });
      d.addEventListener('focus', () => { const b = d.getBoundingClientRect(); show(b.left + b.width / 2, b.top); });
      d.addEventListener('blur', hideTooltip);
      bar.appendChild(d);
      blocks.push(d);
    }
    // 収まらないラベルは表示しない（値はツールチップと表で確認できる）
    for (const d of blocks) if (d.scrollWidth > d.clientWidth) d.textContent = '';
    el.appendChild(legendEl(parts.map((p) => ({ label: `${p.label} ${format(p.value)}`, color: p.color })), 'swatch'));
  });
}

// ---------- グラフカード（「表で見る」切り替え付き） ----------
export function chartCard(name, title, sub = '', cls = '') {
  return html`<div class="card ${cls}" data-chart="${name}">
    <div class="card-header">
      <div><h2>${title}</h2>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>
      <button class="btn btn-sm btn-ghost viz-toggle" type="button" aria-pressed="false">表で見る</button>
    </div>
    <div class="chart"></div>
    <div class="chart-table" hidden></div>
  </div>`;
}
// draw(chartEl) を呼び、表データ { columns: [{label, align}], rows: string[][] } を切り替え表示可能にする
export function setupChart(root, name, draw, table) {
  const card = $(`[data-chart="${name}"]`, root);
  if (!card) return;
  const chartEl = $('.chart', card);
  const tableEl = $('.chart-table', card);
  const btn = $('.viz-toggle', card);
  draw(chartEl);
  if (!table || !table.rows.length) { btn.hidden = true; return; }
  btn.addEventListener('click', () => {
    const showTable = tableEl.hidden;
    if (showTable && !tableEl.childElementCount) {
      mount(tableEl, html`<div class="table-wrap"><table class="data">
        <thead><tr>${table.columns.map((c) => html`<th class="${c.align || ''}">${c.label}</th>`)}</tr></thead>
        <tbody>${table.rows.map((r) => html`<tr>${r.map((v, i) => html`<td class="${table.columns[i]?.align || ''}">${v}</td>`)}</tr>`)}</tbody>
      </table></div>`);
    }
    tableEl.hidden = !showTable;
    chartEl.hidden = showTable;
    btn.textContent = showTable ? 'グラフで見る' : '表で見る';
    btn.setAttribute('aria-pressed', String(showTable));
    if (!showTable) {
      for (const r of registry) if (r.el === chartEl) r.draw();
    }
  });
}
