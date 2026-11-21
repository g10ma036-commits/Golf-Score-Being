// ファイルを渡す：スマホの共有シート（LINE・「ファイルに保存」・「画像を保存」・AirDrop など）かダウンロード
import { errorToast } from './util.js';

export function canShareFile(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

// 共有できたら true。キャンセルしたときは何も表示しない
export async function shareFile(file, title = '') {
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (e) {
    if (e?.name !== 'AbortError') errorToast('共有できませんでした。「保存」をお試しください');
    return false;
  }
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// 今日の日付（ファイル名用）例: 20261122
export function ymd(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// 地図・天気予報を開くリンク（押したときだけ、そのサービスでゴルフ場名を検索する）
export const mapUrl = (name, location = '') => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, location].filter(Boolean).join(' '))}`;
export const weatherUrl = (name, location = '') => `https://www.google.com/search?q=${encodeURIComponent(`${location || name} 天気`)}`;
