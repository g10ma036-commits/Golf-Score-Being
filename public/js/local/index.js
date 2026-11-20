// スマホ単独版：保存先（IndexedDB）を開いてブラウザ内の API を用意する
import { createLocalBackend, memoryStore } from './backend.js';
import { openIdbStore } from './idb.js';

let storeRef = null;
export let storageError = null;

export async function openBackend() {
  let store;
  try {
    store = await openIdbStore();
  } catch (e) {
    // プライベートブラウズなどで保存できない環境。表示はできるが、閉じるとデータは消える
    console.error(e);
    storageError = e;
    store = memoryStore();
  }
  storeRef = store;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('golf-data') : null;
  const backend = createLocalBackend(store, { onSaved: () => channel?.postMessage('changed') });
  // 同じ端末の別のタブ（ブラウザとホーム画面のアプリなど）で変更されたら読み直す
  channel?.addEventListener('message', (e) => { if (e.data === 'changed') backend.invalidate(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') backend.invalidate(); });
  return backend;
}

export const getMeta = (k) => storeRef?.getMeta?.(k) ?? null;
export const setMeta = (k, v) => storeRef?.setMeta?.(k, v);
