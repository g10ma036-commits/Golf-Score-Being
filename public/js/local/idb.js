// スマホ単独版の保存先：ブラウザの IndexedDB（この端末の中だけに保存され、外部には送信されない）
const DB_NAME = 'golf-enjoy-manager';
const VERSION = 1;

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new DOMException('保存が中断されました', 'AbortError'));
});

function open() {
  const r = indexedDB.open(DB_NAME, VERSION);
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
  };
  r.onblocked = () => console.warn('IndexedDB: 別のタブが古いバージョンで開いています');
  return req(r);
}

export async function openIdbStore() {
  let db = await open();
  const watch = () => { db.onclose = () => { db = null; }; db.onversionchange = () => { db.close(); db = null; }; };
  watch();
  // iPhone ではアプリをしばらく閉じていると接続が切れることがあるため、失敗したら 1 回だけ開き直す
  async function run(stores, mode, fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        if (!db) { db = await open(); watch(); }
        const tx = db.transaction(stores, mode);
        const finished = done(tx); // 完了イベントを取りこぼさないよう先に待ち受ける
        finished.catch(() => {});
        const result = await fn(tx);
        await finished;
        return result;
      } catch (e) {
        if (attempt > 0 || !['InvalidStateError', 'UnknownError', 'TransactionInactiveError'].includes(e?.name)) throw e;
        try { db?.close(); } catch { /* ignore */ }
        db = null;
      }
    }
  }
  return {
    load: () => run('kv', 'readonly', (tx) => req(tx.objectStore('kv').get('data'))),
    save: (data) => run('kv', 'readwrite', (tx) => { tx.objectStore('kv').put(data, 'data'); }),
    getMeta: (key) => run('kv', 'readonly', (tx) => req(tx.objectStore('kv').get('meta:' + key))),
    setMeta: (key, value) => run('kv', 'readwrite', (tx) => { tx.objectStore('kv').put(value, 'meta:' + key); }),
    putFile: (name, blob) => run('files', 'readwrite', (tx) => { tx.objectStore('files').put(blob, name); }),
    getFiles: (names) => run('files', 'readonly', async (tx) => {
      const os = tx.objectStore('files');
      const blobs = await Promise.all(names.map((n) => req(os.get(n))));
      return new Map(names.map((n, i) => [n, blobs[i] || null]));
    }),
    deleteFiles: (names) => run('files', 'readwrite', (tx) => { const os = tx.objectStore('files'); names.forEach((n) => os.delete(n)); }),
    listFiles: () => run('files', 'readonly', async (tx) => (await req(tx.objectStore('files').getAllKeys())).map(String)),
    clearFiles: () => run('files', 'readwrite', (tx) => { tx.objectStore('files').clear(); }),
  };
}
