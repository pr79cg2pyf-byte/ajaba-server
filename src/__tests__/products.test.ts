import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
let managerToken: string;
let staffToken: string;
let ownerToken: string;
let otherToken: string;
let close: () => void;
const product = { plu: '123', name: 'Synthetic milk', department: 'Dairy', costPrice: 1.5, retailPrice: 2.5, packSize: '6' };
const products = Array.from({ length: 12_000 }, (_, index) => ({ ...product, id: `product-${index}`, plu: `${index}` }));

beforeAll(async () => {
  process.env.AJABA_DB_PATH = join(fs.mkdtempSync(join(tmpdir(), 'ajaba-products-test-')), 'test.db');
  const { migrate } = await import('../db/migrate'); await migrate();
  const { getDb, execute, closeDb } = await import('../db/connection'); close = closeDb;
  const db = await getDb();
  for (const store of ['valley', 'boondall']) {
    execute(db, 'INSERT INTO stores (store_id, name, code) VALUES (?, ?, ?)', [store, store, store]);
  }
  const { signToken } = await import('../middleware/auth');
  const tokens: Record<string, string> = {};
  for (const [userId, role, store] of [['manager', 'manager', 'valley'], ['staff', 'staff', 'valley'], ['owner', 'owner', 'valley'], ['other', 'staff', 'boondall']] as const) {
    execute(db, "INSERT INTO users (user_id, username, display_name, pin_hash, role, store_id) VALUES (?, ?, ?, 'unused', ?, ?)", [userId, userId, userId, role, store]);
    tokens[userId] = signToken({ user_id: userId, username: userId, role, store_id: store });
  }
  managerToken = tokens.manager; staffToken = tokens.staff; ownerToken = tokens.owner; otherToken = tokens.other;
  app = (await import('../app')).createApp();
});
afterAll(() => close?.());
const get = (path = '/version', auth = managerToken) => request(app).get(`/api/products${path}`).set('Authorization', `Bearer ${auth}`);
const put = (body: unknown, auth = managerToken) => request(app).put('/api/products').set('Authorization', `Bearer ${auth}`).send(body);
const snapshot = async () => {
  const { getDb, queryOne } = await import('../db/connection');
  return queryOne(await getDb(), "SELECT * FROM product_masters WHERE store_id = 'valley'");
};

describe('store product master', () => {
  it('requires authentication for all three endpoints', async () => {
    expect((await request(app).get('/api/products/version')).status).toBe(401);
    expect((await request(app).get('/api/products')).status).toBe(401);
    expect((await request(app).put('/api/products').send({ products: [product] })).status).toBe(401);
  });
  it('returns version zero before the store uploads a master', async () => {
    const version = await get(); expect(version.status).toBe(200); expect(version.body).toEqual({ version: 0, count: 0 });
    const full = await get(''); expect(full.status).toBe(200); expect(full.body).toEqual({ version: 0, count: 0, products: [] });
  });
  it('durably replaces 12,000 products and only retains known fields', async () => {
    const submitted = products.map((item, index) => index ? item : { ...item, extra: 'discard', store_id: 'boondall' });
    const upload = await put({ products: submitted });
    expect(upload.status).toBe(200);
    expect(upload.body).toEqual({ version: 1, count: 12_000, updatedAt: expect.any(String), updatedBy: 'manager' });
    expect(Number.isFinite(Date.parse(upload.body.updatedAt))).toBe(true);
    const { migrate } = await import('../db/migrate'); await migrate();
    close();
    const full = await get('', staffToken);
    expect(full.status).toBe(200);
    expect(full.body).toEqual({ version: 1, count: 12_000, updatedAt: upload.body.updatedAt, products });
    expect((await get()).body).toEqual(upload.body);
  });
  it('forbids staff uploads without changing the master', async () => {
    const before = await snapshot();
    const response = await put({ products: [product] }, staffToken);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Manager or owner authority is required.');
    expect(await snapshot()).toEqual(before);
  });
  it('reports the first invalid row and leaves the entire master unchanged', async () => {
    const before = await snapshot();
    const response = await put({ products: [product, { ...product, name: '   ' }, { ...product, department: 42 }] });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/row\s+2\b/i);
    expect(await snapshot()).toEqual(before);
  });
  it('keeps stores isolated and rejects explicit store overrides', async () => {
    expect((await get('/version', otherToken)).body).toEqual({ version: 0, count: 0 });
    expect((await get('', otherToken)).body).toEqual({ version: 0, count: 0, products: [] });
    expect((await get('/version?store_id=boondall', ownerToken)).status).toBe(403);
    const before = await snapshot();
    expect((await put({ products: [product], store_id: 'boondall' }, ownerToken)).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it('increments the version on a second replacement and accepts barcode-only products', async () => {
    const replacement = { name: 'Synthetic bread', barcode: '987', department: 'Bakery' };
    const upload = await put({ products: [replacement] });
    expect(upload.status).toBe(200);
    expect(upload.body).toEqual({ version: 2, count: 1, updatedAt: expect.any(String), updatedBy: 'manager' });
    expect((await get('')).body.products).toEqual([replacement]);
  });
  it.each([
    ['not an object', null],
    ['array row', []],
    ['empty name', { ...product, name: '' }],
    ['long name', { ...product, name: 'x'.repeat(501) }],
    ['missing identifiers', { ...product, plu: ' ' }],
    ['numeric identifier', { ...product, plu: 123 }],
    ['long identifier', { ...product, barcode: '1'.repeat(65) }],
    ['missing department', { ...product, department: undefined }],
    ['invalid department', { ...product, department: 42 }],
    ['string cost', { ...product, costPrice: '1.5' }],
    ['null retail price', { ...product, retailPrice: null }],
    ['numeric pack size', { ...product, packSize: 6 }],
  ])('rejects %s without writing', async (_label, invalid) => {
    const before = await snapshot();
    const response = await put({ products: [invalid] });
    expect(response.status).toBe(400); expect(response.body.error).toMatch(/row\s+1\b/i);
    expect(await snapshot()).toEqual(before);
  });
  it('rejects JSON numbers that overflow to infinity', async () => {
    const before = await snapshot();
    for (const field of ['costPrice', 'retailPrice']) {
      const body = `{"products":[{"plu":"123","name":"Synthetic milk","department":"Dairy","${field}":1e999}]}`;
      const response = await request(app).put('/api/products').set('Authorization', `Bearer ${managerToken}`).set('Content-Type', 'application/json').send(body);
      expect(response.status).toBe(400); expect(response.body.error).toMatch(/row\s+1\b/i);
    }
    expect(await snapshot()).toEqual(before);
  });
  it.each([
    ['missing', undefined], ['non-array', {}], ['empty', []], ['over 50,000', Array(50_001).fill(product)],
  ])('rejects %s product lists', async (_label, invalid) => {
    const before = await snapshot();
    expect((await put({ products: invalid })).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });
  it('rechecks the database role and active membership', async () => {
    const { execute, getDb } = await import('../db/connection');
    const before = await snapshot();
    try {
      execute(await getDb(), "UPDATE users SET role = 'staff' WHERE user_id = 'manager'");
      expect((await put({ products: [product] })).status).toBe(401);
      execute(await getDb(), "UPDATE users SET role = 'manager', is_active = 0 WHERE user_id = 'manager'");
      expect((await get()).status).toBe(401);
      expect((await put({ products: [product] })).status).toBe(401);
    } finally {
      execute(await getDb(), "UPDATE users SET role = 'manager', is_active = 1 WHERE user_id = 'manager'");
    }
    expect(await snapshot()).toEqual(before);
  });
  it('rolls back a failed disk write and lets the owner retry', async () => {
    const { DB_PATH } = await import('../db/connection');
    const before = await snapshot();
    fs.mkdirSync(`${DB_PATH}.tmp`);
    try { expect((await put({ products: [product] }, ownerToken)).status).toBe(500); }
    finally { fs.rmdirSync(`${DB_PATH}.tmp`); }
    expect(await snapshot()).toEqual(before);
    const retry = await put({ products: [product] }, ownerToken);
    expect(retry.status).toBe(200); expect(retry.body).toMatchObject({ version: 3, count: 1, updatedBy: 'owner' });
  });
  it('accepts product bodies above 10 MB while other routes retain their limit', async () => {
    const largeProducts = Array.from({ length: 12_000 }, (_, index) => ({ ...product, plu: `${index}`, supplier: 's'.repeat(900) }));
    const body = { products: largeProducts };
    const bytes = Buffer.byteLength(JSON.stringify(body));
    expect(bytes).toBeGreaterThan(10 * 1024 * 1024); expect(bytes).toBeLessThan(25 * 1024 * 1024);
    const upload = await put(body);
    expect(upload.status).toBe(200); expect(upload.body).toMatchObject({ version: 4, count: 12_000 });
    expect((await get('')).body.products).toEqual(largeProducts);
    const other = await request(app).post('/api/login').send(body);
    expect([413, 500]).toContain(other.status);
  });
});
