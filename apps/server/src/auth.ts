import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key));
  });
}
const cookieName = 'team_kb_session';
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.COOKIE_SECURE === 'true', path: '/' };
type User = { id: string; email: string; name: string };
type Credentials = { email: string; password: string; name?: string };

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [, salt, encoded] = stored.split(':');
  const hash = await scryptAsync(password, salt);
  const expected = Buffer.from(encoded, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function authenticatedUser(request: FastifyRequest, pool?: pg.Pool): Promise<User | undefined> {
  const token = request.cookies[cookieName];
  if (!pool || !token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
  const result = await pool.query<User>('SELECT u.id,u.email,u.name FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [tokenHash(token)]);
  return result.rows[0];
}

export function registerAuth(app: FastifyInstance, pool?: pg.Pool) {
  // Cookie 自动随请求发送；要求自定义请求头，阻止跨站表单操作登录状态。
  app.addHook('onRequest', async (request, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.url.startsWith('/api/')) {
      if (request.headers['x-requested-with'] !== 'team-kb') {
        return reply.code(403).send({ message: '请求来源校验失败，请通过本项目页面操作。' });
      }
      const origin = request.headers.origin;
      if (origin) {
        try {
          const allowedOrigins = (process.env.APP_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').map((value) => value.trim());
          if (!allowedOrigins.includes(new URL(origin).origin)) {
            return reply.code(403).send({ message: '请求来源校验失败。' });
          }
        } catch {
          return reply.code(403).send({ message: '请求来源校验失败。' });
        }
      }
    }
  });

  const schema = (register: boolean) => ({
    body: {
      type: 'object', additionalProperties: false,
      required: register ? ['email', 'password', 'name'] : ['email', 'password'],
      properties: {
        email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
        password: { type: 'string', minLength: 10, maxLength: 128 },
        ...(register ? { name: { type: 'string', minLength: 1, maxLength: 50, pattern: '\\S' } } : {}),
      },
    },
  });

  async function currentUser(request: FastifyRequest): Promise<User | undefined> {
    const token = request.cookies[cookieName];
    if (!pool || !token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    const result = await pool.query<User>(
      'SELECT u.id,u.email,u.name FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [tokenHash(token)],
    );
    return result.rows[0];
  }

  app.post<{ Body: Credentials }>('/api/auth/register', {
    schema: schema(true), config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ message: '数据库未配置，请按第二步文档完成配置。' });
    const email = request.body.email.toLowerCase();
    const name = request.body.name!.trim();
    const passwordHash = await hashPassword(request.body.password);
    try {
      const result = await pool.query<User>(
        'INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,email,name',
        [randomUUID(), email, name, passwordHash],
      );
      return reply.code(201).send({ user: result.rows[0], message: '注册成功，请登录。' });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ message: '该邮箱已注册，请直接登录。' });
      throw error;
    }
  });

  // 未注册用户也进行一次密码计算，减少通过响应耗时判断邮箱是否存在。
  let dummyHash: Promise<string> | undefined;
  app.post<{ Body: Credentials }>('/api/auth/login', {
    schema: schema(false), config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!pool) return reply.code(503).send({ message: '数据库未配置，请按第二步文档完成配置。' });
    const result = await pool.query<User & { password_hash: string }>('SELECT id,email,name,password_hash FROM users WHERE email=$1', [request.body.email.toLowerCase()]);
    const user = result.rows[0];
    dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
    const valid = await verifyPassword(request.body.password, user?.password_hash ?? await dummyHash);
    if (!user || !valid) return reply.code(401).send({ message: '邮箱或密码错误。' });
    const token = randomBytes(32).toString('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (request.cookies[cookieName]) await client.query('DELETE FROM auth_sessions WHERE token_hash=$1', [tokenHash(request.cookies[cookieName]!)]);
      await client.query('DELETE FROM auth_sessions WHERE user_id=$1 AND expires_at<=now()', [user.id]);
      await client.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '7 days')", [tokenHash(token), user.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 });
    return { user: { id: user.id, name: user.name, email: user.email } };
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!pool) return reply.code(503).send({ message: '数据库未配置。' });
    reply.header('Cache-Control', 'no-store');
    const user = await currentUser(request);
    if (!user) return reply.code(401).send({ message: '请先登录。' });
    return { user };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (!pool) return reply.code(503).send({ message: '数据库未配置。' });
    const token = request.cookies[cookieName];
    if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [tokenHash(token)]);
    reply.clearCookie(cookieName, cookieOptions);
    return { message: '已退出登录。' };
  });

  app.get('/api/conversations', async (request, reply) => {
    if (!pool) return reply.code(503).send({ message: '数据库未配置。' });
    reply.header('Cache-Control', 'no-store');
    const user = await currentUser(request);
    if (!user) return reply.code(401).send({ message: '请先登录。' });
    const result = await pool.query('SELECT id,title,created_at FROM conversations WHERE user_id=$1 ORDER BY created_at DESC', [user.id]);
    return { conversations: result.rows };
  });
}
