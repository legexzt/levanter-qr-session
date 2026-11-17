// Provides the .menu alias by delegating directly to the help plugin.
// Called by the LEGEZT plugin loader/relay with the standard plugin context.
// Needs ./help.js and passes it the unchanged plugin context object.
'use strict';

const help = require('./help.js');

module.exports = {
  name: 'menu',
  command: '.menu',
  description: 'Show the command menu (same as .help).',
  async run(context) {
    return help.run(context);
  }
};
