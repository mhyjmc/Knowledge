<script setup lang="ts">
import {onMounted,ref} from 'vue';
const documents=ref<{id:string;title:string;chunks:number}[]>([]);
const sources=ref<{id:string;document_id:string;title:string;position:number;content:string}[]>([]);
const title=ref(''),content=ref(''),query=ref(''),message=ref(''),busy=ref(false),editingId=ref<string|null>(null);
async function api(path:string,body?:unknown,method:'GET'|'POST'|'PUT'|'DELETE'=body===undefined?'GET':'POST'){
  const response=await fetch(path,{method,headers:method==='GET'?undefined:{'X-Requested-With':'team-kb',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.message??'请求失败。');return result;
}
async function load(){documents.value=(await api('/api/documents')).documents;}
async function perform(task:()=>Promise<void>){busy.value=true;message.value='';try{await task();}catch(error){message.value=error instanceof Error?error.message:'操作失败。';}finally{busy.value=false;}}
async function file(event:Event){const input=event.target as HTMLInputElement;const item=input.files?.[0];if(!item)return;await perform(async()=>{if(!/\.(txt|md)$/i.test(item.name)||item.size>400000)throw new Error('请选择不超过 400 KB 的 UTF-8 文本或 Markdown 文件。');content.value=await item.text();title.value=item.name;message.value='文件已读取，检查内容后点击保存。';});input.value='';}
function clearEditor(){editingId.value=null;title.value='';content.value='';}
async function editDocument(item:{id:string;title:string}){
  if((title.value.trim()||content.value.trim())&&!window.confirm('当前输入尚未保存，确定切换到“'+item.title+'”吗？'))return;
  await perform(async()=>{const result=await api('/api/documents/'+item.id);editingId.value=item.id;title.value=result.document.title;content.value=result.document.content;message.value='正在编辑“'+item.title+'”。';});
}
async function saveDocument(){
  await perform(async()=>{
    const id=editingId.value;
    if(id){await api('/api/documents/'+id,{title:title.value,content:content.value},'PUT');sources.value=sources.value.filter(source=>source.document_id!==id);}
    else await api('/api/documents',{title:title.value,content:content.value});
    clearEditor();await load();message.value=id?'文档已更新，旧搜索结果已清除。':'文档已保存并分段。';
  });
}
async function search(){
  await perform(async()=>{const result=await api('/api/documents/search',{query:query.value});sources.value=result.sources;message.value=result.message;});
}
async function removeDocument(item:{id:string;title:string}){
  if(!window.confirm('确定删除“'+item.title+'”吗？删除后无法恢复文档，历史回答中的来源快照仍会保留。'))return;
  await perform(async()=>{await api('/api/documents/'+item.id,undefined,'DELETE');await load();sources.value=sources.value.filter(source=>source.document_id!==item.id);if(editingId.value===item.id)clearEditor();message.value='文档已删除。';});
}
onMounted(()=>perform(load));
</script>
<template>
  <section class="knowledge">
    <div class="section-title"><div><h2>知识文档</h2><p>把常用资料放在这里，提问时才能找到依据。</p></div><span>{{documents.length}} 份资料</span></div>
    <div class="knowledge-grid">
      <div class="document-list">
        <div class="panel-heading"><h3>资料目录</h3><span>仅你可见</span></div>
        <p v-if="!documents.length" class="empty-state">还没有资料。先在右侧保存一份文本或 Markdown 文档。</p>
        <ul v-else><li v-for="item in documents" :key="item.id" :class="{editing:editingId===item.id}"><strong>{{item.title}}</strong><small>{{item.chunks}} 个片段</small><div class="doc-actions"><button type="button" class="quiet-button" :disabled="busy" @click="editDocument(item)">编辑</button><button type="button" class="danger-button" :disabled="busy" @click="removeDocument(item)">删除</button></div></li></ul>
      </div>
      <div class="editor-panel">
        <div class="panel-heading"><h3>{{editingId?'编辑资料':'添加资料'}}</h3><span>{{editingId?'保存后检索将使用新内容':'支持文本与 Markdown'}}</span></div>
        <label v-if="!editingId" class="file-input">从文件读取内容<input type="file" accept=".txt,.md,text/plain,text/markdown" :disabled="busy" @change="file" /></label>
        <form @submit.prevent="saveDocument"><label>文档标题<input v-model="title" required maxlength="120" :disabled="busy" placeholder="例如：团队报销制度" /></label><label>文档内容<textarea v-model="content" required maxlength="200000" rows="8" :disabled="busy" placeholder="粘贴内容，或从文件读取后在这里检查" /></label><div class="editor-actions"><button :disabled="busy || !title.trim() || !content.trim()">{{editingId?'保存修改':'保存新文档'}}</button><button v-if="editingId" class="quiet-button" type="button" :disabled="busy" @click="clearEditor">取消编辑</button></div></form>
      </div>
    </div>
    <div class="search-panel"><div class="panel-heading"><h3>检索资料</h3><span>先找到原文，再向助手提问</span></div><form @submit.prevent="search"><label for="knowledge-query">输入关键词或问题</label><div class="search-row"><input id="knowledge-query" v-model="query" maxlength="300" required placeholder="例如：报销材料有哪些？" :disabled="busy" /><button :disabled="busy || !query.trim()">查找片段</button></div></form><p v-if="message" role="status" class="status-line">{{message}}</p><div v-if="sources.length" class="search-results"><article v-for="source in sources" :key="source.id"><strong>{{source.title}} <span>第 {{source.position}} 段</span></strong><pre>{{source.content}}</pre></article></div></div>
  </section>
</template>
<style scoped>
.knowledge{margin:48px 0 0}.section-title p{margin:7px 0 0;color:var(--muted);font-size:13px}.knowledge-grid{display:grid;grid-template-columns:minmax(245px,.78fr) minmax(0,1.22fr);border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--paper)}.document-list{padding:22px;background:#eff6fc;border-right:1px solid var(--line)}.editor-panel{padding:22px}.panel-heading{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:18px}.panel-heading h3{margin:0;font-size:16px}.panel-heading span{color:var(--muted);font-size:11px}.document-list ul{padding:0;margin:0;list-style:none;max-height:495px;overflow:auto}.document-list li{padding:14px 0;border-top:1px solid var(--line)}.document-list li.editing{border-left:3px solid var(--deep);padding-left:11px}.document-list strong{display:block;overflow-wrap:anywhere;font-size:14px}.document-list small{display:block;color:var(--muted);margin-top:3px}.doc-actions{display:flex;gap:7px;margin-top:11px}.doc-actions button{padding:5px 10px;font-size:12px}.empty-state{margin:0;color:var(--muted);font-size:13px;line-height:1.8}.file-input{display:block;padding:13px;border:1px dashed #aac8df;border-radius:8px;background:#f7fbff;color:var(--deep);font-size:12px;font-weight:600}.file-input input{display:block;width:100%;margin-top:8px;color:var(--muted);font-size:12px}.editor-panel form{margin-top:18px}.editor-panel form label,.search-panel form label{display:block;font-size:12px;font-weight:600;margin:14px 0 0}.editor-panel form input,.editor-panel form textarea,.search-row input{display:block;width:100%;min-width:0;margin-top:6px;padding:10px 12px;border:1px solid var(--line);border-radius:7px;background:#fff;font-size:13px}.editor-panel form textarea{resize:vertical;line-height:1.75}.editor-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.search-panel{margin-top:25px;padding:23px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.search-row{display:flex;gap:9px;align-items:end}.search-row input{margin-top:7px}.search-row button{flex:none}.status-line{margin:16px 0 0;color:var(--deep);font-size:12px}.search-results{display:grid;gap:10px;margin-top:15px}.search-results article{background:#fff;border-left:3px solid var(--deep);padding:15px 18px}.search-results strong{font-size:13px}.search-results strong span{color:var(--muted);font-weight:400;margin-left:8px}.search-results pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;margin:10px 0 0;font:inherit;font-size:12px;line-height:1.8;color:#3c5d7c}@media(max-width:850px){.knowledge-grid{grid-template-columns:1fr}.document-list{border-right:0;border-bottom:1px solid var(--line)}.document-list ul{max-height:290px}}@media(max-width:520px){.document-list,.editor-panel{padding:17px}.search-row{align-items:stretch;flex-direction:column}.search-row button{align-self:flex-start}.panel-heading{flex-wrap:wrap}}
</style>
