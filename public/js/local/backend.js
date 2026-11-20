// スマホ単独版の「サーバー」：PC版の REST API（server/api.js）と同じ URL・同じ結果を、ブラウザ内だけで返す。
// データはメモリ上の表として持ち、変更のたびに保存先（IndexedDB）へ書き込む。写真は Blob として別に保存する。
import {
  ApiError, SCHEMA, TABLES, ID_TABLES, SETTING_KEYS, SETTING_DEFAULTS, localNow, uuid, num, id,
  normalizeSetting, normalizeCourse, normalizeRound, normalizeClub, normalizeDistance, normalizeAlbum, normalizeCover,
  photoLinks, imageExt, thumbExt, originalName, takenAt, text, cleanImport, isPhotoName, isThumbName,
} from '../shared/model.js';
import { generateSample } from '../shared/sample.js';
import { readBackup, backupParts, mimeOf } from '../shared/backup.js';

export function emptyData() {
  const d = { format: 1, updated_at: null, seq: {}, settings: {} };
  for (const t of Object.keys(SCHEMA)) if (t !== 'settings') d[t] = [];
  for (const t of ID_TABLES) d.seq[t] = 0;
  return d;
}

// SQLite の並び順に合わせた比較（NULL は最小、文字列は単純比較）
const cmp = (a, b) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);
const nocase = (s) => (s == null ? s : String(s).replace(/[A-Z]/g, (c) => c.toLowerCase()));
const maxId = (rows) => rows.reduce((m, r) => Math.max(m, r.id || 0), 0);

/**
 * @param store 保存先 { load(), save(data), putFile(name, blob), getFiles(names) → Map, deleteFiles(names), listFiles(), clearFiles() }
 * @param urls  写真の表示用 URL の作成・破棄（テストでは差し替える）
 */
export function createLocalBackend(store, {
  createUrl = (blob) => URL.createObjectURL(blob),
  revokeUrl = (u) => URL.revokeObjectURL(u),
  onSaved = () => {},
} = {}) {
  let D = null;
  const urls = new Map();

  // 同時に来た要求を 1 つずつ処理する
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  async function ensureLoaded() {
    if (D) return;
    const loaded = await store.load();
    D = loaded && typeof loaded === 'object' ? { ...emptyData(), ...loaded } : emptyData();
    for (const t of ID_TABLES) D.seq[t] = Math.max(D.seq[t] || 0, maxId(D[t]));
  }

  // ---------- 表の操作 ----------
  function insert(t, row) {
    const cols = SCHEMA[t];
    const full = {};
    const now = localNow();
    for (const [c, spec] of Object.entries(cols)) {
      const [type, def] = spec.split('=');
      full[c] = row[c] !== undefined ? row[c] : def !== undefined ? Number(def) : type === 'ts' ? now : null;
    }
    if (cols.id) full.id = ++D.seq[t];
    D[t].push(full);
    return full.id;
  }
  const find = (t, rid) => D[t].find((r) => r.id === rid);
  const exists = (t, rid) => Boolean(find(t, rid));
  function remove(t, pred) { D[t] = D[t].filter((r) => !pred(r)); }
  function mustFind(t, rid, msg) {
    const r = find(t, rid);
    if (!r) throw new ApiError(404, msg);
    return r;
  }

  // ---------- 設定 ----------
  function getSettings() {
    const out = { ...SETTING_DEFAULTS };
    for (const k of SETTING_KEYS) if (D.settings[k] !== undefined) out[k] = D.settings[k];
    return out;
  }
  function putSettings(b) {
    for (const k of SETTING_KEYS) if (b[k] !== undefined) D.settings[k] = normalizeSetting(k, b[k]);
    return getSettings();
  }

  // ---------- コース ----------
  const holesOf = (cid) => D.course_holes.filter((h) => h.course_id === cid).sort((a, b) => a.hole_no - b.hole_no)
    .map(({ hole_no, par, yards, hdcp }) => ({ hole_no, par, yards, hdcp }));
  function listCourses() {
    return [...D.courses]
      .sort((a, b) => cmp(nocase(a.name), nocase(b.name)) || a.id - b.id)
      .map((c) => ({ ...c, round_count: D.rounds.filter((r) => r.course_id === c.id).length, holes: holesOf(c.id) }));
  }
  function getCourse(cid) {
    const c = mustFind('courses', cid, 'コースが見つかりません');
    return { ...c, holes: holesOf(cid) };
  }
  function saveCourse(cid, b) {
    const { row, holes } = normalizeCourse(b);
    if (cid) Object.assign(mustFind('courses', cid, 'コースが見つかりません'), row);
    else cid = insert('courses', row);
    remove('course_holes', (h) => h.course_id === cid);
    for (const h of holes) insert('course_holes', { course_id: cid, ...h });
    return getCourse(cid);
  }
  function deleteCourse(cid) {
    mustFind('courses', cid, 'コースが見つかりません');
    remove('courses', (c) => c.id === cid);
    remove('course_holes', (h) => h.course_id === cid);
    for (const r of D.rounds) if (r.course_id === cid) r.course_id = null;
    return { ok: true };
  }

  // ---------- ラウンド ----------
  function roundRows(filter = () => true) {
    const rounds = D.rounds.filter(filter).sort((a, b) => cmp(b.date, a.date) || b.id - a.id);
    const byRound = new Map();
    for (const h of D.round_holes) {
      if (!byRound.has(h.round_id)) byRound.set(h.round_id, []);
      const { round_id, ...rest } = h;
      byRound.get(round_id).push(rest);
    }
    return rounds.map((r) => ({
      ...r,
      course_name: (r.course_id != null ? find('courses', r.course_id)?.name : null) ?? r.course_name,
      photo_count: D.photos.filter((p) => p.round_id === r.id).length,
      holes: (byRound.get(r.id) || []).sort((a, b) => a.hole_no - b.hole_no),
    }));
  }
  function getRound(rid) {
    const [r] = roundRows((x) => x.id === rid);
    if (!r) throw new ApiError(404, 'ラウンドが見つかりません');
    return r;
  }
  function saveRound(rid, b) {
    const { row, holes } = normalizeRound(b, (cid) => find('courses', cid)?.name);
    if (rid) Object.assign(mustFind('rounds', rid, 'ラウンドが見つかりません'), row, { updated_at: localNow() });
    else rid = insert('rounds', row);
    remove('round_holes', (h) => h.round_id === rid);
    for (const h of holes) insert('round_holes', { round_id: rid, ...h });
    return getRound(rid);
  }
  function deleteRound(rid) {
    mustFind('rounds', rid, 'ラウンドが見つかりません');
    remove('rounds', (r) => r.id === rid);
    remove('round_holes', (h) => h.round_id === rid);
    for (const p of D.photos) if (p.round_id === rid) p.round_id = null;
    return { ok: true };
  }

  // ---------- クラブ ----------
  function listClubs() {
    return [...D.clubs]
      .sort((a, b) => b.in_bag - a.in_bag || a.sort_order - b.sort_order || a.id - b.id)
      .map((c) => {
        const ds = D.distances.filter((d) => d.club_id === c.id);
        const carries = ds.map((d) => d.carry).filter((v) => v != null);
        const totals = ds.map((d) => d.total).filter((v) => v != null);
        const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
        return {
          ...c,
          shot_count: ds.length,
          avg_carry: avg(carries),
          avg_total: avg(totals),
          max_carry: carries.length ? Math.max(...carries) : null,
          min_carry: carries.length ? Math.min(...carries) : null,
        };
      });
  }
  const getClub = (cid) => ({ ...mustFind('clubs', cid, 'クラブが見つかりません') });
  function saveClub(cid, b) {
    const row = normalizeClub(b, !cid);
    if (cid) Object.assign(mustFind('clubs', cid, 'クラブが見つかりません'), row);
    else cid = insert('clubs', row);
    return getClub(cid);
  }
  function reorderClubs(b) {
    if (!Array.isArray(b.ids)) throw new ApiError(400, 'ids が必要です');
    b.ids.forEach((cid, i) => { const c = find('clubs', id(cid)); if (c) c.sort_order = i; });
    return listClubs();
  }
  function deleteClub(cid) {
    mustFind('clubs', cid, 'クラブが見つかりません');
    remove('clubs', (c) => c.id === cid);
    remove('distances', (d) => d.club_id === cid);
    return { ok: true };
  }

  // ---------- 飛距離 ----------
  function listDistances(q) {
    const clubId = q.get('club_id') ? id(q.get('club_id')) : null;
    return D.distances
      .filter((d) => clubId == null || d.club_id === clubId)
      .map((d) => ({ d, c: find('clubs', d.club_id) }))
      .filter((x) => x.c)
      .sort((x, y) => cmp(y.d.date, x.d.date) || y.d.id - x.d.id)
      .map(({ d, c }) => ({ ...d, club_name: c.name, category: c.category }));
  }
  const validDistance = (b) => normalizeDistance(b, (cid) => exists('clubs', cid));
  function addDistances(b) {
    const records = Array.isArray(b.records) ? b.records : [b];
    if (!records.length) throw new ApiError(400, '記録がありません');
    if (records.length > 500) throw new ApiError(400, '一度に登録できるのは500件までです');
    const rows = records.map(validDistance);
    rows.forEach((r) => insert('distances', r));
    return { inserted: rows.length };
  }
  function updateDistance(did, b) {
    const d = mustFind('distances', did, '記録が見つかりません');
    Object.assign(d, validDistance(b));
    return { ...d };
  }
  function deleteDistance(did) {
    mustFind('distances', did, '記録が見つかりません');
    remove('distances', (d) => d.id === did);
    return { ok: true };
  }

  // ---------- アルバム・写真 ----------
  const fileOf = (p) => p.thumb ?? p.filename;
  function listAlbums() {
    return [...D.albums]
      .sort((a, b) => cmp(b.date ?? b.created_at, a.date ?? a.created_at) || b.id - a.id)
      .map((a) => {
        const inAlbum = D.photos.filter((p) => p.album_id === a.id);
        const cover = inAlbum.find((p) => p.id === a.cover_photo_id)
          ?? [...inAlbum].sort((x, y) => cmp(y.taken_at, x.taken_at) || y.id - x.id)[0];
        return { ...a, photo_count: inAlbum.length, cover: cover ? fileOf(cover) : null };
      });
  }
  function getAlbum(aid) {
    const a = listAlbums().find((x) => x.id === aid);
    if (!a) throw new ApiError(404, 'アルバムが見つかりません');
    return a;
  }
  function saveAlbum(aid, b) {
    const row = normalizeAlbum(b);
    if (aid) {
      getAlbum(aid);
      const cover = normalizeCover(b);
      const a = find('albums', aid);
      Object.assign(a, row);
      if (cover !== undefined) a.cover_photo_id = cover;
    } else {
      aid = insert('albums', row);
    }
    return getAlbum(aid);
  }
  function deleteAlbum(aid) {
    getAlbum(aid);
    remove('albums', (a) => a.id === aid);
    for (const p of D.photos) if (p.album_id === aid) p.album_id = null;
    return { ok: true };
  }
  function listPhotos(q) {
    let albumFilter = () => true;
    const albumQ = q.get('album_id');
    if (albumQ) {
      if (albumQ === 'none') albumFilter = (p) => p.album_id == null;
      else { const aid = id(albumQ); albumFilter = (p) => p.album_id === aid; }
    }
    const roundId = q.get('round_id') ? id(q.get('round_id')) : null;
    const limit = q.get('limit') ? num('limit', q.get('limit'), { min: 1, max: 1000, integer: true }) : null;
    const list = D.photos
      .filter((p) => albumFilter(p) && (roundId == null || p.round_id === roundId))
      .sort((a, b) => cmp(b.taken_at ?? b.created_at, a.taken_at ?? a.created_at) || b.id - a.id)
      .slice(0, limit ?? undefined)
      .map((p) => {
        const a = p.album_id != null ? find('albums', p.album_id) : null;
        const r = p.round_id != null ? find('rounds', p.round_id) : null;
        const c = r?.course_id != null ? find('courses', r.course_id) : null;
        return { ...p, album_title: a?.title ?? null, round_date: r?.date ?? null, round_course: r ? (c?.name ?? r.course_name) : null };
      });
    return list;
  }
  const getPhoto = (pid) => ({ ...mustFind('photos', pid, '写真が見つかりません') });
  const links = (q) => photoLinks(q, (aid) => exists('albums', aid), (rid) => exists('rounds', rid));

  // 写真の追加はファイル保存が先。データの保存に失敗したらファイルも消す
  async function uploadPhoto(blob, mime, q, headers) {
    const ext = imageExt(mime);
    if (!blob.size) throw new ApiError(400, '画像データが空です');
    const l = links({ album_id: q.get('album_id'), round_id: q.get('round_id') });
    const row = {
      filename: uuid() + ext, original_name: originalName(headers['X-Filename'] ?? headers['x-filename']), mime, size: blob.size,
      ...l, caption: text(q.get('caption'), 500), taken_at: takenAt(q.get('taken_at')),
    };
    await store.putFile(row.filename, blob);
    try {
      return await commit(() => getPhoto(insert('photos', row)));
    } catch (e) {
      await store.deleteFiles([row.filename]).catch(() => {});
      throw e;
    }
  }
  async function uploadThumb(pid, blob, mime) {
    const old = getPhoto(pid);
    const name = 'thumbs/' + uuid() + thumbExt(mime, blob.size);
    await store.putFile(name, blob);
    try {
      const res = await commit(() => { find('photos', pid).thumb = name; return getPhoto(pid); });
      if (old.thumb) await dropFiles([old.thumb]);
      return res;
    } catch (e) {
      await store.deleteFiles([name]).catch(() => {});
      throw e;
    }
  }
  function updatePhoto(pid, b) {
    getPhoto(pid);
    const l = links(b);
    Object.assign(find('photos', pid), { caption: text(b.caption, 500), ...l, taken_at: takenAt(b.taken_at) });
    return getPhoto(pid);
  }
  async function deletePhoto(pid) {
    const ph = getPhoto(pid);
    await commit(() => {
      remove('photos', (p) => p.id === pid);
      for (const a of D.albums) if (a.cover_photo_id === pid) a.cover_photo_id = null;
    });
    await dropFiles([ph.filename, ph.thumb].filter(Boolean));
    return { ok: true };
  }
  async function dropFiles(names) {
    for (const n of names) { const u = urls.get(n); if (u) { revokeUrl(u); urls.delete(n); } }
    await store.deleteFiles(names).catch(() => {});
  }
  // 写真の表示用 URL を用意してから結果を返す（画面側は photoUrl() で同期的に参照する）
  async function ensureUrls(names) {
    const missing = [...new Set(names.filter((n) => n && !urls.has(n)))];
    if (!missing.length) return;
    const files = await store.getFiles(missing);
    for (const [n, blob] of files) if (blob) urls.set(n, createUrl(blob));
  }
  const photoNames = (list) => list.flatMap((p) => [p.filename, p.thumb]);

  // ---------- バックアップ ----------
  function exportAll() {
    const out = { app: 'golf-enjoy-manager', version: 1, exported_at: new Date().toISOString() };
    for (const [t, cols] of Object.entries(TABLES)) {
      const rows = t === 'settings'
        ? SETTING_KEYS.filter((k) => D.settings[k] !== undefined).map((k) => ({ key: k, value: D.settings[k] }))
        : D[t];
      out[t] = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    }
    return out;
  }
  function importAll(data, hasFile) {
    const rows = cleanImport(data, { hasFile });
    D.settings = Object.fromEntries(rows.settings.map((r) => [r.key, r.value ?? '']));
    for (const t of Object.keys(SCHEMA)) {
      if (t === 'settings') continue;
      D[t] = rows[t];
      if (ID_TABLES.includes(t)) D.seq[t] = Math.max(D.seq[t] || 0, maxId(rows[t]));
    }
    const counts = {};
    for (const t of Object.keys(SCHEMA)) counts[t] = t === 'settings' ? rows.settings.length : D[t].length;
    return { ok: true, counts };
  }
  function loadSample() {
    if (D.rounds.length + D.clubs.length + D.courses.length > 0) throw new ApiError(409, 'データが空のときだけサンプルを読み込めます');
    generateSample(insert);
    return { ok: true };
  }
  async function deleteAll() {
    await commit(() => { for (const t of Object.keys(SCHEMA)) if (t !== 'settings') D[t] = []; });
    for (const u of urls.values()) revokeUrl(u);
    urls.clear();
    await store.clearFiles();
    return { ok: true };
  }
  // どの写真からも参照されていないファイルを消す（復元後の片付け）
  async function collectGarbage() {
    const used = new Set(photoNames(D.photos).filter(Boolean));
    const stale = (await store.listFiles()).filter((n) => !used.has(n));
    if (stale.length) await dropFiles(stale);
  }

  // 写真込みのバックアップ（ZIP のパーツ配列）
  async function exportBackupParts() {
    return enqueue(async () => {
      await ensureLoaded();
      const data = exportAll();
      const names = photoNames(D.photos).filter(Boolean);
      const files = await store.getFiles(names);
      return backupParts(data, names.filter((n) => files.get(n)).map((n) => ({ name: n, data: files.get(n) })));
    });
  }
  // バックアップ（ZIP / JSON）から復元。今のデータはすべて置き換わる
  async function importBackup(file) {
    const backup = await readBackup(file);
    return enqueue(async () => {
      await ensureLoaded();
      const existing = new Set(await store.listFiles());
      const incoming = new Set();
      for (const f of backup.files) {
        await store.putFile(f.name, await f.entry.blob(mimeOf(f.name)));
        incoming.add(f.name);
        const u = urls.get(f.name);
        if (u) { revokeUrl(u); urls.delete(f.name); }
      }
      try {
        const res = await commit(() => importAll(backup.data, (n) => incoming.has(n) || existing.has(n)));
        return { ...res, kind: backup.kind };
      } finally {
        await collectGarbage();
      }
    });
  }

  // ---------- 変更の確定：失敗したら元に戻す ----------
  async function commit(fn) {
    const snapshot = structuredClone(D);
    try {
      const result = await fn();
      D.updated_at = new Date().toISOString();
      await store.save(D);
      onSaved();
      return result;
    } catch (e) {
      D = snapshot;
      if (e instanceof ApiError) throw e;
      if (e?.name === 'QuotaExceededError') throw new ApiError(507, '保存できませんでした。端末の空き容量が足りない可能性があります');
      throw e;
    }
  }

  // ---------- ルーティング（server/api.js と同じ） ----------
  const W = { write: true };
  const routes = [
    ['GET', /^\/api\/settings$/, () => getSettings()],
    ['PUT', /^\/api\/settings$/, (c) => putSettings(c.body), W],

    ['GET', /^\/api\/courses$/, () => listCourses()],
    ['POST', /^\/api\/courses$/, (c) => saveCourse(null, c.body), W],
    ['GET', /^\/api\/courses\/(\d+)$/, (c) => getCourse(id(c.m[1]))],
    ['PUT', /^\/api\/courses\/(\d+)$/, (c) => saveCourse(id(c.m[1]), c.body), W],
    ['DELETE', /^\/api\/courses\/(\d+)$/, (c) => deleteCourse(id(c.m[1])), W],

    ['GET', /^\/api\/rounds$/, () => roundRows()],
    ['POST', /^\/api\/rounds$/, (c) => saveRound(null, c.body), W],
    ['GET', /^\/api\/rounds\/(\d+)$/, (c) => getRound(id(c.m[1]))],
    ['PUT', /^\/api\/rounds\/(\d+)$/, (c) => saveRound(id(c.m[1]), c.body), W],
    ['DELETE', /^\/api\/rounds\/(\d+)$/, (c) => deleteRound(id(c.m[1])), W],

    ['GET', /^\/api\/clubs$/, () => listClubs()],
    ['POST', /^\/api\/clubs$/, (c) => saveClub(null, c.body), W],
    ['PUT', /^\/api\/clubs\/order$/, (c) => reorderClubs(c.body), W],
    ['PUT', /^\/api\/clubs\/(\d+)$/, (c) => saveClub(id(c.m[1]), c.body), W],
    ['DELETE', /^\/api\/clubs\/(\d+)$/, (c) => deleteClub(id(c.m[1])), W],

    ['GET', /^\/api\/distances$/, (c) => listDistances(c.q)],
    ['POST', /^\/api\/distances$/, (c) => addDistances(c.body), W],
    ['PUT', /^\/api\/distances\/(\d+)$/, (c) => updateDistance(id(c.m[1]), c.body), W],
    ['DELETE', /^\/api\/distances\/(\d+)$/, (c) => deleteDistance(id(c.m[1])), W],

    ['GET', /^\/api\/albums$/, async () => { const r = listAlbums(); await ensureUrls(r.map((a) => a.cover)); return r; }],
    ['POST', /^\/api\/albums$/, (c) => saveAlbum(null, c.body), W],
    ['GET', /^\/api\/albums\/(\d+)$/, async (c) => { const r = getAlbum(id(c.m[1])); await ensureUrls([r.cover]); return r; }],
    ['PUT', /^\/api\/albums\/(\d+)$/, (c) => saveAlbum(id(c.m[1]), c.body), W],
    ['DELETE', /^\/api\/albums\/(\d+)$/, (c) => deleteAlbum(id(c.m[1])), W],

    ['GET', /^\/api\/photos$/, async (c) => { const r = listPhotos(c.q); await ensureUrls(photoNames(r)); return r; }],
    ['POST', /^\/api\/photos$/, (c) => uploadPhoto(c.body, c.mime, c.q, c.headers)],
    ['PUT', /^\/api\/photos\/(\d+)\/thumb$/, async (c) => { const r = await uploadThumb(id(c.m[1]), c.body, c.mime); await ensureUrls(photoNames([r])); return r; }],
    ['PUT', /^\/api\/photos\/(\d+)$/, (c) => updatePhoto(id(c.m[1]), c.body), W],
    ['DELETE', /^\/api\/photos\/(\d+)$/, (c) => deletePhoto(id(c.m[1]))],

    ['GET', /^\/api\/lan$/, () => ({ available: false, enabled: false, local: true })],
    ['PUT', /^\/api\/lan$/, () => { throw new ApiError(404, 'Not Found'); }],
    ['POST', /^\/api\/lan\/reset$/, () => { throw new ApiError(404, 'Not Found'); }],

    ['GET', /^\/api\/export$/, () => exportAll()],
    ['POST', /^\/api\/import$/, async (c) => {
      const existing = new Set(await store.listFiles());
      try { return await commit(() => importAll(c.body, (n) => existing.has(n))); } finally { await collectGarbage(); }
    }],
    ['POST', /^\/api\/sample$/, () => loadSample(), W],
    ['POST', /^\/api\/delete-all$/, (c) => {
      if (!c.body || c.body.confirm !== 'DELETE') throw new ApiError(400, '確認文字列が一致しません');
      return deleteAll();
    }],
  ];

  // method, url（例: /api/rounds?x=1）, body（JSON の値 / 写真は Blob）, headers
  function handle(method, url, body, headers = {}) {
    return enqueue(async () => {
      await ensureLoaded();
      const u = new URL(url, 'http://local');
      let route = null;
      let m = null;
      let pathMatched = false;
      for (const r of routes) {
        const mm = u.pathname.match(r[1]);
        if (!mm) continue;
        pathMatched = true;
        if (r[0] === method) { route = r; m = mm; break; }
      }
      if (!route) throw new ApiError(pathMatched ? 405 : 404, pathMatched ? 'Method Not Allowed' : 'Not Found');
      const isBlob = typeof Blob !== 'undefined' && body instanceof Blob;
      const c = {
        m, q: u.searchParams, headers,
        body: isBlob ? body : body === undefined || body === null ? {} : structuredClone(body),
        mime: isBlob ? String(headers['Content-Type'] || body.type || '').split(';')[0].trim().toLowerCase() : null,
      };
      const run = () => route[2](c);
      const result = route[3]?.write ? await commit(run) : await run();
      return result === undefined ? null : structuredClone(result);
    });
  }

  return {
    handle,
    fileUrl: (name) => urls.get(name) || '',
    exportBackupParts,
    importBackup,
    // 別のタブ・ウィンドウで変更されたとき、次の要求で読み直す
    invalidate: () => enqueue(async () => { D = null; }),
    meta: () => enqueue(async () => { await ensureLoaded(); return { updated_at: D.updated_at, rounds: D.rounds.length, photos: D.photos.length }; }),
  };
}

// テスト用・保存先が使えない環境用のメモリ上の保存先
export function memoryStore() {
  let data = null;
  const files = new Map();
  return {
    async load() { return data ? structuredClone(data) : null; },
    async save(d) { data = structuredClone(d); },
    async putFile(n, b) { files.set(n, b); },
    async getFiles(names) { return new Map(names.map((n) => [n, files.get(n) || null])); },
    async deleteFiles(names) { names.forEach((n) => files.delete(n)); },
    async listFiles() { return [...files.keys()]; },
    async clearFiles() { files.clear(); },
    _files: files,
  };
}

export { isPhotoName, isThumbName };
