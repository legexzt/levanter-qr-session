/**
 * server.js — Levanter QR Session Manager
 *
 * Serves a mobile-friendly page where the owner can:
 *   - see the live WhatsApp pairing QR for Levanter (auto-refreshed)
 *   - see connection status (Waiting to scan / Connected)
 *   - disconnect the session (deletes Levanter's auth files + restarts it)
 *     so a fresh QR is generated
 *
 * The QR is recovered from Levanter's PM2 logs (Baileys prints it with
 * qrcode-terminal). See qr-extract.js.
 *
 * Env:
 *   PORT           default 8080
 *   LEVANTER_DIR   default /home/ubuntu/levanter
 *   PM2_NAME       default levanter
 *   POLL_MS        default 10000 (how often to re-read the logs)
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile, exec } = require('child_process')
const express = require('express')
const { extractQrString, qrStringToDataUrl } = require('./qr-extract')

const PORT = parseInt(process.env.PORT || '8080', 10)
// P0 (F-31): bind to localhost only. The dashboard no longer proxies this
// service (it uses legezt-bot on 127.0.0.1:3001), and binding 0.0.0.0 with
// no auth exposed the live QR — and a disconnect endpoint that DELETES auth
// files — to the whole internet. Localhost keeps the deploy health check
// (curl http://localhost:8080/api/health) and any same-host tooling working.
const HOST = process.env.HOST || '127.0.0.1'
const LEVANTER_DIR = process.env.LEVANTER_DIR || '/home/ubuntu/levanter'
const PM2_NAME = process.env.PM2_NAME || 'levanter'
const POLL_MS = parseInt(process.env.POLL_MS || '10000', 10)
const QR_FRESH_MS = 120000 // a QR seen within this window means "waiting to scan"

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const state = {
  qrString: null,
  qrDataUrl: null,
  qrUpdatedAt: null,
  qrFormat: null,
  status: 'unknown', // waiting | connected | unknown
  account: null,
  levanterUp: null,
  lastPollAt: null,
  lastError: null,
}

function log (...args) {
  console.log(new Date().toISOString(), ...args)
}

function pm2LogPath () {
  const pm2Home = process.env.PM2_HOME || path.join(os.homedir(), '.pm2')
  return path.join(pm2Home, 'logs', `${PM2_NAME}-out.log`)
}

/** Read the tail (last ~512 KB) of a file. */
function readTail (file, maxBytes = 512 * 1024) {
  try {
    const st = fs.statSync(file)
    const start = Math.max(0, st.size - maxBytes)
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(st.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    return buf.toString('utf8')
  } catch (e) {
    return null
  }
}

function pm2LogsCli () {
  return new Promise(resolve => {
    exec(`pm2 logs ${PM2_NAME} --lines 500 --nostream`, { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout)
    })
  })
}

function detectAccount (text) {
  const m = text.match(/(\d{10,15})@s\.whatsapp\.net/)
  if (m) return '+' + m[1]
  const m2 = text.match(/(?:connected|logged in|paired)[^\n]{0,80}?(\d{10,15})/i)
  return m2 ? '+' + m2[1] : null
}

function detectStatus (text, qrFresh) {
  if (qrFresh) return 'waiting'
  if (/connection\s*open|connected(\s+as|\s+to)?|logged in|is now online|opened connection/i.test(text)) return 'connected'
  return 'unknown'
}

async function pollOnce () {
  state.lastPollAt = new Date().toISOString()
  let text = readTail(pm2LogPath())
  if (text === null) {
    text = await pm2LogsCli()
  }
  if (text === null) {
    state.lastError = 'cannot read levanter logs'
    state.levanterUp = false
    return
  }
  state.lastError = null
  state.levanterUp = true

  const found = extractQrString(text)
  if (found && found.qrString !== state.qrString) {
    try {
      state.qrDataUrl = await qrStringToDataUrl(found.qrString)
      state.qrString = found.qrString
      state.qrFormat = found.format
      state.qrUpdatedAt = new Date().toISOString()
      log('new QR captured (format:', found.format + ')')
    } catch (e) {
      state.lastError = 'qr render failed: ' + e.message
    }
  }
  const qrFresh = !!(state.qrUpdatedAt && (Date.now() - new Date(state.qrUpdatedAt).getTime() < QR_FRESH_MS))
  state.status = detectStatus(text, qrFresh)
  const account = detectAccount(text)
  if (account) state.account = account
}

/** Find Levanter's WhatsApp session/auth directories (best effort). */
function findSessionDirs () {
  const found = []
  let sessionId = null
  try {
    const envText = fs.readFileSync(path.join(LEVANTER_DIR, 'config.env'), 'utf8')
    const m = envText.match(/^SESSION_ID\s*=\s*(.+)$/m)
    if (m) sessionId = m[1].trim().replace(/^['"]|['"]$/g, '')
  } catch (_) { /* no config.env */ }
  let entries = []
  try {
    entries = fs.readdirSync(LEVANTER_DIR, { withFileTypes: true })
  } catch (_) { /* dir missing */ }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const name = e.name
    if (/^(session|auth)/i.test(name) || (sessionId && name.includes(sessionId))) {
      found.push(path.join(LEVANTER_DIR, name))
    }
  }
  // Baileys multi-file auth also drops a creds.json at the top level sometimes.
  const creds = path.join(LEVANTER_DIR, 'creds.json')
  if (fs.existsSync(creds)) found.push(creds)
  return { found, sessionId, entries: entries.map(e => e.name) }
}

function rmrf (p) {
  return new Promise((resolve, reject) => {
    execFile('rm', ['-rf', '--', p], err => (err ? reject(err) : resolve()))
  })
}

function pm2Restart () {
  return new Promise((resolve, reject) => {
    exec(`pm2 restart ${PM2_NAME}`, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message))
      resolve(stdout)
    })
  })
}

app.get('/api/qr', (req, res) => {
  res.json({
    status: state.status,
    account: state.account,
    levanterUp: state.levanterUp,
    qrDataUrl: state.qrDataUrl,
    qrUpdatedAt: state.qrUpdatedAt,
    qrAgeSec: state.qrUpdatedAt ? Math.round((Date.now() - new Date(state.qrUpdatedAt).getTime()) / 1000) : null,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
  })
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, levanterUp: state.levanterUp, status: state.status, lastPollAt: state.lastPollAt })
})

app.post('/api/disconnect', async (req, res) => {
  log('disconnect requested')
  const { found, sessionId, entries } = findSessionDirs()
  if (found.length === 0) {
    return res.status(409).json({
      ok: false,
      error: 'No Levanter session/auth folder found — nothing to disconnect.',
      sessionId,
      topLevelEntries: entries.slice(0, 40),
    })
  }
  // Safety: only delete paths inside LEVANTER_DIR.
  for (const p of found) {
    if (!p.startsWith(LEVANTER_DIR + path.sep)) {
      return res.status(400).json({ ok: false, error: 'Refusing to delete path outside levanter dir: ' + p })
    }
  }
  try {
    for (const p of found) {
      await rmrf(p)
      log('deleted session path:', p)
    }
    await pm2Restart()
    log('levanter restarted after disconnect')
    state.qrString = null
    state.qrDataUrl = null
    state.qrUpdatedAt = null
    state.status = 'unknown'
    state.account = null
    // Wait for a fresh QR (up to ~75s).
    let fresh = null
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 7500))
      await pollOnce()
      if (state.qrDataUrl) { fresh = state.qrDataUrl; break }
    }
    res.json({ ok: true, deleted: found, restarted: true, freshQrAvailable: !!fresh, qrDataUrl: fresh })
  } catch (e) {
    log('disconnect failed:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

setInterval(() => { pollOnce().catch(e => log('poll error:', e.message)) }, POLL_MS)
pollOnce().catch(e => log('initial poll error:', e.message))

app.listen(PORT, HOST, () => {
  log(`qr-session listening on http://${HOST}:${PORT} (levanter dir: ${LEVANTER_DIR})`)
})
