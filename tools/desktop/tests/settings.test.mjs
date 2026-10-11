import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('managed Milvus migrates once to built-in memory without changing the database', async () => {
  const data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const settings = await server.ssrLoadModule('/src/frontend/services/room/roomSettings.js');
    assert.equal(settings.DEFAULT_ROOM_MEMORY_SETTINGS.provider, 'sqlite');
    data.set('roomMemorySettings', JSON.stringify({ enabled: true, provider: 'sqlite-milvus', milvusEnabled: true, milvusManaged: true, databasePath: '/preserved/memory.sqlite', vaultPath: '/preserved/vault' }));
    const migrated = settings.readRoomMemorySettings();
    assert.equal(migrated.provider, 'sqlite');
    assert.equal(migrated.milvusEnabled, false);
    assert.equal(migrated.milvusManaged, false);
    assert.equal(migrated.databasePath, '/preserved/memory.sqlite');
    assert.equal(migrated.vaultPath, '/preserved/vault');
    settings.writeRoomMemorySettings({ ...migrated, provider: 'sqlite-milvus', milvusEnabled: true, milvusManaged: false });
    assert.equal(settings.readRoomMemorySettings().provider, 'sqlite-milvus', 'explicit later external choice should persist');
  } finally { await server.close(); delete globalThis.localStorage; }
});
