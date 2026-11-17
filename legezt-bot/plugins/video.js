// Searches YouTube and sends a video as MP4, falling back to its link.
// Called by the LEGEZT plugin relay through the exported run function.
// Needs the Baileys message context plus yt-search and play-dl.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const yts = require('yt-search');
const playdl = require('play-dl');

const { logPluginError } = require('../lib/errors.js');
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15000;
const SEARCH_TIMEOUT_MS = 12000;

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function remainingTime(deadline) {
  const ms = deadline - Date.now();
  if (ms <= 0) throw new Error('timeout');
  return ms;
}

function isYouTubeUrl(query) {
  return /youtu\.?be/.test(query) || (
    /^https?:\/\//i.test(query) &&
    (query.includes('youtube.com/watch') || query.includes('youtu.be/'))
  );
}

async function searchVideo(query) {
  let result = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await withTimeout(yts(query), SEARCH_TIMEOUT_MS);
      break;
    } catch (_) {
      if (attempt === 1) return null;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (!result || !Array.isArray(result.videos) || result.videos.length === 0) {
    return null;
  }

  for (const video of result.videos) {
    if (video && !video.isLive && video.url) return video;
  }

  return null;
}

async function downloadToFile(readable, extension, maxBytes, timeoutMs) {
  const tempPath = path.join(
    os.tmpdir(),
    crypto.randomBytes(8).toString('hex') + extension
  );

  let output = null;
  let limiter = null;
  let bytes = 0;
  let keepFile = false;

  try {
    if (!readable || typeof readable.pipe !== 'function') return null;

    limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          callback(new Error('too big'));
          return;
        }
        callback(null, chunk);
      }
    });

    output = fs.createWriteStream(tempPath, { flags: 'wx' });
    await withTimeout(pipeline(readable, limiter, output), timeoutMs);

    if (bytes <= 0) return null;

    keepFile = true;
    return { path: tempPath, size: bytes };
  } catch (_) {
    return null;
  } finally {
    if (!keepFile) {
      try {
        if (readable && typeof readable.destroy === 'function') readable.destroy();
      } catch (_) {}

      try {
        if (limiter && typeof limiter.destroy === 'function') limiter.destroy();
      } catch (_) {}

      try {
        if (output && typeof output.destroy === 'function') output.destroy();
      } catch (_) {}

      try {
        await fs.promises.unlink(tempPath);
      } catch (_) {}
    }
  }
}

async function downloadVideo(url) {
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;

  try {
    let ms = remainingTime(deadline);
    const info = await withTimeout(playdl.video_info(url), ms);

    let streamInfo;
    try {
      ms = remainingTime(deadline);
      streamInfo = await withTimeout(
        playdl.stream_from_info(info, { quality: 18 }),
        ms
      );
    } catch (_) {
      ms = remainingTime(deadline);
      streamInfo = await withTimeout(playdl.stream_from_info(info), ms);
    }

    if (!streamInfo || !streamInfo.stream) return null;

    ms = remainingTime(deadline);
    return await downloadToFile(
      streamInfo.stream,
      '.mp4',
      MAX_VIDEO_BYTES,
      ms
    );
  } catch (_) {
    return null;
  }
}

async function run({ log, sock, message, from, text, args, plugins, reply }) {
  let tempPath = null;
  let title = 'YouTube video';
  let url = '';
  let searchLink = 'https://www.youtube.com/';

  try {
    const query = Array.isArray(args) ? args.join(' ').trim() : '';
    searchLink = 'https://www.youtube.com/results?search_query=' +
      encodeURIComponent(query);

    if (!query) {
      const usage = '.video <video name> — e.g. .video funny cats';
      await reply(usage);
      return usage;
    }

    let video;
    if (isYouTubeUrl(query)) {
      video = { title: 'YouTube video', url: query, duration: null };
    } else {
      video = await searchVideo(query);
    }

    if (!video || !video.url) {
      const notFound = 'Could not find that video on YouTube. Try a search here: ' +
        searchLink;
      await reply(notFound);
      return notFound;
    }

    title = String(video.title || 'YouTube video');
    url = String(video.url);

    const seconds = video.duration ? Number(video.duration.seconds) : NaN;
    if (Number.isFinite(seconds) && seconds > 600) {
      const tooLong = `${title}\n${url}\n(Too long to download — here is the link.)`;
      await reply(tooLong);
      return tooLong;
    }

    await reply(`Downloading… 🎬 ${title}`);

    const downloaded = await downloadVideo(url);
    if (downloaded && downloaded.path) tempPath = downloaded.path;

    if (!downloaded || !downloaded.path || !downloaded.size) {
      logPluginError(log, 'video', new Error('video download failed — sending link'));
      const failure = `${title}\n${url}\n(Could not download the video — here is the link.)`;
      await reply(failure);
      return failure;
    }

    const videoBuffer = await fs.promises.readFile(tempPath);
    if (videoBuffer.length === 0) {
      const failure = `${title}\n${url}\n(Could not download the video — here is the link.)`;
      await reply(failure);
      return failure;
    }

    await sock.sendMessage(from, {
      video: videoBuffer,
      mimetype: 'video/mp4',
      caption: title
    }, { quoted: message });

    return title;
  } catch (err) {
    logPluginError(log, 'video', err);
    const failure = url
      ? `${title}\n${url}\n(Could not download the video — here is the link.)`
      : 'Could not find that video on YouTube. Try a search here: ' + searchLink;

    try {
      await reply(failure);
    } catch (_) {}

    return failure;
  } finally {
    if (tempPath) {
      try {
        await fs.promises.unlink(tempPath);
      } catch (_) {}
    }
  }
}

module.exports = {
  name: 'video',
  command: '.video',
  description: 'Search YouTube and send a video as MP4.',
  run
};
