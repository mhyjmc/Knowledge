<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../store/session';

type Project = { name:string; stage:string; capabilities:{name:string;status:string}[] };
const project = ref<Project | null>(null);
const state = ref<'loading'|'ready'|'error'>('loading');
const errorMessage = ref('');
const router = useRouter();
const session = useSessionStore();

async function connect() {
  state.value = 'loading'; errorMessage.value = '';
  try {
    const response = await fetch('/api/project', {signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('后端返回异常状态');
    project.value = await response.json() as Project;
    state.value = 'ready';
  } catch {
    state.value = 'error';
    errorMessage.value = '暂时无法连接后端，请确认项目根目录中的 npm run dev 正在运行。';
  }
}
function openDocuments() { void router.push(session.user ? '/documents' : '/account'); }
onMounted(connect);
</script>

<template>
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy"><p class="eyebrow">资料、答案与待办</p><h1 id="hero-title">从一份资料，<br />找到有出处的答案。</h1><p class="intro">导入文档，核对引用，再决定下一步要做的事。文档问答可以查看引用原文。</p><button class="hero-action" type="button" @click="openDocuments">{{ session.user?'查看我的文档':'登录后开始使用' }}</button></div>
    <div class="hero-route" aria-label="使用流程"><span>导入资料</span><i aria-hidden="true"></i><span>查看出处</span><i aria-hidden="true"></i><span>确认待办</span></div>
  </section>
  <section class="connection" aria-live="polite">
    <div class="connection-indicator" :class="state" aria-hidden="true"></div><div><strong>{{ state === 'ready' ? '服务已连接' : state === 'loading' ? '正在连接服务' : '服务连接失败' }}</strong><p>{{ state === 'ready' ? '可以开始管理文档和对话。' : errorMessage || '正在读取项目状态。' }}</p></div>
    <button class="quiet-button" :disabled="state === 'loading'" @click="connect">重新检查</button>
  </section>
  <section class="roadmap">
    <div class="section-title"><h2>当前能力</h2><span>{{project?.stage || '正在读取进度'}}</span></div>
    <ul v-if="project" class="capabilities"><li v-for="item in project.capabilities" :key="item.name"><span>{{item.name}}</span><span :class="['badge',{done:item.status==='已实现'}]">{{item.status}}</span></li></ul>
    <p v-else class="empty">连接后端后，将显示最新的功能进度。</p>
  </section>
</template>
