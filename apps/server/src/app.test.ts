import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './app.js';

test('健康检查返回服务状态，项目接口明确区分已实现与待开发功能', async () => {
  const app = createApp();
  try {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, 'ok');
    assert.ok(Number.isFinite(Date.parse(health.json().timestamp)));
    const project = await app.inject({ method: 'GET', url: '/api/project' });
    assert.equal(project.statusCode, 200);
    assert.equal(project.json().capabilities[0].status, '已实现');
    assert.equal(project.json().capabilities.find((item: { name: string }) => item.name === '模型对话').status, '已实现');
    assert.equal(project.json().capabilities.find((item: { name: string }) => item.name === '文档知识库').status, '已实现');
  } finally {
    await app.close();
  }
});
