const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, connect, disconnect, createUser, login } = require('./helpers');
const mailer = require('../services/mailer');

before(() => connect('spp_lab3_test_auth'));
after(() => disconnect());

describe('auth', () => {
  test('register returns 201, access token and refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@test.dev', name: 'Newbie', password: 'password1' });

    assert.equal(res.status, 201);
    assert.ok(res.body.accessToken);
    assert.equal(res.body.user.role, 'user');
    assert.match(res.headers['set-cookie'].join(';'), /refreshToken=.*HttpOnly/);
  });

  test('duplicate email gives 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@test.dev', name: 'Again', password: 'password1' });
    assert.equal(res.status, 409);
  });

  test('invalid body gives 422 with details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad', name: 'x', password: '123' });
    assert.equal(res.status, 422);
    assert.ok(Array.isArray(res.body.details));
  });

  test('malformed json gives 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    assert.equal(res.status, 400);
  });

  test('protected route without token gives 401 with WWW-Authenticate', async () => {
    const res = await request(app).get('/api/tasks');
    assert.equal(res.status, 401);
    assert.match(res.headers['www-authenticate'], /Bearer/);
  });

  test('wrong method gives 405 with Allow header', async () => {
    const res = await request(app).get('/api/auth/login');
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'POST');
  });

  test('unknown route gives 404', async () => {
    const res = await request(app).get('/api/nothing');
    assert.equal(res.status, 404);
  });

  test('account is locked after several failed logins', async () => {
    await createUser({ email: 'victim@test.dev' });

    for (let i = 0; i < 2; i += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'victim@test.dev', password: 'wrong-pass1' });
      assert.equal(res.status, 401);
    }

    const locked = await request(app)
      .post('/api/auth/login')
      .send({ email: 'victim@test.dev', password: 'wrong-pass1' });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers['retry-after']) > 0);

    const correct = await request(app)
      .post('/api/auth/login')
      .send({ email: 'victim@test.dev', password: 'secret123' });
    assert.equal(correct.status, 429);
  });

  test('refresh rotates token, logout revokes session', async () => {
    await createUser({ email: 'refresh@test.dev' });
    const { agent, token } = await login('refresh@test.dev');

    const refreshed = await agent.post('/api/auth/refresh');
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.accessToken);

    const logout = await agent.post('/api/auth/logout');
    assert.equal(logout.status, 204);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(me.status, 401);
  });

  test('sessions over the limit are closed', async () => {
    await createUser({ email: 'multi@test.dev' });
    const first = await login('multi@test.dev');
    await login('multi@test.dev');
    const third = await login('multi@test.dev');

    const old = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${first.token}`);
    assert.equal(old.status, 401);

    const list = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${third.token}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);
    assert.equal(list.body.filter((s) => s.current).length, 1);
  });

  test('password can be restored by email', async () => {
    await createUser({ email: 'forgot@test.dev' });
    const { token: oldToken } = await login('forgot@test.dev');

    let sentToken = null;
    const original = mailer.sendPasswordReset;
    mailer.sendPasswordReset = async (_user, token) => {
      sentToken = token;
    };

    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.dev' });
    assert.equal(unknown.status, 202);
    assert.equal(sentToken, null);

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'forgot@test.dev' });
    mailer.sendPasswordReset = original;

    assert.equal(res.status, 202);
    assert.ok(sentToken);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: sentToken, password: 'brandnew1' });
    assert.equal(reset.status, 200);

    const reused = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: sentToken, password: 'brandnew2' });
    assert.equal(reused.status, 400);

    const old = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
    assert.equal(old.status, 401);

    const { res: relogin } = await login('forgot@test.dev', 'brandnew1');
    assert.equal(relogin.status, 200);
  });
});
