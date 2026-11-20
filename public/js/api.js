// API の呼び出し。PC版はサーバーへ、スマホ単独版はブラウザ内の API（local/backend.js）へ送る
import { STANDALONE } from './mode.js';
const backupLib = () => import('./shared/backup.js');

export { STANDALONE };

let backend = null;
let backendPromise = null;
function localBackend() {
  backendPromise ??= import('./local/index.js').then(async (m) => { backend = await m.openBackend(); return backend; });
  return backendPromise;
}

async function request(method, url, body, extraHeaders = {}) {
  if (STANDALONE) return (await localBackend()).handle(method, url, body, extraHeaders);
  const headers = { 'X-Golf-App': '1', ...extraHeaders };
  let payload;
  if (body instanceof Blob) {
    payload = body;
    headers['Content-Type'] = body.type || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new Error('サーバーに接続できません。アプリ（start.bat）が起動しているか確認してください');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `エラー (${res.status})`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),
  upload: (url, blob, headers) => request(url.includes('/thumb') ? 'PUT' : 'POST', url, blob, headers),
};

// 設定はよく使うのでキャッシュ
let settingsCache = null;
export async function getSettings(force = false) {
  if (!settingsCache || force) settingsCache = await api.get('/api/settings');
  return settingsCache;
}
export async function saveSettings(s) {
  settingsCache = await api.put('/api/settings', s);
  return settingsCache;
}
export function unit() { return settingsCache?.unit === 'm' ? 'm' : 'yd'; }

// 写真の表示用 URL（スマホ単独版は端末内の画像を指す blob: URL）
export const fileUrl = (name) => (!name ? '' : STANDALONE ? backend?.fileUrl(name) || '' : `/photos/${name}`);
export const photoUrl = (p, thumb = true) => fileUrl(thumb && p.thumb ? p.thumb : p.filename);

// ---------- バックアップ（写真込み ZIP） ----------
export async function createBackup() {
  if (STANDALONE) {
    const [parts, { backupFileName }] = await Promise.all([(await localBackend()).exportBackupParts(), backupLib()]);
    return new File(parts, backupFileName('zip'), { type: 'application/zip' });
  }
  let res;
  try { res = await fetch('/api/export?format=zip'); } catch { throw new Error('サーバーに接続できません'); }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `エラー (${res.status})`);
  const { backupFileName } = await backupLib();
  return new File([await res.blob()], backupFileName('zip'), { type: 'application/zip' });
}
// 復元前の確認用に中身を数える
export async function inspectBackup(file) {
  const { readBackup, backupSummary } = await backupLib();
  const b = await readBackup(file);
  return { kind: b.kind, ...backupSummary(b) };
}
export async function restoreBackup(file, kind) {
  if (STANDALONE) return (await localBackend()).importBackup(file);
  if (kind === 'zip') return request('POST', '/api/import/zip', new Blob([file], { type: 'application/zip' }));
  const { data } = await (await backupLib()).readBackup(file);
  return request('POST', '/api/import', data);
}
export async function localMeta() {
  if (!STANDALONE) return null;
  const b = await localBackend();
  const m = await import('./local/index.js');
  return { ...(await b.meta()), last_backup_at: await m.getMeta('last_backup_at'), storageError: m.storageError };
}
export async function markBackedUp() {
  if (!STANDALONE) return;
  const m = await import('./local/index.js');
  await m.setMeta('last_backup_at', new Date().toISOString());
}
