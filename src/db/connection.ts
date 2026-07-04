// SQLite database connection using sql.js (pure JS, no native build needed)

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'ajaba.db');

let db: SqlJsDatabase | null = null;
let dbBuffer: Buffer;

// Load or create the database file
function loadDbFile(): Buffer {
  try {
    if (fs.existsSync(DB_PATH)) {
      return fs.readFileSync(DB_PATH);
    }
  } catch (err) {
    console.warn(`[db] Could not read existing DB, creating new one: ${err}`);
  }
  return Buffer.alloc(0);
}

// Save database to disk
function saveDb(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

// Initialize and get database instance
export async function getDb(): Promise<SqlJsDatabase> {
  if (!db) {
    const SQL = await initSqlJs();
    dbBuffer = loadDbFile();
    db = new SQL.Database(dbBuffer);

    // Enable WAL-like pragmas (sql.js runs in memory, but we simulate pragmas)
    db.run('PRAGMA foreign_keys = ON');

    console.log(`[db] Connected (sql.js, FK enforced, ${dbBuffer.length} bytes loaded)`);

    // Auto-save on process exit
    process.on('exit', () => saveDb());
    process.on('SIGINT', () => { saveDb(); process.exit(); });
    process.on('SIGTERM', () => { saveDb(); process.exit(); });
  }
  return db;
}

// Explicit save (call after writes)
export function saveToDisk(): void {
  saveDb();
  console.log('[db] Saved to disk');
}

export function closeDb(): void {
  if (db) {
    saveDb();
    db.close();
    db = null;
    console.log('[db] Connection closed');
  }
}

// Helper: run a query and return all rows
export function queryAll(db: SqlJsDatabase, sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run a query and return first row
export function queryOne(db: SqlJsDatabase, sql: string, params: any[] = []): any | null {
  const rows = queryAll(db, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: execute a statement (INSERT/UPDATE/DELETE)
export function execute(db: SqlJsDatabase, sql: string, params: any[] = []): void {
  db.run(sql, params);
  saveDb(); // Auto-save after writes
}
