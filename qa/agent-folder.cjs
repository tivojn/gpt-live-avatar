'use strict';
const assert = require('node:assert/strict'), path = require('node:path');
const root = process.env.GLA_AGENT_FOLDER_ROOT || path.resolve(__dirname, '..');
const {normalizeAgentFolder: normalize} = require(path.join(root, 'electron/agent-folder.cjs'));
// The same cases on either system: "/Users/…" on macOS, "C:\Users\…" on Windows.
const win = process.platform === 'win32', sep = path.sep, p = posix => win ? (posix === '/' ? 'C:\\' : 'C:' + posix.replaceAll('/', '\\')) : posix;
const home = p('/Users/adamcohen'), downloads = home + sep + 'Downloads', desktop = home + sep + 'Desktop';
const expected = folder => ({agentFolder:folder,agentFolderDefaultVersion:1});
for (const config of [undefined,null,{}, {agentFolder:''},{agentFolder:'~/Desktop'},{agentFolder:'relative'},{agentFolder:7},{agentFolder:desktop+'\0file'}]) {
  assert.deepEqual(normalize(config,home), expected(downloads), 'Missing or invalid folders use absolute Downloads');
}
for (const folder of [desktop,desktop+sep,desktop+sep+sep,desktop+sep+'.']) {
  const config = Object.freeze({agentFolder:folder});
  assert.deepEqual(normalize(config,home+sep), expected(downloads), 'Only the normalized legacy Desktop default migrates');
  assert.equal(config.agentFolder,folder,'Normalization does not mutate the saved config');
}
for (const folder of [desktop+sep+'Project',desktop+'-backup',p('/Users/another/Desktop'),p('/Volumes/Work'),p('/'),p('/tmp/Folder ')]) {
  assert.deepEqual(normalize({agentFolder:folder},home), expected(folder), 'Subfolders and custom absolute paths are retained');
}
assert.deepEqual(normalize({agentFolder:p('/Volumes/Work//Project/')},home), expected(p('/Volumes/Work/Project')));
if (win) assert.deepEqual(normalize({agentFolder:'C:/Users/adamcohen/Desktop/'},home), expected(downloads), 'Forward slashes are the same folder on Windows');
const migrated = normalize({agentFolder:desktop},home);
assert.deepEqual(normalize(migrated,home), migrated, 'Migration is idempotent');
assert.deepEqual(normalize({...migrated,agentFolder:desktop},home), expected(desktop), 'A later explicit Desktop choice must survive restart');
assert.deepEqual(normalize({agentFolder:desktop+sep,agentFolderDefaultVersion:1},home), expected(desktop));
assert.deepEqual(normalize({agentFolder:desktop,agentFolderDefaultVersion:2},home), expected(desktop), 'A future marker also prevents legacy migration');
assert.deepEqual(normalize({agentFolder:'',agentFolderDefaultVersion:1},home), expected(downloads), 'Invalid folders still recover after migration');
assert(path.isAbsolute(normalize({},home).agentFolder), 'Backend receives an absolute path, never display shorthand');
console.log('Agent folder defaults, one-time Desktop migration, explicit choices, custom paths and absolute normalization passed.');
