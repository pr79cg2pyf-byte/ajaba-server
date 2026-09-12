import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.AJABA_TEST_URL!;
if (!BASE_URL) throw new Error('Integration tests require the isolated test server.');
const VALID_USER = { username: 'andy', pin: '1234' };
const STORE_ID = 'store-valley-001';

let authToken = '';
let createdTaskId = '';

describe('Auth — POST /api/auth/login', () => {
  it('returns 200 + JWT token with valid credentials', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .send(VALID_USER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(20);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.username).toBe('andy');
    expect(res.body.user).not.toHaveProperty('pin_hash');

    authToken = res.body.token;
  });

  it('returns 401 with wrong PIN', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: 'andy', pin: '0000' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 for non-existent user', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: 'ghost', pin: '1234' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when PIN is missing', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: 'andy' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when PIN is not 4 digits', async () => {
    const res = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: 'andy', pin: '12' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Auth — GET /api/auth/me', () => {
  beforeAll(async () => {
    if (!authToken) {
      const res = await request(BASE_URL).post('/api/auth/login').send(VALID_USER);
      authToken = res.body.token;
    }
  });

  it('returns 200 with current user info when token is valid', async () => {
    const res = await request(BASE_URL)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('user_id');
    expect(res.body.user.username).toBe('andy');
    expect(res.body.user).not.toHaveProperty('pin_hash');
  });

  it('returns 401 when no token provided', async () => {
    const res = await request(BASE_URL).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 with an invalid/tampered token', async () => {
    const res = await request(BASE_URL)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Tasks — GET /api/tasks', () => {
  it('returns 200 with task list when authenticated', async () => {
    const res = await request(BASE_URL)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body).toHaveProperty('count');
  });

  it('returns 401 when no token provided', async () => {
    const res = await request(BASE_URL).get('/api/tasks');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('filters tasks by store_id query param', async () => {
    const res = await request(BASE_URL)
      .get(`/api/tasks?store_id=${STORE_ID}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
    for (const task of res.body.tasks) {
      expect(task.store_id).toBe(STORE_ID);
    }
  });
});

describe('Tasks — POST /api/tasks', () => {
  it('creates a new task and returns 201 with task object', async () => {
    const res = await request(BASE_URL)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        store_id: STORE_ID,
        title: 'Vitest integration test task',
        category: 'other',
        priority: 'medium',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task).toHaveProperty('task_id');
    expect(res.body.task.title).toBe('Vitest integration test task');
    expect(res.body.task.status).toBe('pending');

    createdTaskId = res.body.task.task_id;
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(BASE_URL)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Missing store_id and category' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 when creating task without token', async () => {
    const res = await request(BASE_URL)
      .post('/api/tasks')
      .send({ store_id: STORE_ID, title: 'Unauth task', category: 'other' });

    expect(res.status).toBe(401);
  });
});

describe('Tasks — GET /api/tasks/:id', () => {
  it('returns the task with history when it exists', async () => {
    if (!createdTaskId) return;

    const res = await request(BASE_URL)
      .get(`/api/tasks/${createdTaskId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task).toHaveProperty('task_id', createdTaskId);
    expect(res.body).toHaveProperty('history');
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('returns 404 for a non-existent task ID', async () => {
    const res = await request(BASE_URL)
      .get('/api/tasks/non-existent-task-id-xyz')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Tasks — accept / complete workflow', () => {
  it('accepts a pending task (POST /api/tasks/:id/accept)', async () => {
    if (!createdTaskId) return;

    const res = await request(BASE_URL)
      .post(`/api/tasks/${createdTaskId}/accept`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task.status).toBe('accepted');
  });

  it('completes an accepted task (POST /api/tasks/:id/complete)', async () => {
    if (!createdTaskId) return;

    const res = await request(BASE_URL)
      .post(`/api/tasks/${createdTaskId}/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ notes: 'Done by vitest integration test' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task.status).toBe('completed');
    expect(res.body.task).toHaveProperty('completed_at');
  });
});

describe('Credits — GET /api/credits/summary', () => {
  it('returns 200 with summary stats when authenticated', async () => {
    const res = await request(BASE_URL)
      .get('/api/credits/summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_claimed');
    expect(res.body).toHaveProperty('total_approved');
    expect(res.body).toHaveProperty('total_credited');
    expect(res.body).toHaveProperty('by_supplier');
    expect(res.body).toHaveProperty('by_status');
    expect(Array.isArray(res.body.by_supplier)).toBe(true);
    expect(Array.isArray(res.body.by_status)).toBe(true);
  });

  it('returns 401 when no token provided', async () => {
    const res = await request(BASE_URL).get('/api/credits/summary');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('filters summary by store_id query param', async () => {
    const res = await request(BASE_URL)
      .get(`/api/credits/summary?store_id=${STORE_ID}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_claimed');
    expect(res.body).toHaveProperty('by_supplier');
  });
});

describe('Credits — GET /api/credits', () => {
  it('returns 200 with credit claims list when authenticated', async () => {
    const res = await request(BASE_URL)
      .get('/api/credits')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('claims');
    expect(Array.isArray(res.body.claims)).toBe(true);
    expect(res.body).toHaveProperty('count');
  });

  it('returns 401 when no token provided', async () => {
    const res = await request(BASE_URL).get('/api/credits');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Health check', () => {
  it('GET /api/health returns ok without authentication', async () => {
    const res = await request(BASE_URL).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('timestamp');
  });
});
