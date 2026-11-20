// アルバムの中身（すべての写真 / 未分類 / 各アルバム）
import { html, mount, $, $$, fmtDate, icon, confirmDialog, toast, errorToast } from '../util.js';
import { api, photoUrl } from '../api.js';
import { navigate } from '../main.js';
import { dropzoneHtml, bindDropzone, openLightbox } from './photoTools.js';
import { openAlbumEditor } from './album.js';

export async function render(root, [key]) {
  let album = null;
  let photos;
  if (key === 'all') photos = await api.get('/api/photos');
  else if (key === 'none') photos = await api.get('/api/photos?album_id=none');
  else {
    [album, photos] = await Promise.all([api.get(`/api/albums/${key}`), api.get(`/api/photos?album_id=${key}`)]);
  }
  const title = album ? album.title : key === 'all' ? 'すべての写真' : '未分類の写真';

  // 撮影月ごとにグループ化
  const groups = new Map();
  photos.forEach((p, i) => {
    const k = (p.taken_at || p.created_at || '').slice(0, 7) || '日付なし';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ p, i });
  });

  mount(root, html`
    <div class="page-header">
      <div><a class="small" href="#/album">← アルバム一覧</a><h1>${title}</h1>
        <div class="sub">${album?.date ? `${fmtDate(album.date)}・` : ''}${photos.length} 枚</div></div>
      ${album ? html`<div class="actions"><button class="btn" id="edit">${icon('edit')}編集</button><button class="btn btn-danger" id="del">${icon('trash')}削除</button></div>` : ''}
    </div>
    ${album?.description ? html`<p class="secondary" style="white-space:pre-wrap;margin-top:-8px">${album.description}</p>` : ''}
    <div style="margin-bottom:16px">${dropzoneHtml(album ? `このアルバムに写真を追加（ドラッグ＆ドロップ / クリック）` : '写真を追加（ドラッグ＆ドロップ / クリック）')}</div>
    ${photos.length ? [...groups.entries()].map(([k, items]) => html`
      <h3 style="margin:16px 0 8px" class="secondary">${/^\d{4}-\d{2}$/.test(k) ? `${k.slice(0, 4)}年${Number(k.slice(5))}月` : k}</h3>
      <div class="photo-grid">${items.map(({ p, i }) => html`<button type="button" class="ph" data-idx="${i}" aria-label="${p.caption || '写真'}を拡大">
        <img src="${photoUrl(p)}" alt="${p.caption || ''}" loading="lazy">
        ${p.caption || p.round_course ? html`<span class="cap">${p.caption || `${p.round_course}`}</span>` : ''}</button>`)}</div>`)
      : html`<div class="card empty">${icon('photo')}<p>まだ写真がありません。上のエリアに写真をドロップしてください。</p></div>`}
  `);

  const reload = () => render(root, [key]);
  bindDropzone($('.dropzone', root), { albumId: album?.id ?? null }, reload);
  $$('.ph', root).forEach((b) => b.addEventListener('click', () => openLightbox(photos, Number(b.dataset.idx), { onChanged: reload })));
  $('#edit', root)?.addEventListener('click', async () => { if (await openAlbumEditor(album)) reload(); });
  $('#del', root)?.addEventListener('click', async () => {
    const ok = await confirmDialog(`アルバム「${album.title}」を削除しますか？\n中の写真は削除されず「未分類」に移動します。`, { danger: true, okText: '削除する' });
    if (!ok) return;
    try { await api.del(`/api/albums/${album.id}`); toast('アルバムを削除しました'); navigate('/album'); } catch (e) { errorToast(e); }
  });
}

