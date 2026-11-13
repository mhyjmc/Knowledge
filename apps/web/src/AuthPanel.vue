<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ChatPanel from './ChatPanel.vue';
import KnowledgePanel from './KnowledgePanel.vue';
import TaskPanel from './TaskPanel.vue';

type User = { id: string; name: string; email: string };
const user = ref<User | null>(null);
const mode = ref<'login' | 'register'>('login');
const name = ref('');
const email = ref('');
const password = ref('');
const busy = ref(false);
const initialising = ref(true);
const message = ref('');
const failed = ref(false);
const database = ref('正在检查数据库…');

async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Requested-With': 'team-kb' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? '请求失败，请稍后重试。');
  return data;
}

async function initialise() {
  try {
    const result = await request('/api/database');
    database.value = result.message;
  } catch (error) {
    database.value = error instanceof Error ? error.message : '暂时无法连接数据库。';
  }
  try { user.value = (await request('/api/auth/me')).user; } catch { user.value = null; }
  initialising.value = false;
}

function switchMode(next: 'login' | 'register') {
  mode.value = next;
  message.value = '';
  password.value = '';
}

async function submit() {
  busy.value = true;
  message.value = '';
  failed.value = false;
  try {
    const body = { email: email.value.trim(), password: password.value, ...(mode.value === 'register' ? { name: name.value.trim() } : {}) };
    const result = await request(`/api/auth/${mode.value}`, body);
    if (mode.value === 'register') {
      mode.value = 'login';
      message.value = '注册成功，请使用刚才的邮箱和密码登录。';
    } else {
      user.value = result.user;
      message.value = '登录成功。';
    }
    password.value = '';
  } catch (error) {
    failed.value = true;
    message.value = error instanceof Error ? error.message : '网络连接异常，请稍后重试。';
  } finally { busy.value = false; }
}

async function logout() {
  busy.value = true;
  try {
    await request('/api/auth/logout', {});
    user.value = null;
    message.value = '已退出登录。';
    failed.value = false;
  } catch (error) {
    message.value = error instanceof Error ? error.message : '退出失败，请重试。';
    failed.value = true;
  } finally { busy.value = false; }
}

onMounted(initialise);
</script>

<template>
  <section class="account-section">
    <div class="section-title"><h2>团队账号</h2><span>{{ database }}</span></div>
    <p v-if="initialising" role="status">正在读取登录状态…</p>
    <div v-else-if="user" class="account-content">
      <div><h3>{{ user.name }}</h3><p>{{ user.email }}</p><span class="badge done">已登录</span></div>
      <button :disabled="busy" @click="logout">退出登录</button>
    </div>
    <form v-else class="account-form" @submit.prevent="submit">
      <div class="mode-tabs" role="tablist" aria-label="账号操作">
        <button type="button" role="tab" :aria-selected="mode === 'login'" :class="{ selected: mode === 'login' }" :disabled="busy" @click="switchMode('login')">登录</button>
        <button type="button" role="tab" :aria-selected="mode === 'register'" :class="{ selected: mode === 'register' }" :disabled="busy" @click="switchMode('register')">注册</button>
      </div>
      <div class="account-fields">
        <label v-if="mode === 'register'">姓名<input v-model="name" :disabled="busy" required maxlength="50" autocomplete="name" placeholder="你的姓名" /></label>
        <label>邮箱<input v-model="email" :disabled="busy" required type="email" maxlength="254" autocomplete="email" placeholder="name@example.com" /></label>
        <label>密码<input v-model="password" :disabled="busy" required type="password" minlength="10" maxlength="128" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" placeholder="至少 10 个字符" /></label>
      </div>
      <button type="submit" :disabled="busy">{{ busy ? '正在处理…' : mode === 'register' ? '创建账号' : '登录账号' }}</button>
    </form>
    <p v-if="message" :class="['account-message', { failed }]" role="status">{{ message }}</p>
  </section>
  <ChatPanel v-if="user" :key="user.id" :user-id="user.id" />
  <KnowledgePanel v-if="user" :key="'knowledge-'+user.id" />
  <TaskPanel v-if="user" :key="'tasks-'+user.id" />
</template>

<style scoped>
.account-section{margin:32px 0;padding:20px 0;border-top:1px solid #dbe2d8;border-bottom:1px solid #dbe2d8}.section-title{flex-wrap:wrap}.account-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px;margin:20px 0}label{display:flex;flex-direction:column;gap:7px;font-size:13px}input{font:inherit;padding:11px 12px;border:1px solid #bac9bf;border-radius:6px;min-width:0;background:white}input:focus{outline:2px solid #608967;outline-offset:1px}.mode-tabs{display:flex;gap:2px;border-bottom:1px solid #dbe2d8}.mode-tabs button{background:transparent;color:#66776c;border-radius:0;padding:10px 22px;border-bottom:2px solid transparent}.mode-tabs button.selected{color:#214e3c;border-bottom-color:#214e3c}.account-content{display:flex;justify-content:space-between;align-items:center;gap:16px}.account-content h3{margin:0;font-size:18px}.account-content p{font-size:13px;color:#6b7b71}.account-message{font-size:13px;color:#3e704c}.failed{color:#ad3434}@media(max-width:640px){.account-fields{grid-template-columns:1fr}.account-content{flex-wrap:wrap}}
</style>
