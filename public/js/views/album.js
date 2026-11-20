// アルバム一覧
import { html, mount, $, fmtDate, icon, openModal, toast, errorToast } from '../util.js';
import { api, fileUrl, STANDALONE } from '../api.js';
import { navigate } from '../main.js';
import { dropzoneHtml, bindDropzone } from './photoTools.js';

export async function render(root) {
  const [albums, photos] = await Promise.all([api.get('/api/albums'), api.get('/api/photos')]);
  const unassigned = photos.filter((p) => !p.album_id);
  const coverOf = (list) => (list[0] ? fileUrl(list[0].thumb || list[0].filename) : null);
  const card = (href, title, sub, cover) => html`<a class="album-card" href="${href}">
    <div class="cover">${cover ? html`<img src="${cover}" alt="" loading="lazy">` : icon('album')}</div>
    <div class="meta"><h3>${title}</h3><div class="small muted">${sub}</div></div></a>`;

  mount(root, html`
    <div class="page-header">
      <div><h1>アルバム</h1><div class="sub">ラウンドの思い出やスイング写真を整理できます（写真は${STANDALONE ? 'この端末の中' : ' data/photos フォルダ'}に保存）</div></div>
      <div class="actions"><button class="btn btn-primary" id="add">${icon('plus')}新しいアルバム</button></div>
    </div>
    <div class="album-grid">
      ${card('#/album/all', 'すべての写真', `${photos.length} 枚`, coverOf(photos))}
      ${unassigned.length ? card('#/album/none', '未分類', `${unassigned.length} 枚`, coverOf(unassigned)) : ''}
      ${albums.map((a) => card(`#/album/${a.id}`, a.title, `${a.date ? fmtDate(a.date) + '・' : ''}${a.photo_count} 枚`, a.cover ? fileUrl(a.cover) : null))}
    </div>
    <div class="section">${dropzoneHtml('ここに写真をドロップすると「未分類」に追加されます')}</div>
  `);
  $('#add', root).addEventListener('click', async () => {
    const a = await openAlbumEditor(null);
    if (a) navigate(`/album/${a.id}`);
  });
  bindDropzone($('.dropzone', root), {}, () => render(root));
}

export function openAlbumEditor(album) {
  return new Promise((resolve) => {
    let saved = null;
    const m = openModal({
      title: album ? 'アルバムを編集' : '新しいアルバム',
      body: html`<form id="album-form" autocomplete="off"><div class="form-grid">
        <label class="field wide"><span>タイトル *</span><input name="title" required maxlength="100" value="${album?.title || ''}" placeholder="例: 2026 夏合宿ゴルフ"></label>
        <label class="field"><span>日付</span><input type="date" name="date" value="${album?.date || ''}"></label>
        <label class="field wide"><span>説明</span><textarea name="description" rows="3" maxlength="2000">${album?.description || ''}</textarea></label>
      </div></form>`,
      footer: html`<button class="btn" data-cancel>キャンセル</button><button class="btn btn-primary" data-save>保存</button>`,
      onClose: () => resolve(saved),
    });
    const form = $('#album-form', m.el);
    $('[data-cancel]', m.el).addEventListener('click', () => m.close());
    const save = async () => {
      if (!form.reportValidity()) return;
      const body = { title: form.title.value, date: form.date.value || null, description: form.description.value };
      try {
        saved = album ? await api.put(`/api/albums/${album.id}`, body) : await api.post('/api/albums', body);
        toast('アルバムを保存しました');
        m.close();
      } catch (e) { errorToast(e); }
    };
    $('[data-save]', m.el).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  });
}
