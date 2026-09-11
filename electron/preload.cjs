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
  selectAvatar: slug => ipcRenderer.invoke('gla:avatar:select', slug),
  useBundledAvatar: () => ipcRenderer.invoke('gla:avatar:use-bundled'),
  // texture tiers and downloadable avatars (GitHub release), with progress
  assets: {
    status: slug => ipcRenderer.invoke('gla:assets:status', slug),
    refresh: () => ipcRenderer.invoke('gla:assets:refresh'),
    download: (slug, tier) => ipcRenderer.invoke('gla:assets:download', { slug, tier }),
    cancel: () => ipcRenderer.invoke('gla:assets:cancel'),
    remove: (slug, tier) => ipcRenderer.invoke('gla:assets:remove', { slug, tier }),
    onProgress: callback => subscribe('gla:assets:progress', callback),
  },
  // live session: the renderer owns WebRTC, main owns the API key
  createLiveSession: sdp => ipcRenderer.invoke('gla:live:create', sdp),
  live: { heartbeat: active => ipcRenderer.send('gla:live:heartbeat', Boolean(active)) },
  // native right-click menu; main answers with an action id
  showMenu: state => ipcRenderer.invoke('gla:menu:show', state),
  onMenuAction: callback => subscribe('gla:menu-action', callback),
  // window controls for the avatar window
  window: {
    moveBy: (dx, dy) => ipcRenderer.send('gla:window:move-by', { dx, dy }),
    resizeTo: (width, height) => ipcRenderer.invoke('gla:window:resize', { width, height }),
    bounds: () => ipcRenderer.invoke('gla:window:bounds'),
    workArea: () => ipcRenderer.invoke('gla:window:work-area'),
    setBounds: bounds => ipcRenderer.invoke('gla:window:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('gla:window:ignore-mouse', Boolean(ignore)),
  },
  openSettings: () => ipcRenderer.invoke('gla:open-settings'),
  mic: {
    status: () => ipcRenderer.invoke('gla:mic:status'),
    ask: () => ipcRenderer.invoke('gla:mic:ask'),
    openPrivacy: () => ipcRenderer.invoke('gla:mic:open-privacy'),
  },
  quit: () => ipcRenderer.invoke('gla:quit'),
  isElectron: true,
});
