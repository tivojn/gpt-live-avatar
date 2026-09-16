'use strict';
// One native listener is shared by solo and group renderers. Serialize ownership
// before any await, so a late renderer teardown cannot stop a new performance.
class AudioTapOwner {
  constructor(tap) {
    this.tap = tap;
    this.ticket = 0;
    this.owner = null;
    this.token = null;
  }

  async start(owner, request = {}) {
    const ticket = ++this.ticket;
    this.owner = owner;
    this.token = null;
    this.tap.stop();
    const current = () => this.ticket === ticket && this.owner === owner;
    const cancelled = () => ({ ok: false, error: 'The audio request was replaced or stopped.' });
    try {
      if (request.pid !== undefined && (!Number.isInteger(request.pid) || request.pid <= 0)) {
        throw new Error('Choose a valid audio source.');
      }
      const target = request.pid !== undefined
        ? { pid: request.pid, name: null, key: null }
        : await this.tap.pickPlayer(request.player);
      if (!current()) return cancelled();
      if (!target) throw new Error(request.player
        ? 'The selected player is not playing. Start its music and try again.'
        : 'Nothing is playing right now.');
      const format = await this.tap.start(Number.isInteger(target.pid)
        ? { pid: target.pid } : { bundleId: target.bundleId });
      if (!current()) return cancelled();
      this.token = format.token;
      return { ok: true, ...format, source: target.name || null, player: target.key || null };
    } catch (error) {
      if (!current()) return cancelled();
      this.tap.stop();
      this.owner = this.token = null;
      return { ok: false, error: error.message || 'The audio listener could not start.' };
    }
  }

  stop(owner, token) {
    if (this.owner !== owner || (token !== undefined && token !== null && token !== this.token)) return false;
    ++this.ticket;
    this.owner = this.token = null;
    this.tap.stop();
    return true;
  }
}
module.exports = { AudioTapOwner };
