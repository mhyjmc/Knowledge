import { createApp } from './app.js';
import { createDatabase } from './database.js';
import { migrate } from './database.js';

const pool = createDatabase();
const app = createApp(pool);
pool?.on('error', () => app.log.error('数据库连接异常，请检查 PostgreSQL 服务。'));
const port = Number(process.env.PORT ?? 3001);

try {
  if (!pool) throw new Error('DATABASE_URL 未配置，无法启动服务。');
  await migrate(pool);
  // 开发时仅监听本机，部署时可用 HOST=0.0.0.0 调整。
  await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
