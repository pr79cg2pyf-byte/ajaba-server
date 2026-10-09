"use strict";
// SQLite database connection using sql.js (pure JS, no native build needed)
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DB_PATH = void 0;
exports.getDb = getDb;
exports.saveToDisk = saveToDisk;
exports.durableWrite = durableWrite;
exports.closeDb = closeDb;
exports.queryAll = queryAll;
exports.queryOne = queryOne;
exports.execute = execute;
const sql_js_1 = __importDefault(require("sql.js"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.DB_PATH = path.resolve(process.env.AJABA_DB_PATH || path.join(__dirname, '..', '..', 'data', 'ajaba.db'));
if (process.env.NODE_ENV === 'test' && !process.env.AJABA_DB_PATH)
    throw new Error('Tests require an explicit AJABA_DB_PATH; refusing to open the application database.');
let db = null;
let dbBuffer;
let databaseFactory = null;
// Load or create the database file
function loadDbFile() {
    if (fs.existsSync(exports.DB_PATH))
        return fs.readFileSync(exports.DB_PATH);
    return Buffer.alloc(0);
}
// Save database to disk
function saveDb() {
    if (!db)
        return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.mkdirSync(path.dirname(exports.DB_PATH), { recursive: true });
    const temporary = `${exports.DB_PATH}.tmp`;
    const fd = fs.openSync(temporary, 'w');
    try {
        fs.writeFileSync(fd, buffer);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temporary, exports.DB_PATH);
}
// Initialize and get database instance
async function getDb() {
    if (!db) {
        const SQL = await (0, sql_js_1.default)();
        databaseFactory = SQL;
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
function saveToDisk() {
    saveDb();
    console.log('[db] Saved to disk');
}
/** Roll back in-memory changes too if the durable snapshot cannot be written. */
function durableWrite(database, write) {
    const before = database.export();
    try {
        database.run('BEGIN TRANSACTION');
        const result = write();
        database.run('COMMIT');
        saveDb();
        return result;
    }
    catch (error) {
        database.close();
        db = new databaseFactory.Database(before);
        db.run('PRAGMA foreign_keys = ON');
        throw error;
    }
}
function closeDb() {
    if (db) {
        saveDb();
        db.close();
        db = null;
        console.log('[db] Connection closed');
    }
}
// Helper: run a query and return all rows
function queryAll(db, sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length > 0)
        stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}
// Helper: run a query and return first row
function queryOne(db, sql, params = []) {
    const rows = queryAll(db, sql, params);
    return rows.length > 0 ? rows[0] : null;
}
// Helper: execute a statement (INSERT/UPDATE/DELETE)
function execute(db, sql, params = []) {
    db.run(sql, params);
    saveDb(); // Auto-save after writes
}
//# sourceMappingURL=connection.js.map