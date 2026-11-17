// Provides the .ask alias by delegating directly to the AI plugin.
// Called by the LEGEZT plugin loader/relay with the standard plugin context.
// Needs ./ai.js so both commands share the same client and chat history.
'use strict';

const ai = require('./ai.js');

module.exports = {
  name: 'ask',
  command: '.ask',
  description: 'Ask the AI anything (same as .ai).',
  async run(context) {
    return ai.run(context);
  }
};
