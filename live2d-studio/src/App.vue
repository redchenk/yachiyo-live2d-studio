<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import Live2DPage from '../../src/frontend/pages/Live2DPage.vue';
import TsIcon from '../../src/frontend/components/TsIcon.vue';
import { readRoomLLMSettings, readRoomTTSSettings } from '../../src/frontend/services/room/roomSettings';
import StudioSettingsPanel from './components/StudioSettingsPanel.vue';
import MusicTestPage from './components/MusicTestPage.vue';
import BilibiliDanmakuPage from './components/BilibiliDanmakuPage.vue';
import MinecraftPage from './components/MinecraftPage.vue';
import springBranch from '../../assets/images/spring-studio-v1/sakura-branch.png';

function shouldOpenSettingsOnBoot() {
  const llm = readRoomLLMSettings();
  const tts = readRoomTTSSettings();
  return !llm.apiKey || !llm.apiUrl || (tts.enabled && !tts.apiUrl);
}

const settingsOpen = ref(shouldOpenSettingsOnBoot());
const settingsTab = ref('llm');
const activeView = ref('live');
const workspaceCollapsed = ref(localStorage.getItem('yachiyo:studio:workspaceCollapsed') !== 'false');
function toggleWorkspace() {
  workspaceCollapsed.value = !workspaceCollapsed.value;
  localStorage.setItem('yachiyo:studio:workspaceCollapsed', String(workspaceCollapsed.value));
}
const railItems = [
  { id: 'live', label: '直播舞台', icon: 'home' },
  { id: 'items', label: '模型与道具', icon: 'package' },
  { id: 'danmaku', label: '弹幕互动', icon: 'message' },
  { id: 'music', label: '音乐与点歌', icon: 'music' },
  { id: 'minecraft', label: 'Minecraft', icon: 'gamepad' }
];

onMounted(() => {
  document.body.classList.add('vue-live2d-route');
});

onUnmounted(() => {
  document.body.classList.remove('vue-live2d-route');
});
</script>

<template>
  <div class="studio-app-shell" :class="{ 'is-workspace-collapsed': workspaceCollapsed }">
    <header class="studio-masthead">
      <div class="studio-wordmark"><span class="studio-moon-mark">☾</span><div><strong>月读 · 八千代</strong><small>YACHIYO LIVE2D STUDIO</small></div></div>
      <div class="studio-season-heading"><span>春日直播间</span><small>让声音、表情与故事在这里相遇</small></div>
      <button class="studio-memory-shortcut" type="button" @click="settingsTab = 'memory'; settingsOpen = true"><TsIcon name="note" :size="16" /> 长记忆</button>
    </header>
    <Live2DPage
      v-show="activeView === 'live' || activeView === 'items'"
      :item-editor-open="activeView === 'items'"
      @item-editor-close="activeView = 'live'"
    />
    <BilibiliDanmakuPage v-if="activeView === 'danmaku'" />
    <MusicTestPage v-if="activeView === 'music'" />
    <MinecraftPage v-if="activeView === 'minecraft'" />
    <aside class="studio-left-rail" aria-label="Studio navigation">
      <div class="studio-rail-brand">
        <span v-if="!workspaceCollapsed">工作空间</span>
        <button class="studio-workspace-toggle" type="button"
          :title="workspaceCollapsed ? '展开工作空间' : '折叠工作空间'"
          :aria-label="workspaceCollapsed ? '展开工作空间' : '折叠工作空间'"
          :aria-expanded="!workspaceCollapsed" aria-controls="studio-workspace-navigation"
          @click="toggleWorkspace">
          <TsIcon name="panelLeft" :size="19" />
        </button>
      </div>
      <nav id="studio-workspace-navigation">
        <button
          v-for="item in railItems"
          :key="item.id"
          class="studio-rail-item"
          :class="{ active: activeView === item.id }"
          type="button"
          :title="item.label"
          :aria-label="item.label"
          :aria-current="activeView === item.id ? 'page' : undefined"
          @click="activeView = item.id"
        >
          <TsIcon :name="item.icon" :size="25" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <button
        class="studio-rail-item studio-rail-settings"
        :class="{ active: settingsOpen }"
        type="button"
        title="工作室设置"
        aria-label="工作室设置"
        :aria-pressed="settingsOpen ? 'true' : 'false'"
        @click="settingsOpen = !settingsOpen"
      >
        <TsIcon name="settings" :size="25" />
        <span>设置</span>
      </button>
      <div class="studio-rail-avatar" aria-label="八千代春日工作室">
        <img :src="springBranch" alt="" aria-hidden="true" />
        <strong>八千代的工作室</strong>
        <em>春光正好，开始吧。</em>
      </div>
    </aside>
    <Transition name="studio-scrim">
      <button
        v-if="settingsOpen"
        class="studio-settings-scrim"
        type="button"
        aria-label="Close settings"
        @click="settingsOpen = false"
      ></button>
    </Transition>
    <Transition name="studio-settings-drawer">
      <StudioSettingsPanel v-if="settingsOpen" :initial-tab="settingsTab" @close="settingsOpen = false" />
    </Transition>
  </div>
</template>
