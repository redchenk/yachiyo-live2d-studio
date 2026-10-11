const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('yachiyoDesktop', Object.freeze({ embeddedMemory: true, platform: process.platform }));
