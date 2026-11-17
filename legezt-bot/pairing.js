// Requests and validates Baileys pairing codes and tracks them per QR code.
// Called by bot.js for QR-triggered and on-demand pairing code requests.
// Needs fs, a live Baileys socket, and the owner phone number file path.
const fs = require('fs');

function writeLog(log, level, message) {
  try {
    // bot.js passes its log as a function log(level, msg); other callers
    // may pass an object with level methods. Support both, never throw.
    if (typeof log === 'function') {
      log(level, message);
      return;
    }
    if (log && typeof log[level] === 'function') log[level](message);
  } catch (err) {
    // Logging must not break pairing.
  }
}

function readPhoneNumber(phoneFile, log) {
  let value;
  try {
    value = fs.readFileSync(phoneFile, 'utf8').trim();
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      writeLog(log, 'warn', 'phone file missing/invalid');
    }
    return null;
  }
  if (!/^[0-9]{10,15}$/.test(value)) {
    writeLog(log, 'warn', 'phone file invalid');
    return null;
  }
  return value;
}

async function requestPairingCodeForSocket(sock, phoneNumber, log) {
  let timer = null;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('pairing code timeout')), 10000);
    });
    const result = await Promise.race([sock.requestPairingCode(phoneNumber), timeout]);
    const code = String(result == null ? '' : result).trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      writeLog(log, 'error', 'pairing code response invalid');
      return null;
    }
    return code;
  } catch (err) {
    writeLog(log, 'error', 'pairing code request failed or timed out');
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class PairingCode {
  constructor() {
    this.code = null;
    this.issuedAt = null;
    this.forQrAt = null;
    this.lastRequestAt = 0;
  }

  clear() {
    this.code = null;
    this.issuedAt = null;
    this.forQrAt = null;
    this.lastRequestAt = 0;
  }

  get(qrIssuedAt, qrFresh) {
    if (qrFresh && this.code && this.forQrAt === qrIssuedAt) return this.code;
    return null;
  }

  async maybeRequest(sock, qrIssuedAt, phoneFile, log) {
    try {
      if (this.code && this.forQrAt === qrIssuedAt) return this.code;
      if (Date.now() - this.lastRequestAt < 20000) return this.code;
      const phoneNumber = readPhoneNumber(phoneFile, log);
      if (!phoneNumber) {
        writeLog(log, 'warn', 'pairing code unavailable: owner phone number not configured');
        return null;
      }
      if (!sock) return null;
      this.lastRequestAt = Date.now();
      const code = await requestPairingCodeForSocket(sock, phoneNumber, log);
      if (!code) {
        this.code = null;
        writeLog(log, 'error', 'Pairing code request failed');
        return null;
      }
      this.code = code;
      this.issuedAt = Date.now();
      this.forQrAt = qrIssuedAt;
      writeLog(log, 'info', 'Pairing code issued');
      return code;
    } catch (err) {
      this.code = null;
      writeLog(log, 'error', 'Pairing code request failed');
      return null;
    }
  }

  async requestFresh(sock, qrIssuedAt, phoneFile, log) {
    try {
      const phoneNumber = readPhoneNumber(phoneFile, log);
      if (!phoneNumber) return { ok: false, error: 'phone-not-configured' };
      if (!sock) return { ok: false, error: 'no-socket' };
      if (Date.now() - this.lastRequestAt < 5000) {
        return { ok: false, error: 'too-soon' };
      }
      this.lastRequestAt = Date.now();
      const code = await requestPairingCodeForSocket(sock, phoneNumber, log);
      if (!code) return { ok: false, error: 'request-failed' };
      this.code = code;
      this.issuedAt = Date.now();
      // Bind the fresh code to the current QR so get() exposes it at once.
      this.forQrAt = qrIssuedAt;
      return { ok: true, pairingCode: code };
    } catch (err) {
      writeLog(log, 'error', 'Pairing code request failed');
      return { ok: false, error: 'request-failed' };
    }
  }
}

module.exports = { readPhoneNumber, requestPairingCodeForSocket, PairingCode };
