// 为浏览器人工验收准备独立账号；凭据仅存放在 Git 忽略目录。
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createDatabase } from '../apps/server/dist/database.js';
const folder = new URL('../.browser-acceptance/', import.meta.url);
const file = new URL('account.json', folder);
if (process.argv.includes('--cleanup')) {
  const account = JSON.parse(await readFile(file, 'utf8'));
  const pool = createDatabase();
  if (!pool) throw new Error('数据库未配置');
  try {
    await pool.query('DELETE FROM users WHERE id=$1 AND email=$2', [account.id, account.email]);
    await unlink(file);
    console.log('本轮浏览器验收账号及关联数据已清理。');
  } finally { await pool.end(); }
} else {
  try { await readFile(file); throw new Error('已有验收账号，请先清理后再创建。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const email = `browser-${randomUUID()}@example.com`, password = randomUUID();
  const response = await fetch('http://127.0.0.1:3001/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'team-kb' },
    body: JSON.stringify({ name: '浏览器验收', email, password }), signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 201) throw new Error('创建临时验收账号失败，请检查后端与数据库。');
  const result = await response.json();
  await mkdir(folder, { recursive: true });
  await writeFile(file, JSON.stringify({ id: result.user.id, email, password }), 'utf8');
  console.log('临时账号已准备，凭据仅保存在本机 Git 忽略目录。');
}
