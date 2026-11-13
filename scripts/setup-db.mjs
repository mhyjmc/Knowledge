import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const password = randomBytes(24).toString('hex');
try {
  await writeFile(new URL('../.env', import.meta.url),
    `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://team_kb:${password}@127.0.0.1:5433/team_knowledge\nCOOKIE_SECURE=false\n`,
    { flag: 'wx', mode: 0o600 });
  console.log('已生成项目根目录 .env，含随机数据库密码。请勿提交或分享该文件。');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env 已存在，保留原配置。');
}
