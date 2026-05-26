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
    <div class="studio-floating-toolbar" aria-label="Studio tools">
      <button
        class="studio-icon-btn"
        type="button"
        title="Settings"
        aria-label="Settings"
        :aria-pressed="settingsOpen ? 'true' : 'false'"
        @click="settingsOpen = !settingsOpen"
      >
        <TsIcon name="settings" :size="19" />
      </button>
    </div>
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
