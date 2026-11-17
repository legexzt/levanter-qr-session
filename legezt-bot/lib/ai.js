// Provides Kimi K3 chat completions via AWS Bedrock (us-east-1, inference profile us.moonshotai.kimi-k3.1).
// Called by the .ai and .ask plugins; uses lib/keys.js and Node 20+ global fetch.
// Needs a Bedrock API key in /var/legezt/config/bedrock.key (mode 600) or BEDROCK_API_KEY env; the key value is never logged.
'use strict';

const keyStore = require('./keys');

const ENDPOINT = 'https://bedrock-runtime.us-east-1.amazonaws.com/model/us.moonshotai.kimi-k3.1/invoke';
const MODEL_LABEL = 'kimi-k3.1';
const NO_KEY_MESSAGE = 'Kimi key not configured yet — ask the owner to add it.';
const UNAVAILABLE_MESSAGE = 'Kimi is unavailable right now, try again in a bit.';
const BUSY_MESSAGE = 'Kimi is busy right now, try again in a bit.';
const FORBIDDEN_MESSAGE = 'Kimi is not available for this account right now — ask the owner to check the key.';
const TIMEOUT_MESSAGE = 'Kimi took too long to reply — try again.';

const SYSTEM_PROMPT =
  'You are LEGEZT, a friendly, helpful, concise WhatsApp bot. ' +
  'You understand Roman Hindi and English mixes; reply in the same language mix the user uses. ' +
  'Never claim to be human. Never invent facts you do not know; say when you are unsure.';

function isValidMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;

  try {
    return messages.every((message) => {
      return (
        message !== null &&
        typeof message === 'object' &&
        typeof message.content === 'string'
      );
    });
  } catch {
    return false;
  }
}

function clampNumber(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;

  let number;
  try {
    number = Number(value);
  } catch {
    return fallback;
  }

  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeTimeout(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;

  let number;
  try {
    number = Number(value);
  } catch {
    return fallback;
  }

  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

// Reads token counts from the Bedrock response's usage field. Accepts both
// input/output_tokens (Anthropic-style) and prompt/completion_tokens
// (OpenAI-style). Returns { input, output, total } or null when the response
// carries no usable usage field.
function parseUsage(data) {
  const usage = data && data.usage;
  if (!usage || typeof usage !== 'object') return null;
  const input = usage.input_tokens !== undefined ? usage.input_tokens : usage.prompt_tokens;
  const output = usage.output_tokens !== undefined ? usage.output_tokens : usage.completion_tokens;
  const total = usage.total_tokens;
  const inNum = typeof input === 'number' && Number.isFinite(input) ? input : null;
  const outNum = typeof output === 'number' && Number.isFinite(output) ? output : null;
  const totalNum = typeof total === 'number' && Number.isFinite(total) ? total : null;
  if (inNum === null && outNum === null && totalNum === null) return null;
  return {
    input: inNum,
    output: outNum,
    total: totalNum !== null ? totalNum : (inNum || 0) + (outNum || 0)
  };
}

async function chat(messages, opts) {
  if (!isValidMessages(messages)) throw new Error('Invalid messages');

  const options = opts && typeof opts === 'object' ? opts : {};
  // Kimi K3.1 is a reasoning model: it spends tokens thinking before it
  // answers, so max_tokens must stay high or replies truncate mid-sentence.
  const maxTokens = clampNumber(options.maxTokens, 8000, 1024, 32000);
  const temperature = clampNumber(options.temperature, 0.7, 0, 1.5);
  const timeoutMs = normalizeTimeout(options.timeoutMs, 60000);

  let key = null;
  try {
    key = keyStore.getKey('bedrock');
  } catch {
    key = null;
  }

  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(NO_KEY_MESSAGE);
  }

  let timer = null;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages,
        max_tokens: maxTokens,
        temperature
      }),
      signal: controller.signal
    });

    const status =
      response && typeof response.status === 'number' ? response.status : 0;
    const ok = Boolean(
      response &&
        (response.ok === true || (status >= 200 && status < 300))
    );

    if (!ok) {
      if (status === 403) throw new Error(FORBIDDEN_MESSAGE);
      if (status === 429) throw new Error(BUSY_MESSAGE);
      throw new Error(UNAVAILABLE_MESSAGE);
    }

    const data = await response.json();
    const choices = data && data.choices;
    const firstChoice = Array.isArray(choices) ? choices[0] : null;
    const message = firstChoice && firstChoice.message;
    const content = message && message.content;

    if (typeof content === 'string' && content.trim()) {
      return { text: content.trim(), model: MODEL_LABEL, usage: parseUsage(data) };
    }

    throw new Error(UNAVAILABLE_MESSAGE);
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(TIMEOUT_MESSAGE);
    if (err instanceof Error && err.message) throw err;
    throw new Error(UNAVAILABLE_MESSAGE);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function isConfigured() {
  try {
    const key = keyStore.getKey('bedrock');
    return typeof key === 'string' && key.length > 0;
  } catch {
    return false;
  }
}

module.exports = { chat, isConfigured, SYSTEM_PROMPT };
