import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from './app.js';
import { createDatabase, migrate } from './database.js';
import { retrieve } from './knowledge.js';

test('同义问法召回、原词优先、搜索入口一致及用户隔离（真实数据库）', async () => {
  const pool = createDatabase(); assert.ok(pool);
  const app = createApp(pool);
  const users: string[] = [];
  const headers = { 'x-requested-with': 'team-kb' };
  async function login() {
    const email = `search-${randomUUID()}@example.com`, password = randomUUID();
    const registered = await app.inject({method:'POST',url:'/api/auth/register',headers,payload:{name:'检索测试',email,password}});
    assert.equal(registered.statusCode,201);
    const id: string = registered.json().user.id; users.push(id);
    const logged = await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email,password}});
    assert.equal(logged.statusCode,200);
    return {id,cookie:(logged.headers['set-cookie'] as string).split(';')[0]};
  }
  try {
    await migrate(pool);
    const own = await login(), other = await login();
    for (const doc of [
      {title:'消费时限',content:'消费后七天内提交报销申请。'},
      {title:'请假流程',content:'请假需要主管批准。'},
      {title:'购买指南',content:'购买前请检查商品保质期。'},
    ]) {
      const response = await app.inject({method:'POST',url:'/api/documents',headers:{...headers,cookie:own.cookie},payload:doc});
      assert.equal(response.statusCode,201);
    }
    for (const [query, title] of [['买东西之后要在几日以内递交凭证？','消费时限'], ['休假需要谁批准？','请假流程']]) {
      const sources = await retrieve(pool,own.id,query);
      assert.equal(sources[0]?.title,title);
      const response = await app.inject({method:'POST',url:'/api/documents/search',headers:{...headers,cookie:own.cookie},payload:{query}});
      assert.equal(response.statusCode,200);
      assert.deepEqual(response.json().sources,sources);
      const hidden = await app.inject({method:'POST',url:'/api/documents/search',headers:{...headers,cookie:other.cookie},payload:{query}});
      assert.equal(hidden.statusCode,200);
      assert.deepEqual(hidden.json().sources,[]);
    }
    // 同义匹配消费资料时，直接含“购买”的资料应排在前面。
    assert.equal((await retrieve(pool,own.id,'购买'))[0]?.title,'购买指南');
    assert.deepEqual(await retrieve(pool,own.id,'火星飞船燃料配方'),[]);
    assert.deepEqual(await retrieve(pool,own.id,'   !!!'),[]);
    // “递”单字不是“递交”，不能触发扩展而误命中提交资料。
    assert.deepEqual(await retrieve(pool,own.id,'快递物流'),[]);
  } finally {
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    await app.close();
  }
});

test('删除文档需要登录和所有权，删除后片段不再被检索（真实数据库）', async () => {
  const pool = createDatabase(); assert.ok(pool);
  const app = createApp(pool);
  const users: string[] = [];
  const headers = {'x-requested-with':'team-kb'};
  async function login() {
    const email = 'delete-' + randomUUID() + '@example.com', password = randomUUID();
    const registered = await app.inject({method:'POST',url:'/api/auth/register',headers,payload:{name:'删除测试',email,password}});
    assert.equal(registered.statusCode,201);
    users.push(registered.json().user.id);
    const logged = await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email,password}});
    assert.equal(logged.statusCode,200);
    return (logged.headers['set-cookie'] as string).split(';')[0];
  }
  try {
    await migrate(pool);
    const owner = await login(), other = await login();
    const created = await app.inject({method:'POST',url:'/api/documents',headers:{...headers,cookie:owner},payload:{title:'删除测试资料',content:'独有测试词汇甲乙丙丁。'}});
    assert.equal(created.statusCode,201);
    const id: string = created.json().document.id, url = '/api/documents/' + id;
    assert.equal((await app.inject({method:'DELETE',url,headers})).statusCode,401);
    assert.equal((await app.inject({method:'DELETE',url,headers:{...headers,cookie:other}})).statusCode,404);
    assert.equal((await app.inject({method:'DELETE',url:'/api/documents/not-a-uuid',headers:{...headers,cookie:owner}})).statusCode,400);
    assert.equal((await app.inject({method:'DELETE',url,headers:{...headers,cookie:owner}})).statusCode,200);
    assert.equal((await app.inject({method:'DELETE',url,headers:{...headers,cookie:owner}})).statusCode,404);
    const listed = await app.inject({method:'GET',url:'/api/documents',headers:{cookie:owner}});
    assert.equal(listed.statusCode,200);
    assert.ok(!listed.json().documents.some((document:{id:string})=>document.id===id));
    assert.deepEqual(await retrieve(pool,users[0]!, '独有测试词汇甲乙丙丁'),[]);
    assert.equal((await pool.query('SELECT id FROM document_chunks WHERE document_id=$1',[id])).rowCount,0);
  } finally {
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    await app.close();
  }
});

test('编辑本人长文档后重建分段与检索，拒绝越权修改（真实数据库）', async () => {
  const pool=createDatabase();assert.ok(pool);
  const app=createApp(pool),users:string[]=[];
  const headers={'x-requested-with':'team-kb'};
  async function login(){
    const email='edit-'+randomUUID()+'@example.com',password=randomUUID();
    const registered=await app.inject({method:'POST',url:'/api/auth/register',headers,payload:{name:'编辑测试',email,password}});
    assert.equal(registered.statusCode,201);users.push(registered.json().user.id);
    const logged=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email,password}});
    assert.equal(logged.statusCode,200);
    return {id:registered.json().user.id as string,cookie:(logged.headers['set-cookie'] as string).split(';')[0]};
  }
  try{
    await migrate(pool);
    const owner=await login(),other=await login();
    const original='oldtokenxyz '+'甲'.repeat(1600);
    const created=await app.inject({method:'POST',url:'/api/documents',headers:{...headers,cookie:owner.cookie},payload:{title:'原始标题',content:original}});
    assert.equal(created.statusCode,201);
    const id:string=created.json().document.id,url='/api/documents/'+id;
    const oldChunks=(await pool.query<{id:string}>('SELECT id FROM document_chunks WHERE document_id=$1',[id])).rows.map(row=>row.id);
    assert.equal((await app.inject({method:'GET',url,headers})).statusCode,401);
    assert.equal((await app.inject({method:'GET',url,headers:{cookie:other.cookie}})).statusCode,404);
    assert.equal((await app.inject({method:'GET',url:'/api/documents/invalid',headers:{cookie:owner.cookie}})).statusCode,400);
    const read=await app.inject({method:'GET',url,headers:{cookie:owner.cookie}});
    assert.equal(read.statusCode,200);assert.equal(read.json().document.content,original);
    assert.equal((await app.inject({method:'PUT',url,headers,payload:{title:'新标题',content:'newtokenabc'}})).statusCode,401);
    assert.equal((await app.inject({method:'PUT',url,headers:{cookie:owner.cookie},payload:{title:'新标题',content:'newtokenabc'}})).statusCode,403);
    assert.equal((await app.inject({method:'PUT',url,headers:{...headers,cookie:other.cookie},payload:{title:'越权',content:'newtokenabc'}})).statusCode,404);
    assert.equal((await app.inject({method:'PUT',url,headers:{...headers,cookie:owner.cookie},payload:{title:' ',content:'newtokenabc'}})).statusCode,400);
    const updatedContent='newtokenabc '+'乙'.repeat(1700);
    const updated=await app.inject({method:'PUT',url,headers:{...headers,cookie:owner.cookie},payload:{title:'新标题',content:updatedContent}});
    assert.equal(updated.statusCode,200);assert.equal(updated.json().document.id,id);
    const after=await app.inject({method:'GET',url,headers:{cookie:owner.cookie}});
    assert.equal(after.json().document.title,'新标题');assert.equal(after.json().document.content,updatedContent);
    assert.deepEqual(await retrieve(pool,owner.id,'oldtokenxyz'),[]);
    assert.equal((await retrieve(pool,owner.id,'newtokenabc'))[0]?.title,'新标题');
    assert.equal((await pool.query('SELECT id FROM document_chunks WHERE id=ANY($1::uuid[])',[oldChunks])).rowCount,0);
  }finally{await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await app.close();}
});
