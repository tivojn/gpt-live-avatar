'use strict';
// Keep reconnect context within GPT-Live's startup history limits.
function historyItems(history) {
  if (!Array.isArray(history)) return [];
  const result = []; let bytes = 0;
  for (const item of history.slice(-48).reverse()) {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.text !== 'string') continue;
    const text = item.text.slice(-1800).trim();
    if (!text) continue;
    bytes += Buffer.byteLength(text);
    if (bytes > 6000) break;
    result.unshift({ type: 'message', role: item.role, content: [{ type: item.role === 'assistant' ? 'output_text' : 'input_text', text }] });
  }
  return result;
}
module.exports = { historyItems };
