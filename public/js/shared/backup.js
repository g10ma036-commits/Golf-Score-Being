// バックアップファイル（写真込みの ZIP / データのみの JSON）の読み書き。PC版・スマホ単独版で共通の形式
import { ApiError, IMAGE_EXT, isPhotoName, isThumbName } from './model.js';
import { zipParts, readZip, isZip } from './zip.js';

export const BACKUP_JSON = 'data.json';
const MIME_BY_EXT = Object.fromEntries(Object.entries(IMAGE_EXT).map(([m, e]) => [e, m]));
export const mimeOf = (name) => MIME_BY_EXT[name.slice(name.lastIndexOf('.'))] || 'application/octet-stream';

function parseJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new ApiError(400, 'バックアップファイルを読み込めませんでした（形式が不正です）'); }
  if (!data || data.app !== 'golf-enjoy-manager') throw new ApiError(400, 'このアプリのバックアップファイルではありません');
  return data;
}

// file: File / Blob / Uint8Array。files は写真ファイル（名前は検証済みのものだけ）
export async function readBackup(file) {
  if (await isZip(file)) {
    let entries;
    let jsonText;
    try {
      entries = await readZip(file);
      const json = entries.find((e) => e.name === BACKUP_JSON);
      if (!json) throw new ApiError(400, 'バックアップ ZIP の中に data.json がありません');
      jsonText = new TextDecoder().decode(await json.bytes());
    } catch (e) {
      throw e instanceof ApiError ? e : new ApiError(400, e.message);
    }
    const data = parseJson(jsonText);
    const files = entries
      .filter((e) => e.name.startsWith('photos/'))
      .map((e) => ({ name: e.name.slice('photos/'.length), entry: e }))
      .filter((f) => isPhotoName(f.name) || isThumbName(f.name));
    return { kind: 'zip', data, files };
  }
  const text = typeof Blob !== 'undefined' && file instanceof Blob ? await file.text() : new TextDecoder().decode(file);
  return { kind: 'json', data: parseJson(text), files: [] };
}

export function backupSummary({ data, files = [] }) {
  const n = (k) => (Array.isArray(data[k]) ? data[k].length : 0);
  const t = typeof data.exported_at === 'string' ? new Date(data.exported_at) : null;
  const p = (x) => String(x).padStart(2, '0');
  return {
    // 書き出した日時（UTC）を端末の日付で表示
    date: t && !Number.isNaN(t.getTime()) ? `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}` : null,
    rounds: n('rounds'), courses: n('courses'), clubs: n('clubs'), distances: n('distances'),
    albums: n('albums'), photos: n('photos'), photoFiles: files.filter((f) => isPhotoName(f.name)).length,
  };
}

// files: [{ name: 'uuid.jpg' | 'thumbs/uuid.jpg', data: Blob | Uint8Array }]
export function backupParts(data, files) {
  return zipParts([
    { name: BACKUP_JSON, data: JSON.stringify(data) },
    ...files.map((f) => ({ name: 'photos/' + f.name, data: f.data })),
  ]);
}

export function backupFileName(ext, d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `golf-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}
