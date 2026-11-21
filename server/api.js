'use strict';
// REST API（JSON）。ルーティング・各リソースの CRUD。
// 入力チェックは public/js/shared/model.js をスマホ単独版（public/js/local/backend.js）と共用する
const fs = require('node:fs');
const path = require('node:path');
const { generateSample } = require('./sample');
const {
  ApiError: HttpError, TABLES, SETTING_KEYS, SETTING_DEFAULTS, uuid, num, id, text, takenAt,
  normalizeSetting, normalizeCourse, normalizeRound, normalizeClub, normalizeDistance, normalizeAlbum, normalizeCover,
  photoLinks, imageExt, thumbExt, originalName, cleanImport, parseNines, ninesLabel, parseParty,
} = require('../public/js/shared/model.js');
const { readBackup, backupParts, backupFileName } = require('../public/js/shared/backup.js');
const { pickSample } = require('../public/js/shared/sample.js');

const JSON_LIMIT = 50 * 1024 * 1024;   // インポート用に大きめ
const UPLOAD_LIMIT = 60 * 1024 * 1024; // 写真1枚あたり
const ZIP_LIMIT = 2 * 1024 * 1024 * 1024; // 写真込みバックアップ

function unlinkQuiet(file) {
  try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') console.warn(e.message); }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'データが大きすぎます'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// JSON 以外（ZIP など）を返すときの戻り値
class FileResult {
  constructor(body, type, filename) { this.body = body; this.type = type; this.filename = filename; }
}

function createApi(db, { photoDir, lan = null, onLanChange = () => {} }) {
  const thumbDir = path.join(photoDir, 'thumbs');
  fs.mkdirSync(thumbDir, { recursive: true });
  const photoPath = (name) => path.join(photoDir, name);

  // ---------- 設定 ----------
  function getSettings() {
    const out = { ...SETTING_DEFAULTS };
    for (const r of db.all('SELECT key, value FROM settings')) if (SETTING_KEYS.includes(r.key)) out[r.key] = r.value;
    return out;
  }
  function putSettings(b) {
    db.tx(() => {
      for (const k of SETTING_KEYS) {
        if (b[k] === undefined) continue;
        db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, normalizeSetting(k, b[k]));
      }
    });
    return getSettings();
  }

  // ---------- コース ----------
  function courseHoles(courseId) {
    return db.all('SELECT hole_no, par, yards, hdcp, memo FROM course_holes WHERE course_id = ? ORDER BY hole_no', courseId);
  }
  function listCourses() {
    const courses = db.all(`
      SELECT c.*, (SELECT COUNT(*) FROM rounds r WHERE r.course_id = c.id) AS round_count
      FROM courses c ORDER BY c.name COLLATE NOCASE, c.id`);
    const holes = db.all('SELECT course_id, hole_no, par, yards, hdcp, memo FROM course_holes ORDER BY course_id, hole_no');
    const byCourse = new Map();
    for (const h of holes) {
      if (!byCourse.has(h.course_id)) byCourse.set(h.course_id, []);
      byCourse.get(h.course_id).push({ hole_no: h.hole_no, par: h.par, yards: h.yards, hdcp: h.hdcp, memo: h.memo });
    }
    return courses.map((c) => ({ ...c, nines: parseNines(c.nines), holes: byCourse.get(c.id) || [] }));
  }
  function getCourse(courseId) {
    const c = db.get('SELECT * FROM courses WHERE id = ?', courseId);
    if (!c) throw new HttpError(404, 'コースが見つかりません');
    return { ...c, nines: parseNines(c.nines), holes: courseHoles(courseId) };
  }
  function saveCourse(courseId, b) {
    const { row, holes } = normalizeCourse(b);
    const fields = [row.name, row.location, row.rating, row.slope, row.memo, row.nines];
    return db.tx(() => {
      if (courseId) {
        getCourse(courseId);
        db.run('UPDATE courses SET name=?, location=?, rating=?, slope=?, memo=?, nines=? WHERE id=?', ...fields, courseId);
      } else {
        courseId = Number(db.run('INSERT INTO courses(name, location, rating, slope, memo, nines) VALUES (?,?,?,?,?,?)', ...fields).lastInsertRowid);
      }
      db.run('DELETE FROM course_holes WHERE course_id = ?', courseId);
      for (const h of holes) {
        db.run('INSERT INTO course_holes(course_id, hole_no, par, yards, hdcp, memo) VALUES (?,?,?,?,?,?)', courseId, h.hole_no, h.par, h.yards, h.hdcp, h.memo);
      }
      return getCourse(courseId);
    });
  }

  // ---------- ラウンド ----------
  function roundRows(where = '', ...params) {
    const rounds = db.all(`
      SELECT r.*, COALESCE(c.name, r.course_name) AS course_name, c.nines AS course_nines,
             (SELECT COUNT(*) FROM photos p WHERE p.round_id = r.id) AS photo_count
      FROM rounds r LEFT JOIN courses c ON c.id = r.course_id
      ${where}
      ORDER BY r.date DESC, r.id DESC`, ...params);
    if (!rounds.length) return [];
    const ids = rounds.map((r) => r.id);
    const holes = db.all(`SELECT * FROM round_holes WHERE round_id IN (${ids.map(() => '?').join(',')}) ORDER BY round_id, hole_no`, ...ids);
    const byRound = new Map();
    for (const h of holes) {
      const { round_id, ...rest } = h;
      if (!byRound.has(round_id)) byRound.set(round_id, []);
      byRound.get(round_id).push(rest);
    }
    return rounds.map(({ course_nines, ...r }) => ({
      ...r,
      party: parseParty(r.party),
      nines_label: r.course_id != null ? ninesLabel(parseNines(course_nines), r.front_nine, r.back_nine) : null,
      holes: byRound.get(r.id) || [],
    }));
  }
  function getRound(roundId) {
    const [r] = roundRows('WHERE r.id = ?', roundId);
    if (!r) throw new HttpError(404, 'ラウンドが見つかりません');
    return r;
  }
  function saveRound(roundId, b) {
    const { row, holes } = normalizeRound(b, (cid) => {
      const c = db.get('SELECT name, nines FROM courses WHERE id = ?', cid);
      return c ? { name: c.name, nineCount: parseNines(c.nines).length } : undefined;
    });
    const fields = [row.date, row.course_id, row.course_name, row.tee, row.weather, row.companions, row.memo, row.rating, row.slope, row.front_nine, row.back_nine, row.party];
    return db.tx(() => {
      if (roundId) {
        getRound(roundId);
        db.run(`UPDATE rounds SET date=?, course_id=?, course_name=?, tee=?, weather=?, companions=?, memo=?, rating=?, slope=?, front_nine=?, back_nine=?, party=?,
                updated_at=datetime('now','localtime') WHERE id=?`, ...fields, roundId);
      } else {
        roundId = Number(db.run(`INSERT INTO rounds(date, course_id, course_name, tee, weather, companions, memo, rating, slope, front_nine, back_nine, party)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, ...fields).lastInsertRowid);
      }
      db.run('DELETE FROM round_holes WHERE round_id = ?', roundId);
      for (const h of holes) {
        db.run(`INSERT INTO round_holes(round_id, hole_no, par, yards, strokes, putts, fairway, penalties, bunker)
                VALUES (?,?,?,?,?,?,?,?,?)`, roundId, h.hole_no, h.par, h.yards, h.strokes, h.putts, h.fairway, h.penalties, h.bunker);
      }
      return getRound(roundId);
    });
  }

  // ---------- クラブ ----------
  function listClubs() {
    return db.all(`
      SELECT c.*,
        COUNT(d.id)              AS shot_count,
        AVG(d.carry)             AS avg_carry,
        AVG(d.total)             AS avg_total,
        MAX(d.carry)             AS max_carry,
        MIN(d.carry)             AS min_carry
      FROM clubs c LEFT JOIN distances d ON d.club_id = c.id
      GROUP BY c.id
      ORDER BY c.in_bag DESC, c.sort_order, c.id`);
  }
  function getClub(clubId) {
    const c = db.get('SELECT * FROM clubs WHERE id = ?', clubId);
    if (!c) throw new HttpError(404, 'クラブが見つかりません');
    return c;
  }
  function saveClub(clubId, b) {
    const r = normalizeClub(b, !clubId);
    const fields = [r.category, r.name, r.brand, r.model, r.loft, r.shaft, r.flex, r.length, r.target_carry, r.in_bag, r.memo];
    if (clubId) {
      getClub(clubId);
      db.run(`UPDATE clubs SET category=?, name=?, brand=?, model=?, loft=?, shaft=?, flex=?, length=?, target_carry=?, in_bag=?, memo=? WHERE id=?`, ...fields, clubId);
    } else {
      clubId = Number(db.run(`INSERT INTO clubs(category, name, brand, model, loft, shaft, flex, length, target_carry, in_bag, memo, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, ...fields, r.sort_order).lastInsertRowid);
    }
    return getClub(clubId);
  }
  function reorderClubs(b) {
    if (!Array.isArray(b.ids)) throw new HttpError(400, 'ids が必要です');
    db.tx(() => b.ids.forEach((cid, i) => db.run('UPDATE clubs SET sort_order = ? WHERE id = ?', i, id(cid))));
    return listClubs();
  }

  // ---------- 飛距離 ----------
  function listDistances(q) {
    const where = [];
    const p = [];
    if (q.get('club_id')) { where.push('d.club_id = ?'); p.push(id(q.get('club_id'))); }
    return db.all(`
      SELECT d.*, c.name AS club_name, c.category
      FROM distances d JOIN clubs c ON c.id = d.club_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.date DESC, d.id DESC`, ...p);
  }
  function validateDistance(b) {
    const d = normalizeDistance(b, (cid) => Boolean(db.get('SELECT id FROM clubs WHERE id = ?', cid)));
    return [d.club_id, d.date, d.carry, d.total, d.place, d.memo];
  }
  function addDistances(b) {
    const records = Array.isArray(b.records) ? b.records : [b];
    if (!records.length) throw new HttpError(400, '記録がありません');
    if (records.length > 500) throw new HttpError(400, '一度に登録できるのは500件までです');
    const rows = records.map(validateDistance);
    db.tx(() => rows.forEach((r) => db.run('INSERT INTO distances(club_id, date, carry, total, place, memo) VALUES (?,?,?,?,?,?)', ...r)));
    return { inserted: rows.length };
  }
  function updateDistance(did, b) {
    if (!db.get('SELECT id FROM distances WHERE id = ?', did)) throw new HttpError(404, '記録が見つかりません');
    db.run('UPDATE distances SET club_id=?, date=?, carry=?, total=?, place=?, memo=? WHERE id=?', ...validateDistance(b), did);
    return db.get('SELECT * FROM distances WHERE id = ?', did);
  }

  // ---------- アルバム・写真 ----------
  function listAlbums() {
    return db.all(`
      SELECT a.*,
        (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) AS photo_count,
        COALESCE(
          (SELECT COALESCE(p.thumb, p.filename) FROM photos p WHERE p.id = a.cover_photo_id AND p.album_id = a.id),
          (SELECT COALESCE(p.thumb, p.filename) FROM photos p WHERE p.album_id = a.id ORDER BY p.taken_at DESC, p.id DESC LIMIT 1)
        ) AS cover
      FROM albums a ORDER BY COALESCE(a.date, a.created_at) DESC, a.id DESC`);
  }
  function getAlbum(aid) {
    const a = listAlbums().find((x) => x.id === aid);
    if (!a) throw new HttpError(404, 'アルバムが見つかりません');
    return a;
  }
  function saveAlbum(aid, b) {
    const r = normalizeAlbum(b);
    const fields = [r.title, r.description, r.date];
    if (aid) {
      getAlbum(aid);
      const cover = normalizeCover(b);
      db.run('UPDATE albums SET title=?, description=?, date=? WHERE id=?', ...fields, aid);
      if (cover !== undefined) db.run('UPDATE albums SET cover_photo_id=? WHERE id=?', cover, aid);
    } else {
      aid = Number(db.run('INSERT INTO albums(title, description, date) VALUES (?,?,?)', ...fields).lastInsertRowid);
    }
    return getAlbum(aid);
  }
  function listPhotos(q) {
    const where = [];
    const p = [];
    if (q.get('album_id')) {
      if (q.get('album_id') === 'none') where.push('ph.album_id IS NULL');
      else { where.push('ph.album_id = ?'); p.push(id(q.get('album_id'))); }
    }
    if (q.get('round_id')) { where.push('ph.round_id = ?'); p.push(id(q.get('round_id'))); }
    const limit = q.get('limit') ? num('limit', q.get('limit'), { min: 1, max: 1000, integer: true }) : null;
    return db.all(`
      SELECT ph.*, a.title AS album_title, r.date AS round_date, COALESCE(c.name, r.course_name) AS round_course
      FROM photos ph
      LEFT JOIN albums a ON a.id = ph.album_id
      LEFT JOIN rounds r ON r.id = ph.round_id
      LEFT JOIN courses c ON c.id = r.course_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(ph.taken_at, ph.created_at) DESC, ph.id DESC
      ${limit ? 'LIMIT ' + limit : ''}`, ...p);
  }
  function getPhoto(pid) {
    const ph = db.get('SELECT * FROM photos WHERE id = ?', pid);
    if (!ph) throw new HttpError(404, '写真が見つかりません');
    return ph;
  }
  const links = (q) => photoLinks(q,
    (aid) => Boolean(db.get('SELECT id FROM albums WHERE id = ?', aid)),
    (rid) => Boolean(db.get('SELECT id FROM rounds WHERE id = ?', rid)));
  const mimeOf = (req) => String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  function uploadPhoto(req, buf, q) {
    const mime = mimeOf(req);
    const ext = imageExt(mime);
    if (!buf.length) throw new HttpError(400, '画像データが空です');
    const { album_id: albumId, round_id: roundId } = links({ album_id: q.get('album_id'), round_id: q.get('round_id') });
    const original = originalName(req.headers['x-filename']);
    const caption = text(q.get('caption'), 500);
    const taken = takenAt(q.get('taken_at'));
    const filename = uuid() + ext;
    fs.writeFileSync(photoPath(filename), buf);
    try {
      const pid = Number(db.run(`INSERT INTO photos(filename, original_name, mime, size, album_id, round_id, caption, taken_at)
        VALUES (?,?,?,?,?,?,?,?)`, filename, original, mime, buf.length, albumId, roundId, caption, taken).lastInsertRowid);
      return getPhoto(pid);
    } catch (e) {
      unlinkQuiet(photoPath(filename));
      throw e;
    }
  }
  function uploadThumb(pid, req, buf) {
    const ph = getPhoto(pid);
    const name = 'thumbs/' + uuid() + thumbExt(mimeOf(req), buf.length);
    fs.writeFileSync(photoPath(name), buf);
    db.run('UPDATE photos SET thumb = ? WHERE id = ?', name, pid);
    if (ph.thumb) unlinkQuiet(photoPath(ph.thumb));
    return getPhoto(pid);
  }
  function updatePhoto(pid, b) {
    getPhoto(pid);
    const { album_id: albumId, round_id: roundId } = links(b);
    db.run('UPDATE photos SET caption=?, album_id=?, round_id=?, taken_at=? WHERE id=?',
      text(b.caption, 500), albumId, roundId, takenAt(b.taken_at), pid);
    return getPhoto(pid);
  }
  function deletePhoto(pid) {
    const ph = getPhoto(pid);
    db.run('DELETE FROM photos WHERE id = ?', pid);
    db.run('UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = ?', pid);
    unlinkQuiet(photoPath(ph.filename));
    if (ph.thumb) unlinkQuiet(photoPath(ph.thumb));
    return { ok: true };
  }

  // ---------- バックアップ ----------
  function exportAll() {
    const out = { app: 'golf-enjoy-manager', version: 1, exported_at: new Date().toISOString() };
    for (const [t, cols] of Object.entries(TABLES)) out[t] = db.all(`SELECT ${cols.join(', ')} FROM ${t}`);
    out.settings = out.settings.filter((r) => SETTING_KEYS.includes(r.key)); // スマホ接続の秘密キーなどは含めない
    return out;
  }
  // 写真込みのバックアップ（ZIP）
  async function exportZip() {
    const data = exportAll();
    const files = [];
    for (const p of data.photos) {
      for (const name of [p.filename, p.thumb]) {
        if (!name) continue;
        try { files.push({ name, data: fs.readFileSync(photoPath(name)) }); } catch { /* ファイルがなければ省略 */ }
      }
    }
    return new FileResult(Buffer.concat(await backupParts(data, files)), 'application/zip', backupFileName('zip'));
  }
  // 復元：内容を点検（壊れた行・参照切れ・不正なファイル名を除外）してから、全データを置き換える
  function importAll(data, hasFile = (name) => fs.existsSync(photoPath(name))) {
    const rows = cleanImport(data, { hasFile });
    const order = Object.keys(TABLES);
    db.tx(() => {
      for (const t of [...order].reverse()) {
        if (t === 'settings') db.run(`DELETE FROM settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(',')})`, ...SETTING_KEYS);
        else db.run(`DELETE FROM ${t}`);
      }
      for (const t of order) {
        const cols = TABLES[t];
        const sql = `INSERT INTO ${t}(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        for (const row of rows[t]) db.run(sql, ...cols.map((c) => row[c]));
      }
    });
    const counts = {};
    for (const t of order) counts[t] = t === 'settings' ? rows.settings.length : db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
    return { ok: true, counts };
  }
  async function importZip(buf) {
    const backup = await readBackup(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
    const written = new Set();
    for (const f of backup.files) {
      fs.writeFileSync(photoPath(f.name), await f.entry.bytes()); // 名前は UUID 形式のみ（readBackup で検証済み）
      written.add(f.name);
    }
    return { ...importAll(backup.data, (n) => written.has(n) || fs.existsSync(photoPath(n))), kind: backup.kind };
  }
  function loadSample() {
    const n = db.get('SELECT (SELECT COUNT(*) FROM rounds) + (SELECT COUNT(*) FROM clubs) + (SELECT COUNT(*) FROM courses) AS n').n;
    if (n > 0) throw new HttpError(409, 'データが空のときだけサンプルを読み込めます');
    db.tx(() => generateSample(db));
    return { ok: true };
  }
  // サンプルデータの有無と件数（自分で登録したデータは含まない）
  function sampleIds() {
    return pickSample({
      courses: db.all('SELECT id, name, memo FROM courses'),
      clubs: db.all('SELECT id, brand FROM clubs'),
      rounds: db.all('SELECT id, course_id, course_name FROM rounds'),
    });
  }
  const inList = (ids) => ids.map(() => '?').join(',') || 'NULL';
  function sampleInfo() {
    const s = sampleIds();
    const distances = db.get(`SELECT COUNT(*) AS n FROM distances WHERE club_id IN (${inList(s.clubIds)})`, ...s.clubIds).n;
    const counts = { courses: s.courseIds.length, rounds: s.roundIds.length, clubs: s.clubIds.length, distances };
    return { present: counts.courses + counts.rounds + counts.clubs > 0, counts };
  }
  // サンプルだけを削除（飛距離はクラブと一緒に消える）
  function deleteSample() {
    const info = sampleInfo();
    const s = sampleIds();
    db.tx(() => {
      db.run(`DELETE FROM rounds WHERE id IN (${inList(s.roundIds)})`, ...s.roundIds);
      db.run(`DELETE FROM clubs WHERE id IN (${inList(s.clubIds)})`, ...s.clubIds);
      db.run(`DELETE FROM courses WHERE id IN (${inList(s.courseIds)})`, ...s.courseIds);
    });
    return { ok: true, deleted: info.counts };
  }
  function deleteAll() {
    const photos = db.all('SELECT filename, thumb FROM photos');
    db.tx(() => {
      for (const t of Object.keys(TABLES).reverse()) if (t !== 'settings') db.run(`DELETE FROM ${t}`);
    });
    for (const p of photos) {
      unlinkQuiet(photoPath(p.filename));
      if (p.thumb) unlinkQuiet(photoPath(p.thumb));
    }
    return { ok: true };
  }

  // ---------- スマホ接続 ----------
  function lanState(local) {
    if (!lan) return { available: false, enabled: false, local };
    return { available: true, ...lan.state(local) };
  }
  function requireLocal(c) {
    if (!lan) throw new HttpError(404, 'Not Found');
    if (!c.local) throw new HttpError(403, 'この設定は PC からのみ変更できます');
  }

  function exists(table, rid, label) {
    if (!db.get(`SELECT id FROM ${table} WHERE id = ?`, rid)) throw new HttpError(404, `${label}が見つかりません`);
  }

  // ---------- ルーティング ----------
  // [method, pattern, handler, options]
  const routes = [
    ['GET', /^\/api\/settings$/, () => getSettings()],
    ['PUT', /^\/api\/settings$/, (c) => putSettings(c.body)],

    ['GET', /^\/api\/courses$/, () => listCourses()],
    ['POST', /^\/api\/courses$/, (c) => saveCourse(null, c.body)],
    ['GET', /^\/api\/courses\/(\d+)$/, (c) => getCourse(id(c.m[1]))],
    ['PUT', /^\/api\/courses\/(\d+)$/, (c) => saveCourse(id(c.m[1]), c.body)],
    ['DELETE', /^\/api\/courses\/(\d+)$/, (c) => { const cid = id(c.m[1]); exists('courses', cid, 'コース'); db.run('DELETE FROM courses WHERE id = ?', cid); return { ok: true }; }],

    ['GET', /^\/api\/rounds$/, () => roundRows()],
    ['POST', /^\/api\/rounds$/, (c) => saveRound(null, c.body)],
    ['GET', /^\/api\/rounds\/(\d+)$/, (c) => getRound(id(c.m[1]))],
    ['PUT', /^\/api\/rounds\/(\d+)$/, (c) => saveRound(id(c.m[1]), c.body)],
    ['DELETE', /^\/api\/rounds\/(\d+)$/, (c) => { const rid = id(c.m[1]); exists('rounds', rid, 'ラウンド'); db.run('DELETE FROM rounds WHERE id = ?', rid); return { ok: true }; }],

    ['GET', /^\/api\/clubs$/, () => listClubs()],
    ['POST', /^\/api\/clubs$/, (c) => saveClub(null, c.body)],
    ['PUT', /^\/api\/clubs\/order$/, (c) => reorderClubs(c.body)],
    ['PUT', /^\/api\/clubs\/(\d+)$/, (c) => saveClub(id(c.m[1]), c.body)],
    ['DELETE', /^\/api\/clubs\/(\d+)$/, (c) => { const cid = id(c.m[1]); getClub(cid); db.run('DELETE FROM clubs WHERE id = ?', cid); return { ok: true }; }],

    ['GET', /^\/api\/distances$/, (c) => listDistances(c.q)],
    ['POST', /^\/api\/distances$/, (c) => addDistances(c.body)],
    ['PUT', /^\/api\/distances\/(\d+)$/, (c) => updateDistance(id(c.m[1]), c.body)],
    ['DELETE', /^\/api\/distances\/(\d+)$/, (c) => { const did = id(c.m[1]); exists('distances', did, '記録'); db.run('DELETE FROM distances WHERE id = ?', did); return { ok: true }; }],

    ['GET', /^\/api\/albums$/, () => listAlbums()],
    ['POST', /^\/api\/albums$/, (c) => saveAlbum(null, c.body)],
    ['GET', /^\/api\/albums\/(\d+)$/, (c) => getAlbum(id(c.m[1]))],
    ['PUT', /^\/api\/albums\/(\d+)$/, (c) => saveAlbum(id(c.m[1]), c.body)],
    ['DELETE', /^\/api\/albums\/(\d+)$/, (c) => { const aid = id(c.m[1]); getAlbum(aid); db.run('DELETE FROM albums WHERE id = ?', aid); return { ok: true }; }],

    ['GET', /^\/api\/photos$/, (c) => listPhotos(c.q)],
    ['POST', /^\/api\/photos$/, (c) => uploadPhoto(c.req, c.body, c.q), { raw: true }],
    ['PUT', /^\/api\/photos\/(\d+)\/thumb$/, (c) => uploadThumb(id(c.m[1]), c.req, c.body), { raw: true }],
    ['PUT', /^\/api\/photos\/(\d+)$/, (c) => updatePhoto(id(c.m[1]), c.body)],
    ['DELETE', /^\/api\/photos\/(\d+)$/, (c) => deletePhoto(id(c.m[1]))],

    ['GET', /^\/api\/lan$/, (c) => lanState(c.local)],
    ['PUT', /^\/api\/lan$/, (c) => {
      requireLocal(c);
      lan.setEnabled(Boolean(c.body.enabled));
      onLanChange();
      return lanState(true);
    }],
    ['POST', /^\/api\/lan\/reset$/, (c) => { requireLocal(c); lan.reset(); return lanState(true); }],

    ['GET', /^\/api\/export$/, (c) => (c.q.get('format') === 'zip' ? exportZip() : exportAll()), { download: true }],
    ['POST', /^\/api\/import$/, (c) => importAll(c.body)],
    ['POST', /^\/api\/import\/zip$/, (c) => importZip(c.body), { raw: true, limit: ZIP_LIMIT }],
    ['GET', /^\/api\/sample$/, () => sampleInfo()],
    ['POST', /^\/api\/sample$/, () => loadSample()],
    ['DELETE', /^\/api\/sample$/, () => deleteSample()],
    ['POST', /^\/api\/delete-all$/, (c) => {
      if (!c.body || c.body.confirm !== 'DELETE') throw new HttpError(400, '確認文字列が一致しません');
      return deleteAll();
    }],
  ];

  async function handle(req, res, url, ctx = { local: true }) {
    const send = (status, data, headers = {}) => {
      const body = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(body);
    };
    try {
      // 別サイトからのリクエスト（CSRF）を防ぐため、変更系はカスタムヘッダー必須
      if (req.method !== 'GET' && req.headers['x-golf-app'] !== '1') throw new HttpError(403, '不正なリクエストです');

      let match = null;
      let route = null;
      let pathMatched = false;
      for (const r of routes) {
        const m = url.pathname.match(r[1]);
        if (!m) continue;
        pathMatched = true;
        if (r[0] === req.method) { match = m; route = r; break; }
      }
      if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method Not Allowed' : 'Not Found');
      const opts = route[3] || {};

      let body = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        if (opts.raw) {
          body = await readBody(req, opts.limit ?? UPLOAD_LIMIT);
        } else {
          const buf = await readBody(req, JSON_LIMIT);
          if (buf.length) {
            const ct = String(req.headers['content-type'] || '');
            if (!ct.startsWith('application/json')) throw new HttpError(415, 'Content-Type は application/json にしてください');
          }
          try { body = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw new HttpError(400, 'JSON の形式が不正です'); }
        }
      }
      const result = await route[2]({ req, m: match, q: url.searchParams, body, local: Boolean(ctx.local) });
      if (result instanceof FileResult) {
        res.writeHead(200, {
          'Content-Type': result.type,
          'Content-Length': result.body.length,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Cache-Control': 'no-store',
        });
        res.end(result.body);
        return;
      }
      const headers = {};
      if (opts.download) headers['Content-Disposition'] = `attachment; filename="${backupFileName('json')}"`;
      send(req.method === 'POST' && !opts.raw ? 201 : 200, result, headers);
    } catch (e) {
      if (e instanceof HttpError) {
        send(e.status, { error: e.message });
      } else if (/constraint/i.test(e.message)) {
        send(400, { error: '入力内容が制約に違反しています: ' + e.message });
      } else {
        console.error(e);
        send(500, { error: 'サーバー内部エラー: ' + e.message });
      }
    }
  }

  return { handle };
}

module.exports = { createApi, HttpError };
