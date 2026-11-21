// サンプルデータの読み込み・削除（ホームと設定で共用）
import { html, confirmDialog, toast, errorToast } from '../util.js';
import { api } from '../api.js';

export const sampleCountText = (c) => `コース ${c.courses}・ラウンド ${c.rounds}・クラブ ${c.clubs}・飛距離 ${c.distances}件`;

// サンプルが入っているときにホームの上部に出すお知らせ
export function sampleNoticeHtml(info) {
  if (!info?.present) return '';
  return html`<div class="notice sample-notice">
    <span>🧪 いま表示しているのは<strong>サンプルデータ</strong>（架空のコース・ラウンド・クラブ）です。自分の記録を始めるときは、サンプルだけを消せます。</span>
    <button type="button" class="btn btn-sm" data-delete-sample>サンプルデータを削除</button></div>`;
}

export async function loadSample() {
  await api.post('/api/sample');
  toast('サンプルデータを読み込みました。不要になったら、ホームの「サンプルデータを削除」で消せます');
}

// 確認してからサンプルだけを削除。削除したら true
export async function deleteSampleFlow() {
  let info;
  try { info = await api.get('/api/sample'); } catch (e) { errorToast(e); return false; }
  if (!info.present) { toast('サンプルデータはありません'); return false; }
  const ok = await confirmDialog(
    `サンプルデータを削除します。\n${sampleCountText(info.counts)}\n\n自分で登録したコース・ラウンド・クラブ・写真は残ります（サンプルのコースで記録したラウンドは一緒に削除されます）。`,
    { title: 'サンプルデータを削除', danger: true, okText: '削除する' },
  );
  if (!ok) return false;
  try {
    await api.del('/api/sample');
    toast('サンプルデータを削除しました');
    return true;
  } catch (e) { errorToast(e); return false; }
}
