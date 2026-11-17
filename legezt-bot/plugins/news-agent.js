// .news — the owner's own news AI agent (extension point, DISABLED by default).
// Called by bot.js only if enabled — the loader skips it while enabled === false.
// Needs the owner's API keys + implementation (a later phase); do NOT build it now.
'use strict';

module.exports = {
  name: 'news-agent',
  command: '.news',
  description: 'News AI agent — disabled by default (owner enables it later with his API keys).',
  enabled: false,
  async run({ reply }) {
    const text = 'News agent is disabled. The owner enables it later with his API keys.';
    await reply(text);
    return text;
  }
};
