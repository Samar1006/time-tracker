import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { request, startTestServer, stopTestServer } from './helpers/http.js';
import { resetAuthStore, DEMO_USER } from '../src/services/authService.js';

describe('auth routes', () => {
  before(async () => {
    await startTestServer();
  });

  after(async () => {
    await stopTestServer();
  });

  beforeEach(async () => {
    await resetAuthStore();
  });

  it('GET /api/auth/demo-account returns seeded credentials', async () => {
    const res = await request('/api/auth/demo-account');
    assert.equal(res.status, 200);
    assert.equal(res.body.email, DEMO_USER.email);
    assert.equal(res.body.password, DEMO_USER.password);
    assert.equal(res.body.userId, DEMO_USER.id);
  });

  it('POST /api/auth/login succeeds for demo user', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: { email: DEMO_USER.email, password: DEMO_USER.password },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.id, DEMO_USER.id);
    assert.equal(res.body.user.email, DEMO_USER.email);
  });

  it('POST /api/auth/login rejects wrong password', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: { email: DEMO_USER.email, password: 'wrong-password' },
    });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /invalid email or password/i);
  });

  it('POST /api/auth/signup then GET /api/auth/me', async () => {
    const signup = await request('/api/auth/signup', {
      method: 'POST',
      body: {
        fullName: 'Test Hacker',
        email: 'test@example.com',
        password: 'password123',
      },
    });
    assert.equal(signup.status, 201);
    assert.ok(signup.body.token);

    const me = await request('/api/auth/me', {
      headers: { Authorization: `Bearer ${signup.body.token}` },
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'test@example.com');
    assert.equal(me.body.user.fullName, 'Test Hacker');
  });

  it('GET /api/auth/me rejects missing token', async () => {
    const res = await request('/api/auth/me');
    assert.equal(res.status, 401);
  });
});
