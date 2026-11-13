import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { registerAuth } from './auth.js';
import { registerChat } from './chat.js';
import type { ModelRunner } from './model.js';
import { registerKnowledge } from './knowledge.js';
import { registerTasks } from './tasks.js';

// 将接口定义与启动过程分开，方便在测试中直接请求接口。
export function createApp(pool?: pg.Pool, runner?: ModelRunner) {
  const app = Fastify({ logger: true, ajv: { customOptions: { removeAdditional: false } } });
  app.register(cookie);
  app.register(rateLimit, { global: false });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ message: '参数格式不正确，请检查邮箱、密码、会话编号或消息长度。' });
    if (error.statusCode === 429) return reply.code(429).send({ message: '请求过于频繁，请稍后再试。' });
    request.log.error({ code: error.code }, '请求处理失败');
    return reply.code(503).send({ message: '服务暂时不可用，请检查后端日志与数据库状态。' });
  });
  registerAuth(app, pool);
  registerChat(app, pool, runner);
  registerKnowledge(app, pool);
  registerTasks(app, pool, runner);
  if (pool) app.addHook('onClose', async () => { await pool.end(); });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: '团队知识库助手',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/project', async () => ({
    name: '团队知识库助手',
    stage: '知识问答与待办确认工作流',
    capabilities: [
      { name: '前后端连接', status: '已实现' },
      { name: '登录与会话存储', status: '已实现' },
      { name: '模型对话', status: '已实现' },
      { name: '文档知识库', status: '已实现' },
      { name: '工具调用与任务执行', status: '待办工作流已实现' },
    ],
  }));

  app.get('/api/database', async (_request, reply) => {
    if (!pool) return reply.code(503).send({ status: 'unconfigured', message: '请先配置数据库。' });
    try {
      await pool.query('SELECT id FROM users LIMIT 0');
      return { status: 'ok', message: 'PostgreSQL 已连接，数据表已就绪。' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', message: '数据库不可用或尚未迁移，请查看第二步文档。' });
    }
  });

  return app;
}
