// Provides cached current-weather lookups for the .weather command.
// Called by the LEGEZT plugin loader/relay with the standard plugin context.
// Needs an OpenWeatherMap key from lib/keys.js and Node's global fetch.
'use strict';

const { getKey } = require('../lib/keys.js');

const { logPluginError } = require('../lib/errors.js');
const CACHE_TTL_MS = 10 * 60 * 1000;
// SPEC 13: the cache is capped (oldest city dropped) so distinct cities can
// never grow it without bound. Expired entries are also removed on access.
const MAX_CACHE_ENTRIES = 100;
const weatherCache = new Map();

const USAGE = '.weather <city> — e.g. .weather Hyderabad';
const MISSING_KEY = 'Weather key not configured yet — ask the owner to add it.';
const NOT_FOUND = 'City not found — try `.weather <city>` with a different spelling.';
const FAILURE = 'Weather lookup failed, try again in a bit.';

async function send(reply, message) {
  await reply(message);
  return message;
}

function conditionEmoji(condition) {
  switch (condition) {
    case 'Clear':
      return '☀️';
    case 'Clouds':
      return '☁️';
    case 'Rain':
      return '🌧️';
    case 'Drizzle':
      return '🌦️';
    case 'Thunderstorm':
      return '⛈️';
    case 'Snow':
      return '❄️';
    case 'Mist':
    case 'Fog':
    case 'Haze':
      return '🌫️';
    default:
      return '🌡️';
  }
}

function formatTemperature(value) {
  return Number.isFinite(value) ? `${Math.round(value)}°C` : '—';
}

function formatHumidity(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
}

function formatWind(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} m/s` : '—';
}

function formatLocalTime(unixSeconds, timezoneSeconds) {
  if (!Number.isFinite(unixSeconds) || !Number.isFinite(timezoneSeconds)) {
    return '--:--';
  }

  const date = new Date((unixSeconds + timezoneSeconds) * 1000);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatWeather(data, requestedCity) {
  if (!data || !data.main || !Array.isArray(data.weather) || data.weather.length === 0) {
    throw new Error('Invalid weather response');
  }

  const sys = data.sys || {};
  const wind = data.wind || {};
  const weather = data.weather[0] || {};
  const condition = typeof weather.main === 'string' ? weather.main : '';

  let conditionText = condition || 'Current conditions';
  if (typeof weather.description === 'string' && weather.description.trim()) {
    const description = weather.description.trim();
    conditionText = description.charAt(0).toUpperCase() + description.slice(1);
  }

  const city = typeof data.name === 'string' && data.name.trim()
    ? data.name.trim()
    : requestedCity;
  const country = typeof sys.country === 'string' ? sys.country.trim() : '';
  const place = country ? `${city}, ${country}` : city;

  const sunrise = formatLocalTime(sys.sunrise, data.timezone);
  const sunset = formatLocalTime(sys.sunset, data.timezone);

  return [
    `📍 ${place}`,
    `${conditionEmoji(condition)} ${conditionText}`,
    `🌡️ Temperature: ${formatTemperature(data.main.temp)}`,
    `Feels like: ${formatTemperature(data.main.feels_like)}`,
    `💧 Humidity: ${formatHumidity(data.main.humidity)}`,
    `💨 Wind: ${formatWind(wind.speed)}`,
    `🌅 Sunrise: ${sunrise} | 🌇 Sunset: ${sunset}`
  ].join('\n');
}

async function requestWeather(city, key) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const url = 'https://api.openweathermap.org/data/2.5/weather'
      + `?q=${encodeURIComponent(city)}`
      + `&units=metric&appid=${encodeURIComponent(key)}`;

    const response = await fetch(url, { signal: controller.signal });

    if (response.status === 404) {
      return { ok: false, notFound: true };
    }
    if (response.status !== 200) {
      return { ok: false, notFound: false, error: 'weather API HTTP ' + response.status };
    }

    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    const detail = error && typeof error.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'weather API request failed';
    return { ok: false, notFound: false, error: detail };
  } finally {
    clearTimeout(timeout);
  }
}

async function run({ log, args, reply }) {
  const city = Array.isArray(args) ? args.join(' ').trim() : '';
  if (!city) {
    return send(reply, USAGE);
  }

  const key = getKey('openweather');
  if (!key) {
    return send(reply, MISSING_KEY);
  }

  const cacheKey = city.toLowerCase();
  const cached = weatherCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return send(reply, cached.text);
    }
    weatherCache.delete(cacheKey);
  }

  const result = await requestWeather(city, key);
  if (result.notFound) {
    return send(reply, NOT_FOUND);
  }
  if (!result.ok) {
    logPluginError(log, 'weather', new Error(result.error || 'weather API request failed'));
    return send(reply, FAILURE);
  }

  let output;
  try {
    output = formatWeather(result.data, city);
  } catch (error) {
    logPluginError(log, 'weather', error);
    return send(reply, FAILURE);
  }

  if (weatherCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = weatherCache.keys().next().value;
    weatherCache.delete(oldest);
  }
  weatherCache.set(cacheKey, {
    text: output,
    expiresAt: Date.now() + CACHE_TTL_MS
  });

  return send(reply, output);
}

module.exports = {
  name: 'weather',
  command: '.weather',
  description: 'Get the current weather for a city.',
  run
};
