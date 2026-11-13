import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { createDatabase, migrate } from './database.js';
import type { ModelRunner } from './model.js';

test('对话流式保存、历史恢复、失败状态与跨用户隔离（模型使用测试替身）', async () => {
  const pool = createDatabase(); assert.ok(pool);
  await migrate(pool);
  const runner: ModelRunner = async function* (messages) {
    yield {text:'测试'};
    if (messages.at(-1)?.content === '触发失败') throw new Error('模拟上游中断');
    yield {text:'回答', completed:true, usage:{total_tokens:12}};
  };
  const app = createApp(pool, runner);
  const headers = {'x-requested-with':'team-kb',origin:'http://127.0.0.1:5173'};
  const users: string[] = [];
  const password = 'Local-Test-Password-2026';
  async function login() {
    const email = `chat-${randomUUID()}@example.com`;
    const registered = await app.inject({method:'POST',url:'/api/auth/register',headers,payload:{name:'对话测试',email,password}});
    assert.equal(registered.statusCode,201); users.push(registered.json().user.id);
    const response = await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email,password}});
    assert.equal(response.statusCode,200);
    return (response.headers['set-cookie'] as string).split(';')[0];
  }
  try {
    assert.equal((await app.inject({method:'POST',url:'/api/conversations',headers,payload:{}})).statusCode,401);
    const cookie = await login();
    const created = await app.inject({method:'POST',url:'/api/conversations',headers:{...headers,cookie},payload:{}});
    assert.equal(created.statusCode,201);
    const id = created.json().conversation.id;
    const sent = await app.inject({method:'POST',url:`/api/conversations/${id}/messages`,headers:{...headers,cookie},payload:{content:'你好'}});
    assert.equal(sent.statusCode,200);
    const events = sent.body.trim().split('\n').map((line:string) => JSON.parse(line));
    assert.equal(events.at(-1).status,'completed');
    assert.equal(events.filter((item:{type:string}) => item.type === 'delta').map((item:{text:string})=>item.text).join(''),'测试回答');
    const saved = await app.inject({method:'GET',url:`/api/conversations/${id}/messages`,headers:{cookie}});
    assert.equal(saved.json().messages[1].content,'测试回答');
    assert.equal(saved.json().messages[1].usage.total_tokens,12);
    const other = await login();
    const document = await app.inject({method:'POST',url:'/api/documents',headers:{...headers,cookie},payload:{title:'测试报销制度',content:'报销材料必须包含发票与审批记录。'}});
    assert.equal(document.statusCode,201);
    const found = await app.inject({method:'POST',url:'/api/documents/search',headers:{...headers,cookie},payload:{query:'报销材料'}});
    assert.equal(found.json().sources[0].title,'测试报销制度');
    const grounded=await app.inject({method:'POST',url:`/api/conversations/${id}/messages`,headers:{...headers,cookie},payload:{content:'报销材料',mode:'knowledge'}});
    assert.equal(JSON.parse(grounded.body.trim().split('\n')[0]).sources[0].title,'测试报销制度');
    const restored=await app.inject({method:'GET',url:`/api/conversations/${id}/messages`,headers:{cookie}});
    assert.equal(restored.json().messages.at(-1).sources[0].content,'报销材料必须包含发票与审批记录。');
    const noEvidence=await app.inject({method:'POST',url:`/api/conversations/${id}/messages`,headers:{...headers,cookie},payload:{content:'火星飞船',mode:'knowledge'}});
    assert.match(noEvidence.body,/资料不足/);
    const hidden = await app.inject({method:'POST',url:'/api/documents/search',headers:{...headers,cookie:other},payload:{query:'报销材料'}});
    assert.equal(hidden.json().sources.length,0);
    const missing = await app.inject({method:'POST',url:'/api/documents/search',headers:{...headers,cookie},payload:{query:'火星飞船'}});
    assert.equal(missing.json().sources.length,0);
    assert.equal((await app.inject({method:'GET',url:`/api/conversations/${id}/messages`,headers:{cookie:other}})).statusCode,404);
    assert.equal((await app.inject({method:'POST',url:`/api/conversations/${id}/messages`,headers:{...headers,cookie:other},payload:{content:'越权'}})).statusCode,404);
    const lock = await pool.connect();
    try {
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[id]);
      assert.equal((await app.inject({method:'POST',url:`/api/conversations/${id}/messages`,headers:{...headers,cookie},payload:{content:'并发'}})).statusCode,409);
    } finally { await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[id]);lock.release(); }
    const failed = await app.inject({method:'POST',url:`/api/conversations/${id}/messages`,headers:{...headers,cookie},payload:{content:'触发失败'}});
    assert.equal(JSON.parse(failed.body.trim().split('\n').at(-1)!).status,'failed');
    const after = await app.inject({method:'GET',url:`/api/conversations/${id}/messages`,headers:{cookie}});
    assert.equal(after.json().messages.at(-1).content,'测试');
    assert.equal(after.json().messages.at(-1).status,'failed');
    assert.equal((await app.inject({method:'POST',url:`/api/conversations/${id}/messages`,headers:{...headers,cookie},payload:{content:' '}})).statusCode,400);
  } finally { await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]); await app.close(); }
});
