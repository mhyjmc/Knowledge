import { createDatabase, migrate } from './database.js';

const pool = createDatabase();
if (!pool) {
  console.error('未配置 DATABASE_URL，请先在项目根目录运行 npm run db:setup。');
  process.exitCode = 1;
} else {
  try {
    await migrate(pool);
    console.log('数据库迁移完成：用户、登录会话、对话与消息表已就绪，可重复执行。');
  } catch {
    console.error('数据库迁移失败，请确认 Docker Desktop 正在运行，已执行 npm run db:up，且 .env 中的连接配置正确。');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
