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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS course_holes (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  hole_no   INTEGER NOT NULL CHECK (hole_no BETWEEN 1 AND 18),
  par       INTEGER NOT NULL DEFAULT 4,
  yards     INTEGER,
  hdcp      INTEGER,
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
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);

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
