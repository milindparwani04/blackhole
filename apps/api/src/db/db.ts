import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations.js';

export type DB = DatabaseSync;
type Params = Record<string, unknown>;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(all<{ version: number }>(db, 'SELECT version FROM schema_migrations').map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    tx(db, () => {
      db.exec(m.sql);
      run(db, 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (:v, :n, :t)', {
        v: m.version,
        n: m.name,
        t: nowIso(),
      });
    });
  }
}

// node:sqlite rejects unknown named parameters, undefined and booleans, so params are
// filtered to the names the statement actually uses and normalised here.
const paramCache = new Map<string, string[]>();
function bind(sql: string, p: Params): Record<string, SQLInputValue> {
  let names = paramCache.get(sql);
  if (!names) {
    names = [...new Set([...sql.matchAll(/[:$@]([A-Za-z_]\w*)/g)].map((m) => m[1]))];
    paramCache.set(sql, names);
  }
  const out: Record<string, SQLInputValue> = {};
  for (const n of names) {
    const v = p[n];
    out[n] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as SQLInputValue);
  }
  return out;
}

export const run = (db: DB, sql: string, p: Params = {}) => db.prepare(sql).run(bind(sql, p));
export const get = <T>(db: DB, sql: string, p: Params = {}) => db.prepare(sql).get(bind(sql, p)) as T | undefined;
export const all = <T>(db: DB, sql: string, p: Params = {}) => db.prepare(sql).all(bind(sql, p)) as T[];

let spCounter = 0;
/** Savepoint-based transaction; safe to nest. */
export function tx<T>(db: DB, fn: () => T): T {
  const sp = `sp_${++spCounter}`;
  db.exec(`SAVEPOINT ${sp}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${sp}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  }
}

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
