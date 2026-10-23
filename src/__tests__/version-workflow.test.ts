import { afterAll, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const directory = mkdtempSync(join(tmpdir(), 'ajaba-version-test-'));
process.env.AJABA_DB_PATH = join(directory, 'unused.db');
afterAll(() => rmdirSync(directory));
const { version } = require('../../package.json') as { version: string };
it('reports the server package version without sign-in or configuration disclosure', async () => {
  const { createApp } = await import('../app');
  const res = await request(createApp()).get('/api/version');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    service: 'ajaba-server', version,
    build: { commit: expect.stringMatching(/^[0-9a-f]{40}$/), dirty: expect.any(Boolean) },
  });
});
