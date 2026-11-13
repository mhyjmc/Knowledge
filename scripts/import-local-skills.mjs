import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from 'dotenv';

const root = new URL('../', import.meta.url);
config({ path: fileURLToPath(new URL('.env', root)), quiet: true });
const directory = new URL('.local-knowledge/skills/', root);
const ownerName = process.argv[2];
if (!ownerName) throw new Error('请传入目标账号名称，例如 npm run skills:import -- zhx。');
if (!process.env.DATABASE_URL) throw new Error('请先配置 DATABASE_URL 并启动数据库。');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const owners = await pool.query('SELECT id FROM users WHERE name=$1', [ownerName]);
  if (owners.rowCount !== 1) throw new Error('目标账号不存在或名称不唯一，请检查账号名称。');
  const userId = owners.rows[0].id;
  const files = (await readdir(directory)).filter(name => /^0[0-4]-.*\.md$/.test(name)).sort();
  if (files.length !== 5) throw new Error('预期 5 份 Skills 索引文档，请检查本机资料目录。');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      const content = (await readFile(new URL(file, directory), 'utf8')).replace(/\r\n/g, '\n').trim();
      const title = '本机 Skills / ' + file.replace(/\.md$/, '');
      const existing = await client.query('SELECT id FROM documents WHERE user_id=$1 AND title=$2 FOR UPDATE', [userId, title]);
      if (existing.rowCount > 1) throw new Error('发现重复的索引文档：' + title);
      const id = existing.rowCount ? existing.rows[0].id : randomUUID();
      if (existing.rowCount) await client.query('DELETE FROM document_chunks WHERE document_id=$1', [id]);
      else await client.query('INSERT INTO documents(id,user_id,title) VALUES ($1,$2,$3)', [id, userId, title]);
      let count = 0;
      for (let index = 0; index < content.length; index += 700) {
        await client.query('INSERT INTO document_chunks(id,document_id,position,content) VALUES ($1,$2,$3,$4)', [randomUUID(), id, ++count, content.slice(index, index + 800)]);
      }
      console.log(title + '：' + count + ' 个片段');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
