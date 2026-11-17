// Searches Openverse and sends the first matching image.
// Called by the LEGEZT plugin relay when a user runs .img.
// Needs Node 20+ global fetch and access to Openverse and image hosts.
'use strict';


const { logPluginError } = require('../lib/errors.js');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

async function respond(reply, text) {
  try {
    await reply(text);
  } catch (_) {
    // The returned text still lets the relay path provide the response.
  }
  return text;
}

async function searchOpenverse(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=3`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Openverse request failed');
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'image/*' }
    });

    if (!response.ok) {
      controller.abort();
      throw new Error('Image request failed');
    }

    const contentType = (response.headers.get('content-type') || '')
      .trim()
      .toLowerCase();

    if (!contentType.startsWith('image/')) {
      controller.abort();
      throw new Error('Response was not an image');
    }

    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader) {
      const declaredLength = Number(lengthHeader);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        controller.abort();
        throw new Error('Image exceeded the size limit');
      }
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        controller.abort();
        throw new Error('Image exceeded the size limit');
      }
      return Buffer.from(bytes);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    while (true) {
      const part = await reader.read();
      if (part.done) break;

      const value = part.value;
      if (!value || !value.byteLength) continue;

      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        controller.abort();
        try {
          await reader.cancel();
        } catch (_) {
          // The download is already being aborted.
        }
        throw new Error('Image exceeded the size limit');
      }

      chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  name: 'img',
  command: '.img',
  description: 'Search Openverse and send the top image.',

  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      const query = Array.isArray(args) ? args.join(' ').trim() : '';
      if (!query) {
        return respond(
          reply,
          '.img <what to search> — e.g. .img sunset over the sea'
        );
      }

      const data = await searchOpenverse(query);
      const results = data && Array.isArray(data.results) ? data.results : [];

      if (results.length === 0) {
        return respond(reply, `No images found for "${query}".`);
      }

      const first = results[0];
      if (!first || typeof first !== 'object') {
        return respond(reply, 'Image search failed, try again in a bit.');
      }

      const sourceLink = first.foreign_landing_url || first.url || '';
      if (!sourceLink) {
        return respond(reply, 'Image search failed, try again in a bit.');
      }

      const linkText = `Here is an image for "${query}": ${sourceLink}`;
      let imageBuffer;

      try {
        imageBuffer = await downloadImage(first.url);
      } catch (err) {
        logPluginError(log, 'img', err);
        return respond(reply, linkText);
      }

      const title = first.title || query;
      try {
        await sock.sendMessage(
          from,
          {
            image: imageBuffer,
            caption: `${title}\n${sourceLink}`
          },
          { quoted: message }
        );
      } catch (err) {
        logPluginError(log, 'img', err);
        return respond(reply, linkText);
      }

      return undefined;
    } catch (err) {
      logPluginError(log, 'img', err);
      return respond(reply, 'Image search failed, try again in a bit.');
    }
  }
};
