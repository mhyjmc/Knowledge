import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDatabase, migrate } from './database.js';
import { retrieve, retrievalVersion, expandedTerms, type Source } from './knowledge.js';
import { modelConfig, generationConfig, runModel, type ModelRunner } from './model.js';
import { datasetVersion, documents, cases } from './evaluation-cases.js';

const live = process.argv.includes('--live');
const pool = createDatabase();
assert.ok(pool, '请先配置并启动 PostgreSQL。');
if (live) assert.ok(modelConfig().configured, '真实评测需要服务端模型密钥。');
let modelCalls = 0;
const runner: ModelRunner = async function* (...args) {
  if (live && modelCalls >= 3) throw new Error('本轮真实模型调用达到三次上限');
  modelCalls++;
  if (!live) throw new Error('离线评测禁止调用模型');
  yield* runModel(...args);
};
const app = createApp(pool, runner);
const users: string[] = [];
const results: Record<string, unknown>[] = [];
const headers = { 'x-requested-with': 'team-kb' };
const startedAt = new Date().toISOString();
const output = fileURLToPath(new URL('../../../docs/evaluations/', import.meta.url));
let fatal = false;

async function login() {
  const email = `eval-${randomUUID()}@example.com`;
  const password = randomUUID();
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { name: '临时评测用户', email, password } });
  assert.equal(registered.statusCode, 201, '评测注册失败');
  const userId: string = registered.json().user.id;
  users.push(userId);
  const logged = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { email, password } });
  assert.equal(logged.statusCode, 200, '评测登录失败');
  return { userId, cookie: (logged.headers['set-cookie'] as string).split(';')[0] };
}
async function conversation(cookie: string) {
  const response = await app.inject({ method: 'POST', url: '/api/conversations', headers: { ...headers, cookie }, payload: {} });
  assert.equal(response.statusCode, 201);
  return response.json().conversation.id as string;
}

try {
  await migrate(pool);
  const owner = await login();
  const outsider = await login();
  for (const doc of documents) {
    const response = await app.inject({ method: 'POST', url: '/api/documents', headers: { ...headers, cookie: owner.cookie }, payload: doc });
    assert.equal(response.statusCode, 201, '合成资料导入失败');
  }
  for (const item of cases) {
    const sources = await retrieve(pool, owner.userId, item.question);
    // 记录期望资料是否进入前五条，单独检查第一条排序。
    const hit = item.title === null ? sources.length === 0 : sources.some(source => source.title === item.title);
    results.push({ id: item.id, phase: '检索', question: item.question, expectedTitle: item.title, passed: hit,
      top1Correct: item.title === null ? sources.length === 0 : sources[0]?.title === item.title, queryTerms: expandedTerms(item.question), sources });
  }
  const isolated = await retrieve(pool, outsider.userId, '报销材料');
  const ownerConversation = await conversation(owner.cookie);
  const denied = await app.inject({ method: 'GET', url: `/api/conversations/${ownerConversation}/messages`, headers: { cookie: outsider.cookie } });
  const deniedWrite = await app.inject({ method: 'POST', url: `/api/conversations/${ownerConversation}/messages`, headers: { ...headers, cookie: outsider.cookie }, payload: { content: '报销材料', mode: 'knowledge' } });
  results.push({ id: 'isolation', phase: '权限', passed: isolated.length === 0 && denied.statusCode === 404 && deniedWrite.statusCode === 404,
    sources: isolated, readStatus: denied.statusCode, writeStatus: deniedWrite.statusCode });

  // 离线仅验证无证据分支；真实模式最多三次收费调用，第四题无证据应不调用模型。
  for (const item of cases.filter(item => live ? item.live : item.id === 'no-match')) {
    console.log(`评测：${item.id}（${live ? '真实模式' : '离线模式'}）`);
    const id = await conversation(owner.cookie);
    const before = modelCalls;
    const response = await app.inject({ method: 'POST', url: `/api/conversations/${id}/messages`, headers: { ...headers, cookie: owner.cookie }, payload: { content: item.question, mode: 'knowledge' } });
    const history = await app.inject({ method: 'GET', url: `/api/conversations/${id}/messages`, headers: { cookie: owner.cookie } });
    const saved = history.statusCode === 200 ? history.json().messages.at(-1) : undefined;
    const answer: string = saved?.role === 'assistant' ? saved.content : '';
    const sources: Source[] = saved?.sources ?? [];
    const citations = Array.from(answer.matchAll(/\[(\d+)\]/g), match => Number(match[1]));
    const checks = {
      completed: response.statusCode === 200 && saved?.status === 'completed',
      expectedKeywords: item.keywords.every(word => new RegExp(word).test(answer)),
      refusal: item.kind !== 'refusal' || /资料不足|未规定|未提及|未说明|没有.*(?:额度|信息)|无法.*(?:确定|回答)/.test(answer),
      citations: citations.every(index => index >= 1 && index <= sources.length) && (item.kind !== 'answer' || citations.length > 0),
      sourceSnapshot: item.title === null ? sources.length === 0 : sources.some(source => source.title === item.title),
      noEvidenceNoModel: item.title !== null || (modelCalls === before && saved?.usage === null),
    };
    results.push({ id: item.id, phase: '问答自动初筛', question: item.question, passed: Object.values(checks).every(Boolean), checks,
      answer, sources, citations, status: saved?.status ?? 'missing', durationMs: saved?.duration_ms ?? null, usage: saved?.usage ?? null,
      modelCalls: modelCalls - before, httpStatus: response.statusCode,
      humanReview: '待人工确认：事实是否有依据、是否正确拒答、引用是否支持每项结论。' });
  }
} catch {
  // 不输出原始上游错误，避免敏感配置或认证信息进入报告。
  fatal = true;
  results.push({ id: 'execution-error', phase: '运行', passed: false, error: '评测未完整执行，请检查数据库和本机配置；原始错误不写入报告。' });
} finally {
  try { await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]); }
  catch { fatal = true; results.push({ id: 'cleanup-error', phase: '清理', passed: false, error: '临时评测数据清理失败，需检查数据库。' }); }
  await app.close();
}
await mkdir(output, { recursive: true });
const filename = `${startedAt.replace(/[:.]/g, '-')}-${live ? 'live' : 'offline'}`;
const passed = results.filter(result => result.passed).length;
const report = { datasetVersion, retrievalVersion, mode: live ? '真实模型' : '离线（无模型）', startedAt, endedAt: new Date().toISOString(),
  config: live ? { model: modelConfig().model, apiMode: modelConfig().mode, ...generationConfig() } : null,
  modelCalls, passed, total: results.length, fatal, results };
await writeFile(`${output}${filename}.json`, JSON.stringify(report, null, 2) + '\n', 'utf8');
const markdown = [
  '# 固定问题评测结果', '', `- 时间（UTC）：${startedAt}`, `- 题库版本：${datasetVersion}`, `- 检索版本：${retrievalVersion}`, `- 模式：${report.mode}`,
  `- 自动检查：${passed}/${results.length} 通过；实际模型调用：${modelCalls} 次。`,
  '- 自动初筛不能证明答案正确；本报告保留原始合成资料、回答及用量。用量为供应商报告值，不能直接解释为费用。',
  '- 词项检索的同义问法失败也计入失败，不调整期望掩盖问题。', '',
  '| 项目 | 检查层 | 自动结果 |', '| --- | --- | --- |',
  ...results.map(result => `| ${result.id} | ${result.phase} | ${result.passed ? '通过' : '失败'} |`), '',
  ...results.filter(result => result.phase === '问答自动初筛').flatMap(result => [
    `## ${result.id}`, '', `问题：${result.question}`, '', `状态：${result.status}；耗时：${result.durationMs} ms`, '',
    '回答：', '', String(result.answer || '（空）'), '', '引用原文：', '',
    ...(result.sources as Source[]).map((source, index) => `${index + 1}. ${source.title}：${source.content}`), '',
    `自动检查：${JSON.stringify(result.checks)}`, '', String(result.humanReview), '',
  ]), '## 下一步人工检查', '',
  '逐题阅读回答与原文：材料和时限是否一致；额度未规定时是否拒绝编造金额；每个引用是否支持对应结论。检查完成后另记人工结论，不把自动通过当作人工通过。', '',
  `JSON 明细：[${filename}.json](${filename}.json)`, '',
].join('\n');
await writeFile(`${output}${filename}.md`, markdown, 'utf8');
console.log(`自动检查 ${passed}/${results.length}；模型调用 ${modelCalls} 次；报告 ${output}${filename}.md`);
if (fatal || passed !== results.length) process.exitCode = 1;
