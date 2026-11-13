<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useSessionStore } from './store/session';

const session = useSessionStore();
const route = useRoute();
const navigation = [
  {path:'/',label:'工作台',mark:'◇'},
  {path:'/account',label:'账号',mark:'○'},
  {path:'/documents',label:'知识文档',mark:'▤'},
  {path:'/chat',label:'智能问答',mark:'◎'},
  {path:'/tasks',label:'任务助手',mark:'✓'},
];
const pageName = computed(() => navigation.find(item => item.path === route.path)?.label ?? '工作台');
</script>

<template>
  <div class="workspace">
    <aside class="sidebar" aria-label="工作区导航">
      <div class="brand"><span class="logo" aria-hidden="true">知</span><span>团队知识库<small>资料与行动工作台</small></span></div>
      <nav class="primary-nav" aria-label="主要功能">
        <RouterLink v-for="item in navigation" :key="item.path" :to="item.path" :class="['nav',{active:route.path===item.path}]" :aria-current="route.path===item.path?'page':undefined"><span>{{item.label}}</span><span class="nav-mark" aria-hidden="true">{{item.mark}}</span></RouterLink>
      </nav>
      <div class="sidebar-foot"><span class="sidebar-pulse" aria-hidden="true"></span>{{session.user?'已进入个人工作区':'登录后使用资料与问答'}}</div>
    </aside>
    <main>
      <header class="topbar"><span>工作区 / {{pageName}}</span><span class="version">{{session.user?'个人资料空间':'访客视图'}}</span></header>
      <RouterView />
      <footer>团队知识库助手 · 资料归你管理，行动由你确认</footer>
    </main>
  </div>
</template>
