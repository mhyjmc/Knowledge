<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
const props = defineProps<{ userId: string }>();
type Conversation = { id: string; title: string };
type Message = { id: string; role: string; content: string; status: string; duration_ms?: number; usage?: unknown; sources?:{title:string;position:number;content:string}[];mode?:string };
const mode=ref<'chat'|'knowledge'>('knowledge');
const conversations = ref<Conversation[]>([]), messages = ref<Message[]>([]);
const selected = ref(''), input = ref(''), error = ref(''), model = ref(''), configuration = ref('');
const busy = ref(false), loading = ref(false), configured = ref(false);
let controller: AbortController | undefined;
let revision = 0;
const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'team-kb' };
async function api(path: string, body?: unknown) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '请求失败。');
  return data;
}
async function load() {
  const current = ++revision;
  loading.value = true; error.value = '';
  try {
    const [list, config] = await Promise.all([api('/api/conversations'), api('/api/model')]);
    if (current !== revision) return;
    conversations.value = list.conversations; model.value = config.model; configured.value = config.configured; configuration.value = config.message;
    selected.value = conversations.value[0]?.id ?? '';
    messages.value = selected.value ? (await api(`/api/conversations/${selected.value}/messages`)).messages : [];
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载失败。'; }
  finally { if (current === revision) loading.value = false; }
}
async function select(id: string) {
  if (busy.value || loading.value) return;
  loading.value = true; error.value = '';
  try { messages.value = (await api(`/api/conversations/${id}/messages`)).messages; selected.value = id; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '加载失败。'; }
  finally { loading.value = false; }
}
async function newConversation() {
  const result = await api('/api/conversations', {});
  conversations.value.unshift(result.conversation); selected.value = result.conversation.id; messages.value = [];
}
async function create() {
  loading.value = true; error.value = '';
  try { await newConversation(); } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建失败。'; }
  finally { loading.value = false; }
}
async function send() {
  if (!input.value.trim() || busy.value || loading.value || !configured.value) return;
  busy.value = true; error.value = '';
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 135000);
  let started = false, done = false;
  const question = input.value.trim();
  let answer: Message | undefined;
  try {
    if (!selected.value) await newConversation();
    const response = await fetch(`/api/conversations/${selected.value}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: question,mode:mode.value }), signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).message || '发送失败。');
    if (!response.body) throw new Error('浏览器无法读取流式回答。');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    function processLine(line: string) {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'start') {
        started = true; input.value = '';
        messages.value.push({id:event.userMessageId,role:'user',content:question,status:'completed'});
        answer = {id:event.id,role:'assistant',content:'',status:'generating',sources:event.sources,mode:event.mode};
        messages.value.push(answer);
        answer = messages.value[messages.value.length-1];
      }
      if (event.type === 'delta' && answer) answer.content += event.text;
      if (event.type === 'error') error.value = event.message;
      if (event.type === 'done' && answer) { done = true; answer.status = event.status; answer.duration_ms = event.duration_ms; answer.usage = event.usage; }
    }
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, {stream:!chunk.done});
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
      if (chunk.done) { processLine(buffer); break; }
    }
    if (!done) throw new Error('连接提前结束，请刷新会话确认保存状态。');
    const item = conversations.value.find((item) => item.id === selected.value);
    if (item?.title === '新会话') item.title = question.slice(0,40);
  } catch (cause) {
    if (controller.signal.aborted) { if (answer) answer.status = 'cancelled'; error.value = '已停止接收回答，服务端正在保存状态；可点击刷新会话确认。'; }
    else { if (answer) answer.status = 'failed'; error.value = cause instanceof Error ? cause.message : '发送失败。'; }
    if (!started) input.value = question;
  } finally { clearTimeout(timeout); busy.value = false; controller = undefined; }
}
watch(() => props.userId, load);
onMounted(load);
onBeforeUnmount(() => { revision++; controller?.abort(); });
const labels: Record<string,string> = {completed:'已完成',generating:'生成中',cancelled:'已停止',failed:'未完成'};
function usageLabel(message: Message) {
  if (message.mode === 'knowledge' && message.sources?.length === 0) return '未调用模型';
  if (!message.usage || typeof message.usage !== 'object') return '供应商未返回用量';
  const usage = message.usage as Record<string, unknown>;
  const value = (key: string) => typeof usage[key] === 'number' && Number.isFinite(usage[key]) && (usage[key] as number) >= 0 ? usage[key] : undefined;
  const input = value('input_tokens') ?? value('prompt_tokens');
  const output = value('output_tokens') ?? value('completion_tokens');
  const total = value('total_tokens');
  const parts = [input === undefined ? '' : `输入 ${input}`, output === undefined ? '' : `输出 ${output}`, total === undefined ? '' : `总计 ${total}`].filter(Boolean);
  return parts.length ? `用量（Token）：${parts.join(' / ')}` : '供应商用量格式未识别';
}
</script>

<template>
  <section class="chat-panel">
    <div class="section-title"><h2>智能问答</h2><span>{{ model }}</span></div>
    <p class="notice">{{ configuration }}</p>
    <fieldset :disabled="busy || loading"><legend>回答方式</legend><label><input v-model="mode" type="radio" value="knowledge" /> 文档问答</label><label><input v-model="mode" type="radio" value="chat" /> 普通对话</label></fieldset>
    <div class="chat-layout">
      <aside class="history"><button :disabled="busy || loading" @click="create">新建对话</button><button v-for="item in conversations" :key="item.id" :class="{chosen: selected === item.id}" :disabled="busy || loading" @click="select(item.id)">{{ item.title }}</button></aside>
      <div class="chat-main">
        <div class="messages" aria-label="对话消息" aria-live="polite">
          <p v-if="!messages.length" class="notice empty-chat">{{ loading ? '正在读取历史…' : mode === 'knowledge' ? '输入问题，助手会先查找你的资料并标出来源。' : '输入问题，开始一段普通对话。' }}</p>
          <article v-for="message in messages" :key="message.id" :class="['message', message.role]">
            <strong>{{ message.role === 'user' ? '你' : '助手' }}</strong><p>{{ message.content || (message.status === 'generating' ? '等待模型回答…' : '本次没有生成回答。') }}</p>
            <details v-for="(source,index) in message.sources" :key="index"><summary>[{{index+1}}] {{source.title}} · 第 {{source.position}} 段（检索原文）</summary><p>{{source.content}}</p></details>
            <small v-if="message.role === 'assistant'">{{ labels[message.status] }}<template v-if="message.duration_ms"> · {{ (message.duration_ms/1000).toFixed(1) }} 秒</template> · {{ usageLabel(message) }}</small>
          </article>
        </div>
        <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
        <form @submit.prevent="send"><label for="question">你的问题</label><textarea id="question" v-model="input" :disabled="busy || loading" maxlength="8000" rows="3" :placeholder="mode === 'knowledge' ? '例如：报销材料有哪些？' : '例如：用简单例子解释数据库事务'" /><div class="chat-actions"><button v-if="busy" type="button" @click="controller?.abort()">停止生成</button><button v-else :disabled="loading || !configured || !input.trim()">发送问题</button><button class="quiet-button" type="button" :disabled="busy || loading || !selected" @click="select(selected)">刷新会话</button></div></form>
      </div>
    </div>
  </section>
</template>
<style scoped>
.chat-panel{margin:48px 0 0}.notice{color:var(--muted);font-size:12px;margin:0 0 15px}.chat-panel .section-title{margin-bottom:7px}.chat-panel fieldset{display:flex;gap:18px;align-items:center;border:0;padding:0;margin:0 0 16px;font-size:12px}.chat-panel legend{float:left;margin-right:18px;color:var(--muted)}.chat-panel fieldset label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}.chat-panel input[type=radio]{accent-color:var(--deep)}.chat-layout{display:grid;grid-template-columns:205px minmax(0,1fr);border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}.history{padding:17px;background:#eff6fc;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:7px;max-height:665px;overflow:auto}.history button{white-space:normal;text-align:left;overflow-wrap:anywhere;background:transparent;color:var(--deep);border:1px solid transparent;padding:9px 10px;font-weight:500}.history button:hover:not(:disabled){background:#e1f0fc}.history button.chosen{background:#fff;border-color:var(--line);color:var(--ink);font-weight:700}.history button:first-child{background:var(--deep);color:#fff;text-align:center;margin-bottom:8px;font-weight:700}.history button:first-child:hover:not(:disabled){background:#154f8e;color:#fff}.chat-main{padding:20px;min-width:0;display:flex;flex-direction:column}.messages{min-height:245px;max-height:470px;overflow:auto;padding-right:4px}.empty-chat{padding:32px 10px;text-align:center}.message{padding:15px 17px;background:#f6fafe;border-left:3px solid var(--deep);margin:0 0 12px;max-width:94%}.message.user{background:#e7f3fd;border-left-color:#76a9d5;margin-left:auto}.message strong{font-size:12px;color:var(--deep)}.message p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.85;margin:8px 0}.message details{border-top:1px solid var(--line);padding-top:9px;margin-top:10px;font-size:12px}.message summary{cursor:pointer;color:var(--deep);overflow-wrap:anywhere}.message small{color:var(--muted);overflow-wrap:anywhere;font-size:11px}.chat-error{color:var(--danger);font-size:12px}.chat-main form{margin-top:auto;padding-top:16px;border-top:1px solid var(--line)}.chat-main form label{display:block;font-size:12px;font-weight:700}.chat-main textarea{display:block;width:100%;resize:vertical;margin:8px 0 11px;border:1px solid var(--line);border-radius:7px;padding:11px 12px;font-size:13px;line-height:1.7}.chat-actions{display:flex;gap:9px;flex-wrap:wrap}@media(max-width:700px){.chat-layout{grid-template-columns:1fr}.history{max-height:156px;border-right:0;border-bottom:1px solid var(--line)}.chat-main{padding:16px}.message{max-width:100%}.chat-panel fieldset{flex-wrap:wrap;gap:8px 14px}}
</style>
