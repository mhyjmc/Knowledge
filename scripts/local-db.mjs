import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { config } from 'dotenv';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('请先运行 npm run db:setup。');
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/team_knowledge') {
  throw new Error('本地开发数据库仅支持 127.0.0.1:5433/team_knowledge。外部数据库请使用自己的启动方式。');
}
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const dataDir = fileURLToPath(new URL('../.local-postgres/', import.meta.url));
const db = new EmbeddedPostgres({
  databaseDir: dataDir, user, password, port: 5433,
  persistent: true, authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}, onError: (message) => console.error(String(message)),
});

let initialised = false;
try { await access(new URL('../.local-postgres/PG_VERSION', import.meta.url)); initialised = true; } catch {}
if (!initialised) {
  console.log('首次初始化本地 PostgreSQL，请稍候…');
  await db.initialise();
}
await db.start();
const client = new pg.Client({ host: '127.0.0.1', port: 5433, user, password, database: 'postgres' });
try {
  await client.connect();
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', ['team_knowledge']);
  if (!existing.rowCount) await client.query('CREATE DATABASE team_knowledge');
} catch (error) {
  await db.stop();
  throw error;
} finally { await client.end(); }
console.log('本地 PostgreSQL 已启动：127.0.0.1:5433，数据保存在 .local-postgres。');
console.log('请保持此终端打开；另开终端执行 npm run db:migrate，然后 npm run dev。');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await db.stop();
    process.exit(0);
  });
}
