const { app, request, register, auth } = require('./helpers/app');
const { startTestDb, stopTestDb, clearTestDb } = require('./helpers/db');

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

describe('用户认证', () => {
  test('注册成功返回 token 和用户信息', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('alice');
    expect(res.body.user.id).toBeTruthy();
    expect(res.body.user.createdAt).toBeTruthy();
  });

  test('重复用户名返回 409', async () => {
    await register('bob');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'secret123' });
    expect(res.status).toBe(409);
  });

  test('用户名或密码太短返回 400', async () => {
    const shortName = await request(app)
      .post('/api/auth/register')
      .send({ username: 'c', password: 'secret123' });
    expect(shortName.status).toBe(400);

    const shortPassword = await request(app)
      .post('/api/auth/register')
      .send({ username: 'carol', password: '1' });
    expect(shortPassword.status).toBe(400);
  });

  test('登录成功并可获取当前用户', async () => {
    await register('carol');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'carol', password: 'secret123' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();

    const me = await request(app)
      .get('/api/auth/me')
      .set(auth(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('carol');
  });

  test('错误密码返回 401', async () => {
    await register('dave');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dave', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  test('未登录访问受保护接口返回 401', async () => {
    const res = await request(app).get('/api/surveys');
    expect(res.status).toBe(401);
  });

  test('无效 token 返回 401', async () => {
    const res = await request(app)
      .get('/api/surveys')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
