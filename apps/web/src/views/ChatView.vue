<script setup lang="ts">
import ChatPanel from '../ChatPanel.vue';
import { useSessionStore } from '../store/session';
const session = useSessionStore();
</script>

<template><ChatPanel v-if="session.user" :user-id="session.user.id" /></template>
