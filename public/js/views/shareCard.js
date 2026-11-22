// ラウンドのスコアカードを 1 枚の画像にして共有する（LINE・写真に保存など）
import { html, mount, $, $$, openModal, toast, errorToast, fmtDate, toPar, pct } from '../util.js';
import { photoUrl } from '../api.js';
import { summarize, resultKey, played } from '../stats.js';
import { canShareFile, shareFile, downloadFile } from '../share.js';

const W = 1080;
const PAD = 56;
// 画像は常に明るい配色（受け取った人の画面の設定に左右されないように）
const C = {
  bg: '#ffffff', ink: '#16181d', sub: '#6b6a65', muted: '#9a9893', line: '#e2e0da', soft: '#f3f2ee', accent: '#17663f',
  eagle: '#184f95', birdie: '#3a84e0', bogey: '#e34948', double: '#e34948', triple: '#9b1c22',
};
export const family = () => getComputedStyle(document.body).fontFamily || 'sans-serif';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('写真を読み込めませんでした'));
    img.src = src;
  });
}

// 長い文字を幅に合わせて折り返す（最大 maxLines 行。あふれたら「…」）
export function wrap(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of [...text]) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 日本式の記号：◎イーグル ○バーディ □ボギー 二重□ダブルボギー ■トリプル以上
function drawMark(ctx, key, cx, cy, s) {
  ctx.lineWidth = 3;
  const circle = (r, color) => { ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); };
  const square = (half, color) => { ctx.strokeStyle = color; roundRect(ctx, cx - half, cy - half, half * 2, half * 2, 5); ctx.stroke(); };
  if (key === 'eagle') { circle(s / 2, C.eagle); circle(s / 2 - 7, C.eagle); }
  if (key === 'birdie') circle(s / 2 - 3, C.birdie);
  if (key === 'bogey') square(s / 2 - 4, C.bogey);
  if (key === 'double') { square(s / 2, C.double); square(s / 2 - 7, C.double); }
  if (key === 'triple') { ctx.fillStyle = C.triple; roundRect(ctx, cx - s / 2 + 2, cy - s / 2 + 2, s - 4, s - 4, 5); ctx.fill(); }
}

// 画像を描く。photo は読み込み済みの画像（なければ null）
async function drawCard(round, { photo, badge, companions, party = false }) {
  const sum = summarize(round);
  const F = family();
  const font = (size, weight = 400) => `${weight} ${size}px ${F}`;
  const holes = Array.from({ length: 18 }, (_, i) => round.holes.find((h) => h.hole_no === i + 1) || { hole_no: i + 1, par: null });
  const halves = [0, 9].filter((from) => holes.slice(from, from + 9).some(played));
  const nineNames = round.nines_label ? round.nines_label.split(' → ') : null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const inner = W - PAD * 2;

  // 高さを先に計算するため、描画せずに測る → 描く の 2 回まわす
  const layout = (draw) => {
    let y = 0;
    if (photo) {
      const ph = Math.round(W * 0.75);
      if (draw) {
        const scale = Math.max(W / photo.naturalWidth, ph / photo.naturalHeight);
        const sw = W / scale;
        const sh = ph / scale;
        const sx = (photo.naturalWidth - sw) / 2;
        const sy = photo.naturalHeight > photo.naturalWidth ? (photo.naturalHeight - sh) * 0.35 : (photo.naturalHeight - sh) / 2; // 縦長は顔が入りやすい上寄り
        ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, W, ph);
      }
      y = ph;
    }
    y += 52;
    // 日付・コース名・補足
    ctx.font = font(30);
    if (draw) { ctx.fillStyle = C.sub; ctx.fillText(fmtDate(round.date), PAD, y + 30); }
    y += 48;
    ctx.font = font(54, 700);
    const nameLines = wrap(ctx, round.course_name || 'コース未登録', inner, 2);
    for (const line of nameLines) {
      if (draw) { ctx.fillStyle = C.ink; ctx.fillText(line, PAD, y + 54); }
      y += 70;
    }
    const subParts = [round.nines_label, round.tee && `${round.tee}ティー`, round.weather].filter(Boolean);
    if (subParts.length) {
      ctx.font = font(28);
      if (draw) { ctx.fillStyle = C.sub; ctx.fillText(subParts.join('　・　'), PAD, y + 30); }
      y += 46;
    }
    if (companions && round.companions) {
      ctx.font = font(28);
      const lines = wrap(ctx, `同伴：${round.companions}`, inner, 2);
      for (const line of lines) { if (draw) { ctx.fillStyle = C.sub; ctx.fillText(line, PAD, y + 30); } y += 42; }
    }
    // スコア
    y += 22;
    ctx.font = font(150, 700);
    const scoreText = sum.holes ? String(sum.strokes) : '—';
    const scoreW = ctx.measureText(scoreText).width;
    if (draw) { ctx.fillStyle = C.ink; ctx.fillText(scoreText, PAD - 4, y + 132); }
    const sx = PAD + scoreW + 28;
    ctx.font = font(52, 700);
    if (draw && sum.holes) { ctx.fillStyle = C.ink; ctx.fillText(toPar(sum.toPar), sx, y + 68); }
    ctx.font = font(28);
    if (draw) {
      ctx.fillStyle = C.sub;
      ctx.fillText(`${sum.complete ? '' : `${sum.holes}ホール・`}パー ${sum.par || '—'}`, sx, y + 108);
      if (sum.front.holes || sum.back.holes) ctx.fillText(`OUT ${sum.front.holes ? sum.front.strokes : '—'} ／ IN ${sum.back.holes ? sum.back.strokes : '—'}`, sx, y + 146);
    }
    if (badge) {
      ctx.font = font(30, 700);
      const bw = ctx.measureText(badge).width + 40;
      if (draw) {
        ctx.fillStyle = '#e3f0e8';
        roundRect(ctx, W - PAD - bw, y + 14, bw, 56, 28);
        ctx.fill();
        ctx.fillStyle = C.accent;
        ctx.fillText(badge, W - PAD - bw + 20, y + 53);
      }
    }
    y += 176;
    // 数値のタイル（パット・FWキープ・パーオン・OB）
    const tiles = [
      ['パット', sum.puttHoles ? String(sum.putts) : '—'],
      ['FWキープ', sum.fwTotal ? pct(sum.fwHit / sum.fwTotal) : '—'],
      ['パーオン', sum.girKnown ? pct(sum.gir / sum.girKnown) : '—'],
      ['OB・ペナ', sum.holes ? String(sum.penalties) : '—'],
    ];
    const gap = 16;
    const tw = (inner - gap * 3) / 4;
    tiles.forEach(([label, value], i) => {
      const x = PAD + i * (tw + gap);
      if (!draw) return;
      ctx.fillStyle = C.soft;
      roundRect(ctx, x, y, tw, 118, 16);
      ctx.fill();
      ctx.fillStyle = C.sub;
      ctx.font = font(24);
      ctx.fillText(label, x + 20, y + 40);
      ctx.fillStyle = C.ink;
      ctx.font = font(44, 700);
      ctx.fillText(value, x + 20, y + 94);
    });
    y += 118 + 36;
    // 同伴者を含めたランキング（選んだときだけ）
    if (party && round.party?.length) {
      const sum = (arr, a, b) => arr.slice(a, b).reduce((t, v) => t + (v || 0), 0);
      const players = [{ name: '自分', strokes: holes.map((h) => (played(h) ? h.strokes : null)) }, ...round.party]
        .map((p) => ({ name: p.name, out: sum(p.strokes, 0, 9), in: sum(p.strokes, 9, 18), n: p.strokes.filter((v) => v != null).length }))
        .map((p) => ({ ...p, total: p.out + p.in }))
        .sort((a, b) => (b.n === 18) - (a.n === 18) || a.total - b.total);
      ctx.font = font(28, 700);
      if (draw) { ctx.fillStyle = C.ink; ctx.fillText('ランキング', PAD, y + 28); }
      y += 48;
      players.forEach((p, i) => {
        if (draw) {
          ctx.fillStyle = i === 0 ? '#fff4d6' : C.soft;
          roundRect(ctx, PAD, y, inner, 64, 14);
          ctx.fill();
          ctx.fillStyle = C.ink;
          ctx.font = font(30, 800);
          ctx.fillText(`${i + 1}`, PAD + 22, y + 43);
          ctx.font = font(30, 700);
          ctx.fillText(wrap(ctx, p.name, inner - 420, 1)[0] || '', PAD + 70, y + 43);
          ctx.font = font(24);
          ctx.fillStyle = C.sub;
          ctx.textAlign = 'right';
          ctx.fillText(p.n ? `OUT ${p.out || '—'}・IN ${p.in || '—'}` : '未入力', W - PAD - 110, y + 41);
          ctx.fillStyle = C.ink;
          ctx.font = font(34, 800);
          ctx.fillText(p.total ? String(p.total) : '—', W - PAD - 22, y + 44);
          ctx.textAlign = 'left';
        }
        y += 74;
      });
      y += 20;
    }
    // スコアカード（OUT・IN）
    const labelW = 104;
    const sumW = 92;
    const colW = (inner - labelW - sumW) / 9;
    for (const from of halves) {
      const hs = holes.slice(from, from + 9);
      if (nineNames && nineNames.length === 2) {
        ctx.font = font(24, 700);
        if (draw) { ctx.fillStyle = C.sub; ctx.fillText(`${from ? '後半' : '前半'}：${nineNames[from ? 1 : 0]}`, PAD, y + 24); }
        y += 38;
      }
      const rows = [
        ['ホール', 46, (h) => String(h.hole_no), from ? 'IN' : 'OUT'],
        ['パー', 46, (h) => (h.par ? String(h.par) : ''), String(hs.reduce((a, h) => a + (h.par || 0), 0) || '')],
        ['スコア', 78, null, hs.some(played) ? String(hs.reduce((a, h) => a + (played(h) ? h.strokes : 0), 0)) : ''],
        ['パット', 46, (h) => (Number.isFinite(h.putts) ? String(h.putts) : ''), hs.some((h) => Number.isFinite(h.putts)) ? String(hs.reduce((a, h) => a + (h.putts || 0), 0)) : ''],
      ];
      const tableTop = y;
      for (const [label, rh, val, total] of rows) {
        if (draw) {
          if (label === 'ホール') { ctx.fillStyle = C.soft; ctx.fillRect(PAD, y, inner, rh); }
          ctx.fillStyle = C.sub;
          ctx.font = font(24, label === 'ホール' ? 700 : 400);
          ctx.textAlign = 'left';
          ctx.fillText(label, PAD + 14, y + rh / 2 + 9);
          ctx.textAlign = 'center';
          hs.forEach((h, i) => {
            const cx = PAD + labelW + colW * i + colW / 2;
            if (label === 'スコア') {
              if (!played(h)) return;
              const k = resultKey(h.strokes, h.par);
              drawMark(ctx, k, cx, y + rh / 2, 58);
              ctx.fillStyle = k === 'triple' ? '#ffffff' : C.ink;
              ctx.font = font(32, 700);
              ctx.fillText(String(h.strokes), cx, y + rh / 2 + 11);
            } else {
              ctx.fillStyle = label === 'パット' && h.putts >= 3 ? C.bogey : label === 'ホール' ? C.sub : C.ink;
              ctx.font = font(label === 'ホール' ? 24 : 26, label === 'ホール' ? 700 : 400);
              ctx.fillText(val(h), cx, y + rh / 2 + 9);
            }
          });
          ctx.fillStyle = label === 'ホール' ? C.sub : C.ink;
          ctx.font = font(label === 'スコア' ? 32 : 26, 700);
          ctx.fillText(total, PAD + inner - sumW / 2, y + rh / 2 + (label === 'スコア' ? 11 : 9));
          ctx.textAlign = 'left';
          ctx.fillStyle = C.line;
          ctx.fillRect(PAD, y + rh - 1, inner, 1);
        }
        y += rh;
      }
      if (draw) {
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 2;
        roundRect(ctx, PAD, tableTop, inner, y - tableTop, 12);
        ctx.stroke();
      }
      y += 28;
    }
    // フッター
    y += 8;
    ctx.font = font(24);
    if (draw) {
      ctx.fillStyle = C.muted;
      ctx.fillText('⛳ Golf Enjoy Manager', PAD, y + 26);
    }
    y += 26 + 44;
    return Math.ceil(y);
  };

  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const h = layout(false);
  canvas.width = W;
  canvas.height = h;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, h);
  ctx.textBaseline = 'alphabetic';
  layout(true);
  const type = photo ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error('画像を作れませんでした');
  return new File([blob], `golf-score-${round.date.replace(/-/g, '')}.${photo ? 'jpg' : 'png'}`, { type });
}

// LINE などにそのまま貼れる文章（例：⛳ 11/22(日) 出島ゴルフクラブ／スコア 88（+16）…）
export function roundText(round, { companions = false, party = false, badge = '' } = {}) {
  const s = summarize(round);
  const lines = [`⛳ ${fmtDate(round.date)} ${round.course_name || ''}${round.nines_label ? `（${round.nines_label}）` : ''}`];
  if (badge) lines.push(badge);
  lines.push(`スコア ${s.holes ? `${s.strokes}（${toPar(s.toPar)}）` : '—'}${s.front.holes && s.back.holes ? `　OUT ${s.front.strokes}・IN ${s.back.strokes}` : ''}${s.complete ? '' : `（${s.holes}ホール）`}`);
  const parts = [s.puttHoles && `パット ${s.putts}`, s.fwTotal && `FWキープ ${pct(s.fwHit / s.fwTotal)}`, s.girKnown && `パーオン ${pct(s.gir / s.girKnown)}`, s.holes && `OB・ペナ ${s.penalties}`].filter(Boolean);
  if (parts.length) lines.push(parts.join('・'));
  if (companions && round.companions) lines.push(`同伴：${round.companions}`);
  if (party && round.party?.length) {
    const sum = (arr) => arr.reduce((a, v) => a + (v || 0), 0);
    const players = [{ name: '自分', strokes: round.holes.filter(played).map((h) => h.strokes), n: s.holes }, ...round.party.map((p) => ({ name: p.name, strokes: p.strokes, n: p.strokes.filter((v) => v != null).length }))]
      .map((p) => ({ ...p, total: sum(p.strokes) })).sort((a, b) => (b.n === 18) - (a.n === 18) || a.total - b.total);
    lines.push('', '【ランキング】', ...players.map((p, i) => `${i + 1}. ${p.name} ${p.total || '—'}${p.n && p.n < 18 ? `（${p.n}H）` : ''}`));
  }
  return lines.join('\n');
}

// 共有用の画像を作って、プレビュー → 共有／保存
export function openShareCard(round, photos, { badge = '' } = {}) {
  const shareable = canShareFile(new File([''], 'a.png', { type: 'image/png' }));
  let photoIdx = photos.length ? 0 : -1;
  let withCompanions = false;
  let withParty = false;
  let file = null;
  let url = null;
  let gen = 0;
  const m = openModal({
    title: 'スコアカードを画像で共有',
    body: html`<div class="share-card">
      <div class="share-preview"><div class="loading">画像を作成中…</div></div>
      ${photos.length ? html`<div class="share-opt"><div class="small secondary">写真</div>
        <div class="share-photos">
          <button type="button" class="sp-none" data-photo="-1">なし</button>
          ${photos.map((p, i) => html`<button type="button" class="sp" data-photo="${i}" aria-label="写真 ${i + 1}"><img src="${photoUrl(p)}" alt=""></button>`)}
        </div></div>` : ''}
      ${round.companions ? html`<label class="check share-opt"><input type="checkbox" data-companions> 同伴者の名前を入れる</label>` : ''}
      ${round.party?.length ? html`<label class="check share-opt"><input type="checkbox" data-party> 同伴者のスコア（ランキング）を入れる</label>` : ''}
      <p class="small muted">${shareable ? '「共有する」から LINE で送ったり、「画像を保存」で写真アプリに保存したりできます。' : '「画像を保存」でダウンロードできます。'}</p>
    </div>`,
    footer: html`<button class="btn" data-copy-text>テキストをコピー</button><button class="btn" data-dl disabled>画像を保存</button>${shareable ? html`<button class="btn btn-primary" data-share disabled>共有する…</button>` : ''}`,
    onClose: () => { gen++; if (url) URL.revokeObjectURL(url); },
  });
  const preview = $('.share-preview', m.el);
  const buttons = () => $$('[data-dl], [data-share]', m.el);
  const markPhoto = () => $$('[data-photo]', m.el).forEach((b) => b.classList.toggle('on', Number(b.dataset.photo) === photoIdx));

  const render = async () => {
    const my = ++gen;
    buttons().forEach((b) => { b.disabled = true; });
    markPhoto();
    let photo = null;
    if (photoIdx >= 0) {
      try { photo = await loadImage(photoUrl(photos[photoIdx], false)); } catch { errorToast('この写真は画像に入れられませんでした'); }
    }
    try {
      const f = await drawCard(round, { photo, badge, companions: withCompanions, party: withParty });
      if (my !== gen) return;
      file = f;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(f);
      mount(preview, html`<img src="${url}" alt="共有する画像のプレビュー">`);
      buttons().forEach((b) => { b.disabled = false; });
    } catch (e) {
      if (my === gen) mount(preview, html`<p class="bad">${e.message}</p>`);
    }
  };
  $$('[data-photo]', m.el).forEach((b) => b.addEventListener('click', () => { photoIdx = Number(b.dataset.photo); render(); }));
  $('[data-companions]', m.el)?.addEventListener('change', (e) => { withCompanions = e.target.checked; render(); });
  $('[data-party]', m.el)?.addEventListener('change', (e) => { withParty = e.target.checked; render(); });
  $('[data-copy-text]', m.el).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roundText(round, { companions: withCompanions, party: withParty, badge }));
      toast('コピーしました。LINE などに貼り付けて送れます');
    } catch {
      errorToast('コピーできませんでした');
    }
  });
  // 共有は、ボタンを押した直後に呼ぶ必要がある（iPhone）ので、画像は先に作っておく
  $('[data-share]', m.el)?.addEventListener('click', async () => { if (file && (await shareFile(file, 'スコアカード'))) m.close(); });
  $('[data-dl]', m.el).addEventListener('click', () => { if (file) downloadFile(file); });
  render();
}

// 作った画像をプレビューして、共有／保存する（年間のまとめなど）。makeFile は File を返す関数
export function openImagePreview(title, makeFile, shareTitle = title) {
  const shareable = canShareFile(new File([''], 'a.png', { type: 'image/png' }));
  let file = null;
  let url = null;
  const m = openModal({
    title,
    body: html`<div class="share-card"><div class="share-preview"><div class="loading">画像を作成中…</div></div>
      <p class="small muted">${shareable ? '「共有する」から LINE で送ったり、「画像を保存」で写真アプリに保存したりできます。' : '「画像を保存」でダウンロードできます。'}</p></div>`,
    footer: html`<button class="btn" data-dl disabled>画像を保存</button>${shareable ? html`<button class="btn btn-primary" data-share disabled>共有する…</button>` : ''}`,
    onClose: () => { if (url) URL.revokeObjectURL(url); },
  });
  (async () => {
    try {
      if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
      file = await makeFile();
      url = URL.createObjectURL(file);
      mount($('.share-preview', m.el), html`<img src="${url}" alt="共有する画像のプレビュー">`);
      $$('[data-dl], [data-share]', m.el).forEach((b) => { b.disabled = false; });
    } catch (e) {
      mount($('.share-preview', m.el), html`<p class="bad">${e.message}</p>`);
    }
  })();
  $('[data-share]', m.el)?.addEventListener('click', async () => { if (file && (await shareFile(file, shareTitle))) m.close(); });
  $('[data-dl]', m.el).addEventListener('click', () => { if (file) downloadFile(file); });
}
