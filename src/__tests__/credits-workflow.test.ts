import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
const request = require('supertest');
let app: express.Express;
let owner: string, staff: string;
let closeDb: () => void;

beforeAll(async () => {
  process.env.AJABA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ajaba-credits-test-')), 'test.db');
  const connection = await import('../db/connection');
  closeDb = connection.closeDb;
  await (await import('../db/migrate')).migrate();
  const db = await connection.getDb();
  for (const id of ['store-a', 'store-b']) connection.execute(db, 'INSERT INTO stores (store_id,name,code) VALUES (?,?,?)', [id, id, id]);
  connection.execute(db, 'INSERT INTO users (user_id,username,display_name,pin_hash,role,store_id) VALUES (?,?,?,?,?,?)', ['owner-a', 'owner-a', 'Test owner', 'unused', 'owner', 'store-a']);
  connection.execute(db, 'INSERT INTO users (user_id,username,display_name,pin_hash,role,store_id) VALUES (?,?,?,?,?,?)', ['staff-a', 'staff-a', 'Test staff', 'unused', 'staff', 'store-a']);
  connection.execute(db, 'INSERT INTO suppliers (supplier_id,name) VALUES (?,?)', ['supplier-a', 'Test supplier']);
  connection.execute(db, 'INSERT INTO suppliers (supplier_id,name,is_active) VALUES (?,?,?)', ['supplier-inactive', 'Inactive supplier', 0]);
  connection.execute(db, 'INSERT INTO supplier_agreements (agreement_id,supplier_id,store_id,credit_type,credit_rate) VALUES (?,?,?,?,?)', ['agreement-b', 'supplier-a', 'store-b', 'expired_stock', 0.5]);
  connection.execute(db, 'INSERT INTO expiry_records (store_id,record_id,record_json,version,updated_by,updated_at) VALUES (?,?,?,?,?,?)', ['store-a', 'expiry-a', JSON.stringify({ id: 'expiry-a', productName: 'Test milk', quantity: 3 }), 1, 'owner-a', new Date().toISOString()]);
  const { signToken } = await import('../middleware/auth');
  owner = signToken({ user_id: 'owner-a', username: 'owner-a', role: 'owner', store_id: 'store-a' });
  staff = signToken({ user_id: 'staff-a', username: 'staff-a', role: 'staff', store_id: 'store-a' });
  app = express(); app.use(express.json()); app.use('/api/credits', (await import('../routes/credits')).default);
});
afterAll(() => closeDb?.());
const payload = { store_id: 'store-a', supplier_id: 'supplier-a', product_name: 'Test milk', unit_cost: 2.4, quantity: 3, claim_type: 'expired' };

describe('Persisted supplier claim workflow', () => {
  it('creates one draft for a stable expiry identity even if the request is retried', async () => {
    const first = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, source_expiry_id: 'expiry-a', source_expiry_version: 1 });
    expect(first.status).toBe(201);
    const retry = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, source_expiry_id: 'expiry-a', source_expiry_version: 1 });
    expect([200, 201]).toContain(retry.status);
    expect(retry.body.claim.claim_id).toBe(first.body.claim.claim_id);
    const changed = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, source_expiry_id: 'expiry-a', source_expiry_version: 1, unit_cost: 99 });
    expect(changed.status).toBe(409);
  });
  it('reports filtered total with stable offset pagination', async () => {
    await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, product_name: 'Second item' });
    const first = await request(app).get('/api/credits?status=draft&limit=1&offset=0').set('Authorization', `Bearer ${owner}`);
    const second = await request(app).get('/api/credits?status=draft&limit=1&offset=1').set('Authorization', `Bearer ${owner}`);
    expect(first.body.total).toBe(2);
    expect(second.body.claims).toHaveLength(1);
    expect(first.body.claims[0].claim_id).not.toBe(second.body.claims[0].claim_id);
  });
  it('blocks a staff member from reading or creating another store’s claims', async () => {
    expect((await request(app).get('/api/credits?store_id=store-b').set('Authorization', `Bearer ${staff}`)).status).toBe(403);
    expect((await request(app).post('/api/credits').set('Authorization', `Bearer ${staff}`).send({ ...payload, store_id: 'store-b' })).status).toBe(403);
  });
  it('requires manager authority and a receipt reference for credit confirmation', async () => {
    const created = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, product_name: 'Approval item' });
    const id = created.body.claim.claim_id;
    await request(app).post(`/api/credits/${id}/submit`).set('Authorization', `Bearer ${owner}`);
    expect((await request(app).post(`/api/credits/${id}/approve`).set('Authorization', `Bearer ${staff}`)).status).toBe(403);
    expect((await request(app).post(`/api/credits/${id}/approve`).set('Authorization', `Bearer ${owner}`)).status).toBe(200);
    expect((await request(app).post(`/api/credits/${id}/credit`).set('Authorization', `Bearer ${owner}`).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/credits/${id}`).set('Authorization', `Bearer ${staff}`).send({ status: 'credited' })).status).toBe(400);
  });

  it('defaults list and summary to the session store and protects every record route', async () => {
    const created = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, store_id: 'store-b', product_name: 'Other store item' });
    expect(created.status).toBe(201);
    const id = created.body.claim.claim_id;
    const list = await request(app).get('/api/credits').set('Authorization', `Bearer ${owner}`);
    expect(list.body.claims.every((claim: { store_id: string }) => claim.store_id === 'store-a')).toBe(true);
    expect((await request(app).get('/api/credits/summary?store_id=store-b').set('Authorization', `Bearer ${staff}`)).status).toBe(403);
    for (const path of ['', '/submit', '/approve', '/reject', '/credit']) {
      const attempt = path ? request(app).post(`/api/credits/${id}${path}`).send({ reason: 'Test', credit_ref: 'TEST-1' }) : request(app).get(`/api/credits/${id}`);
      expect((await attempt.set('Authorization', `Bearer ${staff}`)).status).toBe(403);
    }
    expect((await request(app).patch(`/api/credits/${id}`).set('Authorization', `Bearer ${staff}`).send({ product_name: 'Forbidden' })).status).toBe(403);
    expect((await request(app).get(`/api/credits/${id}?store_id=store-b`).set('Authorization', `Bearer ${owner}`)).status).toBe(200);
  });

  it('rejects invalid money, quantities, supplier agreements and unsynced sources without writing', async () => {
    for (const invalid of [{ unit_cost: -1 }, { unit_cost: '2' }, { quantity: 0 }, { quantity: -3 }, { quantity: 1.5 }, { supplier_id: 'missing' }, { supplier_id: 'supplier-inactive' }, { agreement_id: 'agreement-b' }, { claim_type: 'invalid' }]) {
      expect((await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, ...invalid })).status).toBe(400);
    }
    expect((await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, source_expiry_id: 'missing-expiry', source_expiry_version: 1 })).status).toBe(409);
  });

  it('calculates draft totals and prevents status/amount overrides through PATCH', async () => {
    const created = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send(payload);
    const id = created.body.claim.claim_id;
    for (const invalid of [{ total_claim: 1 }, { status: 'credited' }, { credit_ref: 'BYPASS' }, { quantity: -1 }]) {
      expect((await request(app).patch(`/api/credits/${id}`).set('Authorization', `Bearer ${staff}`).send(invalid)).status).toBe(400);
    }
    const updated = await request(app).patch(`/api/credits/${id}`).set('Authorization', `Bearer ${staff}`).send({ unit_cost: 3, quantity: 4 });
    expect(updated.status).toBe(200);
    expect(updated.body.claim.total_claim).toBe(12);
  });

  it('records one transition per retry and rejects reversing a credited claim', async () => {
    const created = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send(payload);
    const id = created.body.claim.claim_id;
    for (const stage of ['submit', 'approve', 'credit']) {
      const body = stage === 'credit' ? { credit_ref: 'RECEIPT-42' } : {};
      expect((await request(app).post(`/api/credits/${id}/${stage}`).set('Authorization', `Bearer ${owner}`).send(body)).status).toBe(200);
      expect((await request(app).post(`/api/credits/${id}/${stage}`).set('Authorization', `Bearer ${owner}`).send(body)).status).toBe(200);
    }
    const detail = await request(app).get(`/api/credits/${id}`).set('Authorization', `Bearer ${owner}`);
    expect(detail.body.history.filter((item: { new_status: string }) => item.new_status === 'credited')).toHaveLength(1);
    expect((await request(app).post(`/api/credits/${id}/reject`).set('Authorization', `Bearer ${owner}`).send({ reason: 'Too late' })).status).toBe(409);
    expect((await request(app).post(`/api/credits/${id}/credit`).set('Authorization', `Bearer ${owner}`).send({ credit_ref: 'DIFFERENT' })).status).toBe(409);
  });

  it('requires a nonblank rejection reason and rejects deactivated accounts', async () => {
    const created = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send(payload);
    const id = created.body.claim.claim_id;
    await request(app).post(`/api/credits/${id}/submit`).set('Authorization', `Bearer ${owner}`).send({});
    expect((await request(app).post(`/api/credits/${id}/reject`).set('Authorization', `Bearer ${owner}`).send({ reason: '  ' })).status).toBe(400);
    const connection = await import('../db/connection');
    connection.execute(await connection.getDb(), 'UPDATE users SET is_active = 0 WHERE user_id = ?', ['staff-a']);
    expect((await request(app).get('/api/credits').set('Authorization', `Bearer ${staff}`)).status).toBe(401);
    connection.execute(await connection.getDb(), 'UPDATE users SET is_active = 1 WHERE user_id = ?', ['staff-a']);
  });

  it('rolls back a failed claim/link/history write and accepts a safe retry after restart', async () => {
    const connection = await import('../db/connection');
    connection.execute(await connection.getDb(), 'INSERT INTO expiry_records (store_id,record_id,record_json,version,updated_by,updated_at) VALUES (?,?,?,?,?,?)', ['store-a', 'expiry-failure', JSON.stringify({ id: 'expiry-failure', productName: 'Test milk', quantity: 3 }), 1, 'owner-a', new Date().toISOString()]);
    connection.execute(await connection.getDb(), "CREATE TRIGGER fail_credit_history BEFORE INSERT ON claim_history WHEN NEW.new_status='draft' BEGIN SELECT RAISE(FAIL, 'injected history failure'); END");
    const body = { ...payload, source_expiry_id: 'expiry-failure', source_expiry_version: 1, product_name: 'Atomic creation' };
    expect((await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send(body)).status).toBe(500);
    expect(connection.queryOne(await connection.getDb(), "SELECT COUNT(*) as count FROM credit_claims WHERE product_name='Atomic creation'").count).toBe(0);
    expect(connection.queryOne(await connection.getDb(), "SELECT COUNT(*) as count FROM expiry_claim_links WHERE expiry_record_id='expiry-failure'").count).toBe(0);
    connection.execute(await connection.getDb(), 'DROP TRIGGER fail_credit_history');
    const saved = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send(body);
    expect(saved.status).toBe(201);
    connection.closeDb();
    const retry = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.claim.claim_id).toBe(saved.body.claim.claim_id);
  });

  it('rolls back a status transition if the associated history cannot be persisted', async () => {
    const connection = await import('../db/connection');
    const created = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send(payload);
    const id = created.body.claim.claim_id;
    await request(app).post(`/api/credits/${id}/submit`).set('Authorization', `Bearer ${owner}`).send({});
    connection.execute(await connection.getDb(), "CREATE TRIGGER fail_approval_history BEFORE INSERT ON claim_history WHEN NEW.new_status='approved' BEGIN SELECT RAISE(FAIL, 'injected approval history failure'); END");
    expect((await request(app).post(`/api/credits/${id}/approve`).set('Authorization', `Bearer ${owner}`).send({})).status).toBe(500);
    const detail = await request(app).get(`/api/credits/${id}`).set('Authorization', `Bearer ${owner}`);
    expect(detail.body.claim.status).toBe('submitted');
    expect(detail.body.history.filter((item: { new_status: string }) => item.new_status === 'approved')).toHaveLength(0);
    connection.execute(await connection.getDb(), 'DROP TRIGGER fail_approval_history');
    expect((await request(app).post(`/api/credits/${id}/approve`).set('Authorization', `Bearer ${owner}`).send({})).status).toBe(200);
  });

  it('requires the current acknowledged source version before creating a new claim', async () => {
    const connection = await import('../db/connection');
    connection.execute(await connection.getDb(), 'INSERT INTO expiry_records (store_id,record_id,record_json,version,updated_by,updated_at) VALUES (?,?,?,?,?,?)', ['store-a', 'expiry-versioned', JSON.stringify({ id: 'expiry-versioned', productName: 'Updated milk', quantity: 4, serverVersion: 2 }), 2, 'owner-a', new Date().toISOString()]);
    for (const version of [undefined, 0, -1, 1.5, '2']) {
      const invalid = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, source_expiry_id: 'expiry-versioned', source_expiry_version: version });
      expect(invalid.status).toBe(400);
    }
    const stale = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, source_expiry_id: 'expiry-versioned', source_expiry_version: 1 });
    expect(stale.status).toBe(409);
    expect(connection.queryOne(await connection.getDb(), "SELECT COUNT(*) as count FROM expiry_claim_links WHERE expiry_record_id='expiry-versioned'").count).toBe(0);
    const fresh = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, source_expiry_id: 'expiry-versioned', source_expiry_version: 2 });
    expect(fresh.status).toBe(201);
    connection.execute(await connection.getDb(), 'UPDATE expiry_records SET version=3 WHERE store_id=? AND record_id=?', ['store-a', 'expiry-versioned']);
    const retry = await request(app).post('/api/credits').set('Authorization', `Bearer ${owner}`).send({ ...payload, source_expiry_id: 'expiry-versioned', source_expiry_version: 2 });
    expect(retry.status).toBe(200);
    expect(retry.body.claim.claim_id).toBe(fresh.body.claim.claim_id);
  });
});
