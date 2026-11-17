// Generates a PNG QR code for text or a link and sends it as an image.
// Called by the LEGEZT plugin relay for .qr commands.
// Needs the installed qrcode package, a Baileys socket, and the quoted message.
'use strict';

const QRCode = require('qrcode');

const { logPluginError } = require('../lib/errors.js');
const USAGE = '.qr <text or link> — e.g. .qr https://example.com';

async function respond(reply, message) {
  try {
    await reply(message);
  } catch (_) {
    // The returned text remains available to the relay.
  }
  return message;
}

module.exports = {
  name: 'qr',
  command: '.qr',
  description: 'Generate a QR code for text or a link.',
  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      if (args.length < 1) {
        return respond(reply, USAGE);
      }

      const value = args.join(' ').trim().slice(0, 1000);
      if (!value) {
        return respond(reply, USAGE);
      }

      let pngBuffer;
      try {
        pngBuffer = await QRCode.toBuffer(value, {
          type: 'png',
          width: 512,
          margin: 2,
          errorCorrectionLevel: 'M'
        });
      } catch (err) {
        logPluginError(log, 'qr', err);
        return respond(reply, 'Could not make that QR code.');
      }

      try {
        await sock.sendMessage(from, {
          image: pngBuffer,
          caption: value.slice(0, 200)
        }, { quoted: message });
      } catch (err) {
        logPluginError(log, 'qr', err);
        return respond(reply, 'Could not send the QR code — try again.');
      }

      return value;
    } catch (err) {
      logPluginError(log, 'qr', err);
      return respond(reply, 'Could not make that QR code.');
    }
  }
};
