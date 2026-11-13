import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { createDatabase, migrate } from './database.js';

test('真实 PostgreSQL：注册、登录、权限隔离、退出及数据持久化', async () => {
  const pool = createDatabase();
  assert.ok(pool, '先运行 npm run db:setup 与数据库启动命令');
  await migrate(pool);
  const app = createApp(pool);
  const headers = { 'x-requested-with': 'team-kb', origin: 'http://127.0.0.1:5173' };
  const email = `test-${randomUUID()}@example.com`;
  const password = 'Test-Only-Password-2026';
  let userId: string | undefined;
  let otherId: string | undefined;
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/conversations' })).statusCode, 401);
    const payload = { name: '测试用户', email, password };
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', payload })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', headers: { ...headers, origin: 'https://another.example' }, payload })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { ...payload, password: 'short' } })).statusCode, 400);
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload });
    assert.equal(registered.statusCode, 201);
    userId = registered.json().user.id;
    assert.equal(registered.json().user.password_hash, undefined);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password: 'Incorrect-Password' } })).statusCode, 401);
    const stored = await pool.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
    assert.notEqual(stored.rows[0].password_hash, password);
    assert.match(stored.rows[0].password_hash, /^scrypt:/);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers['set-cookie'] as string;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(';')[0];
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json().user.id, userId);

    const other = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { ...payload, email: `other-${email}` } });
    otherId = other.json().user.id;
    const ownConversation = randomUUID();
    await pool.query('INSERT INTO conversations(id,user_id,title) VALUES ($1,$2,$3),($4,$5,$6)', [ownConversation, userId, '我的会话', randomUUID(), otherId, '其他人的会话']);
    const conversations = await app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie } });
    assert.deepEqual(conversations.json().conversations.map((item: { id: string }) => item.id), [ownConversation]);

    // 使用独立连接验证持久化，排除内存替代数据库的实现。
    const independent = createDatabase()!;
    try {
      assert.equal((await independent.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0].name, '测试用户');
    } finally { await independent.end(); }

    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, cookie }, payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode, 401);
    const loginAgain = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password } });
    const expiredCookie = (loginAgain.headers['set-cookie'] as string).split(';')[0];
    await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [userId]);
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: expiredCookie } })).statusCode, 401);
    const injected = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email: "a' OR 1=1--@example.com", password } });
    // 非法邮箱会先被请求校验拦截，不能到达数据库查询。
    assert.equal(injected.statusCode, 400);
  } finally {
    // 只清理本测试创建的随机用户，外键负责删除其测试会话。
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[userId, otherId].filter(Boolean)]);
    await app.close();
  }
});
