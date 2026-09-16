'use strict';

// Both menus dispatch to the renderer's confirmed music-command router.
// The renderer owns the existing shared tap and each character's performance.
function musicMenu(state = {}, send, character = '') {
  const music = state.music && typeof state.music === 'object' ? state.music : null;
  const targets = Array.isArray(music?.targets) ? music.targets : [];
  const target = character ? targets.find(t => t?.id === character) : targets[0];
  const mode = target?.mode;
  const active = mode === 'sing' || mode === 'dance';
  const pending = Boolean(state.musicPending);
  const available = state.musicAvailable !== false;
  const source = typeof music?.source === 'string' ? music.source.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 70) : '';
  const status = pending ? 'Getting music ready…' : active ? `${mode === 'sing' ? 'Sing-along' : 'Dance-along'}${source ? ' · ' + source : ' active'}` : '';
  return [
    ...(status ? [{ label: status, enabled: false }] : []),
    { label: 'Sing Along to Current Song', type: 'checkbox', checked: active && mode === 'sing', enabled: available && !pending, click: send('music:sing') },
    { label: 'Dance Along to Current Song', type: 'checkbox', checked: active && mode === 'dance', enabled: available && !pending, click: send('music:dance') },
    { label: 'Stop Singing & Dancing', enabled: pending || active || Boolean(state.performing), click: send('stop-performing') },
  ];
}

module.exports = { musicMenu };
