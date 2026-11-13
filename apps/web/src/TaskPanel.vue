<script setup lang="ts">
import { onMounted, ref } from 'vue';
type Run = { id:string; instruction:string; status:string; draft:{title:string;description:string}|null; error:string|null; events:{action:string;created_at:string}[] };
type Task = {id:string;title:string;description:string};
const runs=ref<Run[]>([]), tasks=ref<Task[]>([]), instruction=ref(''), busy=ref(false), message=ref('');
let retry: {instruction:string;requestId:string}|undefined;
const labels:Record<string,string>={proposing:'草稿生成中',pending:'等待确认',executed:'待办已创建',rejected:'已拒绝',failed:'生成失败'};
async function api(path:string,body?:unknown){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json','X-Requested-With':'team-kb'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(body && path==='/api/task-runs'?135000:15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.message || '请求失败，请刷新执行记录确认结果。');return data;
}
async function load(){const [history,list]=await Promise.all([api('/api/task-runs'),api('/api/tasks')]);runs.value=history.runs;tasks.value=list.tasks;}
async function perform(action:()=>Promise<void>){if(busy.value)return;busy.value=true;message.value='';try{await action();}catch(error){message.value=error instanceof Error?error.message:'操作失败，请刷新记录确认结果。';}finally{busy.value=false;}}
async function propose(){await perform(async()=>{
  const text=instruction.value.trim();if(!text)return;
  if(!retry || retry.instruction!==text)retry={instruction:text,requestId:crypto.randomUUID()};
  const result=await api('/api/task-runs',retry);
  // 断网或超时保留请求编号，同一页面重试不会重复生成；终态返回后允许有意重新生成。
  if(result.run.status!=='proposing')retry=undefined;
  await load();
  message.value=result.run.status==='pending'?'草稿已生成，请检查后确认或拒绝。':result.run.error || '请求已有记录，请查看执行状态。';
});}
async function decide(id:string,action:'confirm'|'reject'){await perform(async()=>{
  await api(`/api/task-runs/${id}/decision`,{action});await load();message.value=action==='confirm'?'待办已创建，执行记录已保存。':'已拒绝草稿，没有创建待办。';
});}
onMounted(()=>perform(load));
</script>
<template>
  <section class="task-panel">
    <div class="section-title"><h2>任务助手</h2><span>先确认，再创建</span></div>
    <p class="task-intro">描述一项待办，助手先整理草稿；只有你确认后才保存。</p>
    <form class="task-form" @submit.prevent="propose"><label>待办需求<textarea v-model="instruction" maxlength="2000" rows="3" :disabled="busy" placeholder="例如：整理报销材料，准备发票和审批记录" required /></label><div class="task-actions"><button :disabled="busy || !instruction.trim()">{{busy?'正在处理…':'生成待办草稿'}}</button><button class="quiet-button" type="button" :disabled="busy" @click="perform(load)">刷新记录</button></div></form>
    <p v-if="message" class="task-message" role="status">{{message}}</p>
    <div class="task-columns"><div><h3>我的待办 <small>{{tasks.length}}</small></h3><p v-if="!tasks.length" class="empty-state">暂无待办。确认草稿后会出现在这里。</p>
    <article v-for="task in tasks" :key="task.id" class="task-item"><strong>{{task.title}}</strong><p>{{task.description}}</p></article></div>
    <div><h3>执行记录 <small>最近 50 条</small></h3><p v-if="!runs.length" class="empty-state">暂无执行记录。生成草稿后可以在这里查看过程。</p>
    <article v-for="run in runs" :key="run.id" class="run-item">
      <strong>{{labels[run.status] || run.status}}</strong><p>原始需求：{{run.instruction}}</p>
      <template v-if="run.draft"><h4>{{run.draft.title}}</h4><p>{{run.draft.description}}</p></template>
      <p v-if="run.error">{{run.error}}</p>
      <div v-if="run.status==='pending'" class="task-actions"><button :disabled="busy" @click="decide(run.id,'confirm')">确认创建待办</button><button class="quiet-button" :disabled="busy" @click="decide(run.id,'reject')">拒绝草稿</button></div>
      <details><summary>查看执行过程</summary><ol><li v-for="(event,index) in run.events" :key="index">{{labels[event.action] || event.action}} · {{new Date(event.created_at).toLocaleString('zh-CN')}}</li></ol></details>
    </article></div></div>
  </section>
</template>
<style scoped>
.task-panel{margin:48px 0 0}.task-intro{color:var(--muted);font-size:13px;margin:0 0 17px}.task-form{padding:22px;border:1px solid var(--line);border-radius:12px;background:#fff}.task-form label{display:block;font-size:12px;font-weight:700}.task-form textarea{display:block;width:100%;padding:11px 12px;margin:8px 0 13px;border:1px solid var(--line);border-radius:7px;resize:vertical;font-size:13px;line-height:1.7}.task-actions{display:flex;gap:9px;flex-wrap:wrap}.task-message{font-size:12px;color:var(--deep);margin:12px 0}.task-columns{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:30px}.task-columns h3{font-size:16px;margin:0 0 13px}.task-columns h3 small{font-weight:400;color:var(--muted);margin-left:7px;font-size:11px}.empty-state{color:var(--muted);font-size:12px;padding:18px 0;border-top:1px solid var(--line)}article{padding:16px;background:#fff;border:1px solid var(--line);border-radius:8px;margin:0 0 10px;font-size:13px}article strong{color:var(--ink)}article p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;color:#3f5e7a;line-height:1.75}.run-item{border-left:3px solid var(--deep)}h4{margin:12px 0 5px;font-size:13px}details{margin-top:14px;color:var(--deep);border-top:1px solid var(--line);padding-top:10px;font-size:12px}summary{cursor:pointer}ol{padding-left:20px}li{margin:5px 0}@media(max-width:800px){.task-columns{grid-template-columns:1fr;gap:18px}}@media(max-width:520px){.task-form{padding:17px}}
</style>
