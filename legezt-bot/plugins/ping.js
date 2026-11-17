// .ping — replies with latency so the owner can check the bot is alive.
// Called by bot.js when a WhatsApp message (or a Muse relay call) starts with .ping.
// Needs the message timestamp (Baileys) for latency; works without it via the relay.
'use strict';

module.exports = {
  name: 'ping',
  command: '.ping',
  description: 'Check the bot is alive — replies pong with latency.',
  async run({ message, reply }) {
    let latency = null;
    const ts = message && message.messageTimestamp;
    if (ts !== undefined && ts !== null) {
      const ms = Number(ts) * 1000;
      if (Number.isFinite(ms) && ms > 0) latency = Math.max(0, Date.now() - ms);
    }
    const text = latency === null
      ? 'pong 🏓 — LEGEZT is alive (via relay)'
      : `pong 🏓 ${latency}ms — LEGEZT is alive`;
    await reply(text);
    return text;
  }
};
