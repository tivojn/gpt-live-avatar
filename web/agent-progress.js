// Public task updates only. Never display raw tool output or private reasoning.
const labels = {
  avatar_state: 'Checking available motions', move_avatar: 'Moving', play_motion: 'Playing a motion',
  read_current_page: 'Reading the current page', read_webpage_url: 'Reading the linked page',
  list_files: 'Checking files', read_text_file: 'Reading a file', create_text_file: 'Creating a file',
  trash_file: 'Moving the file to Trash', commandExecution: 'Running the task', shell: 'Running the task',
  fileChange: 'Updating files', edit_file: 'Updating files', imageGeneration: 'Creating your image',
  imageView: 'Looking at the image', webSearch: 'Searching the web', mcpToolCall: 'Using a connected tool',
  dynamicToolCall: 'Working on your request', agentMessage: 'Preparing an update',
};
export function progressText(value, limit = 360) {
  const text = String(value || '').replace(/```[\s\S]*?```/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`#]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text;
}
export function progressLabel(p) {
  if (p.state === 'thinking') return 'Working…';
  if (p.state === 'complete') return p.receipts?.some(r => !r.ok) ? 'Finished with an issue' : 'Done';
  if (p.state === 'cancelled') return 'Stopped';
  if (p.state === 'error') return 'Couldn’t finish';
  if (p.state === 'tool-error') return 'Checking another approach…';
  if (p.state === 'waiting') return 'Waiting for you…';
  if (p.state === 'update') return 'Working…';
  const tool = String(p.tool || '');
  const label = labels[tool] || (/cua|browser|computer/i.test(tool) ? 'Working with the app' : 'Working on your request');
  return label + (p.state === 'done' ? ' · done' : '…');
}
export class AgentProgress {
  constructor() { this.current = null; this.retired = new Set(); }
  accept(p, now = performance.now()) {
    if (!p?.id || this.retired.has(p.id)) return null;
    if (this.current?.id !== p.id) {
      // Requests start with thinking. Late events from an older request must
      // never replace a newer task's text or clear its bubble.
      if (p.state !== 'thinking') return null;
      if (this.current) this.retired.add(this.current.id);
      this.current = { id: p.id, character: p.character, detail: '' };
    }
    const previous = this.current;
    const active = !['complete', 'error', 'cancelled'].includes(p.state);
    const detail = p.state === 'update' ? progressText(p.text) :
      p.state === 'complete' ? progressText(p.text) : p.state === 'error' ? progressText(p.error) :
      p.state === 'cancelled' ? '' : previous.detail;
    this.current = { ...previous, state: p.state, character: p.character || previous.character,
      label: progressLabel(p), detail, active, until: active ? Infinity : now + (p.state === 'cancelled' ? 1800 : 8000) };
    if (!active) this.retired.add(p.id);
    while (this.retired.size > 64) this.retired.delete(this.retired.values().next().value);
    return this.current;
  }
}
