import { createApp } from 'vue';
import App from './App.vue';
import { configureAssetCssVars } from '../../src/frontend/utils/assetUrl';
import { installYachiyoMusicWindowApi } from '../../src/frontend/services/room/yachiyoMusicAdapter';
import './style.css';

configureAssetCssVars();
installYachiyoMusicWindowApi();

const app = createApp(App);

app.config.errorHandler = (err, vm, info) => {
  console.error('Live2D Studio error:', err, info);
};

app.mount('#app');
