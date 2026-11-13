import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from './app.js';
import { createDatabase,migrate } from './database.js';
import type { ModelRunner } from './model.js';

test('待办草稿确认、拒绝、失败、幂等、原子执行及跨用户隔离（模型测试替身）',async()=>{
  const pool=createDatabase();assert.ok(pool);await migrate(pool);
  let calls=0;
  const runner:ModelRunner=async function*(messages){calls++;const input=messages[0].content;
    if(input==='上游失败')throw new Error('模拟失败，含敏感错误不应回显');
    yield {text:input==='错误格式'?'```json\n{}\n```':JSON.stringify({title:'整理报销材料',description:'准备发票和审批记录。'}),completed:true};
  };
  const app=createApp(pool,runner),users:string[]=[],headers={'x-requested-with':'team-kb'};
  async function login(){const email=`task-${randomUUID()}@example.com`,password=randomUUID();
    const registered=await app.inject({method:'POST',url:'/api/auth/register',headers,payload:{name:'任务测试',email,password}});assert.equal(registered.statusCode,201);users.push(registered.json().user.id);
    const logged=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email,password}});assert.equal(logged.statusCode,200);return (logged.headers['set-cookie'] as string).split(';')[0];
  }
  try{
    assert.equal((await app.inject({method:'GET',url:'/api/tasks'})).statusCode,401);
    const cookie=await login(),other=await login();
    const payload={instruction:'准备报销',requestId:randomUUID()};
    const proposed=await app.inject({method:'POST',url:'/api/task-runs',headers:{...headers,cookie},payload});assert.equal(proposed.statusCode,201);
    const id=proposed.json().run.id;assert.equal(proposed.json().run.status,'pending');
    assert.deepEqual((await app.inject({method:'GET',url:'/api/tasks',headers:{cookie}})).json().tasks,[]);
    const duplicate=await app.inject({method:'POST',url:'/api/task-runs',headers:{...headers,cookie},payload});assert.equal(duplicate.json().run.id,id);assert.equal(calls,1);
    assert.equal((await app.inject({method:'POST',url:'/api/task-runs',headers:{...headers,cookie},payload:{...payload,instruction:'换个任务'}})).statusCode,409);
    assert.equal((await app.inject({method:'POST',url:`/api/task-runs/${id}/decision`,headers:{...headers,cookie:other},payload:{action:'confirm'}})).statusCode,404);
    assert.deepEqual((await app.inject({method:'GET',url:'/api/task-runs',headers:{cookie:other}})).json().runs,[]);
    const confirm=()=>app.inject({method:'POST',url:`/api/task-runs/${id}/decision`,headers:{...headers,cookie},payload:{action:'confirm'}});
    const [first,second]=await Promise.all([confirm(),confirm()]);assert.equal(first.statusCode,200);assert.equal(second.statusCode,200);assert.equal(first.json().task.id,second.json().task.id);
    const list=(await app.inject({method:'GET',url:'/api/tasks',headers:{cookie}})).json().tasks;assert.equal(list.length,1);assert.equal(list[0].title,'整理报销材料');
    assert.deepEqual((await app.inject({method:'GET',url:'/api/tasks',headers:{cookie:other}})).json().tasks,[]);
    assert.equal((await app.inject({method:'POST',url:`/api/task-runs/${id}/decision`,headers:{...headers,cookie},payload:{action:'reject'}})).statusCode,409);
    const history=(await app.inject({method:'GET',url:'/api/task-runs',headers:{cookie}})).json().runs[0];assert.deepEqual(history.events.map((e:{action:string})=>e.action),['proposing','pending','executed']);
    // 拒绝不得新增待办，且重复拒绝可以安全重放。
    const rejectId=(await app.inject({method:'POST',url:'/api/task-runs',headers:{...headers,cookie},payload:{instruction:'拒绝本次草稿',requestId:randomUUID()}})).json().run.id;
    for(let index=0;index<2;index++)assert.equal((await app.inject({method:'POST',url:`/api/task-runs/${rejectId}/decision`,headers:{...headers,cookie},payload:{action:'reject'}})).json().run.status,'rejected');
    assert.equal((await app.inject({method:'POST',url:`/api/task-runs/${rejectId}/decision`,headers:{...headers,cookie},payload:{action:'confirm'}})).statusCode,409);
    for(const instruction of ['上游失败','错误格式']){
      const failed=await app.inject({method:'POST',url:'/api/task-runs',headers:{...headers,cookie},payload:{instruction,requestId:randomUUID()}});assert.equal(failed.json().run.status,'failed');assert.equal(failed.json().run.draft,null);assert.ok(!failed.body.includes('敏感'));
      assert.equal((await app.inject({method:'POST',url:`/api/task-runs/${failed.json().run.id}/decision`,headers:{...headers,cookie},payload:{action:'confirm'}})).statusCode,409);
    }
    assert.equal((await app.inject({method:'GET',url:'/api/tasks',headers:{cookie}})).json().tasks.length,1);
    assert.equal((await app.inject({method:'POST',url:`/api/task-runs/${id}/decision`,headers:{...headers,cookie},payload:{action:'confirm',title:'客户端篡改'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:`/api/task-runs/${id}/decision`,headers:{cookie},payload:{action:'confirm'}})).statusCode,403);
  }finally{await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await app.close();}
});
