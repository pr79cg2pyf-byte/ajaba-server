import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
let token: string;
let otherToken: string;
let close: () => void;
const record = { id: 'expiry-one', barcode: '123', productName: 'Synthetic milk', department: 'Dairy', expiryDate: '2026-09-14', quantity: 2, status: 'Open', source: 'manual', createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z' };
beforeAll(async () => {
  process.env.AJABA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ajaba-expiry-test-')), 'test.db');
  const { migrate } = await import('../db/migrate'); await migrate();
  const { getDb, execute, closeDb } = await import('../db/connection'); close = closeDb;
  const db = await getDb();
  for (const store of ['valley', 'boondall']) {
    execute(db, 'INSERT INTO stores (store_id, name, code) VALUES (?, ?, ?)', [store, store, store]);
    execute(db, "INSERT INTO users (user_id, username, display_name, pin_hash, role, store_id) VALUES (?, ?, ?, 'unused', 'staff', ?)", [store, store, store, store]);
  }
  const { signToken } = await import('../middleware/auth');
  token = signToken({ user_id: 'valley', username: 'valley', role: 'staff', store_id: 'valley' });
  otherToken = signToken({ user_id: 'boondall', username: 'boondall', role: 'staff', store_id: 'boondall' });
  app = (await import('../app')).createApp();
});
afterAll(() => close?.());
const put = (body: unknown, auth = token) => request(app).put('/api/expiry-records/expiry-one').set('Authorization', `Bearer ${auth}`).send(body);
describe('durable expiry store', () => {
  it('requires authentication', async () => { expect((await request(app).get('/api/expiry-records')).status).toBe(401); });
  it('persists a store-bound record and repeats a mutation idempotently', async () => {
    const first = await put({ record, expectedVersion: 0, mutationId: 'first-write' });
    expect(first.status).toBe(200); expect(first.body.record).toMatchObject({ storeId: 'valley', serverVersion: 1, quantity: 2 });
    const retry = await put({ record, expectedVersion: 0, mutationId: 'first-write' });
    expect(retry.body.record.serverVersion).toBe(1);
    close();
    const read = await request(app).get('/api/expiry-records').set('Authorization', `Bearer ${token}`);
    expect(read.body.records).toHaveLength(1); expect(read.body.records[0].quantity).toBe(2);
  });
  it('blocks other-store requests and lists only the current store', async () => {
    expect((await put({ record: { ...record, storeId: 'valley' }, expectedVersion: 0, mutationId: 'attack' }, otherToken)).status).toBe(403);
    const other = await request(app).get('/api/expiry-records').set('Authorization', `Bearer ${otherToken}`);
    expect(other.body.records).toEqual([]);
    expect((await request(app).get('/api/expiry-records?store_id=boondall').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });
  it('returns the server record on stale version and rejects mutation reuse with different data', async () => {
    const changed = await put({ record: { ...record, quantity: 4 }, expectedVersion: 1, mutationId: 'second-write' });
    expect(changed.body.record.serverVersion).toBe(2);
    const conflict = await put({ record: { ...record, quantity: 3 }, expectedVersion: 1, mutationId: 'stale-write' });
    expect(conflict.status).toBe(409); expect(conflict.body.record.quantity).toBe(4);
    expect((await put({ record: { ...record, quantity: 9 }, expectedVersion: 0, mutationId: 'first-write' })).status).toBe(409);
  });
  it('validates dates, quantities and active store membership', async () => {
    expect((await put({ record: { ...record, expiryDate: '2026-02-31' }, expectedVersion: 2, mutationId: 'invalid-date' })).status).toBe(400);
    expect((await put({ record: { ...record, quantity: 0 }, expectedVersion: 2, mutationId: 'invalid-quantity' })).status).toBe(400);
    const { execute, getDb } = await import('../db/connection');
    execute(await getDb(), "UPDATE users SET is_active = 0 WHERE user_id = 'valley'");
    expect((await request(app).get('/api/expiry-records').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
  it('rolls back memory and mutation history when a durable disk write fails', async () => {
    const { execute, getDb, DB_PATH } = await import('../db/connection');
    execute(await getDb(), "UPDATE users SET is_active = 1 WHERE user_id = 'valley'");
    // Make the temporary snapshot path unwritable as a file; no live path is involved.
    fs.mkdirSync(`${DB_PATH}.tmp`);
    const write = { record: { ...record, quantity: 9 }, expectedVersion: 2, mutationId: 'disk-retry' };
    const failed = await put(write);
    fs.rmdirSync(`${DB_PATH}.tmp`);
    expect(failed.status).toBe(500);
    const read = await request(app).get('/api/expiry-records').set('Authorization', `Bearer ${token}`);
    expect(read.body.records[0]).toMatchObject({ quantity: 4, serverVersion: 2 });
    const retry = await put(write);
    expect(retry.status).toBe(200); expect(retry.body.record).toMatchObject({ quantity: 9, serverVersion: 3 });
  });
  it('recovers the real claim link on another device without a client update', async () => {
    const { execute, getDb } = await import('../db/connection'); const db = await getDb();
    execute(db, "INSERT INTO suppliers(supplier_id,name) VALUES ('test-supplier','Test supplier')");
    execute(db, "INSERT INTO credit_claims(claim_id,store_id,supplier_id,product_name,unit_cost,quantity,total_claim,claim_type,discovery_date) VALUES ('test-claim','valley','test-supplier','Synthetic milk',1,2,2,'expired','2026-09-13')");
    execute(db, "INSERT INTO expiry_claim_links(store_id,expiry_record_id,claim_id) VALUES ('valley','expiry-one','test-claim')");
    const read = await request(app).get('/api/expiry-records').set('Authorization', `Bearer ${token}`);
    expect(read.body.records[0]).toMatchObject({ claimId: 'test-claim', status: 'Supplier Credit Case' });
  });
  it('preserves completed stock work while still hydrating its claim link', async () => {
    const writtenOff = await put({ record: { ...record, status: 'Written Off' }, expectedVersion: 3, mutationId: 'written-off' });
    expect(writtenOff.status).toBe(200);
    expect(writtenOff.body.record).toMatchObject({ status: 'Written Off', claimId: 'test-claim' });
    const read = await request(app).get('/api/expiry-records').set('Authorization', `Bearer ${token}`);
    expect(read.body.records[0]).toMatchObject({ status: 'Written Off', claimId: 'test-claim' });
  });
});
