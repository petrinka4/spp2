const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, connect, disconnect, createUser, login } = require('./helpers');

const auth = (token) => ({ Authorization: `Bearer ${token}` });

let user;
let other;
let manager;
let admin;

before(async () => {
  await connect('spp_lab3_test_tasks');
  await createUser({ email: 'user@test.dev' });
  await createUser({ email: 'other@test.dev' });
  await createUser({ email: 'manager@test.dev', role: 'manager' });
  await createUser({ email: 'admin@test.dev', role: 'admin' });
  user = (await login('user@test.dev')).token;
  other = (await login('other@test.dev')).token;
  manager = (await login('manager@test.dev')).token;
  admin = (await login('admin@test.dev')).token;
});

after(() => disconnect());

describe('tasks and roles', () => {
  let taskId;

  test('user creates task, gets 201 and Location', async () => {
    const res = await request(app).post('/api/tasks').set(auth(user)).send({ title: 'My task' });
    assert.equal(res.status, 201);
    assert.match(res.headers.location, /\/api\/tasks\/[a-f0-9]{24}$/);
    taskId = res.body._id;
  });

  test('validation error gives 422', async () => {
    const res = await request(app).post('/api/tasks').set(auth(user)).send({ title: '' });
    assert.equal(res.status, 422);
  });

  test('invalid id gives 422, missing task gives 404', async () => {
    const bad = await request(app).get('/api/tasks/123').set(auth(user));
    assert.equal(bad.status, 422);
    const missing = await request(app).get('/api/tasks/000000000000000000000000').set(auth(user));
    assert.equal(missing.status, 404);
  });

  test('other user cannot see foreign task', async () => {
    const list = await request(app).get('/api/tasks').set(auth(other));
    assert.equal(list.body.length, 0);

    const res = await request(app).get(`/api/tasks/${taskId}`).set(auth(other));
    assert.equal(res.status, 403);
  });

  test('manager sees and edits all tasks but cannot delete foreign', async () => {
    const list = await request(app).get('/api/tasks').set(auth(manager));
    assert.equal(list.body.length, 1);

    const upd = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set(auth(manager))
      .send({ title: 'Checked by manager', status: 'in_progress' });
    assert.equal(upd.status, 200);

    const del = await request(app).delete(`/api/tasks/${taskId}`).set(auth(manager));
    assert.equal(del.status, 403);
  });

  test('only admin manages users', async () => {
    const asManager = await request(app).get('/api/users').set(auth(manager));
    assert.equal(asManager.status, 403);

    const asAdmin = await request(app).get('/api/users').set(auth(admin));
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.body.length, 4);

    const target = asAdmin.body.find((u) => u.email === 'other@test.dev');
    const promote = await request(app)
      .patch(`/api/users/${target._id}`)
      .set(auth(admin))
      .send({ role: 'manager' });
    assert.equal(promote.status, 200);
    assert.equal(promote.body.role, 'manager');

    const list = await request(app).get('/api/tasks').set(auth(other));
    assert.equal(list.body.length, 1);
  });

  test('disabled user loses access immediately', async () => {
    const users = await request(app).get('/api/users').set(auth(admin));
    const target = users.body.find((u) => u.email === 'user@test.dev');

    await request(app).patch(`/api/users/${target._id}`).set(auth(admin)).send({ isActive: false });

    const res = await request(app).get('/api/tasks').set(auth(user));
    assert.equal(res.status, 401);
  });

  test('admin deletes any task with 204', async () => {
    const res = await request(app).delete(`/api/tasks/${taskId}`).set(auth(admin));
    assert.equal(res.status, 204);
  });

  test('unsupported attachment type gives 415', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set(auth(admin))
      .field('title', 'With file')
      .attach('attachment', Buffer.from('<html></html>'), {
        filename: 'x.html',
        contentType: 'text/html',
      });
    assert.equal(res.status, 415);
  });
});
