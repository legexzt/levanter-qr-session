// Outbound queue tests (Phase 4): messages go out ONE BY ONE, little by
// little — NEVER one big text all together, NEVER a simultaneous blast.
// One send at a time per chat, 400 ms pacing between sends to the same
// chat, reactions in order, held (not lost) while the socket is down,
// stale (>15 s) items dropped on reconnect, never replayed.
//
// Run: node legezt-bot/test/test_outbound.js
// (No test framework — plain Node, same style as test_spam_fix.js.)
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'legezt-outbound-test-'));
process.env.LEGEZT_CHATS_DIR = path.join(TMP, 'chats');
process.env.LEGEZT_VAULT_DIR = path.join(TMP, 'vault');
process.env.LEGEZT_VAULT_KEY_FILE = path.join(TMP, 'vault.key');
process.env.LEGEZT_USAGE_FILE = path.join(TMP, 'usage.jsonl');
fs.writeFileSync(process.env.LEGEZT_VAULT_KEY_FILE, Buffer.alloc(32, 7));

const BOT_DIR = path.join(__dirname, '..');
const LegeztBot = require(path.join(BOT_DIR, 'bot.js'));
const { OutboundQueue, PACING_MS, STALE_MS } = require(path.join(BOT_DIR, 'lib', 'outbound.js'));
const chats = require(path.join(BOT_DIR, 'lib', 'chats.js'));

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ALICE = '919991111111@s.whatsapp.net';
const BOB = '919992222222@s.whatsapp.net';

function makeMsg(id, jid, text, tsSeconds) {
  return {
    key: { remoteJid: jid, id, fromMe: false },
    messageTimestamp: tsSeconds,
    message: { conversation: text },
    pushName: 'Test'
  };
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

// --- Fake socket: one ordered log of EVERY send, with start timestamps,
// so order + pacing can be measured. Per-jid send delays make one chat
// slow without slowing the other.
const sends = []; // { jid, kind, text?, emoji?, at, doneAt }
const delayByJid = new Map();
let sentSeq = 0;
const fakeSock = {
  ws: { isOpen: true, readyState: 1 },
  sendMessage: async (jid, payload) => {
    const at = Date.now();
    const delay = delayByJid.get(jid) || 0;
    if (delay > 0) await sleep(delay);
    if (payload && payload.react) {
      sends.push({ jid, kind: 'react', emoji: payload.react.text, at, doneAt: Date.now() });
      return {};
    }
    if (payload && typeof payload.text === 'string') {
      sends.push({ jid, kind: 'text', text: payload.text, at, doneAt: Date.now() });
      sentSeq += 1;
      return { key: { id: `SENT-${sentSeq}`, remoteJid: jid, fromMe: true } };
    }
    const kind = payload.sticker ? 'sticker' : payload.image ? 'image' : payload.audio ? 'audio' : payload.video ? 'video' : 'media';
    sends.push({ jid, kind, at, doneAt: Date.now() });
    sentSeq += 1;
    return { key: { id: `SENT-${sentSeq}`, remoteJid: jid, fromMe: true } };
  }
};

(async () => {
  // ================= Queue-level tests (OutboundQueue directly) =================
  const qLog = [];
  let qReady = true;
  const q = new OutboundQueue({
    send: async (jid, item) => {
      qLog.push({ jid, kind: item.kind, text: item.text || null, at: Date.now() });
      return { ok: true };
    },
    isReady: () => qReady,
    log: () => {}
  });

  // (a) Three quick text replies to ONE chat are sent as THREE separate
  // messages, in order — never merged into one.
  const qa = qLog.length;
  const p1 = q.enqueueText(ALICE, 'one');
  const p2 = q.enqueueText(ALICE, 'two');
  const p3 = q.enqueueText(ALICE, 'three');
  await Promise.all([p1, p2, p3]);
  const three = qLog.slice(qa);
  check('(a) three quick replies -> three separate sends', three.length === 3);
  check('(a) three sends in order, texts intact',
    three.length === 3 && three[0].text === 'one' && three[1].text === 'two' && three[2].text === 'three');
  check('(a) no merged message', three.every((s) => s.text !== 'one\n\ntwo\n\nthree' && !String(s.text).includes('\n\n')));

  // (b) A pacing gap exists between consecutive sends to the same chat:
  // each send starts >=300 ms after the previous one started (the queue
  // waits PACING_MS after each send when another item is waiting).
  check('(b) pacing gap 1 -> 2 is >=300 ms', three.length === 3 && three[1].at - three[0].at >= 300);
  check('(b) pacing gap 2 -> 3 is >=300 ms', three.length === 3 && three[2].at - three[1].at >= 300);
  check('(b) pacing constant is 400 ms', PACING_MS === 400);

  // (c) Sends to two chats proceed independently: ALICE is slow (600 ms
  // per send), BOB is instant. BOB's message must finish BEFORE ALICE's
  // slow send finishes, even though ALICE was enqueued first.
  const slowLog = [];
  let slowReady = true;
  const q2 = new OutboundQueue({
    send: async (jid, item) => {
      const at = Date.now();
      if (jid === ALICE) await sleep(600);
      slowLog.push({ jid, at, doneAt: Date.now() });
      return { ok: true };
    },
    isReady: () => slowReady,
    log: () => {}
  });
  const pa = q2.enqueueText(ALICE, 'slow one');
  const pb = q2.enqueueText(BOB, 'fast one');
  await Promise.all([pa, pb]);
  const aliceDone = slowLog.find((s) => s.jid === ALICE).doneAt;
  const bobDone = slowLog.find((s) => s.jid === BOB).doneAt;
  check("(c) other chat's send finishes while first chat is slow", bobDone < aliceDone);
  check('(c) both chats still sent', slowLog.length === 2);
  q2.stop();

  // (d) Queue holds when the socket is down and resumes on reconnect.
  qReady = false;
  const qd = qLog.length;
  const held = q.enqueueText(BOB, 'held while down');
  await sleep(250);
  check('(d) nothing sent while socket is down', qLog.length === qd);
  qReady = true;
  q.onConnected();
  const heldResult = await held;
  check('(d) held message sent after reconnect', heldResult && qLog.length === qd + 1 && qLog[qLog.length - 1].text === 'held while down');

  // (e) A stale queued message (>15 s) is dropped on reconnect, never
  // replayed. (Backdate the queued item — the queue measures age from
  // enqueue time, and the test cannot wait 15 s.)
  qReady = false;
  const qe = qLog.length;
  const stale = q.enqueueText(BOB, 'stale — must never arrive');
  await sleep(50); // let it land in the lane
  const lane = q._lanes.get(BOB);
  if (lane && lane.items.length > 0) lane.items[0].enqueuedAt = Date.now() - (STALE_MS + 5000);
  qReady = true;
  q.onConnected();
  const staleResult = await stale;
  await sleep(100);
  check('(e) stale queued message dropped on reconnect', staleResult === false && qLog.length === qe);
  check('(e) staleness window is 15 s', STALE_MS === 15000);

  // (d2) A FRESH held message resumes on reconnect (not dropped).
  qReady = false;
  const qf = qLog.length;
  const fresh = q.enqueueText(BOB, 'fresh held — must arrive');
  await sleep(50);
  qReady = true;
  q.onConnected();
  const freshResult = await fresh;
  check('(d2) fresh held message sent after reconnect', freshResult && qLog.length === qf + 1 && qLog[qLog.length - 1].text === 'fresh held — must arrive');
  q.stop();

  // ================= Bot-level tests (LegeztBot + fake socket) =================
  const bot = new LegeztBot({ authDir: path.join(TMP, 'auth'), log: () => {} });
  bot.sock = fakeSock;
  bot.status = 'connected';
  bot._connectedAt = Date.now();
  const nowSec = Math.floor(Date.now() / 1000);

  // (f) Reaction order: ⏳ before the reply, ✅ after, exactly once each.
  let pingRuns = 0;
  const pingPlugin = {
    name: 'ping',
    run: async ({ reply }) => { pingRuns += 1; await reply('pong'); }
  };
  bot.plugins = new Map([['.ping', pingPlugin], ['ping', pingPlugin]]);
  const rf = sends.length;
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('PING-1', ALICE, '.ping', nowSec)]
  }, fakeSock);
  const pingSends = sends.slice(rf);
  check('(f) .ping: ⏳, reply, ✅ in order, exactly once each',
    pingSends.length === 3
    && pingSends[0].kind === 'react' && pingSends[0].emoji === '⏳'
    && pingSends[1].kind === 'text' && pingSends[1].text === 'pong'
    && pingSends[2].kind === 'react' && pingSends[2].emoji === '✅');
  check('(f) plugin ran once', pingRuns === 1);

  // (a-bot) A plugin that replies three times quickly produces THREE
  // separate messages, in order — never one merged message.
  const triplePlugin = {
    name: 'triple',
    run: async ({ reply }) => {
      reply('one');
      reply('two');
      reply('three');
    }
  };
  bot.plugins.set('.triple', triplePlugin);
  bot.plugins.set('triple', triplePlugin);
  const rt = sends.length;
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('TRIPLE-1', BOB, '.triple', nowSec)]
  }, fakeSock);
  const tripleSends = sends.slice(rt);
  check('(a-bot) three replies -> three separate messages',
    tripleSends.length === 5 // ⏳ + 3 texts + ✅
    && tripleSends[0].kind === 'react' && tripleSends[0].emoji === '⏳'
    && tripleSends[1].kind === 'text' && tripleSends[1].text === 'one'
    && tripleSends[2].kind === 'text' && tripleSends[2].text === 'two'
    && tripleSends[3].kind === 'text' && tripleSends[3].text === 'three'
    && tripleSends[4].kind === 'react' && tripleSends[4].emoji === '✅');
  check('(a-bot) pacing between the three replies',
    tripleSends[2].at - tripleSends[1].at >= 300 && tripleSends[3].at - tripleSends[2].at >= 300);

  // Archive: one line per message actually sent — the three replies are
  // three "out" lines, not one merged line.
  await sleep(150); // fire-and-forget archive chain
  const bobLines = readArchived(BOB).filter((l) => l.direction === 'out');
  const bobTexts = bobLines.map((l) => l.text);
  check('(archive) three replies archived as three out lines',
    bobTexts.includes('one') && bobTexts.includes('two') && bobTexts.includes('three'));
  check('(archive) no merged archive line',
    !bobTexts.some((t) => typeof t === 'string' && t.includes('one\n\ntwo')));

  // Media via the plugin socket goes through the same queue in order:
  // a text reply, then the media, then ✅ — never overtaking.
  const mediaPlugin = {
    name: 'pic',
    run: async ({ reply, sock }) => {
      await reply('here is your picture');
      await sock.sendMessage(BOB, { image: Buffer.from('fake-png') });
    }
  };
  bot.plugins.set('.pic', mediaPlugin);
  bot.plugins.set('pic', mediaPlugin);
  const rm = sends.length;
  await bot._onMessagesUpsert({
    type: 'notify',
    messages: [makeMsg('PIC-1', BOB, '.pic', nowSec)]
  }, fakeSock);
  const picSends = sends.slice(rm);
  check('(media) text, then media, then ✅ — in order, through one queue',
    picSends.length === 4
    && picSends[0].kind === 'react' && picSends[0].emoji === '⏳'
    && picSends[1].kind === 'text' && picSends[1].text === 'here is your picture'
    && picSends[2].kind === 'image'
    && picSends[3].kind === 'react' && picSends[3].emoji === '✅');

  bot._outbound.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('TEST CRASH:', err);
  process.exit(1);
});
