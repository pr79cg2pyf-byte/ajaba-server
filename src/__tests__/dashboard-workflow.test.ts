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
  process.env.AJABA_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ajaba-dashboard-test-')), 'test.db');
  const connection = await import('../db/connection');
  closeDb = connection.closeDb;
  await (await import('../db/migrate')).migrate();
  const db = await connection.getDb();
  for (const id of ['store-a', 'store-b']) connection.execute(db, 'INSERT INTO stores (store_id,name,code) VALUES (?,?,?)', [id, id, id]);
  connection.execute(db, 'INSERT INTO users (user_id,username,display_name,pin_hash,role,store_id) VALUES (?,?,?,?,?,?)', ['owner-a', 'owner-a', 'Test owner', 'unused', 'owner', 'store-a']);
  connection.execute(db, 'INSERT INTO users (user_id,username,display_name,pin_hash,role,store_id) VALUES (?,?,?,?,?,?)', ['staff-a', 'staff-a', 'Test staff', 'unused', 'staff', 'store-a']);
  connection.execute(db, 'INSERT INTO users (user_id,username,display_name,pin_hash,role,store_id) VALUES (?,?,?,?,?,?)', ['staff-b', 'staff-b', 'Other store staff', 'unused', 'staff', 'store-b']);
  connection.execute(db, 'INSERT INTO suppliers (supplier_id,name) VALUES (?,?)', ['supplier-a', 'Test supplier']);
  connection.execute(db, 'INSERT INTO tasks (task_id,store_id,title,category,status) VALUES (?,?,?,?,?)', ['task-a', 'store-a', 'Store A task', 'other', 'pending']);
  connection.execute(db, 'INSERT INTO tasks (task_id,store_id,title,category,status) VALUES (?,?,?,?,?)', ['task-b', 'store-b', 'Store B task', 'other', 'pending']);
  const { signToken } = await import('../middleware/auth');
  owner = signToken({ user_id: 'owner-a', username: 'owner-a', role: 'owner', store_id: 'store-a' });
  staff = signToken({ user_id: 'staff-a', username: 'staff-a', role: 'staff', store_id: 'store-a' });
  app = express(); app.use(express.json()); app.use('/api/dashboard', (await import('../routes/dashboard')).default);
});
afterAll(() => closeDb?.());

describe('Dashboard store scoping', () => {
  it('returns 403 when a staff member requests another store_id', async () => {
    const res = await request(app).get('/api/dashboard/summary?store_id=store-b').set('Authorization', `Bearer ${staff}`);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('defaults to the session store and only counts its own data', async () => {
    const res = await request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${staff}`);
    expect(res.status).toBe(200);
    expect(res.body.store_id).toBe('store-a');
    expect(res.body.total_tasks).toBe(1);
  });

  it('allows a staff member to read their own store explicitly', async () => {
    const res = await request(app).get('/api/dashboard/summary?store_id=store-a').set('Authorization', `Bearer ${staff}`);
    expect(res.status).toBe(200);
    expect(res.body.store_id).toBe('store-a');
  });

  it('allows an owner to read another store', async () => {
    const res = await request(app).get('/api/dashboard/summary?store_id=store-b').set('Authorization', `Bearer ${owner}`);
    expect(res.status).toBe(200);
    expect(res.body.store_id).toBe('store-b');
    expect(res.body.total_tasks).toBe(1);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/dashboard/summary');
    expect(res.status).toBe(401);
  });
});
