import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 3001);

function isListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const finish = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(1500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(true));
  });
}

const occupied = await Promise.all([5173, port].map(isListening));
if (occupied.some(Boolean)) {
  let running = false;
  try {
    const [healthResponse, projectResponse, pageResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) }),
      fetch('http://127.0.0.1:5173/api/project', { signal: AbortSignal.timeout(3000) }),
      fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(3000) }),
    ]);
    if (healthResponse.ok && projectResponse.ok && pageResponse.ok) {
      const health = await healthResponse.json();
      const project = await projectResponse.json();
      const page = await pageResponse.text();
      running = health.status === 'ok' && health.service === '团队知识库助手'
        && project.name === '团队知识库助手' && page.includes('<title>团队知识库助手</title>');
    }
  } catch { /* 端口占用不等于项目可用，需要同时验证前后端身份与响应。 */ }
  if (running) {
    console.log('\n团队知识库助手已经在运行，无需重复启动。');
    console.log('请打开：http://127.0.0.1:5173/');
    console.log('若需重启，请在原启动终端按 Ctrl+C，再运行 npm run dev。\n');
    process.exit(0);
  }
  console.error(`\n无法启动：端口 ${[5173, port].filter((_, index) => occupied[index]).join('、')} 已被占用，但前后端没有同时正常响应。`);
  console.error('请检查原启动终端，结束自己启动的旧服务后重试。');
  console.error('详细说明：docs/03-第一步-运行与理解前后端.md\n');
  process.exit(1);
}

// 直接通过 Node 启动本地工具，避免 Windows 的 npm.ps1 执行策略问题。
const child = spawn(process.execPath, [
  fileURLToPath(new URL('../node_modules/concurrently/dist/bin/concurrently.js', import.meta.url)),
  '-k', '-n', 'server,web',
  'npm run dev -w @team-kb/server', 'npm run dev -w @team-kb/web',
], { cwd: root, stdio: 'inherit' });
child.once('error', (error) => { console.error('启动失败，请先运行 npm install。', error.message); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
