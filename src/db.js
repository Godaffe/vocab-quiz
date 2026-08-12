import initSqlJs from 'sql.js';
import { getBlob, putBlob } from './idb.js';

const MAIN_KEY = 'main-db';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vocabulaire (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  fr TEXT NOT NULL,
  en TEXT NOT NULL,
  en_base TEXT NOT NULL,
  en_past_simple TEXT,
  en_past_participle TEXT,
  example TEXT,
  type TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grammaire (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  fr TEXT NOT NULL,
  en TEXT NOT NULL,
  explication TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  en TEXT NOT NULL,
  meaning TEXT NOT NULL,
  example TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  item_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  box_level INTEGER NOT NULL DEFAULT 0,
  is_learned INTEGER NOT NULL DEFAULT 0,
  next_review_date TEXT,
  introduced_at TEXT,
  last_result TEXT,
  last_reviewed_at TEXT,
  correct_streak INTEGER NOT NULL DEFAULT 0,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_type, item_key)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const DEFAULT_SETTINGS = {
  new_items_per_day: '10',
  schema_version: '1',
};

let SQL = null;
let db = null;

export async function initDb() {
  if (db) return db;

  SQL = await initSqlJs({
    locateFile: (file) => `${import.meta.env.BASE_URL}${file}`,
  });

  const existing = await getBlob(MAIN_KEY);
  db = existing ? new SQL.Database(new Uint8Array(existing)) : new SQL.Database();

  db.exec(SCHEMA);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }

  await save();
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}

export async function save() {
  const bytes = db.export();
  await putBlob(MAIN_KEY, bytes.buffer);
}

export function run(sql, params = []) {
  db.run(sql, params);
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

export function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setSetting(key, value) {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  await save();
}
