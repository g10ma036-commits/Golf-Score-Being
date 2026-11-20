// サーバー（PC版）とスマホ単独版（ブラウザ内で動く版）で共通の、入力チェックとデータの定義。
// どちらも同じ規則で保存されるよう、検証ロジックはここにだけ書く。

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const CLUB_CATEGORIES = ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'];
export const FAIRWAY = ['hit', 'left', 'right'];
export const PLACES = ['range', 'course', 'simulator'];
export const IMAGE_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/avif': '.avif', 'image/heic': '.heic', 'image/heif': '.heif',
};
export const THUMB_MIME = ['image/jpeg', 'image/webp', 'image/png'];
export const SETTING_KEYS = ['player_name', 'unit', 'theme'];
export const SETTING_DEFAULTS = { player_name: '', unit: 'yd', theme: 'auto' };

// 写真ファイル名はアプリが付けた UUID のみ（バックアップ復元時のパストラバーサル対策も兼ねる）
export const PHOTO_NAME_RE = /^[0-9a-f-]{36}\.(jpg|png|gif|webp|avif|heic|heif)$/;
export const THUMB_NAME_RE = /^thumbs\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
export const isPhotoName = (s) => typeof s === 'string' && PHOTO_NAME_RE.test(s);
export const isThumbName = (s) => typeof s === 'string' && THUMB_NAME_RE.test(s);

// テーブルの列定義。型: id=自動採番の主キー, int, real, text, ts=作成日時。
// 「!」は必須、「=値」は既定値
export const SCHEMA = {
  settings: { key: 'text!', value: 'text' },
  courses: { id: 'id', name: 'text!', location: 'text', rating: 'real', slope: 'int', memo: 'text', created_at: 'ts' },
  course_holes: { course_id: 'int!', hole_no: 'int!', par: 'int=4', yards: 'int', hdcp: 'int' },
  rounds: {
    id: 'id', date: 'text!', course_id: 'int', course_name: 'text', tee: 'text', weather: 'text', companions: 'text',
    memo: 'text', rating: 'real', slope: 'int', created_at: 'ts', updated_at: 'ts',
  },
  round_holes: {
    round_id: 'int!', hole_no: 'int!', par: 'int=4', yards: 'int', strokes: 'int', putts: 'int',
    fairway: 'text', penalties: 'int', bunker: 'int',
  },
  clubs: {
    id: 'id', category: 'text!', name: 'text!', brand: 'text', model: 'text', loft: 'real', shaft: 'text', flex: 'text',
    length: 'real', target_carry: 'int', in_bag: 'int=1', sort_order: 'int=0', memo: 'text', created_at: 'ts',
  },
  distances: { id: 'id', club_id: 'int!', date: 'text!', carry: 'real', total: 'real', place: 'text', memo: 'text', created_at: 'ts' },
  albums: { id: 'id', title: 'text!', description: 'text', date: 'text', cover_photo_id: 'int', created_at: 'ts' },
  photos: {
    id: 'id', filename: 'text!', thumb: 'text', original_name: 'text', mime: 'text', size: 'int', album_id: 'int',
    round_id: 'int', caption: 'text', taken_at: 'text', created_at: 'ts',
  },
};
export const TABLES = Object.fromEntries(Object.entries(SCHEMA).map(([t, cols]) => [t, Object.keys(cols)]));
export const ID_TABLES = Object.keys(SCHEMA).filter((t) => SCHEMA[t].id);

// SQLite の datetime('now','localtime') と同じ形式
export function localNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- 入力検証ヘルパー ----------
export function text(v, max = 500) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
export function num(name, v, { min = -Infinity, max = Infinity, integer = false, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ApiError(400, `${name} は必須です`);
    return null;
  }
  let n = Number(v);
  if (!Number.isFinite(n)) throw new ApiError(400, `${name} の値が不正です`);
  if (integer) n = Math.round(n);
  if (n < min || n > max) throw new ApiError(400, `${name} は ${min}〜${max} の範囲で入力してください`);
  return n;
}
export function date(name, v, { required = true } = {}) {
  if (!v) {
    if (required) throw new ApiError(400, `${name} は必須です`);
    return null;
  }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ApiError(400, `${name} の日付形式が不正です（YYYY-MM-DD）`);
  }
  return s;
}
export function oneOf(name, v, list) {
  if (v === undefined || v === null || v === '') return null;
  if (!list.includes(v)) throw new ApiError(400, `${name} の値が不正です`);
  return v;
}
export function id(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'ID が不正です');
  return n;
}
export function takenAt(v) {
  const s = text(v, 30);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) throw new ApiError(400, '撮影日時の形式が不正です');
  return s.replace('T', ' ');
}

// ---------- 各リソースの正規化（検証済みの値を返す。不正なら ApiError） ----------
export function normalizeSetting(k, value) {
  let v = text(value, 100) ?? '';
  if (k === 'unit') v = oneOf('unit', v, ['yd', 'm']) ?? 'yd';
  if (k === 'theme') v = oneOf('theme', v, ['auto', 'light', 'dark']) ?? 'auto';
  return v;
}

export function normalizeCourse(b) {
  const name = text(b.name, 200);
  if (!name) throw new ApiError(400, 'コース名は必須です');
  const row = {
    name,
    location: text(b.location, 200),
    rating: num('コースレート', b.rating, { min: 50, max: 90 }),
    slope: num('スロープ', b.slope, { min: 55, max: 155, integer: true }),
    memo: text(b.memo, 2000),
  };
  return { row, holes: normalizeCourseHoles(b.holes) };
}
function normalizeCourseHoles(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map((h) => {
    const no = num('ホール番号', h.hole_no, { min: 1, max: 18, integer: true, required: true });
    if (seen.has(no)) throw new ApiError(400, `ホール ${no} が重複しています`);
    seen.add(no);
    return {
      hole_no: no,
      par: num(`${no}番のパー`, h.par, { min: 3, max: 6, integer: true }) ?? 4,
      yards: num(`${no}番のヤード`, h.yards, { min: 0, max: 900, integer: true }),
      hdcp: num(`${no}番のHDCP`, h.hdcp, { min: 1, max: 18, integer: true }),
    };
  });
}

// courseName(id) は登録済みコースの名前（なければ undefined）を返す関数
export function normalizeRound(b, courseName) {
  const d = date('日付', b.date);
  const courseId = num('コース', b.course_id, { min: 1, integer: true });
  let name = text(b.course_name, 200);
  if (courseId) {
    const n = courseName(courseId);
    if (n === undefined) throw new ApiError(400, '選択したコースが存在しません');
    name = n;
  }
  if (!courseId && !name) throw new ApiError(400, 'コースを選択してください');
  const row = {
    date: d, course_id: courseId, course_name: name,
    tee: text(b.tee, 50), weather: text(b.weather, 50), companions: text(b.companions, 300), memo: text(b.memo, 4000),
    rating: num('コースレート', b.rating, { min: 50, max: 90 }),
    slope: num('スロープ', b.slope, { min: 55, max: 155, integer: true }),
  };
  return { row, holes: normalizeRoundHoles(b.holes) };
}
function normalizeRoundHoles(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map((h) => {
    const no = num('ホール番号', h.hole_no, { min: 1, max: 18, integer: true, required: true });
    if (seen.has(no)) throw new ApiError(400, `ホール ${no} が重複しています`);
    seen.add(no);
    const par = num(`${no}番のパー`, h.par, { min: 3, max: 6, integer: true }) ?? 4;
    const strokes = num(`${no}番のスコア`, h.strokes, { min: 1, max: 20, integer: true });
    const putts = num(`${no}番のパット`, h.putts, { min: 0, max: 10, integer: true });
    if (strokes != null && putts != null && putts >= strokes) {
      throw new ApiError(400, `${no}番: パット数がスコア以上になっています`);
    }
    return {
      hole_no: no,
      par,
      yards: num(`${no}番のヤード`, h.yards, { min: 0, max: 900, integer: true }),
      strokes,
      putts,
      fairway: par === 3 ? null : oneOf(`${no}番のフェアウェイ`, h.fairway, FAIRWAY),
      penalties: num(`${no}番のペナルティ`, h.penalties, { min: 0, max: 10, integer: true }),
      bunker: num(`${no}番のバンカー`, h.bunker, { min: 0, max: 10, integer: true }),
    };
  });
}

// 新規クラブは「種類→ロフト」順の位置に入れる
export function defaultClubOrder(category, loft) {
  const base = CLUB_CATEGORIES.indexOf(category) * 1000;
  return base + Math.round((loft ?? 50) * 10);
}
export function normalizeClub(b, isNew) {
  const name = text(b.name, 50);
  if (!name) throw new ApiError(400, 'クラブ名（番手）は必須です');
  const category = oneOf('種類', b.category, CLUB_CATEGORIES);
  if (!category) throw new ApiError(400, '種類を選択してください');
  const row = {
    category, name, brand: text(b.brand, 100), model: text(b.model, 100),
    loft: num('ロフト', b.loft, { min: 0, max: 80 }),
    shaft: text(b.shaft, 100), flex: text(b.flex, 20),
    length: num('長さ', b.length, { min: 20, max: 52 }),
    target_carry: num('想定飛距離', b.target_carry, { min: 0, max: 450, integer: true }),
    in_bag: b.in_bag === undefined ? 1 : (b.in_bag ? 1 : 0),
    memo: text(b.memo, 1000),
  };
  if (isNew) row.sort_order = num('並び順', b.sort_order, { integer: true }) ?? defaultClubOrder(category, row.loft);
  return row;
}

// clubExists(id) が false なら 404
export function normalizeDistance(b, clubExists) {
  const clubId = num('クラブ', b.club_id, { min: 1, integer: true, required: true });
  if (!clubExists(clubId)) throw new ApiError(404, 'クラブが見つかりません');
  const carry = num('キャリー', b.carry, { min: 0, max: 450 });
  const total = num('トータル', b.total, { min: 0, max: 500 });
  if (carry == null && total == null) throw new ApiError(400, 'キャリーかトータルのどちらかを入力してください');
  return { club_id: clubId, date: date('日付', b.date), carry, total, place: oneOf('場所', b.place, PLACES), memo: text(b.memo, 500) };
}

export function normalizeAlbum(b) {
  const title = text(b.title, 100);
  if (!title) throw new ApiError(400, 'タイトルは必須です');
  return { title, description: text(b.description, 2000), date: date('日付', b.date, { required: false }) };
}
export function normalizeCover(b) {
  return b.cover_photo_id === undefined ? undefined : num('カバー写真', b.cover_photo_id, { min: 1, integer: true });
}

// albumExists / roundExists は id → boolean
export function photoLinks(q, albumExists, roundExists) {
  const albumId = q.album_id ? num('アルバム', q.album_id, { min: 1, integer: true }) : null;
  const roundId = q.round_id ? num('ラウンド', q.round_id, { min: 1, integer: true }) : null;
  if (albumId && !albumExists(albumId)) throw new ApiError(400, 'アルバムが存在しません');
  if (roundId && !roundExists(roundId)) throw new ApiError(400, 'ラウンドが存在しません');
  return { album_id: albumId, round_id: roundId };
}
export function imageExt(mime) {
  const ext = IMAGE_EXT[mime];
  if (!ext) throw new ApiError(415, '対応していない画像形式です（JPEG / PNG / WebP / GIF / HEIC）');
  return ext;
}
export function thumbExt(mime, size) {
  if (!THUMB_MIME.includes(mime)) throw new ApiError(415, 'サムネイル形式が不正です');
  if (!size || size > 5 * 1024 * 1024) throw new ApiError(400, 'サムネイルサイズが不正です');
  return IMAGE_EXT[mime];
}
export function originalName(header) {
  try { return text(decodeURIComponent(String(header || '')), 255); } catch { return null; }
}

// ---------- バックアップの復元：内容を点検して、壊れた行や参照切れを直した行の一覧を返す ----------
// hasFile(name) は写真ファイルがこの環境（またはバックアップ ZIP）にあるか
export function cleanImport(data, { hasFile = () => true, now = localNow() } = {}) {
  if (!data || data.app !== 'golf-enjoy-manager') throw new ApiError(400, 'このアプリのバックアップファイルではありません');
  const out = {};
  for (const [t, cols] of Object.entries(SCHEMA)) {
    const list = Array.isArray(data[t]) ? data[t] : [];
    const rows = [];
    const ids = new Set();
    for (const src of list) {
      if (!src || typeof src !== 'object') continue;
      const row = {};
      let ok = true;
      for (const [c, spec] of Object.entries(cols)) {
        const [type, def] = spec.split('=');
        const required = type.endsWith('!');
        let v = coerce(type.replace('!', ''), src[c]);
        if (v == null && def !== undefined) v = Number(def);
        if (v == null && type === 'ts') v = now;
        if (v == null && (required || type === 'id')) ok = false;
        row[c] = v;
      }
      if (!ok) continue;
      if (cols.id) {
        if (ids.has(row.id)) continue;
        ids.add(row.id);
      }
      rows.push(row);
    }
    out[t] = rows;
  }
  // 参照切れの修正（SQLite の外部キーと同じ考え方：子は削除、任意の参照は NULL）
  const has = (t) => new Set(out[t].map((r) => r.id));
  const uniq = (rows, key) => { const s = new Set(); return rows.filter((r) => { const k = key(r); if (s.has(k)) return false; s.add(k); return true; }); };
  const seenKey = new Set();
  out.settings = out.settings.filter((r) => SETTING_KEYS.includes(r.key) && !seenKey.has(r.key) && seenKey.add(r.key));
  const courses = has('courses');
  out.course_holes = uniq(out.course_holes.filter((h) => courses.has(h.course_id) && h.hole_no >= 1 && h.hole_no <= 18), (h) => `${h.course_id}:${h.hole_no}`);
  for (const r of out.rounds) if (r.course_id != null && !courses.has(r.course_id)) r.course_id = null;
  const rounds = has('rounds');
  out.round_holes = uniq(out.round_holes.filter((h) => rounds.has(h.round_id) && h.hole_no >= 1 && h.hole_no <= 18), (h) => `${h.round_id}:${h.hole_no}`);
  const clubs = has('clubs');
  out.distances = out.distances.filter((d) => clubs.has(d.club_id));
  const albums = has('albums');
  out.photos = uniq(out.photos.filter((p) => isPhotoName(p.filename) && hasFile(p.filename)), (p) => p.filename);
  for (const p of out.photos) {
    if (p.thumb != null && !(isThumbName(p.thumb) && hasFile(p.thumb))) p.thumb = null;
    if (p.album_id != null && !albums.has(p.album_id)) p.album_id = null;
    if (p.round_id != null && !rounds.has(p.round_id)) p.round_id = null;
  }
  const photos = has('photos');
  for (const a of out.albums) if (a.cover_photo_id != null && !photos.has(a.cover_photo_id)) a.cover_photo_id = null;
  return out;
}
function coerce(type, v) {
  if (v === undefined || v === null || v === '') return null;
  if (type === 'text' || type === 'ts') return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'boolean' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  if (type === 'id') return Number.isInteger(n) && n > 0 ? n : null;
  return type === 'int' ? Math.round(n) : n;
}
