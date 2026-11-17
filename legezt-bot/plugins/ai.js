// Provides .ai chat with short, per-chat in-memory conversation history.
// Called by the LEGEZT plugin loader/relay and delegated to by the ask plugin.
// Needs the shared Kimi K3 client and system prompt from lib/ai.js.
'use strict';

const { chat, SYSTEM_PROMPT } = require('../lib/ai.js');

const { logPluginError } = require('../lib/errors.js');
const { logUsage } = require('../usage.js');
const USAGE = '.ai <your message> — e.g. .ai write a haiku about rain';
const MAX_HISTORY_ENTRIES = 6;
const MAX_CHATS = 500;
const histories = new Map();

function trimHistory(history) {
  if (history.length > MAX_HISTORY_ENTRIES) {
    history.splice(0, history.length - MAX_HISTORY_ENTRIES);
  }
}

function getHistory(chatId) {
  const existing = histories.get(chatId);
  if (existing) {
    return existing;
  }

  const history = [];
  histories.set(chatId, history);

  if (histories.size > MAX_CHATS) {
    const oldestKey = histories.keys().next().value;
    histories.delete(oldestKey);
  }

  return history;
}

function clearHistory() {
  histories.clear();
}

async function run({ log, from, args, reply }) {
  const userMessage = Array.isArray(args) ? args.join(' ').trim() : '';
  if (!userMessage) {
    await reply(USAGE);
    return USAGE;
  }

  const history = getHistory(from);
  history.push({ role: 'user', content: userMessage });
  trimHistory(history);

  let output;
  let usage = null;
  let ok = true;
  const startedAt = Date.now();

  try {
    const result = await chat(
      [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      // Kimi K3.1 is a reasoning model — max_tokens stays high (8000) so
      // replies do not truncate mid-sentence.
      { maxTokens: 8000, temperature: 0.7 }
    );

    const assistantText = result && typeof result.text === 'string'
      ? result.text.trim()
      : '';

    if (!assistantText) {
      throw new Error('The AI returned an empty response — try again.');
    }

    usage = result && result.usage ? result.usage : null;
    history.push({ role: 'assistant', content: assistantText });
    trimHistory(history);

    output = assistantText.length > 4000
      ? `${assistantText.slice(0, 4000)}…`
      : assistantText;
  } catch (error) {
    ok = false;
    logPluginError(log, 'ai', error);
    trimHistory(history);
    output = error && typeof error.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'AI request failed, try again in a bit.';
  }

  // Usage event for the dashboard: token counts come from the Bedrock
  // response's usage field; null when the response carries none.
  logUsage({
    type: 'ai',
    command: '.ai',
    chat: from,
    tokens: usage && typeof usage.total === 'number' ? usage.total : null,
    inputTokens: usage && typeof usage.input === 'number' ? usage.input : null,
    outputTokens: usage && typeof usage.output === 'number' ? usage.output : null,
    durationMs: Date.now() - startedAt,
    ok
  });

  await reply(output);
  return output;
}

module.exports = {
  name: 'ai',
  command: '.ai',
  description: 'Chat with the AI (Kimi K3).',
  run
};

module.exports.clearHistory = clearHistory;
