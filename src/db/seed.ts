// Seed initial data: stores + owner user (sql.js version)

import { getDb, closeDb, execute, queryAll } from './connection';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function seed(): Promise<void> {
  const db = await getDb();

  console.log('[seed] Inserting stores...');

  // Check if stores already exist
  const existing = queryAll(db, 'SELECT COUNT(*) as count FROM stores');
  if (existing[0]?.count > 0) {
    console.log('[seed] Stores already exist, skipping.');
    closeDb();
    return;
  }

  execute(db,
    'INSERT INTO stores (store_id, name, code, timezone) VALUES (?, ?, ?, ?)',
    ['store-valley-001', 'IGA Valley', 'VALLEY', 'Australia/Brisbane']
  );
  execute(db,
    'INSERT INTO stores (store_id, name, code, timezone) VALUES (?, ?, ?, ?)',
    ['store-boondall-001', 'IGA Boondall', 'BOONDALL', 'Australia/Brisbane']
  );

  console.log('[seed] Stores: IGA Valley (VALLEY), IGA Boondall (BOONDALL)');

  // Create owner user
  const pinHash = bcrypt.hashSync('1234', 10);
  const ownerId = uuidv4();

  execute(db,
    'INSERT INTO users (user_id, username, display_name, pin_hash, role, store_id) VALUES (?, ?, ?, ?, ?, ?)',
    [ownerId, 'andy', 'Andy', pinHash, 'owner', 'store-valley-001']
  );

  console.log('[seed] Owner user: username=andy, pin=1234, role=owner');
  console.log('[seed] ✅ Seed complete.');
  closeDb();
}

seed().catch(err => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
