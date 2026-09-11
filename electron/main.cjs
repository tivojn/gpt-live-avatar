'use strict';
// GPT-Live Avatar: a desk avatar (Tia) on OpenAI GPT-Live-1.
// The main process owns the API key and session creation; the renderer owns
// WebRTC, the 3D avatar and the overhead bubble.
const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, screen, session: electronSession, Menu } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const WEB = path.join(__dirname, '..', 'web');
const DEFAULT_OPENCLAM_AVATAR = path.join(os.homedir(), 'Library', 'Application Support', 'OpenClam Studio', 'backend-data', 'avatars', 'tia');
const LIVE_MODEL = 'gpt-live-1';
const DEFAULT_BACKEND_MODEL = 'gpt-5.6-terra';
const RECOMMENDED_BACKENDS = ['gpt-5.6-terra', 'gpt-5.6-luna'];
const VOICES = ['marin', 'beacon', 'bossa', 'cinder', 'delta', 'gleam', 'meridian', 'quartz', 'ripple', 'stone', 'tempo', 'vesper', 'willow'];
const QUALITIES = ['friendly', 'balanced', 'best'];

const DEFAULTS = {
  backendModel: DEFAULT_BACKEND_MODEL,
  voice: 'marin',
  quality: 'balanced',
  avatarDir: '',
  personaName: 'Tia',
  persona: 'You are Tia, a warm, playful desk companion who loves to move.',
  opacity: 1,
  windowWidth: 380,
  windowHeight: 640,
  orbitYaw: 0,
  orbitPitch: 0,
  zoom: 1,
  bubble: true,
};

let config = { ...DEFAULTS };
let avatarWindow = null;
let settingsWindow = null;
let serverOrigin = '';

// ---------------------------------------------------------------- config
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const keyPath = () => path.join(app.getPath('userData'), 'openai-key.bin');

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    config = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch { config = { ...DEFAULTS }; }
  if (!VOICES.includes(config.voice)) config.voice = DEFAULTS.voice;
  if (!QUALITIES.includes(config.quality)) config.quality = DEFAULTS.quality;
  if (!config.avatarDir && fs.existsSync(path.join(DEFAULT_OPENCLAM_AVATAR, 'manifest.json'))) config.avatarDir = DEFAULT_OPENCLAM_AVATAR;
}
function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}
function publicSettings() {
  return { ...config, voices: VOICES, qualities: QUALITIES, liveModel: LIVE_MODEL, recommendedBackends: RECOMMENDED_BACKENDS, hasKey: hasApiKey(), avatar: avatarInfo() };
}
function broadcastSettings() {
  const value = publicSettings();
  for (const w of [avatarWindow, settingsWindow]) if (w && !w.isDestroyed()) w.webContents.send('gla:settings', value);
}

// ---------------------------------------------------------------- API key
function hasApiKey() { return fs.existsSync(keyPath()); }
function readApiKey() {
  if (!hasApiKey()) return '';
  const blob = fs.readFileSync(keyPath());
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(blob) : blob.toString('utf8');
}
function writeApiKey(key) {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8');
  fs.mkdirSync(path.dirname(keyPath()), { recursive: true });
  fs.writeFileSync(keyPath(), data, { mode: 0o600 });
}
async function fetchModels(key) {
  const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (response.status === 401) throw new Error('OpenAI rejected this API key.');
  if (!response.ok) throw new Error(`OpenAI answered ${response.status} while listing models.`);
  const body = await response.json();
  return (body.data || []).map(m => m.id);
}
function backendCandidates(ids) {
  // Responses models the docs point at for GPT-Live delegation: the GPT-5
  // family, without code, search, chat-latest or dated snapshot aliases.
  const wanted = ids.filter(id => /^gpt-5(\.\d+)?(-[a-z]+)?$/.test(id) && !/codex|search|chat/.test(id));
  const uniq = [...new Set([...RECOMMENDED_BACKENDS.filter(id => ids.includes(id)), ...wanted])];
  return uniq;
}

// ---------------------------------------------------------------- avatar package
function avatarInfo() {
  const dir = config.avatarDir;
  const result = { dir, ok: false, name: '', clips: 0, modelBytes: 0, problem: '' };
  if (!dir) { result.problem = 'No avatar folder selected.'; return result; }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (manifest.renderer !== '3d' || !manifest.model) { result.problem = 'This folder is not a 3D avatar package.'; return result; }
    const model = path.join(dir, manifest.model);
    result.modelBytes = fs.statSync(model).size;
    result.name = String(manifest.name || 'Avatar');
    result.manifest = manifest;
    // Prefer the published runtime bundle: its split "resident" model streams
    // textures at the size the quality setting asks for, which is what makes
    // the resource-friendly mode cheap. Fall back to the plain GLB.
    const resident = path.join(dir, 'runtime', 'resident', 'model.gltf');
    result.residentAvailable = fs.existsSync(resident);
    result.modelURL = result.residentAvailable ? '/avatar/runtime/resident/model.gltf' : `/avatar/${manifest.model}`;
    const runtimeMotions = path.join(dir, 'runtime', 'motions', 'library.json');
    result.motionsURL = fs.existsSync(runtimeMotions) ? '/avatar/runtime/motions/library.json' : '/avatar/motions/library.json';
    result.pose = manifest.pose || 'relaxed'; result.yaw = Number(manifest.yaw) || 0;
    result.visemes = Array.isArray(manifest.visemes) ? manifest.visemes : ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou'];
    try {
      const library = JSON.parse(fs.readFileSync(path.join(dir, 'motions', 'library.json'), 'utf8'));
      result.clips = (library.clips || []).length;
      result.clipLabels = (library.clips || []).map(c => String(c.label || c.id || '').replace(/[^\w -]/g, '').slice(0, 60)).filter(Boolean);
    } catch { result.clips = 0; result.clipLabels = []; }
    result.ok = true;
  } catch (error) { result.problem = `Cannot read the avatar package: ${error.message}`; }
  return result;
}

// ---------------------------------------------------------------- local static server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };
function safeJoin(root, rel) {
  const target = path.normalize(path.join(root, rel));
  if (!target.startsWith(path.normalize(root) + path.sep) && target !== path.normalize(root)) return null;
  return target;
}
function startServer() {
  return new Promise(resolve => {
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      let root = WEB; let rel = decodeURIComponent(url.pathname);
      if (rel.startsWith('/avatar/')) { root = config.avatarDir; rel = rel.slice('/avatar/'.length); if (!root) { response.writeHead(404); response.end(); return; } }
      if (rel === '/' || rel === '') rel = 'avatar.html';
      const file = safeJoin(root, rel);
      if (!file) { response.writeHead(403); response.end(); return; }
      let stat;
      try { stat = await fsp.stat(file); } catch { response.writeHead(404); response.end(); return; }
      if (!stat.isFile()) { response.writeHead(404); response.end(); return; }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, { ...headers, 'Content-Length': stat.size });
      if (request.method === 'HEAD') { response.end(); return; }
      fs.createReadStream(file).pipe(response);
    });
    server.listen(0, '127.0.0.1', () => { serverOrigin = `http://127.0.0.1:${server.address().port}`; resolve(serverOrigin); });
  });
}

// ---------------------------------------------------------------- live session
function liveInstructions() {
  const info = avatarInfo();
  const labels = (info.clipLabels || []).join(', ');
  return [
    `You are ${config.personaName}, the voice of an animated 3D companion standing on the user's desk. Speak warmly and naturally at an unhurried pace, in plain spoken language. Be concise by default, usually one to three sentences, and ask only one question at a time. Never use markdown, lists, code or emojis, and never describe your voice, models or delivery. Reply in the language the user speaks.`,
    'Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.',
    'Interruption policy: Stop speaking when the user interrupts. Listen to what they say.',
    labels ? `You embody the on-screen avatar. The app can play these installed body animations: ${labels}. When the user asks you to perform one, or a demonstration clearly fits the conversation, say a natural affirmative intention that names the animation, such as "Sure, I'll try a kung fu punch" or "I'll do a little dance". The app follows your spoken intention, not the user's words. You can also sit down, stand up, wave, make a heart, and stay still; say those the same way, such as "I'll sit down now". You can walk around or run around the screen, follow the cursor, come closer toward the camera, step back, and stay still; these move you across the whole screen, so say the intention naturally, such as "I'll run around the screen" or "I'll come closer". Repeated closer requests approach further. The screen is a stage: top is farthest and smallest, bottom is nearest and largest, and you can walk directly to any corner, top, bottom, left, right or center; for "go to the upper right corner" say "I'll walk to the upper-right corner" and do it. Never deny having an installed animation, never invent one that is not installed, and never claim real physical abilities.` : '',
    'Delegation policy:\nBackend tools:\n- Knowledge assistant: answers questions that need careful reasoning or knowledge you are unsure about.\n\nDelegate to the backend when:\n- The request needs careful reasoning, detailed facts or figures you are not confident about.\n\nDo not delegate to the backend when:\n- It is a greeting, small talk, a feeling, a compliment or something you can answer from the conversation.\n- The user asks for an animation, pose, dance, gesture or movement: answer yourself with the affirmative intention described above.\n\nDelegate before giving an answer that depends on backend work. Do not guess the result while waiting.',
    `Persona notes from the user: ${config.persona}`,
  ].filter(Boolean).join('\n\n');
}
function backendInstructions() {
  return `You are the backend for ${config.personaName}, the voice of an animated desk companion. Answer delegated questions with short, plain-language results the voice model can read out: no markdown, lists, code or emojis. Be accurate and candid about uncertainty. Persona notes from the user: ${config.persona}`;
}
async function createLiveSession(sdp) {
  if (typeof sdp !== 'string' || !sdp.trim()) throw new Error('An SDP offer is required.');
  const apiKey = readApiKey();
  if (!apiKey) throw new Error('Add your OpenAI API key in Settings first.');
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  const result = await client.live.create({
    session: {
      model: LIVE_MODEL,
      instructions: liveInstructions(),
      audio: { output: { voice: config.voice } },
      delegation: { type: 'responses', responses: { model: config.backendModel, instructions: backendInstructions(), reasoning: { effort: 'low' }, max_output_tokens: 600 } },
    },
    transport: { type: 'webrtc', sdp },
  });
  return { id: result.id, sdp: result.transport && result.transport.sdp ? result.transport.sdp : result.sdp };
}

// ---------------------------------------------------------------- windows
function createAvatarWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.round(config.windowWidth), height = Math.round(config.windowHeight);
  avatarWindow = new BrowserWindow({
    width, height,
    x: Number.isFinite(config.windowX) ? config.windowX : workArea.x + workArea.width - width - 24,
    y: Number.isFinite(config.windowY) ? config.windowY : workArea.y + workArea.height - height - 24,
    transparent: true, frame: false, hasShadow: false, resizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000', title: 'GPT-Live Avatar',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  avatarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  avatarWindow.setAlwaysOnTop(true, 'floating');
  avatarWindow.loadURL(`${serverOrigin}/avatar.html`);
  avatarWindow.on('moved', () => { const b = avatarWindow.getBounds(); config.windowX = b.x; config.windowY = b.y; saveConfig(); });
  avatarWindow.on('closed', () => { avatarWindow = null; });
}
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 620, height: 780, title: 'GPT-Live Avatar Settings', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  settingsWindow.loadURL(`${serverOrigin}/settings.html`);
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('gla:settings:get', () => publicSettings());
ipcMain.handle('gla:settings:set', (_event, patch) => {
  if (!patch || typeof patch !== 'object') return publicSettings();
  const allowed = ['backendModel', 'voice', 'quality', 'avatarDir', 'personaName', 'persona', 'opacity', 'windowWidth', 'windowHeight', 'orbitYaw', 'orbitPitch', 'zoom', 'bubble'];
  for (const key of allowed) if (key in patch) config[key] = patch[key];
  if (!VOICES.includes(config.voice)) config.voice = DEFAULTS.voice;
  if (!QUALITIES.includes(config.quality)) config.quality = DEFAULTS.quality;
  config.opacity = Math.min(1, Math.max(0.15, Number(config.opacity) || 1));
  config.windowWidth = Math.min(1600, Math.max(160, Math.round(Number(config.windowWidth) || DEFAULTS.windowWidth)));
  config.windowHeight = Math.min(2000, Math.max(200, Math.round(Number(config.windowHeight) || DEFAULTS.windowHeight)));
  saveConfig(); broadcastSettings();
  return publicSettings();
});
ipcMain.handle('gla:key:status', () => ({ hasKey: hasApiKey() }));
ipcMain.handle('gla:key:clear', () => { try { fs.unlinkSync(keyPath()); } catch {} broadcastSettings(); return { hasKey: false }; });
ipcMain.handle('gla:key:set', async (_event, key) => {
  const value = String(key || '').trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(value)) return { ok: false, error: 'That does not look like an OpenAI API key (it should start with sk-).' };
  let ids;
  try { ids = await fetchModels(value); } catch (error) { return { ok: false, error: error.message }; }
  writeApiKey(value);
  const backends = backendCandidates(ids);
  if (!backends.includes(config.backendModel)) config.backendModel = backends[0] || DEFAULT_BACKEND_MODEL;
  saveConfig(); broadcastSettings();
  return { ok: true, hasLive: ids.includes(LIVE_MODEL), backends, modelCount: ids.length };
});
ipcMain.handle('gla:models:list', async () => {
  const key = readApiKey();
  if (!key) return { ok: false, error: 'Add an API key first.', backends: RECOMMENDED_BACKENDS };
  try { const ids = await fetchModels(key); return { ok: true, backends: backendCandidates(ids), hasLive: ids.includes(LIVE_MODEL) }; }
  catch (error) { return { ok: false, error: error.message, backends: RECOMMENDED_BACKENDS }; }
});
ipcMain.handle('gla:avatar:info', () => avatarInfo());
ipcMain.handle('gla:avatar:choose', async () => {
  const picked = await dialog.showOpenDialog({ title: 'Choose a 3D avatar package folder', properties: ['openDirectory'], defaultPath: config.avatarDir || DEFAULT_OPENCLAM_AVATAR });
  if (picked.canceled || !picked.filePaths[0]) return avatarInfo();
  config.avatarDir = picked.filePaths[0]; saveConfig(); broadcastSettings();
  return avatarInfo();
});
ipcMain.handle('gla:live:create', async (_event, sdp) => {
  try { return { ok: true, ...(await createLiveSession(sdp)) }; }
  catch (error) { const status = error && error.status; return { ok: false, error: status === 401 ? 'OpenAI rejected the stored API key.' : status === 403 ? 'This API key has no access to GPT-Live.' : (error && error.message) || 'Live session creation failed.' }; }
});
ipcMain.on('gla:window:move-by', (_event, { dx, dy }) => {
  if (!avatarWindow) return;
  const [x, y] = avatarWindow.getPosition();
  avatarWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
});
ipcMain.handle('gla:window:resize', (_event, { width, height }) => {
  if (!avatarWindow) return null;
  const w = Math.min(1600, Math.max(160, Math.round(width))), h = Math.min(2000, Math.max(200, Math.round(height)));
  const [x, y] = avatarWindow.getPosition(); const [ow, oh] = avatarWindow.getSize();
  // grow/shrink around the bottom center so her feet stay put
  avatarWindow.setBounds({ x: Math.round(x + (ow - w) / 2), y: Math.round(y + (oh - h)), width: w, height: h });
  config.windowWidth = w; config.windowHeight = h; saveConfig();
  return avatarWindow.getBounds();
});
ipcMain.handle('gla:window:bounds', () => avatarWindow ? avatarWindow.getBounds() : null);
// Stage mode: the renderer grows the window to the whole display so a lunge or
// a walk can reach anywhere on the screen, then shrinks it back around her.
ipcMain.handle('gla:window:work-area', () => {
  if (!avatarWindow) return null;
  const b = avatarWindow.getBounds();
  return screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea;
});
ipcMain.handle('gla:window:set-bounds', (_event, bounds) => {
  if (!avatarWindow || !bounds) return null;
  const w = Math.min(4000, Math.max(160, Math.round(bounds.width))), h = Math.min(3000, Math.max(200, Math.round(bounds.height)));
  avatarWindow.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: w, height: h });
  if (bounds.remember) { config.windowWidth = w; config.windowHeight = h; config.windowX = Math.round(bounds.x); config.windowY = Math.round(bounds.y); saveConfig(); }
  return avatarWindow.getBounds();
});
ipcMain.on('gla:window:ignore-mouse', (_event, ignore) => { if (avatarWindow) avatarWindow.setIgnoreMouseEvents(ignore, { forward: true }); });
ipcMain.handle('gla:open-settings', () => { openSettingsWindow(); return true; });
ipcMain.handle('gla:quit', () => { app.quit(); return true; });

// ---------------------------------------------------------------- app
app.whenReady().then(async () => {
  loadConfig();
  // Development convenience: seed the encrypted key store from the environment
  // once, so a test run never needs the key typed into the UI.
  if (process.env.GLA_OPENAI_KEY && !hasApiKey()) { try { writeApiKey(process.env.GLA_OPENAI_KEY.trim()); } catch {} }
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  await startServer();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ label: 'Settings…', accelerator: 'Cmd+,', click: openSettingsWindow }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
  ]));
  createAvatarWindow();
  if (!hasApiKey() || !avatarInfo().ok) openSettingsWindow();
  app.on('activate', () => { if (!avatarWindow) createAvatarWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
});
