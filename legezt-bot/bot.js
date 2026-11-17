// LEGEZT WhatsApp bot: maintains a self-healing Baileys socket, serves fresh QRs, and runs command plugins.
// Called by server.js for lifecycle, status/QR reporting, WhatsApp messages, and Muse relay responses.
// Requires @whiskeysockets/baileys, qrcode, pino, ./plugins/loader.js, and a writable auth directory.
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const { loadPlugins } = require('./plugins/loader.js');
const { PairingCode } = require('./pairing.js');
const { suggestCommand } = require('./lib/similar.js');
const { check: checkRateLimit, prune: pruneRateLimit } = require('./lib/ratelimit.js');
// P0 (F-08/F-09/F-10): reason-aware reconnect table + 515-guard.
const { decideReconnect, FALSE_LOGOUT_WINDOW_MS, MAX_CONSECUTIVE_BAD_SESSION } = require('./lib/reconnect.js');
const { logUsage } = require('./usage.js');
const { autoSaveMedia } = require('./lib/media.js');
const { archive, extractMessage, noteChatName, getChatDisplayName, isGroupJid } = require('./lib/chats.js');
const { errorCard } = require('./lib/format.js');

// Spam fix (Phase 4): on every (re)connect WhatsApp re-delivers recent
// unread messages as notify, and Baileys can deliver the same message
// twice — without a gate the bot answers old commands again on every
// restart (one command -> many reactions/replies). The gate is two parts:
// (1) FRESHNESS_GRACE_MS — only messages sent after the bot connected
// (minus a small grace for clock skew) are commands; (2) a bounded
// message-ID set — one ID is answered at most once. The gate covers the
// COMMAND path only; archiving and media auto-save run for all messages.
const FRESHNESS_GRACE_MS = 15000;
const MAX_SEEN_MESSAGE_IDS = 2000;

class LegeztBot {
  constructor(opts = {}) {
    this.authDir = opts.authDir || process.env.LEGEZT_AUTH_DIR || '/var/legezt/auth';
    this.pluginDir = opts.pluginDir || path.join(__dirname, 'plugins');
    this.log = opts.log || ((level, msg) => {
      const line = `${new Date().toISOString()} [${String(level).toUpperCase()}] ${msg}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    });
    this.phoneFile = opts.phoneFile || process.env.LEGEZT_PHONE_FILE || '/var/legezt/config/phone.txt';
    this.pairing = new PairingCode();
    fs.mkdirSync(this.authDir, { recursive: true, mode: 0o700 });

    this.QR_MAX_AGE_MS = 45000;
    this.status = 'starting';
    this.account = null;
    this.qrDataUrl = null;
    this.qrIssuedAt = null;
    this.sock = null;
    this.paused = false;
    this.startedAt = Date.now();
    this.lastError = null;
    this.reconnectAttempts = 0;
    this.plugins = new Map();
    this._started = false;
    this._watchdog = null;
    this._reconnectTimer = null;
    this._connecting = null;
    this._generation = 0;
    this._loggedOut = false;
    // P0 (F-06): liveness probe — last time any socket activity was seen
    // (connection.update, messages.upsert, creds.update, or a sent message).
    this._lastActivityAt = Date.now();
    // P0 (F-08): 515-guard — timestamp of the last 515 close, and whether
    // the one 401 it excuses has already been consumed.
    this._last515At = null;
    this._ignored401After515 = false;
    // P0 (F-09): consecutive badSession (500) closes, capped so a corrupt
    // session cannot loop forever (no session backup exists yet, P1 F-13).
    this._consecutiveBadSession = 0;
    // Spam fix (Phase 4): when this connection opened (ms epoch, set on
    // connection === 'open'), and the message IDs already answered in this
    // process (bounded, FIFO eviction — see _noteMessageSeen).
    this._connectedAt = null;
    this._seenMessageIds = new Set();
  }

  async start() {
    if (this._started) return;
    this._started = true;
    try {
      const loaded = await loadPlugins(this.pluginDir, this.log);
      // loadPlugins returns { plugins: Map, list: [...] } — use the Map as-is.
      this.plugins = loaded && loaded.plugins instanceof Map ? loaded.plugins : new Map();
      this._pluginList = Array.isArray(loaded && loaded.list) ? loaded.list : [];
      this.log('info', `Loaded ${this.plugins.size} plugins`);
    } catch (err) {
      this.plugins = new Map();
      this._fail('Plugin loading failed', err);
    }
    try {
      await this._connect();
    } catch (err) {
      this._fail('Connection attempt failed', err);
    }
    this._watchdog = setInterval(() => {
      this._watchdogTick().catch((err) => this._fail('Watchdog failed', err));
    }, 15000);
    // SPEC 13: prune expired antispam states every 60s so quiet chats never
    // keep an entry forever. The Map is also hard-capped (5000 keys).
    this._pruneTimer = setInterval(() => {
      try { pruneRateLimit(); } catch (_) {}
    }, 60000);
  }

  async _connect() {
    if (this.paused) return;
    const ws = this.sock?.ws;
    if (this.sock && (this.status === 'connected' || ws?.isOpen || ws?.readyState === 1)) return;
    if (this._connecting) return this._connecting;

    this._clearReconnect();
    const generation = ++this._generation;
    this._loggedOut = false;
    const previous = this.sock;
    this.sock = null;
    if (previous) {
      try { previous.end(); } catch {}
    }
    this._clearQr();
    this.status = 'unknown';
    this.log('info', `bot connecting (attempt ${this.reconnectAttempts + 1})`);

    const task = (async () => {
      try {
        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        const { version } = await fetchLatestBaileysVersion();
        if (this.paused || generation !== this._generation) return;

        const sock = makeWASocket({
          version,
          auth: state,
          printQRInTerminal: false,
          logger: pino({ level: 'silent' }),
          browser: ['LEGEZT', 'Chrome', '1.0.0'],
          syncFullHistory: false
        });
        this.sock = sock;
        // P0 (F-06): a credential update is socket activity — refresh the
        // liveness timestamp so a quiet-but-alive socket is not recreated.
        sock.ev.on('creds.update', (update) => {
          this._lastActivityAt = Date.now();
          saveCreds(update);
        });
        sock.ev.on('connection.update', (update) => {
          this._onConnectionUpdate(update, sock)
            .catch((err) => this._fail('Connection handler failed', err));
        });
        sock.ev.on('messages.upsert', (update) => {
          this._onMessagesUpsert(update, sock)
            .catch((err) => this._fail('Message handler failed', err));
        });
      } catch (err) {
        if (generation === this._generation && !this.paused) {
          this.sock = null;
          this.status = 'unknown';
          this._fail('Connection attempt failed', err);
        }
      }
    })();
    this._connecting = task;
    try {
      await task;
    } finally {
      if (this._connecting === task) this._connecting = null;
    }
  }

  async _onConnectionUpdate(update, sock) {
    try {
      if (sock && this.sock !== sock) return;
      // P0 (F-06): any connection event is socket activity.
      this._lastActivityAt = Date.now();
      const { connection, lastDisconnect, qr } = update || {};

      if (typeof qr === 'string' && qr.length > 0) {
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          if ((sock && this.sock !== sock) || this.status === 'connected') return;
          this.qrDataUrl = dataUrl;
          this.qrIssuedAt = Date.now();
          this.status = 'waiting';
          this._loggedOut = false;
          this.log('info', 'QR issued (age 0s)');
          // Pairing code refreshes with the QR (fire-and-forget; the QR still works if the code fails).
          this.pairing.maybeRequest(sock, this.qrIssuedAt, this.phoneFile, this.log)
            .catch((err) => this._fail('Pairing code request failed', err));
        } catch (err) {
          this._fail('QR render failed', err);
        }
      }

      if (connection === 'open') {
        this._clearReconnect();
        this.status = 'connected';
        this.account = (sock || this.sock)?.user?.id || null;
        this._clearQr();
        this.reconnectAttempts = 0;
        this._loggedOut = false;
        this._consecutiveBadSession = 0;
        this._ignored401After515 = false;
        // Spam fix (Phase 4): this connection's start time — the freshness
        // gate compares every incoming message against it, so messages
        // sent before this (re)connect are never answered again.
        this._connectedAt = Date.now();
        this.lastError = null;
        this.log('info', `Connected as ${this.account}`);
        return;
      }
      if (connection !== 'close') return;

      this.sock = null;
      this._clearQr();
      this._clearReconnect();
      const code = lastDisconnect?.error?.output?.statusCode;
      this.lastError = lastDisconnect?.error?.message || `Connection closed (code ${code})`;

      // P0 (F-08/F-09/F-10): reason-aware reconnect. The old code had one
      // branch (401 -> stop, everything else -> backoff). That retried a
      // forbidden account forever, fought a replaced session, and killed a
      // healthy bot on the 515 -> 401 false-logout sequence.
      if (code === DisconnectReason.restartRequired) {
        this._last515At = Date.now();
      }
      const recent515 = this._last515At !== null
        && (Date.now() - this._last515At) < FALSE_LOGOUT_WINDOW_MS;
      if (code === DisconnectReason.badSession) {
        this._consecutiveBadSession += 1;
      } else {
        this._consecutiveBadSession = 0;
      }
      const decision = decideReconnect(code, {
        recent515,
        ignored401After515: this._ignored401After515,
        consecutiveBadSession: this._consecutiveBadSession
      });
      // The 515-guard excuses exactly one 401 — consume it so a second 401
      // is treated as a real logout instead of looping forever.
      if (code === DisconnectReason.loggedOut && decision.action === 'immediate') {
        this._ignored401After515 = true;
        this._last515At = null;
      }

      if (decision.action === 'stop') {
        // Terminal: do not auto-reconnect. _loggedOut doubles as the
        // "do not auto-reconnect" flag (the watchdog and resume() honour it);
        // the specific reason is in lastError and the log line.
        this._loggedOut = true;
        this.status = 'disconnected';
        this.log('warn', `Connection closed (code ${code}) — STOPPED: ${decision.reason}`);
        return;
      }

      this._loggedOut = false;
      this.status = 'unknown';
      if (decision.action === 'immediate') {
        // 515 (or a 401 excused by the 515-guard): reconnect NOW, no backoff,
        // and do not count the attempt.
        this.log('warn', `Connection closed (code ${code}) — ${decision.reason}`);
        if (!this.paused) {
          this._connect().catch((err) => this._fail('Reconnect failed', err));
        }
        return;
      }

      this.log('warn', `Connection closed (code ${code}) — ${decision.reason}`);
      const delay = Math.min(2000 * (2 ** this.reconnectAttempts), 30000);
      this.reconnectAttempts += 1;
      if (!this.paused) {
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = null;
          this._connect().catch((err) => this._fail('Reconnect failed', err));
        }, delay);
      }
    } catch (err) {
      this._fail('Connection update failed', err);
    }
  }

  async _watchdogTick() {
    if (this.paused || this._loggedOut) return;
    // P0 (F-06) — connected-state liveness probe. The old watchdog returned
    // immediately when connected, so a socket that died without emitting
    // connection.update (the Levanter 7-hour silent death) was never noticed.
    // Baileys has its own 30s keep-alive (it closes a socket with no frames
    // for 35s), so this is the second layer: it catches a socket that is
    // closed at the transport level, or a handler that stopped running.
    if (this.status === 'connected') {
      const ws = this.sock?.ws;
      // sock.ws is Baileys' WebSocketClient; isOpen is its canonical check
      // (readyState === OPEN). The readyState fallback matches _connect().
      const wsOpen = !!(ws && (ws.isOpen || ws.readyState === 1));
      if (!this.sock || !wsOpen) {
        this.log('warn', 'Liveness probe: socket not open while connected — recreating socket');
        await this._recreateSocket();
        return;
      }
      // Last-activity safety net. A healthy account can be quiet, so this
      // threshold is long (60 min) — a reconnect is cheap, but a silent
      // death used to cost hours. Tunable: lower it if silent deaths recur,
      // raise it if quiet nights cause too many reconnects.
      if (Date.now() - this._lastActivityAt > 60 * 60 * 1000) {
        this.log('warn', 'Liveness probe: no activity for 60m while connected — recreating socket');
        await this._recreateSocket();
        return;
      }
      return;
    }
    const qrAge = this._qrAgeMs();
    if (this.status === 'waiting' && qrAge !== null && qrAge < 60000) return;
    this.log('warn', 'Watchdog: no fresh QR and not connected — recreating socket');
    await this._recreateSocket();
  }

  async _recreateSocket() {
    this._generation += 1;
    this._connecting = null;
    this._clearReconnect();
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      try { sock.end(); } catch {}
    }
    this._clearQr();
    if (!this.paused) this.status = 'unknown';
    await this._connect();
  }

  async _onMessagesUpsert({ messages, type }, sock) {
    try {
      if (type !== 'notify' || (sock && this.sock !== sock)) return;
      // P0 (F-06): an incoming message is socket activity.
      this._lastActivityAt = Date.now();
      for (const msg of messages || []) {
        // fromMe messages are the owner's own messages sent from their phone
        // (the linked account) — the owner triggers commands from their own
        // phone, so they must be processed. The '.' prefix check below
        // prevents reply loops: the bot never sends '.'-prefixed messages.
        if (!msg?.message) continue;
        const text = [
          msg.message.conversation,
          msg.message.extendedTextMessage?.text,
          msg.message.imageMessage?.caption,
          msg.message.videoMessage?.caption
        ].find((value) => typeof value === 'string' && value.trim())?.trim() || '';
        const from = msg.key?.remoteJid;
        if (!from) continue;
        // Media auto-save to the vault (SPEC 12): any incoming document,
        // image, audio/voice note, or video is archived encrypted. It runs
        // for every media message, not just commands, and never blocks
        // command handling or crashes the bot. Once the media is saved, the
        // message itself is archived to the training store (SPEC 6 chats/,
        // Phase 4) with the vault hash, so the archive line can join the
        // message to its file. Both steps are fire-and-forget.
        autoSaveMedia(msg, from, (level, text) => this.log(level, text))
          .then((media) => { this._archiveIncoming(msg, from, media); })
          .catch((err) => {
            this.log('error', 'Media auto-save failed: ' + (err && err.message ? String(err.message).slice(0, 200) : 'unknown error'));
          });
        if (!text.startsWith('.')) continue;

        // Spam fix (Phase 4): only REAL-TIME commands are answered.
        // (1) Freshness — a message sent before this connection started
        // (minus the grace) is a replay from an earlier session, not a
        // new command: ignore it silently — no reaction, no reply, no
        // usage event. The archiver above already recorded it, and the
        // training store keeps the full history.
        if (!this._isFreshMessage(msg)) continue;
        // (2) Dedup — Baileys can deliver the same message twice. One
        // message ID is answered at most once: a repeat delivery is
        // skipped entirely, so one command = one reaction + one reply.
        if (!this._noteMessageSeen(msg)) continue;

        const { command, args } = this._parseCommand(text);
        // Antispam (Toxic-style): per-chat rate limit. Flood (8 cmds/6s)
        // warns once, then ignores; minute cap (18 cmds/60s) ignores
        // silently. A flood can never hang the bot or kill the socket.
        const limit = checkRateLimit(from);
        if (limit === 'warn') {
          await this._sendText(from, 'Slow down — too many commands at once. Try again in a bit.');
          continue;
        }
        if (limit === 'ignore') continue;
        const plugin = this._findPlugin(command);
        if (!plugin) {
          // Typo tolerance (neoxr-style): suggest the closest known command.
          const suggestion = suggestCommand(command, [...this.plugins.keys()]);
          if (suggestion) await this._sendText(from, `Did you mean: ${suggestion}?`);
          else this.log('debug', `No plugin for ${command} from ${from}`);
          continue;
        }
        const name = plugin.name || command.replace(/^\./, '');
        this.log('info', `Plugin ${name} handling ${command} from ${from}`);
        const startedAt = Date.now();
        let ok = true;
        // Loading reaction (SPEC 14): the owner can SEE the command is
        // being worked on. ⏳ now, ✅ on success / ❌ on failure below.
        await this._react(from, msg.key, '⏳');
        try {
          await plugin.run({
            sock: this.sock,
            message: msg,
            from,
            text,
            args,
            plugins: this.plugins,
            log: (level, msg) => this.log(level, msg),
            reply: async (t) => this._sendText(from, t)
          });
          await this._react(from, msg.key, '✅');
        } catch (err) {
          ok = false;
          // Backstop: a plugin that throws (instead of replying a friendly
          // error) is logged here with its name, so it can never fail silently.
          this._fail(`Plugin ${name} failed`, err);
          await this._sendText(from, errorCard('Something went wrong', [
            `The ${name} command failed.`,
            'Try again in a bit — if it keeps failing, tell the owner.'
          ]));
          await this._react(from, msg.key, '❌');
        } finally {
          // Usage event for the dashboard: every plugin invocation, success
          // or failure, with its duration. The chat JID is hashed inside
          // logUsage; no message text is ever stored.
          logUsage({ type: 'plugin', command, chat: from, durationMs: Date.now() - startedAt, ok });
        }
      }
    } catch (err) {
      this._fail('Message handling failed', err);
    }
  }

  // Phase 4: archive one incoming message to the training store
  // (lib/chats.js). Fire-and-forget — a failed archive is logged once and
  // never blocks the command path. Display names are best-effort: a group's
  // subject comes from groupMetadata (cached in chats.js), a 1:1 chat's name
  // from the sender's pushName (never the owner's own name on fromMe).
  _archiveIncoming(msg, from, media) {
    try {
      const entry = extractMessage(msg, {
        from,
        accountJid: this.account,
        media: media || null
      });
      if (entry) archive(entry);
      if (isGroupJid(from)) {
        getChatDisplayName(from, this.sock)
          .then((name) => { if (name) noteChatName(from, name, true); })
          .catch(() => {});
      } else if (!msg.key?.fromMe && typeof msg.pushName === 'string' && msg.pushName.trim() !== '') {
        noteChatName(from, msg.pushName, false);
      }
    } catch (_) {
      // Archiving must never crash the message handler.
    }
  }

  // Spam fix (Phase 4): is this message new enough to answer? A message
  // is fresh when its Baileys timestamp (seconds) is at or after this
  // connection's start, minus FRESHNESS_GRACE_MS for clock skew and for a
  // message sent a breath before the socket opened. Messages without a
  // readable timestamp, and messages arriving before any connection has
  // opened, are treated as fresh — a live command must never be silently
  // dropped just because its timestamp is missing. Only the command path
  // calls this; the relay path (respond) never touches it.
  _isFreshMessage(msg) {
    if (this._connectedAt === null || this._connectedAt === undefined) return true;
    const raw = msg && msg.messageTimestamp;
    let secs = NaN;
    if (typeof raw === 'number') secs = raw;
    else if (typeof raw === 'string') secs = Number(raw);
    else if (raw && typeof raw.toNumber === 'function') {
      try { secs = raw.toNumber(); } catch (_) { secs = NaN; }
    }
    if (!Number.isFinite(secs) || secs <= 0) return true;
    return secs * 1000 >= this._connectedAt - FRESHNESS_GRACE_MS;
  }

  // Spam fix (Phase 4): record a message ID as answered. Returns false
  // when the ID was already answered (the caller must skip the message
  // entirely), true otherwise. The set is bounded (FIFO eviction) so a
  // long-lived process never grows it without a cap. Messages without a
  // usable ID are always treated as new.
  _noteMessageSeen(msg) {
    const id = msg && msg.key && typeof msg.key.id === 'string' ? msg.key.id : null;
    if (id === null || id === '') return true;
    if (this._seenMessageIds.has(id)) return false;
    this._seenMessageIds.add(id);
    while (this._seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
      this._seenMessageIds.delete(this._seenMessageIds.keys().next().value);
    }
    return true;
  }

  // SPEC 14 (gap tolerance): normalise the command before lookup, on
  // both the WhatsApp path and the relay path. Trim, collapse runs of
  // spaces, and allow a space between '.' and the command name, so
  // ". ai", ".  weather  Delhi" and ".ai   hello" all work. A gap must
  // never be a reason for "unknown command".
  _parseCommand(text) {
    const normalized = String(text || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^\.\s+/, '.');
    const parts = normalized === '' ? [] : normalized.split(' ');
    const command = (parts.shift() || '').toLowerCase();
    return { command, args: parts.filter((part) => part !== '') };
  }

  // Loading reaction (SPEC 14): react to the owner's message so he can
  // SEE the command is loading. Best-effort — a failed reaction is
  // logged once and never blocks the command or crashes the bot.
  async _react(jid, key, emoji) {
    try {
      if (!this.sock || !jid || !key) return false;
      await this.sock.sendMessage(jid, { react: { text: emoji, key } });
      return true;
    } catch (err) {
      const detail = err && err.message ? String(err.message).slice(0, 120) : 'unknown error';
      this.log('debug', `Reaction ${emoji} failed: ${detail}`);
      return false;
    }
  }

  _findPlugin(command) {
    return this.plugins.get(command) || this.plugins.get(command.replace(/^\./, '')) || null;
  }

  async _sendText(jid, text) {
    try {
      if (!this.sock) throw new Error('socket is not connected');
      const sent = await this.sock.sendMessage(jid, { text });
      // P0 (F-06): a successful send proves the socket is alive.
      this._lastActivityAt = Date.now();
      // Phase 4: the bot's own reply is the "out" side of the conversation
      // — archive it so the thread is complete. The sent message id dedups
      // against the same message if it also arrives via upsert.
      try {
        archive({
          ts: new Date().toISOString(),
          id: sent && sent.key && typeof sent.key.id === 'string' ? sent.key.id : null,
          chat: jid,
          sender: this.account || 'me',
          senderName: 'LEGEZT',
          direction: 'out',
          type: 'text',
          text: String(text),
          media: null
        });
      } catch (_) {}
      return true;
    } catch (err) {
      this._fail(`Failed to send text to ${jid}`, err);
      return false;
    }
  }

  async respond(message, from) {
    if (typeof message !== 'string' || !message.startsWith('.')) {
      return {
        reply: 'Hi — I am LEGEZT, the WhatsApp bot. I answer commands: send .help to see them, or .ping to check I am alive.',
        handledBy: 'fallback'
      };
    }

    const { command, args } = this._parseCommand(message);
    const plugin = this._findPlugin(command);
    if (!plugin) {
      const suggestion = suggestCommand(command, [...this.plugins.keys()]);
      const hint = suggestion ? ` Did you mean: ${suggestion}?` : '';
      return { reply: `Unknown command.${hint} Send .help for the command list.`, handledBy: 'fallback' };
    }

    const name = plugin.name || command.replace(/^\./, '');
    const replies = [];
    const startedAt = Date.now();
    let ok = true;
    try {
      const result = await plugin.run({
        sock: this.sock,
        message: null,
        from,
        text: message,
        args,
        plugins: this.plugins,
        log: (level, msg) => this.log(level, msg),
        reply: async (t) => {
          if (t !== undefined && t !== null) replies.push(String(t));
          return true;
        }
      });
      if (!replies.length && typeof result === 'string') replies.push(result);
      return { reply: replies.join('\n'), handledBy: name };
    } catch (err) {
      ok = false;
      this._fail(`Plugin ${name} failed`, err);
      return { reply: errorCard('Something went wrong', [
        `The ${name} command failed.`,
        'Try again in a bit — if it keeps failing, tell the owner.'
      ]), handledBy: name };
    } finally {
      logUsage({ type: 'plugin', command, chat: from, durationMs: Date.now() - startedAt, ok });
    }
  }

  pause() {
    this.paused = true;
    this.status = 'disconnected';
    this._generation += 1;
    this._connecting = null;
    this._clearReconnect();
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      try { sock.end(); } catch {}
    }
    this._clearQr();
    this.log('info', 'Bot paused by owner (auth files kept)');
    return this.getStatus();
  }

  resume() {
    this.paused = false;
    this._loggedOut = false;
    this.status = 'unknown';
    this.log('info', 'Bot resumed');
    this._connect().catch((err) => this._fail('Resume connection failed', err));
    return this.getStatus();
  }

  _clearQr() {
    this.qrDataUrl = null;
    this.qrIssuedAt = null;
    this.pairing.clear();
  }

  _clearReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  _qrAgeMs() {
    if (!this.qrDataUrl || !this.qrIssuedAt) return null;
    return Math.max(0, Date.now() - this.qrIssuedAt);
  }

  _fail(message, err) {
    const detail = err?.message || String(err);
    this.lastError = `${message}: ${detail}`;
    this.log('error', this.lastError);
  }

  getStatus() {
    const qrAge = this._qrAgeMs();
    return {
      status: this.status,
      account: this.account,
      qrAgeSec: qrAge === null ? null : Math.floor(qrAge / 1000),
      qrFresh: qrAge !== null && qrAge < this.QR_MAX_AGE_MS,
      paused: this.paused,
      uptimeSec: Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      // P0 (F-06): seconds since the last socket activity, so the Ops page
      // can show liveness instead of only "connected".
      lastActivitySec: Math.max(0, Math.floor((Date.now() - this._lastActivityAt) / 1000)),
      lastError: this.lastError
    };
  }

  getQr() {
    const qrAge = this._qrAgeMs();
    const fresh = qrAge !== null && qrAge < this.QR_MAX_AGE_MS;
    return {
      status: this.status,
      account: this.account,
      qrDataUrl: fresh ? this.qrDataUrl : null,
      pairingCode: this.pairing.get(this.qrIssuedAt, fresh),
      qrAgeSec: qrAge === null ? null : Math.floor(qrAge / 1000),
      qrUpdatedAt: this.qrIssuedAt ? new Date(this.qrIssuedAt).toISOString() : null,
      lastPollAt: new Date().toISOString(),
      lastError: this.lastError
    };
  }

  async requestPairingCode() {
    if (this.status !== 'waiting' || !this.sock) return { ok: false, error: 'not-waiting' };
    return this.pairing.requestFresh(this.sock, this.qrIssuedAt, this.phoneFile, this.log);
  }
}

module.exports = LegeztBot;
module.exports.LegeztBot = LegeztBot;
