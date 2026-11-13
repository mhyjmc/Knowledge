<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AuthPanel from './AuthPanel.vue';

type Project = { name: string; stage: string; capabilities: { name: string; status: string }[] };
const project = ref<Project | null>(null);
const state = ref<'loading' | 'ready' | 'error'>('loading');
const errorMessage = ref('');

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
    <aside class="sidebar">
      <div class="brand"><span class="logo">知</span>团队知识库助手</div>
      <p class="sidebar-label">工作空间</p>
      <div class="nav active">项目概览 <span>01</span></div>
      <div class="nav">知识文档 <small>登录后可用</small></div>
      <div class="nav">智能问答 <small>登录后可用</small></div>
      <div class="nav">任务助手 <small>登录后可用</small></div>
      <div class="sidebar-foot">从前端到 AI 应用开发<br /><strong>每一步，都有记录。</strong></div>
    </aside>
    <main>
      <header><span>工作空间 / 项目概览</span><span class="version">v0.2 · 开发中</span></header>
      <section class="hero">
        <p class="eyebrow">让团队知识，随时可用</p>
        <h1>把散落的知识，<br />变成工作的答案。</h1>
        <p class="intro">集中管理团队文档，找到有出处的答案，并逐步让助手完成实际任务。</p>
        <div class="hero-tag">当前阶段：{{ project?.stage || '正在读取进度…' }}</div>
      </section>
      <section class="connection card" aria-live="polite">
        <div><p class="eyebrow">服务连接</p><h2>{{ state === 'ready' ? '前后端已连接' : state === 'loading' ? '正在连接后端…' : '连接需要检查' }}</h2><p>{{ state === 'ready' ? '页面已成功获取 Node.js 后端返回的项目数据。' : errorMessage || '正在读取项目状态，请稍候。' }}</p></div>
        <button :disabled="state === 'loading'" @click="connect">{{ state === 'loading' ? '连接中…' : '重新检查连接' }} <span>↗</span></button>
      </section>
      <AuthPanel />
      <section class="roadmap">
        <div class="section-title"><h2>一步一步，构建完整应用</h2><span>开发路线</span></div>
        <div v-if="project" class="steps">
          <article v-for="(item, index) in project.capabilities" :key="item.name" class="card step">
            <span class="step-number">0{{ index + 1 }}</span><h3>{{ item.name }}</h3><span :class="['badge', { done: item.status === '已实现' }]">{{ item.status }}</span>
          </article>
        </div>
        <p v-else class="empty">连接后端后，将显示最新的功能进度。</p>
      </section>
      <footer>团队知识库助手 · 文档检索与引用问答</footer>
    </main>
  </div>
</template>
