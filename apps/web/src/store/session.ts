import { defineStore } from 'pinia';
import { ref } from 'vue';

export type SessionUser = { id:string; name:string; email:string };

export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionUser | null>(null);
  const checked = ref(false);
  let pending: Promise<void> | undefined;

  async function restore() {
    if (checked.value) return;
    if (!pending) pending = (async () => {
      try {
        const response = await fetch('/api/auth/me', { signal:AbortSignal.timeout(15000) });
        user.value = response.ok ? (await response.json()).user as SessionUser : null;
      } catch { user.value = null; }
      finally { checked.value = true; pending = undefined; }
    })();
    await pending;
  }

  function setUser(next: SessionUser | null) { user.value = next; checked.value = true; }
  return { user, checked, restore, setUser };
});
