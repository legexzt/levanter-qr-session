// Outbound send queue (Phase 4): every WhatsApp send goes through here.
// Called by bot.js for text replies, reactions, and plugin media sends
// (via the plugin-socket wrapper). Needs only Node timers; never throws
// from enqueue; never strands a caller (a dropped item resolves false,
// a dropped media send rejects via the wrapper so plugins see a failure).
//
// Algorithm (owner order 17 Nov 2026): messages go out ONE BY ONE, little
// by little — NEVER one big text all together, NEVER a simultaneous blast.
//   1. Per-chat FIFO lanes (SPEC 13 dispatcher lanes): one queue per
//      chat, strictly sequential — ONE in-flight send per chat at a time,
//      each sendMessage fully awaited before the next starts. A global
//      concurrency cap (MAX_CONCURRENT_SENDS) so the bot never floods.
//      Every reply stays its OWN separate message. NOTHING is ever
//      merged/coalesced/joined.
//   2. Pacing (the time-period rule): after each send, the lane waits
//      PACING_MS (400 ms) before the next send to the SAME chat, so each
//      message's encryption/sender key is fully distributed before the
//      next goes out. This is the fix for "Waiting for this message"
//      decryption failures: paced sequential sends, never a blast. The
//      pause only applies when another item is already waiting — a lone
//      reply is never delayed.
//   3. Send only when ready: the queue sends only while the socket is
//      connected and open (isReady). If the socket drops mid-queue, the
//      queued UNSENT items are HELD (not lost, not duplicated). On
//      reconnect, onConnected() drops anything older than STALE_MS (the
//      same 15 s freshness window as the spam fix) and resumes the rest.
//      A command sent during a deploy is still dropped, as before.
//   4. Reactions go through the same queue in order (⏳, reply, ✅/❌),
//      each as its own paced step, exactly once per fresh command.
//   5. No repeat spam: the freshness gate + message-ID dedup stay the
//      first line of defence; the queue adds the second — an item that
//      was already sent is never sent twice (it leaves the queue before
//      its send starts, and a failed send is never retried, because it
//      may already have been delivered).
// Caps (SPEC 13): MAX_ITEMS_PER_LANE per chat (oldest queued item is
// dropped, logged, resolved false), MAX_LANES chats, MAX_CONCURRENT_SENDS
// in flight. A 5 s sweep prunes stale items so no promise ever pends
// longer than ~STALE_MS + sweep interval, even if the socket never
// comes back.
'use strict';

const PACING_MS = 400;
const STALE_MS = 15000;
const MAX_CONCURRENT_SENDS = 3;
const MAX_ITEMS_PER_LANE = 50;
const MAX_LANES = 500;
const SWEEP_INTERVAL_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class OutboundQueue {
  constructor(opts = {}) {
    if (!opts || typeof opts.send !== 'function') {
      throw new Error('OutboundQueue needs a send(jid, item) function');
    }
    this._send = opts.send;
    this._isReady = typeof opts.isReady === 'function' ? opts.isReady : () => true;
    this._log = typeof opts.log === 'function' ? opts.log : () => {};
    // jid -> { items: [...], pumping: bool }. A lane is deleted as soon as
    // it drains, so the map only ever holds chats with pending work.
    this._lanes = new Map();
    this._inFlight = 0;
    this._slotWaiters = [];
    this._sweepTimer = setInterval(() => {
      try {
        this._pruneStale();
        // Safety net: if a pump was missed (e.g. onConnected was not
        // called), resume any lane that has work while the socket is up.
        if (this._isReady()) {
          for (const jid of [...this._lanes.keys()]) this._kick(jid);
        }
      } catch (_) { /* a sweep must never crash the bot */ }
    }, SWEEP_INTERVAL_MS);
    if (this._sweepTimer && typeof this._sweepTimer.unref === 'function') {
      this._sweepTimer.unref();
    }
  }

  // One text reply. Resolves with the send result, or false when the
  // message was dropped (stale, lane full, or send failed).
  enqueueText(jid, text) {
    return this._enqueue(jid, { kind: 'text', text: String(text) });
  }

  // One media message (image/audio/video/document/sticker). The payload
  // and options are passed through to sock.sendMessage untouched.
  // Resolves with the send result, or false when dropped.
  enqueueMedia(jid, payload, options) {
    return this._enqueue(jid, { kind: 'media', payload, options });
  }

  // One reaction. Resolves true when sent, false when dropped.
  enqueueReact(jid, key, emoji) {
    return this._enqueue(jid, { kind: 'react', key, emoji });
  }

  // Called when the socket (re)opens: drop anything too old to send, then
  // resume every lane. A queued message older than STALE_MS is never
  // replayed.
  onConnected() {
    this._pruneStale();
    for (const jid of [...this._lanes.keys()]) this._kick(jid);
  }

  // Stop the sweep timer (tests / shutdown). Queued items are left alone.
  stop() {
    if (this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }

  _enqueue(jid, fields) {
    return new Promise((resolve) => {
      const item = { ...fields, jid, enqueuedAt: Date.now(), resolve };
      let lane = this._lanes.get(jid);
      if (!lane) {
        if (this._lanes.size >= MAX_LANES) {
          this._log('warn', `Outbound queue full (${MAX_LANES} chats) — dropping ${item.kind} to ${jid}`);
          resolve(false);
          return;
        }
        lane = { items: [], pumping: false };
        this._lanes.set(jid, lane);
      }
      if (lane.items.length >= MAX_ITEMS_PER_LANE) {
        const dropped = lane.items.shift();
        if (dropped) dropped.resolve(false);
        this._log('warn', `Outbound lane for ${jid} full — dropped oldest queued ${dropped ? dropped.kind : 'item'}`);
      }
      lane.items.push(item);
      this._kick(jid);
    });
  }

  _kick(jid) {
    const lane = this._lanes.get(jid);
    if (!lane || lane.pumping) return;
    lane.pumping = true;
    this._pump(jid, lane).catch((err) => {
      // Fail-safe: the pump must never strand callers. If it dies
      // unexpectedly, resolve everything still queued as failed.
      this._log('error', `Outbound pump crashed for ${jid}: ${err && err.message ? err.message : String(err)}`);
      lane.pumping = false;
      while (lane.items.length > 0) lane.items.shift().resolve(false);
      this._lanes.delete(jid);
    });
  }

  async _pump(jid, lane) {
    try {
      while (lane.items.length > 0) {
        // Send only while the socket is connected and open. Otherwise
        // the queued items are HELD (not lost, not duplicated) until
        // the socket comes back and onConnected() resumes the pump.
        if (!this._isReady()) return;
        // Claim the item BEFORE sending: it leaves the queue now, so
        // the sweep can never touch it mid-send and it is never sent
        // twice.
        const item = lane.items.shift();
        if (this._isStale(item)) {
          item.resolve(false);
          continue;
        }
        await this._acquireSlot();
        if (!this._isReady()) {
          // Socket died while waiting for a slot: put the item back at
          // the front (still held, not lost) and stop until reconnect.
          this._releaseSlot();
          lane.items.unshift(item);
          return;
        }
        let result = false;
        try {
          result = await this._send(jid, item);
        } catch (err) {
          // A send that throws mid-flight is NOT retried: it may already
          // have been delivered, and a retry would risk a duplicate.
          // The item is dropped and logged; the owner re-sends the command.
          this._log('warn', `Outbound send failed (${item.kind} to ${jid}): ${err && err.message ? String(err.message).slice(0, 120) : 'unknown error'}`);
          result = false;
        } finally {
          this._releaseSlot();
        }
        item.resolve(result === undefined ? true : result);
        // Pacing: after each send, wait PACING_MS before the next send
        // to the SAME chat — but only when another item is already
        // waiting. A lone reply is never delayed by pacing.
        if (lane.items.length > 0) await sleep(PACING_MS);
      }
    } finally {
      lane.pumping = false;
      if (lane.items.length === 0) this._lanes.delete(jid);
      // If items remain, the socket is down — onConnected() (or the
      // sweep) resumes the pump when the socket is back. Never re-kick
      // here: it would spin while the socket is down.
    }
  }

  _isStale(item) {
    return Date.now() - item.enqueuedAt > STALE_MS;
  }

  // Drop every queued item older than STALE_MS (resolve false). Items are
  // enqueued in chronological order, so once the head is fresh, every
  // later item is fresh too. The item currently being sent was already
  // shifted out of its lane, so the sweep can never touch it.
  _pruneStale() {
    for (const [jid, lane] of this._lanes) {
      while (lane.items.length > 0 && this._isStale(lane.items[0])) {
        lane.items.shift().resolve(false);
      }
      if (lane.items.length === 0 && !lane.pumping) this._lanes.delete(jid);
    }
  }

  // Global concurrency cap (SPEC 13): at most MAX_CONCURRENT_SENDS sends
  // in flight across all chats. A slot is held only for the send itself,
  // never for the pacing pause.
  _acquireSlot() {
    if (this._inFlight < MAX_CONCURRENT_SENDS) {
      this._inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => { this._slotWaiters.push(resolve); });
  }

  _releaseSlot() {
    this._inFlight -= 1;
    if (this._inFlight < 0) this._inFlight = 0;
    while (this._slotWaiters.length > 0 && this._inFlight < MAX_CONCURRENT_SENDS) {
      this._inFlight += 1;
      this._slotWaiters.shift()();
    }
  }
}

module.exports = { OutboundQueue, PACING_MS, STALE_MS, MAX_CONCURRENT_SENDS, MAX_ITEMS_PER_LANE, MAX_LANES };
