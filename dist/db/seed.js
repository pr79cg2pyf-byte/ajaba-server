"use strict";
// Seed initial data: stores + owner user (sql.js version)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = require("./connection");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
async function seed() {
    const db = await (0, connection_1.getDb)();
    console.log('[seed] Inserting stores...');
    // Check if stores already exist
    const existing = (0, connection_1.queryAll)(db, 'SELECT COUNT(*) as count FROM stores');
    if (existing[0]?.count > 0) {
        console.log('[seed] Stores already exist, skipping.');
        (0, connection_1.closeDb)();
        return;
    }
    (0, connection_1.execute)(db, 'INSERT INTO stores (store_id, name, code, timezone) VALUES (?, ?, ?, ?)', ['store-valley-001', 'IGA Valley', 'VALLEY', 'Australia/Brisbane']);
    (0, connection_1.execute)(db, 'INSERT INTO stores (store_id, name, code, timezone) VALUES (?, ?, ?, ?)', ['store-boondall-001', 'IGA Boondall', 'BOONDALL', 'Australia/Brisbane']);
    console.log('[seed] Stores: IGA Valley (VALLEY), IGA Boondall (BOONDALL)');
    // Create owner user
    const pinHash = bcryptjs_1.default.hashSync('1234', 10);
    const ownerId = (0, uuid_1.v4)();
    (0, connection_1.execute)(db, 'INSERT INTO users (user_id, username, display_name, pin_hash, role, store_id) VALUES (?, ?, ?, ?, ?, ?)', [ownerId, 'andy', 'Andy', pinHash, 'owner', 'store-valley-001']);
    console.log('[seed] Owner user: username=andy, pin=1234, role=owner');
    console.log('[seed] ✅ Seed complete.');
    (0, connection_1.closeDb)();
}
seed().catch(err => {
    console.error('[seed] Failed:', err);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map