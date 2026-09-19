'use strict';
const os = require('node:os');
const path = require('node:path');

function absoluteFolder(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) return null;
  let normalized = path.normalize(value); const root = path.parse(normalized).root;
  // path.normalize leaves the platform's own separator at the end: "/" or, on Windows, "\".
  while (normalized.length > root.length && normalized.endsWith(path.sep)) normalized = normalized.slice(0, -1);
  return normalized;
}

function normalizeAgentFolder(config, home = os.homedir()) {
  const current = config && typeof config === 'object' ? config : {};
  const userHome = absoluteFolder(home) || os.homedir();
  const downloads = path.join(userHome, 'Downloads');
  const folder = absoluteFolder(current.agentFolder);
  const migrated = Number.isInteger(current.agentFolderDefaultVersion) && current.agentFolderDefaultVersion >= 1;
  return {
    agentFolder: !folder || (!migrated && folder === path.join(userHome, 'Desktop')) ? downloads : folder,
    agentFolderDefaultVersion: 1,
  };
}

module.exports = {normalizeAgentFolder};
