'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('gla', {
  group: {
    open: () => ipcRenderer.invoke('gla:group:open'),
    close: () => ipcRenderer.invoke('gla:group:close'),
    catalogue: () => ipcRenderer.invoke('gla:group:catalogue'),
    reply: request => ipcRenderer.invoke('gla:group:reply', request),
    voice: request => ipcRenderer.invoke('gla:group:voice', request),
    live: request => ipcRenderer.invoke('gla:group:live', request),
    transcribe: request => ipcRenderer.invoke('gla:group:transcribe', request),
    cancel: () => ipcRenderer.invoke('gla:group:cancel'),
    setIgnoreMouse: value => ipcRenderer.send('gla:group:ignore-mouse', Boolean(value)),
    onReset: callback => subscribe('gla:group:reset', callback),
    onStop: callback => subscribe('gla:group:stop', callback),
    showMenu: request => ipcRenderer.invoke('gla:group:menu', request),
    onMenuAction: callback => subscribe('gla:group:menu-action', callback),
  },
  // settings and secrets
  getSettings: () => ipcRenderer.invoke('gla:settings:get'),
  setSettings: patch => ipcRenderer.invoke('gla:settings:set', patch),
  onSettings: callback => subscribe('gla:settings', callback),
  setApiKey: key => ipcRenderer.invoke('gla:key:set', key),
  clearApiKey: () => ipcRenderer.invoke('gla:key:clear'),
  keyStatus: () => ipcRenderer.invoke('gla:key:status'),
  listModels: () => ipcRenderer.invoke('gla:models:list'),
  delegate: {
    login: provider => ipcRenderer.invoke('gla:delegate:login', provider),
    cancelLogin: provider => ipcRenderer.invoke('gla:delegate:cancel-login', provider),
    logout: provider => ipcRenderer.invoke('gla:delegate:logout', provider),
    saveXAIKey: key => ipcRenderer.invoke('gla:delegate:xai-key', key),
    clearXAIKey: () => ipcRenderer.invoke('gla:delegate:clear-xai-key'),
    models: () => ipcRenderer.invoke('gla:delegate:models'),
    answer: request => ipcRenderer.invoke('gla:delegate:answer', request),
    cancel: id => ipcRenderer.invoke('gla:delegate:cancel', id),
    test: () => ipcRenderer.invoke('gla:delegate:test'),
  },
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
  saveAppearance: (slug, selection) => ipcRenderer.invoke('gla:appearance:set', { slug, selection }),
  createLiveSession: (sdp, options) => ipcRenderer.invoke('gla:live:create', { sdp, ...options }),
  previewVoice: voice => ipcRenderer.invoke('gla:voice:preview', voice),
  stopVoicePreview: () => ipcRenderer.invoke('gla:voice:preview', ''),
  reportVoicePreview: state => ipcRenderer.send('gla:voice:preview-state', state),
  onVoicePreview: callback => subscribe('gla:voice:preview-state', callback),
  live: { heartbeat: active => ipcRenderer.send('gla:live:heartbeat', Boolean(active)) },
  // native right-click menu; main answers with an action id
  showMenu: state => ipcRenderer.invoke('gla:menu:show', state),
  onMenuAction: callback => subscribe('gla:menu-action', callback),
  onAvatarSuspended: callback => subscribe('gla:avatar:suspended', callback),
  // window controls for the avatar window
  window: {
    remember: bounds => ipcRenderer.send('gla:window:remember', bounds),
    moveBy: (dx, dy) => ipcRenderer.send('gla:window:move-by', { dx, dy }),
    resizeTo: (width, height) => ipcRenderer.invoke('gla:window:resize', { width, height }),
    bounds: () => ipcRenderer.invoke('gla:window:bounds'),
    recover: () => ipcRenderer.invoke('gla:window:recover'),
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
