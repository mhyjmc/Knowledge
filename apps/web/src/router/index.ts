import type { Pinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import OverviewView from '../views/OverviewView.vue';
import AuthPanel from '../AuthPanel.vue';
import KnowledgePanel from '../KnowledgePanel.vue';
import ChatView from '../views/ChatView.vue';
import TaskPanel from '../TaskPanel.vue';
import { useSessionStore } from '../store/session';

export function createWorkspaceRouter(pinia: Pinia) {
  const router = createRouter({
    history: createWebHistory(),
    scrollBehavior: () => ({ top:0 }),
    routes: [
      { path:'/', name:'overview', component:OverviewView },
      { path:'/account', name:'account', component:AuthPanel },
      { path:'/documents', name:'documents', component:KnowledgePanel, meta:{requiresAuth:true} },
      { path:'/chat', name:'chat', component:ChatView, meta:{requiresAuth:true} },
      { path:'/tasks', name:'tasks', component:TaskPanel, meta:{requiresAuth:true} },
      { path:'/:pathMatch(.*)*', redirect:'/' },
    ],
  });
  router.beforeEach(async (to) => {
    const session = useSessionStore(pinia);
    await session.restore();
    if (to.meta.requiresAuth && !session.user) return { path:'/account', query:{redirect:to.fullPath} };
  });
  return router;
}
