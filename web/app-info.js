'use strict';
const $ = id => document.getElementById(id), api = window.glaAppInfo;
function render(info) {
  $('version').textContent = 'Version ' + info.version;
  $('architecture').textContent = info.architecture;
  $('description').textContent = info.description;
  $('release-title').textContent = info.title;
  $('date').textContent = info.date ? 'Released ' + new Date(info.date + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  $('highlights').replaceChildren(...info.highlights.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  const u = info.update, available = u.state === 'available';
  const states = { idle: ['Check for a newer version', 'Updates come from the official GitHub releases.'],
    checking: ['Checking for updates…', 'Contacting GitHub for the latest public release.'],
    current: ['You’re up to date', 'Version ' + info.version + ' is the latest public release.'],
    ahead: ['You’re running a newer version', 'The latest public release is ' + u.version + '.'],
    available: ['Version ' + u.version + ' is available', u.downloadURL ? 'Download the installer, then replace the app in Applications. Your saved settings remain in place.' : 'An installer for this Mac is not attached. Check the release page for available downloads.'],
    error: ['Couldn’t check for updates', u.message] };
  const [status, detail] = states[u.state] || states.idle;
  $('status').textContent = status; $('status').dataset.state = u.state; $('update-detail').textContent = detail;
  $('check').disabled = u.state === 'checking'; $('check').textContent = u.state === 'checking' ? 'Checking…' : 'Check for Updates';
  $('check').classList.toggle('primary', !available || !u.downloadURL);
  $('download').hidden = !available || !u.downloadURL;
  $('release').textContent = u.releaseURL ? 'View Release' : 'Open Releases';
  $('notes-section').hidden = !u.notes;
  // GitHub release content is text, never executable markup.
  $('release-notes').textContent = String(u.notes || '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
async function action(callback) {
  $('action-error').hidden = true;
  try { await callback(); } catch { $('action-error').textContent = 'That action could not finish. Please try again.'; $('action-error').hidden = false; }
}
$('check').onclick = () => action(async () => render(await api.check()));
for (const kind of ['download', 'release', 'repository']) $(kind).onclick = () => action(() => api.open(kind));
const unsubscribe = api.onChange(render); addEventListener('pagehide', unsubscribe, { once: true });
void action(async () => render(await api.get()));
