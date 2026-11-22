// 写真のアップロード・サムネイル生成・ライトボックス（アルバムとラウンド詳細で共用）
import { html, mount, $, fmtDate, localDateTime, toast, errorToast, confirmDialog } from '../util.js';
import { api, photoUrl, STANDALONE } from '../api.js';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'];
const STANDALONE_MAX = 2048; // スマホ単独版は端末の容量を節約するため長辺 2048px に縮小して保存

// ブラウザ側で縮小版（サムネイル）を作る。HEIC などデコードできない形式は null
async function makeThumb(file, max = 480, { quality = 0.82, onlyIfLarger = false } = {}) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (onlyIfLarger && Math.max(bmp.width, bmp.height) <= max) { bmp.close?.(); return null; }
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  } catch {
    return null;
  }
}

export const isImageFile = (f) => ACCEPT.includes(f.type) || /\.(heic|heif)$/i.test(f.name);

export async function uploadPhotos(fileList, { albumId = null, roundId = null } = {}, onProgress = () => {}) {
  const files = [...fileList].filter(isImageFile);
  const skipped = fileList.length - files.length;
  let done = 0;
  let failed = 0;
  for (const f of files) {
    try {
      const q = new URLSearchParams();
      if (albumId) q.set('album_id', albumId);
      if (roundId) q.set('round_id', roundId);
      q.set('taken_at', localDateTime(f.lastModified || Date.now()));
      const type = f.type || (/\.heif$/i.test(f.name) ? 'image/heif' : 'image/heic');
      let blob = f.type ? f : new Blob([f], { type });
      if (STANDALONE && type !== 'image/gif') {
        const small = await makeThumb(f, STANDALONE_MAX, { quality: 0.86, onlyIfLarger: true });
        if (small && small.size < blob.size) blob = small;
      }
      const ph = await api.upload(`/api/photos?${q}`, blob, { 'X-Filename': encodeURIComponent(f.name) });
      const thumb = await makeThumb(f);
      if (thumb) await api.upload(`/api/photos/${ph.id}/thumb`, thumb);
    } catch (e) {
      failed++;
      errorToast(`${f.name}: ${e.message}`);
    }
    done++;
    onProgress(done, files.length);
  }
  const ok = files.length - failed;
  if (ok) toast(`${ok} 枚の写真を追加しました`);
  if (skipped) toast(`${skipped} 件は画像ではないためスキップしました`, 'error');
  return ok;
}

// ドロップ領域 + ファイル選択
export function dropzoneHtml(label = 'ここに写真をドラッグ＆ドロップ、またはクリックして選択') {
  // accept は image/* のみ：iPhone は HEIC を自動で JPEG に変換してアップロードする
  return html`<label class="dropzone" tabindex="0">
    <input type="file" accept="image/*" multiple hidden>
    <div class="only-pointer">${label}</div>
    <div class="only-touch">📷 タップして写真を選ぶ（撮影・写真ライブラリ）</div>
    <div class="small muted only-pointer">JPEG / PNG / WebP / GIF（HEIC は保存できますがブラウザによって表示できません）</div>
    <div class="progress" hidden><div></div></div>
  </label>`;
}
export function bindDropzone(zone, opts, onDone) {
  const input = $('input[type=file]', zone);
  const bar = $('.progress', zone);
  const run = async (files) => {
    if (!files.length) return;
    bar.hidden = false;
    $('div', bar).style.width = '0%';
    await uploadPhotos(files, opts, (d, n) => { $('div', bar).style.width = `${Math.round((d / n) * 100)}%`; });
    bar.hidden = true;
    input.value = '';
    onDone();
  };
  input.addEventListener('change', () => run(input.files));
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); run(e.dataTransfer.files); });
}

export function photoGridHtml(photos) {
  return html`<div class="photo-grid">${photos.map((p, i) => html`<button type="button" class="ph" data-idx="${i}" aria-label="${p.caption || '写真'}を拡大">
    <img src="${photoUrl(p)}" alt="${p.caption || ''}" loading="lazy">${p.caption ? html`<span class="cap">${p.caption}</span>` : ''}</button>`)}</div>`;
}

// 共有に使う写真のファイル（表示中の画像を描き直して JPEG に。スマホ単独版でも外部に通信せずに作れる）
const canSharePhotos = (() => {
  try { return typeof navigator !== 'undefined' && Boolean(navigator.canShare?.({ files: [new File([''], 'a.jpg', { type: 'image/jpeg' })] })); } catch { return false; }
})();
async function photoFile(p) {
  const img = new Image();
  img.src = photoUrl(p, false);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('画像を用意できませんでした');
  return new File([blob], `${(p.original_name || 'golf-photo').replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
}

// ライトボックス（拡大表示 + キャプション・アルバム・ラウンドの編集）
export async function openLightbox(photos, index, { onChanged = () => {} } = {}) {
  const [albums, rounds] = await Promise.all([api.get('/api/albums'), api.get('/api/rounds')]);
  let i = index;
  let changed = false;
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '写真ビューア');
  document.body.appendChild(box);
  const prevFocus = document.activeElement;

  // スライドショー（3 秒ごとに次の写真へ。操作したり閉じたりすると止まる）
  let slideTimer = 0;
  const stopSlide = () => { clearInterval(slideTimer); slideTimer = 0; box.classList.remove('playing'); };
  const close = () => {
    stopSlide();
    box.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
    if (changed) onChanged();
  };
  const go = (d, auto = false) => { if (!photos.length) return; if (!auto) stopSlide(); i = (i + d + photos.length) % photos.length; draw(); };
  const onKey = (e) => {
    if (document.querySelector('.modal-backdrop')) return; // 確認ダイアログ表示中
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  };
  document.addEventListener('keydown', onKey);

  function draw() {
    const p = photos[i];
    const takenLocal = (p.taken_at || '').replace(' ', 'T').slice(0, 16);
    mount(box, html`
      <div class="lb-stage">
        <div class="lb-top">
          <span class="lb-count">${i + 1} / ${photos.length}</span>
          <span class="lb-cap">${p.caption || ''}</span>
          ${photos.length > 1 ? html`<button class="lb-btn" data-slide aria-pressed="${Boolean(slideTimer)}">${slideTimer ? '❚❚ 停止' : '▶ スライドショー'}</button>` : ''}
          ${canSharePhotos ? html`<button class="lb-btn" data-share-photo disabled>共有</button>` : ''}
          <button class="lb-btn lb-info" data-info aria-expanded="${box.classList.contains('side-open')}">情報・編集</button>
          <button class="lb-btn" data-close aria-label="閉じる">✕</button>
        </div>
        <img src="${photoUrl(p, false)}" alt="${p.caption || '写真'}" draggable="false">
        ${photos.length > 1 ? html`<button class="lb-nav lb-prev" aria-label="前の写真">‹</button><button class="lb-nav lb-next" aria-label="次の写真">›</button>` : ''}
      </div>
      <div class="lb-side">
        <label class="field"><span>キャプション</span><textarea name="caption" rows="3" maxlength="500">${p.caption || ''}</textarea></label>
        <label class="field"><span>撮影日時</span><input type="datetime-local" name="taken_at" value="${takenLocal}"></label>
        <label class="field"><span>アルバム</span><select name="album_id"><option value="">（未分類）</option>
          ${albums.map((a) => html`<option value="${a.id}" ${a.id === p.album_id ? 'selected' : ''}>${a.title}</option>`)}</select></label>
        <label class="field"><span>ラウンドと関連付け</span><select name="round_id"><option value="">（なし）</option>
          ${rounds.map((r) => html`<option value="${r.id}" ${r.id === p.round_id ? 'selected' : ''}>${fmtDate(r.date)} ${r.course_name}</option>`)}</select></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" data-save>保存</button>
          ${p.album_id ? html`<button class="btn" data-cover>アルバムの表紙にする</button>` : ''}
        </div>
        ${p.round_id ? html`<a href="#/rounds/${p.round_id}" data-goto style="color:#55c088">このラウンドを見る →</a>` : ''}
        <div class="small" style="color:#898781">${p.original_name || ''}${p.size ? `（${(p.size / 1024 / 1024).toFixed(1)} MB）` : ''}</div>
        <div style="display:flex;gap:8px;margin-top:auto">
          <a class="btn" href="${photoUrl(p, false)}" download="${p.original_name || p.filename}">元画像を保存</a>
          <button class="btn btn-danger" data-del>削除</button>
        </div>
      </div>`);
    // 共有（LINE・AirDrop など）：ボタンを押した直後に共有を始められるよう、表示した写真のファイルを先に用意しておく
    const shareBtn = box.querySelector('[data-share-photo]');
    if (shareBtn) {
      let file = null;
      const my = p;
      photoFile(p).then((f) => { if (photos[i] === my) { file = f; shareBtn.disabled = false; } }).catch(() => { shareBtn.hidden = true; });
      shareBtn.addEventListener('click', async () => {
        if (!file) return;
        try { await navigator.share({ files: [file] }); } catch (e) { if (e?.name !== 'AbortError') errorToast('共有できませんでした'); }
      });
    }
    box.querySelector('[data-slide]')?.addEventListener('click', () => {
      if (slideTimer) { stopSlide(); draw(); return; }
      box.classList.add('playing');
      slideTimer = setInterval(() => go(1, true), 3000);
      draw();
    });
    box.querySelector('.lb-prev')?.addEventListener('click', () => go(-1));
    box.querySelector('.lb-next')?.addEventListener('click', () => go(1));
    box.querySelector('[data-close]').addEventListener('click', close);
    box.querySelector('[data-goto]')?.addEventListener('click', close);
    box.querySelector('[data-info]').addEventListener('click', (e) => {
      if (slideTimer) { stopSlide(); const sb = box.querySelector('[data-slide]'); if (sb) { sb.textContent = '▶ スライドショー'; sb.setAttribute('aria-pressed', 'false'); } }
      const open = box.classList.toggle('side-open');
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });
    const stage = box.querySelector('.lb-stage');
    stage.addEventListener('click', (e) => { if (e.target === stage) close(); });
    // スワイプで前後の写真へ（スマホ）
    let sx = null;
    let sy = 0;
    stage.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
    stage.addEventListener('pointerup', (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 80) go(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', () => { sx = null; });
    box.querySelector('[data-save]').addEventListener('click', async () => {
      const side = box.querySelector('.lb-side');
      const val = (n) => side.querySelector(`[name="${n}"]`).value;
      try {
        const updated = await api.put(`/api/photos/${p.id}`, {
          caption: val('caption'),
          taken_at: val('taken_at') ? val('taken_at').replace('T', ' ') : null,
          album_id: val('album_id') ? Number(val('album_id')) : null,
          round_id: val('round_id') ? Number(val('round_id')) : null,
        });
        photos[i] = { ...p, ...updated };
        changed = true;
        toast('写真の情報を保存しました');
        draw();
      } catch (e) { errorToast(e); }
    });
    box.querySelector('[data-cover]')?.addEventListener('click', async () => {
      try {
        const a = albums.find((x) => x.id === p.album_id);
        await api.put(`/api/albums/${p.album_id}`, { title: a.title, description: a.description, date: a.date, cover_photo_id: p.id });
        changed = true;
        toast('アルバムの表紙に設定しました');
      } catch (e) { errorToast(e); }
    });
    box.querySelector('[data-del]').addEventListener('click', async () => {
      if (!(await confirmDialog('この写真を削除しますか？\n元に戻すことはできません。', { danger: true, okText: '削除する' }))) return;
      try {
        await api.del(`/api/photos/${p.id}`);
        photos.splice(i, 1);
        changed = true;
        toast('写真を削除しました');
        if (!photos.length) { close(); return; }
        i = Math.min(i, photos.length - 1);
        draw();
      } catch (e) { errorToast(e); }
    });
  }
  draw();
  box.querySelector('[data-close]')?.focus();
}
