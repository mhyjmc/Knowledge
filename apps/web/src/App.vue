<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AuthPanel from './AuthPanel.vue';

type Project = { name: string; stage: string; capabilities: { name: string; status: string }[] };
const project = ref<Project | null>(null);
const state = ref<'loading' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const loggedIn = ref(false);
const currentSection = ref('overview');
const navigation = [
  {id:'overview',label:'工作台'},
  {id:'account',label:'账号'},
  {id:'documents',label:'知识文档'},
  {id:'chat',label:'智能问答'},
  {id:'tasks',label:'任务助手'},
];
function navigate(id:string){
  const target=id==='overview'?'overview':loggedIn.value?id:'account';
  currentSection.value=target;
  document.getElementById(target)?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}

async function connect() {
  state.value = 'loading';
  errorMessage.value = '';
  try {
    const response = await fetch('/api/project', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('后端返回异常状态');
    project.value = await response.json() as Project;
    state.value = 'ready';
  } catch {
    state.value = 'error';
    errorMessage.value = '暂时无法连接后端，请确认项目根目录中的 npm run dev 正在运行。';
  }
}

onMounted(connect);
</script>

<template>
  <div class="workspace">
    <aside class="sidebar" aria-label="工作区导航">
      <div class="brand"><span class="logo" aria-hidden="true">知</span><span>团队知识库<small>资料与行动工作台</small></span></div>
      <nav class="primary-nav" aria-label="主要功能">
        <button v-for="item in navigation" :key="item.id" type="button" :class="['nav',{active:currentSection===item.id}]" :aria-current="currentSection===item.id?'location':undefined" @click="navigate(item.id)"><span>{{item.label}}</span><span class="nav-mark" aria-hidden="true">{{ item.id==='overview'?'◇':item.id==='account'?'○':item.id==='documents'?'▤':item.id==='chat'?'◎':'✓' }}</span></button>
      </nav>
      <div class="sidebar-foot"><span class="sidebar-pulse" aria-hidden="true"></span>{{ loggedIn?'已进入个人工作区':'登录后使用资料与问答' }}</div>
    </aside>
    <main id="overview">
      <header class="topbar"><span>工作区 / 工作台</span><span class="version">{{ loggedIn?'个人资料空间':'访客视图' }}</span></header>
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy"><p class="eyebrow">资料、答案与待办</p><h1 id="hero-title">从一份资料，<br />找到有出处的答案。</h1><p class="intro">导入文档，核对引用，再决定下一步要做的事。文档问答可以查看引用原文。</p><button class="hero-action" type="button" @click="navigate('documents')">{{ loggedIn?'查看我的文档':'登录后开始使用' }}</button></div>
        <div class="hero-route" aria-label="使用流程"><span>导入资料</span><i aria-hidden="true"></i><span>查看出处</span><i aria-hidden="true"></i><span>确认待办</span></div>
      </section>
      <section class="connection" aria-live="polite">
        <div class="connection-indicator" :class="state" aria-hidden="true"></div><div><strong>{{ state === 'ready' ? '服务已连接' : state === 'loading' ? '正在连接服务' : '服务连接失败' }}</strong><p>{{ state === 'ready' ? '可以开始管理文档和对话。' : errorMessage || '正在读取项目状态。' }}</p></div>
        <button class="quiet-button" :disabled="state === 'loading'" @click="connect">重新检查</button>
      </section>
      <AuthPanel @auth-change="loggedIn=$event" />
      <section class="roadmap">
        <div class="section-title"><h2>当前能力</h2><span>{{project?.stage || '正在读取进度'}}</span></div>
        <ul v-if="project" class="capabilities"><li v-for="item in project.capabilities" :key="item.name"><span>{{item.name}}</span><span :class="['badge',{done:item.status==='已实现'}]">{{item.status}}</span></li></ul>
        <p v-else class="empty">连接后端后，将显示最新的功能进度。</p>
      </section>
      <footer>团队知识库助手 · 资料归你管理，行动由你确认</footer>
    </main>
  </div>
</template>
