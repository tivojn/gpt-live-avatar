'use strict';
// Listening to another app's audio.
//
// The avatar cannot "sing along" to Spotify by decoding the song: the file is
// DRM'd and there is no waveform to read. A Core Audio process tap solves that
// from the other end - it reads the PCM the player hands to the speakers, after
// the player has decoded it. Whatever the user can hear, she can hear.
//
// Tapping one process rather than the whole machine matters twice over: the
// avatar never hears her own voice back (which would make her lip-sync to
// herself), and the rest of the room stays out of it.
//
// The PCM is not sent over IPC. A 48 kHz stereo float stream is 384 KB/s of
// small, relentless messages, which is what the structured clone path is worst
// at. Instead the renderer opens a plain HTTP request against the local static
// server and the helper's stdout is piped into the response, so TCP carries
// the backpressure.

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Live audio has no value once it is late. If the renderer falls behind, drop
// rather than queue - a backlog would only grow the lip-sync lag.
const MAX_PENDING = 1 << 16;
const HEADER_TIMEOUT = 6000;

const PLAYERS = {
  spotify: { name: 'Spotify', bundleId: 'com.spotify.client', app: 'Spotify' },
  music: { name: 'Music', bundleId: 'com.apple.Music', app: 'Music' },
};

class AudioTap {
  constructor(binaryPath) {
    this.binary = binaryPath;
    this.child = null;
    this.token = null;
    this.header = null;
    this.response = null;
    this.target = null;
    this.tail = Buffer.alloc(0);
    this.cancelStart = null;
  }

  available() {
    if (process.platform !== 'darwin') return false;
    try { fs.accessSync(this.binary, fs.constants.X_OK); return true; } catch { return false; }
  }

  // Which applications currently own audio, and which are actually making sound.
  list() {
    if (!this.available()) return Promise.resolve({ ok: false, reason: 'unavailable', processes: [] });
    return new Promise(resolve => {
      const child = spawn(this.binary, ['--list'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('error', () => resolve({ ok: false, reason: 'spawn-failed', processes: [] }));
      child.on('close', () => {
        try { resolve({ ok: true, processes: JSON.parse(out).processes || [] }); }
        catch { resolve({ ok: false, reason: 'bad-output', processes: [] }); }
      });
    });
  }

  // The player worth listening to: one that is running AND making sound,
  // preferring an explicit request, then Spotify, then Music.
  async pickPlayer(preferred) {
    const { processes } = await this.list();
    const audible = processes.filter(p => p.playing);
    if (preferred && !PLAYERS[preferred]) return null;
    const current = await nowPlaying(preferred);
    const keys = preferred ? [preferred] : current?.playing ? [current.player] : current ? [] : Object.keys(PLAYERS);
    for (const key of keys) {
      const player = PLAYERS[key];
      if (current && (!current.playing || current.player !== key)) continue;
      const match = audible.find(p => p.bundleId === player.bundleId)
        || audible.find(p => p.bundleId.startsWith(player.bundleId + '.'));
      if (match) return { key, name: player.name, bundleId: match.bundleId, pid: match.pid };
    }
    // A named request must never start following some different application.
    if (preferred) return null;
    // Nothing from a known player: fall back to whatever else is audible, so
    // "sing along" still works for a browser tab or a video.
    const other = audible.find(p => typeof p.bundleId === 'string'
      && !p.bundleId.startsWith('com.apple.')
      && !p.bundleId.startsWith('com.github.Electron')
      && !Object.values(PLAYERS).some(player => p.bundleId === player.bundleId || p.bundleId.startsWith(player.bundleId + '.')));
    return other ? { key: null, name: other.name, bundleId: other.bundleId, pid: other.pid } : null;
  }

  // Start capturing. Resolves once the helper reports its stream format, so the
  // caller knows the tap is genuinely live before building a graph around it.
  start({ pid, bundleId } = {}) {
    if (!this.available()) return Promise.reject(new Error('The audio listener is not available on this system.'));
    this.stop();

    const args = Number.isInteger(pid) && pid > 0 ? ['--pid', String(pid)] : bundleId ? ['--bundle', String(bundleId)] : null;
    if (!args) return Promise.reject(new Error('Nothing to listen to.'));

    const child = spawn(this.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.token = crypto.randomBytes(16).toString('hex');
    this.target = { pid, bundleId };

    return new Promise((resolve, reject) => {
      let head = Buffer.alloc(0), settled = false, complaint = '';
      const timer = setTimeout(() => giveUp('The audio listener did not become ready.'), HEADER_TIMEOUT);
      timer.unref?.();
      const cancel = message => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.cancelStart === cancel) this.cancelStart = null;
        reject(new Error(message));
      };
      this.cancelStart = cancel;
      child.stderr.on('data', chunk => { complaint = (complaint + chunk).slice(-4096); });
      const giveUp = message => {
        cancel(message);
        // A previous child's late close/error must not stop its replacement.
        if (this.child === child) this.stop();
      };
      child.on('error', error => giveUp(error.message));
      child.on('close', () => {
        giveUp(complaint.trim() || 'The audio listener stopped unexpectedly.');
        if (this.child === child) this.stop();
      });

      const onHeader = chunk => {
        if (this.child !== child || settled) return;
        head = Buffer.concat([head, chunk]);
        const cut = head.indexOf(10);
        if (cut < 0) { if (head.length > 4096) giveUp('The audio listener sent no format.'); return; }
        if (cut > 4096) { giveUp('The audio listener sent an oversized format.'); return; }
        child.stdout.removeListener('data', onHeader);
        let format;
        try { format = JSON.parse(head.subarray(0, cut).toString()); }
        catch { giveUp('The audio listener sent an unreadable format.'); return; }
        if (!Number.isInteger(format.channels) || format.channels < 1 || format.channels > 32
          || !Number.isFinite(format.sampleRate) || format.sampleRate < 8000 || format.sampleRate > 384000
          || format.format !== 'f32' || format.interleaved !== true) {
          giveUp('The audio listener sent an unsupported format.'); return;
        }
        this.header = format;

        // Anything already past the header belongs to the stream.
        const rest = head.subarray(cut + 1);
        child.stdout.on('data', piece => { if (this.child === child) this.forward(piece); });
        if (rest.length) this.forward(rest);

        settled = true;
        clearTimeout(timer);
        this.cancelStart = null;
        resolve({ ...this.header, token: this.token });
      };
      child.stdout.on('data', onHeader);
    });
  }

  forward(chunk) {
    const frameBytes = (this.header?.channels || 2) * 4;
    const bytes = this.tail.length ? Buffer.concat([this.tail, chunk]) : chunk;
    const complete = bytes.length - bytes.length % frameBytes;
    this.tail = Buffer.from(bytes.subarray(complete));
    if (!complete) return;
    const response = this.response;
    if (!response || response.writableEnded || response.destroyed) return;
    // Pipe chunks split anywhere, including the middle of a float or stereo
    // frame. Drop only complete frames or all subsequent samples are corrupt.
    const maxBytes = Math.max(frameBytes, Math.floor(MAX_PENDING / frameBytes) * frameBytes);
    if (response.writableLength > maxBytes) return;
    const start = Math.max(0, complete - maxBytes);
    try { response.write(bytes.subarray(start, complete)); }
    catch { if (this.response === response) this.detach(); }
  }

  // Called by the local server when the renderer opens the stream.
  attach(token, response) {
    if (!this.child || !this.token || token !== this.token) return false;
    this.detach();
    this.response = response;
    response.on('close', () => { if (this.response === response) this.response = null; });
    response.on('error', () => { if (this.response === response) this.response = null; });
    return true;
  }

  detach() {
    const response = this.response;
    this.response = null;
    if (response && !response.writableEnded) try { response.end(); } catch {}
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.token = null;
    this.header = null;
    this.target = null;
    this.tail = Buffer.alloc(0);
    const cancel = this.cancelStart;
    this.cancelStart = null;
    cancel?.('The audio listener was stopped.');
    this.detach();
    if (!child) return false;
    // Closing stdin is the helper's cue to tear the tap down cleanly; the kill
    // is only there in case it is wedged.
    try { child.stdin.end(); } catch {}
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 400);
    timer.unref?.();
    return true;
  }

  state() {
    return { running: Boolean(this.child), token: this.token, format: this.header, target: this.target };
  }
}

// ------------------------------------------------------------- player control
// Just enough AppleScript to answer "what is playing" and to steer it. Both
// players expose the same vocabulary, so one shape covers them.

const osascript = script => new Promise(resolve => {
  execFile('/usr/bin/osascript', ['-e', script], { timeout: 4000 }, (error, stdout) => {
    resolve(error ? null : String(stdout).trim());
  });
});

const isRunning = async name =>
  (await osascript('tell application "System Events" to (name of processes) contains "' + name + '"')) === 'true';

async function nowPlaying(preferred) {
  if (preferred && !PLAYERS[preferred]) return null;
  const keys = preferred ? [preferred] : Object.keys(PLAYERS);
  const states = await Promise.all(keys.map(async key => {
    const player = PLAYERS[key];
    if (!await isRunning(player.app)) return null;
    const state = await osascript('tell application "' + player.app + '" to player state as string');
    return ['playing', 'paused', 'stopped'].includes(state) ? { key, player, state } : null;
  }));
  // Paused Spotify must not hide Music while Music is actually playing.
  const selected = states.find(item => item?.state === 'playing') || states.find(Boolean);
  if (!selected) return null;
  const { key, player, state } = selected;
  if (state === 'stopped') return { player: key, name: player.name, playing: false, title: '', artist: '', position: 0 };
  const script = 'tell application "' + player.app + '" to return (name of current track) & "|" & '
    + '(artist of current track) & "|" & (player position)';
  const [title = '', artist = '', position = '0'] = String(await osascript(script) || '').split('|');
  return { player: key, name: player.name, playing: state === 'playing', title, artist, position: Number(position) || 0 };
}

async function playerCommand(preferred, command) {
  if (preferred && !PLAYERS[preferred]) return null;
  const current = await nowPlaying(preferred);
  const keys = preferred ? [preferred] : current ? [current.player] : Object.keys(PLAYERS);
  for (const key of keys) {
    const player = PLAYERS[key];
    if (!await isRunning(player.app)) continue;
    const result = await osascript('tell application "' + player.app + '" to ' + command);
    return result === null ? null : key;
  }
  return null;
}

module.exports = { AudioTap, PLAYERS, nowPlaying, playerCommand };
