<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from './store/session';

const session = useSessionStore();
const { user } = storeToRefs(session);
const route = useRoute();
const router = useRouter();
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
  await session.restore();
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
      session.setUser(result.user);
      message.value = '登录成功。';
      const destination = route.query.redirect;
      await router.replace(typeof destination === 'string' && destination.startsWith('/') && !destination.startsWith('//') ? destination : '/documents');
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
    session.setUser(null);
    await router.replace('/account');
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
  <section id="account" class="account-section">
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
</template>

<style scoped>
.account-section{scroll-margin-top:28px;margin:38px 0 0;padding:25px 27px;background:#fff;border:1px solid var(--line);border-radius:12px}.section-title{flex-wrap:wrap}.section-title h2{font-size:19px}.account-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:20px 0}label{display:flex;flex-direction:column;gap:7px;font-size:12px;font-weight:600}input{padding:10px 12px;border:1px solid var(--line);border-radius:7px;min-width:0;background:white;font-size:13px}.mode-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line)}.mode-tabs button{background:transparent;color:var(--muted);border-radius:0;padding:9px 20px;border-bottom:2px solid transparent}.mode-tabs button:hover:not(:disabled){background:#f0f7fd;color:var(--deep)}.mode-tabs button.selected{color:var(--deep);border-bottom-color:var(--deep)}.account-content{display:flex;justify-content:space-between;align-items:center;gap:16px}.account-content h3{margin:0;font-size:17px}.account-content p{font-size:13px;color:var(--muted);overflow-wrap:anywhere}.account-content button{background:transparent;color:var(--deep);border:1px solid var(--line)}.account-content button:hover:not(:disabled){background:#e9f3fc;color:var(--deep)}.account-message{font-size:12px;color:var(--deep);margin-bottom:0}.account-message.failed{color:var(--danger)}@media(max-width:700px){.account-section{scroll-margin-top:115px;padding:19px}.account-fields{grid-template-columns:1fr}.account-content{flex-wrap:wrap}}
</style>
