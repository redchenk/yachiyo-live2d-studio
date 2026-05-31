<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import Live2DPage from '../../src/frontend/pages/Live2DPage.vue';
import TsIcon from '../../src/frontend/components/TsIcon.vue';
import { readRoomLLMSettings, readRoomTTSSettings } from '../../src/frontend/services/room/roomSettings';
import StudioSettingsPanel from './components/StudioSettingsPanel.vue';

function shouldOpenSettingsOnBoot() {
  const llm = readRoomLLMSettings();
  const tts = readRoomTTSSettings();
  return !llm.apiKey || !llm.apiUrl || (tts.enabled && !tts.apiUrl);
}

const settingsOpen = ref(shouldOpenSettingsOnBoot());
const railItems = [
  { id: 'live', label: '直播', icon: 'home', active: true },
  { id: 'model', label: '模型', icon: 'userRound' },
  { id: 'scene', label: '场景', icon: 'image' },
  { id: 'assets', label: '资源', icon: 'package' }
];

onMounted(() => {
  document.body.classList.add('vue-live2d-route');
});

onUnmounted(() => {
  document.body.classList.remove('vue-live2d-route');
});
</script>

<template>
  <div class="studio-app-shell">
    <Live2DPage />
    <aside class="studio-left-rail" aria-label="Studio navigation">
      <div class="studio-rail-brand">
        <span>Y</span>
      </div>
      <nav>
        <button
          v-for="item in railItems"
          :key="item.id"
          class="studio-rail-item"
          :class="{ active: item.active }"
          type="button"
          :title="item.label"
          :aria-current="item.active ? 'page' : undefined"
        >
          <TsIcon :name="item.icon" :size="25" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <button
        class="studio-rail-item studio-rail-settings"
        :class="{ active: settingsOpen }"
        type="button"
        title="Settings"
        aria-label="Settings"
        :aria-pressed="settingsOpen ? 'true' : 'false'"
        @click="settingsOpen = !settingsOpen"
      >
        <TsIcon name="settings" :size="25" />
        <span>设置</span>
      </button>
      <div class="studio-rail-avatar" aria-label="Yachiyo profile">
        <TsIcon name="sparkles" :size="24" />
        <strong>Yachiyo</strong>
        <em>Pro</em>
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
      <StudioSettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
    </Transition>
  </div>
</template>
