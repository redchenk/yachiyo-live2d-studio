<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import TsIcon from '@frontend/components/TsIcon.vue';
import {
  readRoomMinecraftSettings,
  writeRoomMinecraftSettings
} from '@frontend/services/room/roomSettings';
import {
  configureLive2DMinecraft,
  disconnectLive2DMinecraft,
  executeLive2DMinecraftCommand,
  readLive2DMinecraftStatus
} from '@frontend/services/room/live2dMinecraft';

const minecraft = reactive(readRoomMinecraftSettings());
const status = ref(null);
const busy = ref('');
const notice = ref('');
const action = reactive({ type: 'observe', target: '', x: 0, y: 64, z: 0, count: 1 });
let pollTimer = 0;

const state = computed(() => status.value?.state || {});
const phase = computed(() => state.value.phase || (minecraft.enabled ? 'offline' : 'disabled'));
const position = computed(() => {
  const value = state.value.position;
  return value ? `${value.x}, ${value.y}, ${value.z}` : '—';
});
const inventory = computed(() => (state.value.inventory || []).slice(0, 18));
const nearbyPlayers = computed(() => state.value.nearby?.players || []);
const recentEvents = computed(() => (state.value.recentEvents || []).slice().reverse());
const canConnect = computed(() => minecraft.trustedServerAcknowledged && minecraft.host && !busy.value);

function message(value) {
  notice.value = String(value || '');
}

function savedSettings(patch = {}) {
  const saved = writeRoomMinecraftSettings({ ...minecraft, ...patch });
  Object.assign(minecraft, saved);
  window.dispatchEvent(new CustomEvent('tsukuyomi:studio-settings-saved', { detail: { minecraft: saved } }));
  return saved;
}

async function refresh({ quiet = false } = {}) {
  if (!minecraft.enabled) return;
  try {
    status.value = await readLive2DMinecraftStatus();
    if (!quiet) message('状态已刷新');
  } catch (error) {
    if (!quiet) message(error?.message || '无法读取 Minecraft 状态');
  }
}

async function connect() {
  if (!canConnect.value) return;
  busy.value = 'connect';
  try {
    status.value = await configureLive2DMinecraft(savedSettings({ enabled: true }));
    message(minecraft.auth === 'microsoft' ? '正在连接；首次登录请查看设备码' : '连接请求已发送');
  } catch (error) {
    message(error?.message || '连接失败');
  } finally {
    busy.value = '';
  }
}

async function disconnect() {
  busy.value = 'disconnect';
  try {
    status.value = await disconnectLive2DMinecraft();
    Object.assign(minecraft, savedSettings({ enabled: false }));
    message('Minecraft 代理已断开');
  } catch (error) {
    message(error?.message || '断开失败');
  } finally {
    busy.value = '';
  }
}

function actionPayload() {
  if (action.type === 'observe' || action.type === 'stop') return { action: action.type };
  if (action.type === 'move') return { action: 'move', x: action.x, y: action.y, z: action.z, range: 2 };
  if (action.type === 'follow') return { action: 'follow', player: action.target, distance: 3 };
  if (action.type === 'collect') return { action: 'collect', block: action.target, count: action.count, radius: 24 };
  if (action.type === 'craft') return { action: 'craft', item: action.target, count: action.count };
  if (action.type === 'attack') return { action: 'attack', target: action.target, radius: 8 };
  return { action: 'chat', message: action.target };
}

async function runAction() {
  if (busy.value) return;
  busy.value = 'action';
  try {
    const result = await executeLive2DMinecraftCommand(actionPayload(), { settings: savedSettings() });
    message(result.status === 'queued' ? `动作已入队：${result.taskId}` : `动作：${result.status || '完成'}`);
    await refresh({ quiet: true });
  } catch (error) {
    message(error?.message || '动作失败');
  } finally {
    busy.value = '';
  }
}

onMounted(async () => {
  if (minecraft.enabled) {
    try { status.value = await configureLive2DMinecraft(minecraft); } catch (error) { message(error?.message); }
  }
  pollTimer = window.setInterval(() => refresh({ quiet: true }), 1800);
});

onUnmounted(() => window.clearInterval(pollTimer));
</script>

<template>
  <main class="minecraft-page">
    <header class="minecraft-header">
      <div>
        <span class="minecraft-kicker">YACHIYO AGENT</span>
        <h1>Minecraft Java</h1>
        <p>LLM 负责选择动作，本地 Mineflayer 代理负责安全执行与状态回传。</p>
      </div>
      <span class="phase-pill" :data-phase="phase"><i></i>{{ phase }}</span>
    </header>

    <section class="minecraft-grid">
      <article class="minecraft-card connect-card">
        <h2><TsIcon name="gamepad" :size="20" />连接</h2>
        <div class="field-grid">
          <label><span>服务器</span><input v-model="minecraft.host" type="text" spellcheck="false"></label>
          <label><span>端口</span><input v-model.number="minecraft.port" type="number" min="1" max="65535"></label>
          <label><span>用户名</span><input v-model="minecraft.username" type="text" spellcheck="false"></label>
          <label><span>登录</span><select v-model="minecraft.auth"><option value="offline">Offline</option><option value="microsoft">Microsoft</option></select></label>
        </div>
        <label class="trust-row"><input v-model="minecraft.trustedServerAcknowledged" type="checkbox"><span>这是我信任的私人/自建服务器</span></label>
        <label class="trust-row"><input v-model="minecraft.autonomousPlay" type="checkbox"><span>允许八千代在直播空闲时自主决定 MC 动作</span></label>
        <div class="button-row">
          <button class="primary" type="button" :disabled="!canConnect" @click="connect">{{ busy === 'connect' ? '连接中…' : '连接' }}</button>
          <button type="button" :disabled="Boolean(busy)" @click="disconnect">断开</button>
          <button type="button" :disabled="Boolean(busy)" @click="refresh()">刷新</button>
        </div>
        <div v-if="state.microsoftLogin?.userCode" class="login-code">
          <span>Microsoft 设备码</span>
          <strong>{{ state.microsoftLogin.userCode }}</strong>
          <a :href="state.microsoftLogin.verificationUri" target="_blank" rel="noreferrer">打开登录页</a>
        </div>
      </article>

      <article class="minecraft-card telemetry-card">
        <h2><TsIcon name="activity" :size="20" />实时状态</h2>
        <div class="stat-grid">
          <div><span>坐标</span><strong>{{ position }}</strong></div>
          <div><span>生命 / 饥饿</span><strong>{{ state.health ?? 0 }} / {{ state.food ?? 0 }}</strong></div>
          <div><span>维度</span><strong>{{ state.dimension || '—' }}</strong></div>
          <div><span>任务</span><strong>{{ state.activeTask?.action?.action || 'idle' }} +{{ state.taskQueueDepth || 0 }}</strong></div>
        </div>
        <div class="chips"><span v-for="item in inventory" :key="item.name">{{ item.name }} ×{{ item.count }}</span><em v-if="!inventory.length">背包为空或未连接</em></div>
        <div class="players"><span>附近玩家</span><strong>{{ nearbyPlayers.map((item) => `${item.name} ${item.distance}m`).join(' · ') || '无' }}</strong></div>
      </article>

      <article class="minecraft-card action-card">
        <h2><TsIcon name="play" :size="20" />手动测试</h2>
        <select v-model="action.type">
          <option value="observe">观察</option><option value="move">移动</option><option value="follow">跟随玩家</option>
          <option value="collect">收集方块</option><option value="craft">合成</option><option value="attack">攻击目标</option>
          <option value="chat">聊天</option><option value="stop">紧急停止</option>
        </select>
        <div v-if="action.type === 'move'" class="coords">
          <input v-model.number="action.x" type="number" placeholder="X"><input v-model.number="action.y" type="number" placeholder="Y"><input v-model.number="action.z" type="number" placeholder="Z">
        </div>
        <input v-else-if="!['observe', 'stop'].includes(action.type)" v-model="action.target" type="text" spellcheck="false" :placeholder="action.type === 'chat' ? '安全聊天内容（禁止 / 命令）' : '玩家 / 方块 / 物品 / 生物注册名'">
        <label v-if="['collect', 'craft'].includes(action.type)" class="count-row"><span>数量</span><input v-model.number="action.count" type="number" min="1" max="16"></label>
        <button class="primary" type="button" :disabled="Boolean(busy) || !minecraft.enabled" @click="runAction">执行动作</button>
        <p>{{ notice || '动作异步执行，不会阻塞直播字幕、TTS 或弹幕回复。' }}</p>
      </article>

      <article class="minecraft-card events-card">
        <h2><TsIcon name="list" :size="20" />代理事件</h2>
        <ol><li v-for="(item, index) in recentEvents" :key="`${item.at}-${index}`"><time>{{ new Date(item.at).toLocaleTimeString() }}</time><strong>{{ item.type }}</strong><span>{{ item.message || item.reason || item.action || '' }}</span></li></ol>
      </article>
    </section>
  </main>
</template>

<style scoped>
.minecraft-page{height:100%;overflow:auto;padding:36px 42px 48px 132px;color:#f7f2ff;background:radial-gradient(circle at 85% 4%,rgba(96,217,148,.15),transparent 32%),linear-gradient(145deg,#10141d,#151325 62%,#101820)}
.minecraft-header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;max-width:1240px;margin:0 auto 28px}.minecraft-kicker{color:#84e6aa;font-size:12px;font-weight:800;letter-spacing:.22em}.minecraft-header h1{margin:5px 0 6px;font-size:34px}.minecraft-header p{margin:0;color:#aaa8bd}.phase-pill{display:flex;align-items:center;gap:8px;padding:9px 14px;border:1px solid #484759;border-radius:999px;background:#1b1c27;text-transform:uppercase;font-size:12px;font-weight:800}.phase-pill i{width:8px;height:8px;border-radius:50%;background:#a5a3b0}.phase-pill[data-phase=ready] i{background:#72e69e;box-shadow:0 0 13px #72e69e}.phase-pill[data-phase=error] i{background:#ff7285}.minecraft-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:1240px;margin:auto}.minecraft-card{padding:22px;border:1px solid rgba(255,255,255,.09);border-radius:18px;background:rgba(28,29,42,.88);box-shadow:0 18px 45px rgba(0,0,0,.2)}.minecraft-card h2{display:flex;align-items:center;gap:9px;margin:0 0 18px;font-size:17px}.field-grid,.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field-grid label,.count-row{display:grid;gap:6px}.field-grid span,.count-row span,.stat-grid span,.players span,.login-code span{font-size:12px;color:#9d9aac}.minecraft-card input,.minecraft-card select{width:100%;box-sizing:border-box;border:1px solid #464556;border-radius:10px;padding:10px 11px;color:#fff;background:#14151e;outline:none}.minecraft-card input:focus,.minecraft-card select:focus{border-color:#79dba0}.trust-row{display:flex;align-items:center;gap:9px;margin:16px 0;color:#d1cedb;font-size:13px}.trust-row input{width:auto}.button-row{display:flex;gap:9px}.minecraft-card button{border:1px solid #4c4a5c;border-radius:10px;padding:9px 15px;color:#ddd;background:#272735;cursor:pointer}.minecraft-card button.primary{border-color:#74d99c;color:#0d2115;background:#7be2a4;font-weight:800}.minecraft-card button:disabled{opacity:.4;cursor:not-allowed}.login-code{display:flex;align-items:center;gap:12px;margin-top:16px;padding:12px;border-radius:11px;background:#232b28}.login-code strong{font-size:20px;letter-spacing:.12em}.login-code a{margin-left:auto;color:#8be6ae}.stat-grid div{padding:12px;border-radius:11px;background:#151620}.stat-grid strong{display:block;margin-top:5px}.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:15px}.chips span{padding:5px 8px;border-radius:7px;background:#242836;color:#d6d4df;font-size:11px}.chips em{color:#777585;font-style:normal}.players{display:grid;gap:5px;margin-top:15px}.action-card{display:grid;gap:12px}.action-card h2{margin-bottom:4px}.coords{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.count-row{grid-template-columns:auto 90px;align-items:center}.action-card p{min-height:20px;margin:0;color:#aaa8b8;font-size:12px}.events-card ol{list-style:none;margin:0;padding:0;max-height:250px;overflow:auto}.events-card li{display:grid;grid-template-columns:76px 150px 1fr;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px}.events-card time,.events-card span{color:#8d8a9b}@media(max-width:900px){.minecraft-page{padding:26px 24px 90px 92px}.minecraft-grid{grid-template-columns:1fr}.minecraft-header{align-items:flex-start;flex-direction:column}}
</style>
