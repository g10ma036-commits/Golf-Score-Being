'use strict';
// SQLite データベース（Node.js 標準の node:sqlite を使用。外部パッケージ不要）
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  location   TEXT,
  rating     REAL,
  slope      INTEGER,
  memo       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  nines      TEXT    -- 9 ホールのまとまりの名前（JSON 配列。例: ["東","西","南"]）。NULL は OUT・IN
);

CREATE TABLE IF NOT EXISTS course_holes (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  hole_no   INTEGER NOT NULL CHECK (hole_no BETWEEN 1 AND 54),  -- まとまりをまたいだ通し番号
  par       INTEGER NOT NULL DEFAULT 4,
  yards     INTEGER,
  hdcp      INTEGER,
  memo      TEXT,     -- ホールの攻略メモ
  PRIMARY KEY (course_id, hole_no)
);

CREATE TABLE IF NOT EXISTS rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  course_name TEXT,
  tee         TEXT,
  weather     TEXT,
  companions  TEXT,
  memo        TEXT,
  rating      REAL,
  slope       INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  front_nine  INTEGER,  -- 前半・後半に回ったまとまり（1 から。NULL は 1・2）
  back_nine   INTEGER,
  party       TEXT      -- 同伴者のスコア（JSON 配列）
);
CREATE INDEX IF NOT EXISTS idx_rounds_date ON rounds(date);

CREATE TABLE IF NOT EXISTS round_holes (
  round_id  INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  hole_no   INTEGER NOT NULL CHECK (hole_no BETWEEN 1 AND 18),
  par       INTEGER NOT NULL DEFAULT 4,
  yards     INTEGER,
  strokes   INTEGER,
  putts     INTEGER,
  fairway   TEXT,      -- hit | left | right | NULL（未記録・パー3）
  penalties INTEGER,
  bunker    INTEGER,
  note      TEXT,     -- このラウンドでのホールのメモ
  tee_club  TEXT,     -- ティーショットで使ったクラブ
  PRIMARY KEY (round_id, hole_no)
);

CREATE TABLE IF NOT EXISTS clubs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category     TEXT NOT NULL,  -- driver | wood | hybrid | iron | wedge | putter
  name         TEXT NOT NULL,
  brand        TEXT,
  model        TEXT,
  loft         REAL,
  shaft        TEXT,
  flex         TEXT,
  length       REAL,
  target_carry INTEGER,
  in_bag       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  memo         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS distances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id    INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  carry      REAL,
  total      REAL,
  place      TEXT,   -- range | course | simulator
  memo       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_distances_club ON distances(club_id);

CREATE TABLE IF NOT EXISTS albums (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  description    TEXT,
  date           TEXT,
  cover_photo_id INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL UNIQUE,
  thumb         TEXT,
  original_name TEXT,
  mime          TEXT,
  size          INTEGER,
  album_id      INTEGER REFERENCES albums(id) ON DELETE SET NULL,
  round_id      INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
  caption       TEXT,
  taken_at      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id);
CREATE INDEX IF NOT EXISTS idx_photos_round ON photos(round_id);
`;

// node:sqlite は undefined / boolean をバインドできないので変換する
function bindable(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

// 古い版で作ったデータベースを今の形にそろえる
function migrate(raw) {
  const cols = (t) => raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('courses').includes('nines')) raw.exec('ALTER TABLE courses ADD COLUMN nines TEXT');
  const rc = cols('rounds');
  if (!rc.includes('front_nine')) raw.exec('ALTER TABLE rounds ADD COLUMN front_nine INTEGER');
  if (!rc.includes('back_nine')) raw.exec('ALTER TABLE rounds ADD COLUMN back_nine INTEGER');
  if (!rc.includes('party')) raw.exec('ALTER TABLE rounds ADD COLUMN party TEXT');
  // ホール番号の上限（18 → 54）を広げる。SQLite は CHECK を変更できないので表を作り直す
  const sql = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'course_holes'").get()?.sql || '';
  if (sql.includes('BETWEEN 1 AND 18')) {
    raw.exec(`BEGIN;
      CREATE TABLE course_holes_new (
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        hole_no   INTEGER NOT NULL CHECK (hole_no BETWEEN 1 AND 54),
        par       INTEGER NOT NULL DEFAULT 4,
        yards     INTEGER,
        hdcp      INTEGER,
        PRIMARY KEY (course_id, hole_no)
      );
      INSERT INTO course_holes_new(course_id, hole_no, par, yards, hdcp) SELECT course_id, hole_no, par, yards, hdcp FROM course_holes;
      DROP TABLE course_holes;
      ALTER TABLE course_holes_new RENAME TO course_holes;
      COMMIT;`);
  }
  // ホールの攻略メモ（後から追加した列）
  if (!cols('course_holes').includes('memo')) raw.exec('ALTER TABLE course_holes ADD COLUMN memo TEXT');
  if (!cols('round_holes').includes('note')) raw.exec('ALTER TABLE round_holes ADD COLUMN note TEXT'); // ラウンドのホールのメモ（後から追加した列）
  if (!cols('round_holes').includes('tee_club')) raw.exec('ALTER TABLE round_holes ADD COLUMN tee_club TEXT'); // ティーショットのクラブ（後から追加した列）
}

function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);
  migrate(raw);

  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };

  let depth = 0;
  return {
    all: (sql, ...p) => prep(sql).all(...p.map(bindable)),
    get: (sql, ...p) => prep(sql).get(...p.map(bindable)),
    run: (sql, ...p) => prep(sql).run(...p.map(bindable)),
    exec: (sql) => raw.exec(sql),
    // ネスト可能なトランザクション（外側だけが BEGIN/COMMIT する）
    tx(fn) {
      if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
      raw.exec('BEGIN');
      depth = 1;
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth = 0;
      }
    },
    close: () => raw.close(),
  };
}

module.exports = { openDb };
