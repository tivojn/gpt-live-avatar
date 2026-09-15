// Display text only: keep original paths in settings, requests and link targets.
const homePath = value => typeof value === 'string' && value.startsWith('/')
  ? value.replace(/\/+$/, '') : '';
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function shortenHomePaths(value, userHome) {
  const text = String(value ?? ''), home = homePath(userHome);
  if (!home || !text.includes(home)) return text;
  // Do not shorten another user's directory, a copied path prefix or a URL.
  const pattern = new RegExp('(?<![\\p{L}\\p{N}_./\\\\~%+-])' + escapePattern(home) +
    '(?=$|[/\\s"\'`\\])},;:!?]|\\.(?=$|\\s))', 'gu');
  return text.replace(pattern, '~');
}

// For an explicitly editable path field; never expand an agent's whole request.
export function expandHomePath(value, userHome) {
  const text = String(value ?? ''), home = homePath(userHome);
  if (!home) return text;
  return text === '~' ? home : text.startsWith('~/') ? home + text.slice(1) : text;
}
