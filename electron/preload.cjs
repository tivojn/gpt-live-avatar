'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('gla', {
  // settings and secrets
  getSettings: () => ipcRenderer.invoke('gla:settings:get'),
  setSettings: patch => ipcRenderer.invoke('gla:settings:set', patch),
  onSettings: callback => subscribe('gla:settings', callback),
  setApiKey: key => ipcRenderer.invoke('gla:key:set', key),
  clearApiKey: () => ipcRenderer.invoke('gla:key:clear'),
  keyStatus: () => ipcRenderer.invoke('gla:key:status'),
  listModels: () => ipcRenderer.invoke('gla:models:list'),
  // avatar package
  avatarInfo: () => ipcRenderer.invoke('gla:avatar:info'),
  chooseAvatarFolder: () => ipcRenderer.invoke('gla:avatar:choose'),
  // live session: the renderer owns WebRTC, main owns the API key
  createLiveSession: sdp => ipcRenderer.invoke('gla:live:create', sdp),
  // window controls for the avatar window
  window: {
    moveBy: (dx, dy) => ipcRenderer.send('gla:window:move-by', { dx, dy }),
    resizeTo: (width, height) => ipcRenderer.invoke('gla:window:resize', { width, height }),
    bounds: () => ipcRenderer.invoke('gla:window:bounds'),
    setIgnoreMouse: ignore => ipcRenderer.send('gla:window:ignore-mouse', Boolean(ignore)),
  },
  openSettings: () => ipcRenderer.invoke('gla:open-settings'),
  quit: () => ipcRenderer.invoke('gla:quit'),
  isElectron: true,
});
