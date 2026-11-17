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
        sock.ev.on('creds.update', saveCreds);
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

      if (code === DisconnectReason.loggedOut) {
        this._loggedOut = true;
        this.status = 'disconnected';
        this.log('warn', 'Logged out from phone — fresh scan needed (auth files kept, nothing deleted)');
        return;
      }

      this._loggedOut = false;
      this.status = 'unknown';
      this.log('warn', `Connection closed (code ${code}) — reconnecting`);
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
    if (this.paused || this._loggedOut || this.status === 'connected') return;
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
        if (!from || !text.startsWith('.')) continue;

        const { command, args } = this._parseCommand(text);
        const plugin = this._findPlugin(command);
        if (!plugin) {
          this.log('debug', `No plugin for ${command} from ${from}`);
          continue;
        }
        const name = plugin.name || command.replace(/^\./, '');
        this.log('info', `Plugin ${name} handling ${command} from ${from}`);
        try {
          await plugin.run({
            sock: this.sock,
            message: msg,
            from,
            text,
            args,
            plugins: this.plugins,
            reply: async (t) => this._sendText(from, t)
          });
        } catch (err) {
          this._fail(`Plugin ${name} failed`, err);
          await this._sendText(from, `Plugin ${name} failed.`);
        }
      }
    } catch (err) {
      this._fail('Message handling failed', err);
    }
  }

  _parseCommand(text) {
    const parts = text.trim().split(/\s+/);
    const command = (parts.shift() || '').toLowerCase();
    return { command, args: parts };
  }

  _findPlugin(command) {
    return this.plugins.get(command) || this.plugins.get(command.replace(/^\./, '')) || null;
  }

  async _sendText(jid, text) {
    try {
      if (!this.sock) throw new Error('socket is not connected');
      await this.sock.sendMessage(jid, { text });
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
      return { reply: 'Unknown command. Send .help for the command list.', handledBy: 'fallback' };
    }

    const name = plugin.name || command.replace(/^\./, '');
    const replies = [];
    try {
      const result = await plugin.run({
        sock: this.sock,
        message: null,
        from,
        text: message,
        args,
        plugins: this.plugins,
        reply: async (t) => {
          if (t !== undefined && t !== null) replies.push(String(t));
          return true;
        }
      });
      if (!replies.length && typeof result === 'string') replies.push(result);
      return { reply: replies.join('\n'), handledBy: name };
    } catch (err) {
      this._fail(`Plugin ${name} failed`, err);
      return { reply: `Plugin ${name} failed.`, handledBy: name };
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
