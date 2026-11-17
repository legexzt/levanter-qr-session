// Spam fix tests (Phase 4): the bot must answer ONLY real-time commands.
// On every (re)connect WhatsApp re-delivers recent unread messages as
// notify, and Baileys can deliver the same message twice — without the
// freshness gate + message-ID dedup the bot answers old commands again on
// every restart (one command -> many reactions/replies).
//
// Run: node legezt-bot/test/test_spam_fix.js
// (No test framework — plain Node, same style as the Phase 4 chats tests.)
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'legezt-spam-test-'));
process.env.LEGEZT_CHATS_DIR = path.join(TMP, 'chats');
process.env.LEGEZT_VAULT_DIR = path.join(TMP, 'vault');
process.env.LEGEZT_VAULT_KEY_FILE = path.join(TMP, 'vault.key');
process.env.LEGEZT_USAGE_FILE = path.join(TMP, 'usage.jsonl');
fs.writeFileSync(process.env.LEGEZT_VAULT_KEY_FILE, Buffer.alloc(32, 7));

const BOT_DIR = path.join(__dirname, '..');
const LegeztBot = require(path.join(BOT_DIR, 'bot.js'));
const chats = require(path.join(BOT_DIR, 'lib', 'chats.js'));

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Fake socket: records every reaction and text send, never touches the
// network. sendMessage returns a sent key so _sendText can archive the
// bot's own reply like the real socket does.
const reactions = [];
const texts = [];
let sentSeq = 0;
const fakeSock = {
  sendMessage: async (jid, payload) => {
    if (payload && payload.react) {
      reactions.push({ jid, emoji: payload.react.text, keyId: payload.react.key && payload.react.key.id });
      return {};
    }
    if (payload && typeof payload.text === 'string') {
      texts.push({ jid, text: payload.text });
      sentSeq += 1;
      return { key: { id: `SENT-${sentSeq}`, remoteJid: jid, fromMe: true } };
    }
    return {};
  }
};

// --- Fake .ping plugin: records runs, replies 'pong' like the real one.
let pingRuns = 0;
const pingPlugin = {
  name: 'ping',
  run: async ({ reply }) => {
    pingRuns += 1;
    await reply('pong');
  }
};

const ALICE = '919991111111@s.whatsapp.net';
const BOB = '919992222222@s.whatsapp.net';
const CAROL = '919993333333@s.whatsapp.net';
const DAVE = '919994444444@s.whatsapp.net';

function makeMsg(id, jid, text, tsSeconds, extra) {
  const msg = {
    key: { remoteJid: jid, id, fromMe: false },
    messageTimestamp: tsSeconds,
    message: { conversation: text },
    pushName: 'Test'
  };
  if (extra) Object.assign(msg, extra);
  return msg;
}

function readArchived(jid) {
  const dir = path.join(process.env.LEGEZT_CHATS_DIR, chats.safeChatId(jid));
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }
  return out;
}

(async () => {
  const bot = new LegeztBot({ authDir: path.join(TMP, 'auth'), log: () => {} });
  bot.plugins = new Map([['.ping', pingPlugin], ['ping', pingPlugin]]);
  bot.sock = fakeSock;
  // Simulate a connection that opened right now.
  const connectedAt = Date.now();
  bot._connectedAt = connectedAt;
  const nowSec = Math.floor(Date.now() / 1000);

  // (a) A command sent 5 minutes before the (re)connect is a replay: it
  // must produce NO reaction, NO reply, NO plugin run.
  const beforeReactions = reactions.length;
  const beforeTexts = texts.length;
  const beforeRuns = pingRuns;
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('STALE-1', ALICE, '.ping', nowSec - 300)]
  }, fakeSock);
  await sleep(120); // fire-and-forget archive chain
  check('stale message (5 min old): no reaction', reactions.length === beforeReactions);
  check('stale message (5 min old): no reply', texts.length === beforeTexts);
  check('stale message (5 min old): plugin not run', pingRuns === beforeRuns);

  // (e) ...but the archiver still records that old message: the training
  // store wants the full history, and archiving never sends anything.
  const aliceLines = readArchived(ALICE);
  check('stale message still archived', aliceLines.some((l) => l.id === 'STALE-1' && l.text === '.ping'));

  // Grace boundary: 10s before connect is inside the 15s grace -> answered.
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('GRACE-10', BOB, '.ping', nowSec - 10)]
  }, fakeSock);
  check('message 10s before connect (inside grace): plugin runs', pingRuns === beforeRuns + 1);
  check('message 10s before connect: one ⏳ then one ✅',
    reactions.length === beforeReactions + 2
    && reactions[reactions.length - 2].emoji === '⏳'
    && reactions[reactions.length - 1].emoji === '✅');
  check('message 10s before connect: exactly one reply', texts.length === beforeTexts + 1 && texts[texts.length - 1].text === 'pong');

  // Grace boundary: 20s before connect is outside the grace -> ignored.
  const r2 = reactions.length;
  const t2 = texts.length;
  const p2 = pingRuns;
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('GRACE-20', CAROL, '.ping', nowSec - 20)]
  }, fakeSock);
  check('message 20s before connect (outside grace): ignored',
    reactions.length === r2 && texts.length === t2 && pingRuns === p2);

  // (b) A message sent at/after connect is processed exactly once.
  const r3 = reactions.length;
  const t3 = texts.length;
  const p3 = pingRuns;
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('FRESH-1', DAVE, '.ping', nowSec)]
  }, fakeSock);
  check('fresh message: plugin runs once', pingRuns === p3 + 1);
  check('fresh message: ⏳ then ✅', reactions.length === r3 + 2
    && reactions[reactions.length - 2].emoji === '⏳'
    && reactions[reactions.length - 1].emoji === '✅');
  check('fresh message: one reply', texts.length === t3 + 1 && texts[texts.length - 1].text === 'pong');

  // (c) The SAME message ID delivered twice is answered exactly once.
  const r4 = reactions.length;
  const t4 = texts.length;
  const p4 = pingRuns;
  const dup = makeMsg('DUP-1', DAVE, '.ping', nowSec);
  await bot._onMessagesUpsert({ type: 'notify', messages: [dup] }, fakeSock);
  check('first delivery of DUP-1: processed', pingRuns === p4 + 1 && reactions.length === r4 + 2 && texts.length === t4 + 1);
  await bot._onMessagesUpsert({ type: 'notify', messages: [makeMsg('DUP-1', DAVE, '.ping', nowSec)] }, fakeSock);
  check('second delivery of DUP-1: no extra reaction', reactions.length === r4 + 2);
  check('second delivery of DUP-1: no extra reply', texts.length === t4 + 1);
  check('second delivery of DUP-1: plugin not run again', pingRuns === p4 + 1);

  // (d) type 'append' (history sync) is still ignored, even when fresh.
  const r5 = reactions.length;
  const t5 = texts.length;
  const p5 = pingRuns;
  await bot._onMessagesUpsert({
    type: 'append',
    messages: [makeMsg('APPEND-1', ALICE, '.ping', nowSec)]
  }, fakeSock);
  check("type 'append' still ignored", reactions.length === r5 && texts.length === t5 && pingRuns === p5);

  // Gap tolerance intact: '.  ping' still resolves to the plugin.
  const p6 = pingRuns;
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('GAP-1', BOB, '.  ping', nowSec)]
  }, fakeSock);
  check('gap tolerance intact (.  ping works)', pingRuns === p6 + 1);

  // Missing timestamp fails open: a command with no timestamp is answered,
  // never silently dropped.
  const p7 = pingRuns;
  const noTs = makeMsg('NOTS-1', CAROL, '.ping', nowSec);
  delete noTs.messageTimestamp;
  await bot._onMessagesUpsert({ type: 'notify', messages: [noTs] }, fakeSock);
  check('message without timestamp: answered (fail open)', pingRuns === p7 + 1);

  // Long-style timestamp (Baileys Long with toNumber) is honoured.
  const p8 = pingRuns;
  const longTs = makeMsg('LONG-1', DAVE, '.ping', { toNumber: () => nowSec - 600 });
  await bot._onMessagesUpsert({ type: 'notify', messages: [longTs] }, fakeSock);
  check('Long timestamp 10 min old: ignored', pingRuns === p8);

  // Dedup set is bounded: after 2000 entries the oldest is evicted.
  bot._seenMessageIds.clear();
  for (let i = 0; i < 2000; i++) bot._seenMessageIds.add(`FILL-${i}`);
  check('dedup set holds 2000 ids', bot._seenMessageIds.size === 2000);
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('EVICT-1', ALICE, '.ping', nowSec)]
  }, fakeSock);
  check('dedup set stays capped at 2000', bot._seenMessageIds.size === 2000);
  check('dedup set evicted the oldest id', !bot._seenMessageIds.has('FILL-0') && bot._seenMessageIds.has('EVICT-1'));

  // (f) Relay path bypasses the gate entirely: respond() has no message
  // key and is always live by definition — even with no connection time
  // at all it must still answer.
  bot._connectedAt = null;
  const relay = await bot.respond('.ping', ALICE);
  check('relay respond() works with no connect time', relay && relay.reply === 'pong' && relay.handledBy === 'ping');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('TEST CRASH:', err);
  process.exit(1);
});
