/**
 * qr-extract.js — recover the WhatsApp pairing QR string from Levanter's
 * PM2 log output and render it as a clean, scannable QR image.
 *
 * How Levanter prints the QR:
 *   Levanter (Baileys) prints the pairing QR with `qrcode-terminal`
 *   (small mode). The log therefore contains an ASCII-art block made of
 *   half-block characters: █ ▀ ▄ and space. Each character encodes TWO
 *   vertical modules (top + bottom). This module decodes that block back
 *   into the original QR string (via jsQR) and re-renders it as a crisp
 *   PNG data URL (via `qrcode`).
 *
 * It also handles the non-small variants (double-width ██ / single char)
 * and, as a last resort, a raw pairing string printed on its own line.
 */
'use strict'

const jsQR = require('jsqr')
const QRCode = require('qrcode')

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]/g
const QR_CHARS = new Set(['█', '▀', '▄', ' '])

function stripAnsi (s) {
  return s.replace(ANSI_RE, '')
}

/**
 * Remove a PM2 CLI prefix such as `0|levanter  | ` from a log line.
 * Log-file lines (raw stdout) have no prefix, so this is a no-op for them.
 * QR content never contains '|', so stripping up to the first '|' is safe
 * for QR lines.
 */
function stripPm2Prefix (line) {
  const m = line.match(/^(?:.*\|)\s*(.*)$/)
  if (m && /[█▀▄]/.test(m[1])) return m[1]
  return line
}

function isQrLine (line) {
  if (!line || line.length < 10) return false
  let dark = 0
  for (const ch of line) {
    if (!QR_CHARS.has(ch)) return false
    if (ch !== ' ') dark++
  }
  return dark >= 3
}

/** Find contiguous runs of QR-art lines in the log text. */
function findQrBlocks (text) {
  const lines = stripAnsi(text).split('\n').map(stripPm2Prefix)
  const blocks = []
  let cur = []
  for (const line of lines) {
    if (isQrLine(line)) {
      cur.push(line)
    } else {
      if (cur.length >= 8) blocks.push(cur)
      cur = []
    }
  }
  if (cur.length >= 8) blocks.push(cur)
  return blocks
}

/** Small mode: one char = two vertical modules. */
function matrixFromSmall (block) {
  const width = Math.max(...block.map(l => l.length))
  const height = block.length * 2
  const m = Array.from({ length: height }, () => new Array(width).fill(0))
  block.forEach((line, i) => {
    for (let x = 0; x < line.length; x++) {
      const ch = line[x]
      if (ch === '█') { m[i * 2][x] = 1; m[i * 2 + 1][x] = 1 } else if (ch === '▀') { m[i * 2][x] = 1 } else if (ch === '▄') { m[i * 2 + 1][x] = 1 }
    }
  })
  return m
}

/** Non-small mode: '██' = dark module, '  ' = light module. */
function matrixFromDoubleWidth (block) {
  const width = Math.floor(Math.max(...block.map(l => l.length)) / 2)
  const m = block.map(line => {
    const row = new Array(width).fill(0)
    for (let x = 0; x < width; x++) {
      if (line[x * 2] === '█') row[x] = 1
    }
    return row
  })
  return m
}

/** Single-char mode: '█' = dark module, ' ' = light module. */
function matrixFromSingle (block) {
  const width = Math.max(...block.map(l => l.length))
  return block.map(line => {
    const row = new Array(width).fill(0)
    for (let x = 0; x < line.length; x++) if (line[x] === '█') row[x] = 1
    return row
  })
}

function decodeMatrix (matrix) {
  const h = matrix.length
  const w = matrix[0].length
  if (w < 21 || h < 21) return null
  const scale = 4
  const W = w * scale
  const H = h * scale
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = matrix[Math.floor(y / scale)][Math.floor(x / scale)] ? 0 : 255
      const o = (y * W + x) * 4
      data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255
    }
  }
  try {
    const res = jsQR(data, W, H)
    return res ? res.data : null
  } catch (_) {
    return null
  }
}

/** Last-resort: a raw pairing string printed on its own log line. */
function findRawQrString (text) {
  const lines = stripAnsi(text).split('\n').map(stripPm2Prefix)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (/^[A-Za-z0-9+/=_.,-]{60,}$/.test(line) && !/\s/.test(line)) {
      return line
    }
  }
  return null
}

/**
 * Extract the latest pairing QR string from raw log text.
 * Returns { qrString, format } or null.
 */
function extractQrString (text) {
  const blocks = findQrBlocks(text)
  for (let b = blocks.length - 1; b >= 0; b--) {
    const block = blocks[b]
    for (const [name, fn] of [['small', matrixFromSmall], ['double', matrixFromDoubleWidth], ['single', matrixFromSingle]]) {
      let decoded = null
      try { decoded = decodeMatrix(fn(block)) } catch (_) { /* try next */ }
      if (decoded) return { qrString: decoded, format: name }
    }
  }
  const raw = findRawQrString(text)
  if (raw) return { qrString: raw, format: 'raw' }
  return null
}

async function qrStringToDataUrl (qrString) {
  return QRCode.toDataURL(qrString, { errorCorrectionLevel: 'M', margin: 2, width: 512 })
}

module.exports = { extractQrString, qrStringToDataUrl, findQrBlocks, stripAnsi, stripPm2Prefix }
