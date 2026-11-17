// Converts an image or short video into a WhatsApp WebP sticker.
// Called by the LEGEZT plugin relay when a user runs .sticker.
// Needs Baileys media downloads, ffmpeg, and writable temporary storage.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const { logPluginError } = require('../lib/errors.js');
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
let queue = Promise.resolve();

function getMediaTarget(message, from) {
  // Returns a Baileys message object whose media can be downloaded, or null.
  // Case 1: the message itself is an image/video (caption holds the command).
  const direct = message && message.message;
  if (direct && (direct.imageMessage || direct.videoMessage)) return message;
  // Case 2: the message is a text reply quoting an image/video.
  const ctx = direct && direct.extendedTextMessage && direct.extendedTextMessage.contextInfo;
  const quoted = ctx && ctx.quotedMessage;
  if (quoted && (quoted.imageMessage || quoted.videoMessage)) {
    return {
      key: { remoteJid: from, id: ctx.stanzaId || '', fromMe: false, participant: ctx.participant || undefined },
      message: quoted
    };
  }
  return null;
}

async function respond(reply, text) {
  try {
    await reply(text);
  } catch (_) {
    // The returned text still lets the relay path provide the response.
  }
  return text;
}

function runFfmpeg(ffmpegArgs) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ffmpegArgs,
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }
    );
  });
}

async function unlinkQuietly(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (_) {
    // Temporary-file cleanup is best effort.
  }
}

async function convertToWebp(inputBuffer, isVideo) {
  const token = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join(os.tmpdir(), `legezt-sticker-${token}.input`);
  const outputPath = path.join(os.tmpdir(), `legezt-sticker-${token}.webp`);

  try {
    await fs.promises.writeFile(inputPath, inputBuffer);

    const ffmpegArgs = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath
    ];

    if (isVideo) {
      ffmpegArgs.push('-t', '6');
    }

    ffmpegArgs.push(
      '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '60',
      '-loop', '0',
      '-preset', 'default',
      '-an',
      '-vsync', '0',
      outputPath
    );

    await runFfmpeg(ffmpegArgs);
    return await fs.promises.readFile(outputPath);
  } finally {
    await Promise.all([
      unlinkQuietly(inputPath),
      unlinkQuietly(outputPath)
    ]);
  }
}

async function doSticker({ sock, message, from, reply, log }) {
  const target = getMediaTarget(message, from);
  if (!target) {
    return respond(
      reply,
      'Send .sticker as the caption of an image/video, or reply .sticker to an image/video.'
    );
  }

  const videoMessage = target.message && target.message.videoMessage;
  const isVideo = Boolean(videoMessage);
  const duration = isVideo ? Number(videoMessage.seconds || 0) : 0;

  if (isVideo && duration > 30) {
    return respond(reply, 'Video too long for a sticker (max 30s).');
  }

  let inputBuffer;
  try {
    inputBuffer = await downloadMediaMessage(target, 'buffer', {});
  } catch (err) {
    logPluginError(log, 'sticker', err);
    return respond(reply, 'Could not download that media — try sending it again.');
  }

  if (inputBuffer.length > MAX_INPUT_BYTES) {
    return respond(reply, 'That file is too big for a sticker (max 20MB).');
  }

  let webpBuffer;
  try {
    webpBuffer = await convertToWebp(inputBuffer, isVideo);
  } catch (err) {
    logPluginError(log, 'sticker', err);
    return respond(reply, 'Could not convert that media to a sticker.');
  }

  try {
    await sock.sendMessage(from, { sticker: webpBuffer }, { quoted: message });
  } catch (err) {
    logPluginError(log, 'sticker', err);
    return respond(reply, 'Could not send the sticker — try again.');
  }

  return undefined;
}

module.exports = {
  name: 'sticker',
  command: '.sticker',
  description: 'Convert an image or short video into a WhatsApp sticker.',

  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      const job = queue.then(() => doSticker({ sock, message, from, reply, log }));
      queue = job.catch(() => {});
      const result = await job;
      return result;
    } catch (err) {
      logPluginError(log, 'sticker', err);
      return respond(reply, 'Could not make that sticker — try again.');
    }
  }
};
