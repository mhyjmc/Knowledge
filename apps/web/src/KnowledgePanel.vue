<script setup lang="ts">
import {onMounted,ref} from 'vue';
const documents=ref<{id:string;title:string;chunks:number}[]>([]);
const sources=ref<{id:string;document_id:string;title:string;position:number;content:string}[]>([]);
const title=ref(''),content=ref(''),query=ref(''),message=ref(''),busy=ref(false);
async function api(path:string,body?:unknown,method?:'DELETE'){
  const response=await fetch(path,{method:method??(body===undefined?'GET':'POST'),headers:body===undefined?(method?{'X-Requested-With':'team-kb'}:undefined):{'Content-Type':'application/json','X-Requested-With':'team-kb'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.message??'请求失败。');return result;
}
async function load(){documents.value=(await api('/api/documents')).documents;}
async function perform(task:()=>Promise<void>){busy.value=true;message.value='';try{await task();}catch(error){message.value=error instanceof Error?error.message:'操作失败。';}finally{busy.value=false;}}
async function file(event:Event){const input=event.target as HTMLInputElement;const item=input.files?.[0];if(!item)return;await perform(async()=>{if(!/\.(txt|md)$/i.test(item.name)||item.size>400000)throw new Error('请选择不超过 400 KB 的 UTF-8 文本或 Markdown 文件。');content.value=await item.text();title.value=item.name;message.value='文件已读取，检查内容后点击保存。';});input.value='';}
async function removeDocument(item:{id:string;title:string}){
  if(!window.confirm('确定删除“'+item.title+'”吗？删除后无法恢复文档，历史回答中的来源快照仍会保留。'))return;
  await perform(async()=>{await api('/api/documents/'+item.id,undefined,'DELETE');await load();sources.value=sources.value.filter(source=>source.document_id!==item.id);message.value='文档已删除。';});
}
onMounted(()=>perform(load));
</script>
<template>
  <section class="knowledge"><div class="section-title"><h2>我的知识文档</h2><span>文本 / Markdown</span></div>
    <p>导入自己有权使用的资料。</p>
    <label>选择文件<input type="file" accept=".txt,.md,text/plain,text/markdown" :disabled="busy" @change="file" /></label>
    <form @submit.prevent="perform(async()=>{await api('/api/documents',{title,content});title='';content='';await load();message='文档已保存并分段。';})">
      <label>文档标题<input v-model="title" required maxlength="120" :disabled="busy" /></label><label>文档内容<textarea v-model="content" required maxlength="200000" rows="5" :disabled="busy" /></label><button :disabled="busy || !title.trim() || !content.trim()">保存文档</button>
    </form>
    <ul><li v-for="item in documents" :key="item.id">{{item.title}} · {{item.chunks}} 个片段 <button type="button" :disabled="busy" @click="removeDocument(item)">删除</button></li></ul>
    <form @submit.prevent="perform(async()=>{const result=await api('/api/documents/search',{query});sources=result.sources;message=result.message;})"><label>检索资料<input v-model="query" maxlength="300" required placeholder="例如：报销材料" :disabled="busy" /></label><button :disabled="busy || !query.trim()">检索</button></form>
    <p role="status">{{message}}</p><article v-for="source in sources" :key="source.id"><strong>{{source.title}} · 第 {{source.position}} 段</strong><pre>{{source.content}}</pre></article>
  </section>
</template>
<style scoped>
.knowledge{border-top:1px solid #dbe2d8;padding-top:20px;margin:30px 0;font-size:13px}label{display:block;margin:12px 0}input,textarea{display:block;width:100%;margin-top:6px;font:inherit;padding:10px;border:1px solid #bac9bf;border-radius:6px}input[type=file]{border:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}article{background:#fff;padding:14px;margin:10px 0;border:1px solid #dbe2d8;border-radius:8px}
</style>
