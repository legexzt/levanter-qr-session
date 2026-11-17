# PHASE-2-PLUGINS-REPORT — legezt-bot plugin set (17 Nov 2026)

Built from the 12-repo research analysis (`~/workspace/whatsapp-bot-research/ANALYSIS.md`).
No code was copied from the researched repos. Baileys stays pinned at 6.7.24.
No eval/shell from chat, no hardcoded keys, no remote plugin install, no TLS-disable.

## What was built (19 plugins)

| Command | What it does | Key needed |
| --- | --- | --- |
| `.ping` | Liveness check (Phase 2) | — |
| `.help` | Lists every loaded command | — |
| `.menu` | Same as `.help` | — |
| `.about` | Bot info + owner + command count | — |
| `.ai <message>` | Chat with Kimi K3 via AWS Bedrock (see below) | `bedrock.key` |
| `.ask <message>` | Alias for `.ai` | `bedrock.key` |
| `.weather <city>` | Current weather (OpenWeatherMap, 10-min cache) | `openweather.key` |
| `.sticker` | Image/short video → WebP sticker (ffmpeg, serial queue) | — |
| `.img <query>` | Openverse image search, sends image + link fallback | — |
| `.removebg` | Remove background (remove.bg) | `removebg.key` |
| `.song <query>` | YouTube audio (play-dl; link fallback if download fails) | — |
| `.video <query>` | YouTube video (play-dl itag 18; link fallback) | — |
| `.translate <lang> <text>` | Free Google Translate endpoint | — |
| `.tr <lang> <text>` | Alias for `.translate` | — |
| `.tts <text>` | Text-to-speech voice note (Google TTS, 200-char cap) | — |
| `.qr <text>` | QR code image | — |
| `.calc <expr>` | Calculator, hand-written parser — NEVER eval | — |
| `.password` | Random password (crypto.randomBytes, 8–64 chars) | — |
| `.base64 <text>` | Base64 encode/decode with validation | — |

## `.ai` — Kimi K3 via Bedrock (owner order, supersedes Groq)

- Provider: AWS Bedrock, region **us-east-1**, inference profile `us.moonshotai.kimi-k3.1`.
- Endpoint `https://bedrock-runtime.us-east-1.amazonaws.com/model/us.moonshotai.kimi-k3.1/invoke`,
  Bearer auth, OpenAI-style body, `max_tokens` 8000, temperature 0.7.
- Short per-chat history (last 6 messages) in memory only, capped at 500 chats.
- Key read at runtime from `/var/legezt/config/bedrock.key` (mode 600).
  If the key is missing/empty, `.ai` replies "Kimi key not configured yet — ask the
  owner to add it" and does not crash.
- Verified live with the real key: Kimi replied `"OK"` to a test prompt.
- **Kimi is a reasoning model, so `.ai` replies are slower than a non-reasoning
  model (it reasons ~9–12k tokens per call). That is the owner's choice.**

## Adopted from the analysis (small, high-value)

- **Typo tolerance (neoxr-style):** unknown command ≥60% similar to a known one
  replies `Did you mean: .xxx?` (in `bot.js` + `lib/similar.js`). Works on the
  WhatsApp path and the Muse relay path.
- **Antispam (Toxic-style):** per-chat rate limit in `bot.js` + `lib/ratelimit.js`.
  Flood (8 commands/6s) → warn once, then ignore; minute cap (18/60s) → ignore
  silently. Bounded state (5000 keys max).

## 24/7 self-management (SPEC §11, owner order 17 Nov 2026 ~13:05 IST)

- **Error handling in every plugin:** each plugin's `run()` is wrapped so ANY
  failure (API down, bad response, missing key, timeout, malformed input) replies
  with ONE short friendly message and NEVER throws up to the bot core. `bot.js`
  keeps its backstop catch (`Plugin <name> failed`) for anything that does throw.
- **Timeouts on every external call:** all HTTP/API calls time out at **15s**
  (weather, translate, tts, img, removebg, song/video downloads and searches).
  **One documented exception:** the Kimi/Bedrock call uses 60s, because a 15s
  timeout would make `.ai` unusable — Kimi reasons for 10–30s+ per call. The
  timeout still exists, so a hung call cannot hang forever.
- **Error logging with context:** failures log one line with time + plugin name +
  error via the bot's `log('error', ...)` helper (`lib/errors.js` —
  `logPluginError`). Long token-like strings are redacted from log lines; API
  keys and phone numbers are never logged. A missing key is a config state, not
  an error — it is NOT logged on every call (the user-facing reply says so).
- **Graceful degradation:** missing key → "X not configured yet" (no crash, no
  retry loop). API error → one friendly reply, never retried more than once per
  command. Downloaders fall back to a link, never fail silently.
- **24/7 stays on:** PM2 auto-restart, the 15s watchdog, and reconnect backoff
  are untouched. This change does not touch `server.js`, the watchdog, or PM2
  config.

## Files changed

- `legezt-bot/plugins/` — 17 new plugin files + `help.js` (already auto-lists all
  plugins via the plugins Map; no edit needed) + `about.js`, `menu.js`.
- `legezt-bot/lib/` — `keys.js` (env/file key reader), `ai.js` (Kimi/Bedrock
  client, now also returns token usage), `ratelimit.js` (now with `prune()`),
  `similar.js` (now also exports `suggestCommand`), `errors.js` (new:
  `logPluginError`), `media.js` (new: media auto-save into the vault).
- `legezt-bot/usage.js` (new) — appends one JSON line per event to
  `/var/legezt/storage/usage.jsonl` + in-memory aggregates (`getStats()`).
- `legezt-bot/vault.js` (new) — AES-256-GCM encrypt/decrypt, content-hash
  index + dedup.
- `legezt-bot/bot.js` — passes `log` in the plugin run context (both WhatsApp
  and relay paths), typo tolerance + antispam wiring, usage logging on every
  plugin invocation, media auto-save hook, backstop catch kept.
- `legezt-bot/package.json` — added `yt-search` 2.13.1 and `play-dl` 1.9.7.
- `deploy.sh` — creates empty `bedrock.key`, `openweather.key`, `removebg.key`
  (mode 600, owner ubuntu) if missing; if `BEDROCK_API_KEY` is set and
  non-empty when deploy.sh runs, writes it into `bedrock.key` (mode 600) and
  never logs the value. Phone/relay-key steps unchanged. Also generates
  `vault.key` (32 random bytes, mode 600) if missing and creates
  `/var/legezt/storage/` + `/var/legezt/storage/vault/` (mode 700).

## AI usage tracking + secret vault (SPEC §12, owner order 17 Nov 2026 ~13:14 IST)

- **Usage logging (`usage.js`):** one JSON line per event in
  `/var/legezt/storage/usage.jsonl` (dir created if missing). Fields: `time`,
  `type` ("ai" | "plugin" | "media"), `command`, `chat` (JID SHA-256 hashed —
  never a phone number in plain text), `tokens`, `durationMs`, `ok`, plus
  `inputTokens`/`outputTokens` for AI calls and `file` for media events.
  Never logs API keys or message text. Never crashes on a failed write.
  Called from `bot.js` on EVERY plugin invocation (WhatsApp + relay paths,
  success + failure + duration) and from the `.ai` plugin (which captures the
  token usage from the Bedrock response's `usage` field — `input_tokens` +
  `output_tokens`, with `prompt_tokens`/`completion_tokens` as fallback;
  `tokens: null` when the response carries no usage field).
- **Secret vault (`vault.js`):** AES-256-GCM (Node `crypto`). Key from
  `/var/legezt/config/vault.key` (32 bytes, mode 600, generated by deploy.sh).
  `saveToVault(name, buffer)` writes to `/var/legezt/storage/vault/` (mode 700
  dir, file mode 600) and returns the vault path; `readFromVault(name)`
  decrypts. File layout: `[iv 12][auth tag 16][ciphertext]`. The key is never
  logged and never committed. `findByHash` / `readByHash` look up by content hash.
- **Media auto-save (`lib/media.js`, hooked in `bot.js`):** any incoming
  document, image, audio/voice note, or video is downloaded and saved to the
  vault as `<timestamp>_<original-filename>` (generated name for images/
  audio/video, e.g. `1731834567890_image.jpg`), then a "media" usage event is
  logged. Runs for every media message, not just commands; fire-and-forget so
  it never blocks command handling. A failed download/encrypt is logged once
  and never crashes the bot. Per-file cap 100 MB (larger files skipped with a
  warning). Documents + images + audio/voice + video are all implemented.
- **Dashboard display of usage stats and the vault browser is a LATER build**
  (Ops page) — this step is logging + vault storage only.

## Data structures (SPEC §13, owner order 17 Nov 2026 ~13:16 IST)

Every collection has a stated cap or expiry. Dispatch is O(1) via Map; the
typo suggester is O(n) over the small plugin set (19) and runs only for
unknown commands (fuzzy matching cannot be O(1) without an index).

| Piece | Data structure | Cap / expiry |
| --- | --- | --- |
| Plugin registry | `Map` (command → plugin), loaded by `plugins/loader.js` | One entry per plugin file (~19); `Map.get` is O(1), never an array scan |
| Per-chat AI history (`.ai`) | `Map` (chat → FIFO array) | 6 messages per chat (oldest dropped); 500 chats max (oldest chat evicted) |
| Antispam state | `Map` (chat → { times[], flooding }) | 5000 keys max (oldest evicted); per-key timestamp list capped at 50 (most recent); expired states pruned on access AND by a 60s sweep in `bot.js` |
| Usage stats | Append-only JSONL on disk + in-memory `Map` aggregates (`byCommand`, `byType`, `byDay`) | JSONL rotated at 10 MB; `byCommand` bounded by distinct commands (~20); `byType` 3 types; `byDay` last 30 days (older pruned). `getStats()` reads O(1), no disk scan. Aggregates reset on restart; JSONL is the durable truth |
| Vault index | `Map` (content SHA-256 → { name, storedAt, size, originalName }), persisted to `index.json` (atomic temp + rename) | Bounded by distinct files (dedup stores each content once); per-file cap 100 MB in the media saver. Lookup by hash, never a directory scan |
| Weather cache | `Map` (city → { text, expiresAt }) | 10-min TTL (expired removed on access) + 100 entries max (oldest evicted) |
| Key file cache (`lib/keys.js`) | `Map` (key name → { keys, readAt }) | 60s TTL; keyed by key name only (3 names used), so it cannot grow |
| Calc function set | `Set` (8 names) | Constant, never grows |
| Sticker queue | Single promise chain (serial, concurrency 1) | Not a collection; one pending job reference |

## API keys the owner must supply (server config `/var/legezt/config/`, mode 600)

| File | Plugin | How to add (on the EC2) |
| --- | --- | --- |
| `bedrock.key` | `.ai` / `.ask` | Owner already has the key. Either place it once: `echo -n '<key>' \| sudo tee /var/legezt/config/bedrock.key`, or set a `BEDROCK_API_KEY` secret in GitHub and wire it into the deploy workflow (deploy.sh already handles the env var). |
| `openweather.key` | `.weather` | Free tier at openweathermap.org (1000 calls/day). Same `tee` pattern. |
| `removebg.key` | `.removebg` | Free tier at remove.bg (50 images/month). Same `tee` pattern. |

No key is in the repo, in any file pushed, or in this report. Never put a real
key value in Git or chat.

## Local tests (VM, 17 Nov 2026) — 48/48 + 37/37 passed

- `/tmp/kimi/test_plugins.js` (kept on the VM, not in the repo) — 48/48.
  Proves with a fake socket: all 19 plugins load; `.help` lists every command;
  typo tolerance (`.weathre` → `.weather`, `.traslate` → `.translate`,
  `.stiker` → `.sticker`, `.xyz` → no match); rate limit (7 ok → 8th warns →
  9th ignores → minute cap ignores → clear resets); `.weather`/`.ai` with no
  key reply "not configured" without throwing; `.calc` bad input replies
  friendly + logs one error line; `.calc 2+3*4 = 14`; `.password`, `.base64`,
  `.qr`, `.about`, `.menu` work; `bot.respond()` handles `.help`, typo,
  unknown, `.ping`; `_onMessagesUpsert` sends "Did you mean" and warns once
  on flood.
- `/tmp/kimi/test_usage_vault.js` (kept on the VM, not in the repo) — 37/37.
  Proves with temp dirs (nothing touches `/var/legezt`): usage JSONL lines
  carry all required fields and never contain a phone number or message text;
  `getStats()` aggregates are correct (per-command, per-type, per-day);
  `logUsage` never throws on bad input; vault key file is 32 bytes; vault
  round-trip encrypt/decrypt works; dedup stores identical content once
  (same path, 1 index entry); `findByHash`/`readByHash` work; unknown hash
  returns null; different content gets its own file; tampered ciphertext
  fails to decrypt; vault names are sanitised (no traversal); ratelimit
  `prune()` keeps fresh states and the flood warning still fires;
  `autoSaveMedia` returns silently for non-media and logs (never throws) for
  bad media; `bot.respond('.ping')` writes a plugin usage event with the chat
  hashed.

## Known limits / deviations

- **`bot.js` is 451 lines** (SPEC §10 says ≤400). It was already at the 400-line
  limit after Phase 2; the overage is the required typo-tolerance + antispam +
  log-context + usage-logging + media-hook wiring. The media auto-save itself
  was extracted to `lib/media.js` to keep bot.js down. Splitting bot.js further
  (e.g. extracting the connection lifecycle) is a follow-up refactor — not
  done here to avoid touching stable live core logic.
- **Kimi call timeout is 60s, not 15s** (see above — reasoning model; documented).
- **`.song` / `.video` downloads are best-effort.** `play-dl` stream extraction
  fails from the VM ("Invalid URL") and `yt-search` is flaky (~50% parser
  errors in VM tests; the plugin retries once). Both plugins always fall back
  to the YouTube link, so the user is never left with nothing. Whether play-dl
  works on the EC2 is unverified — test `.song` live after deploy.
- **`yt-search` is flaky** (see above). If it keeps failing on the EC2, the
  fallback is the search link.
- **`views/connect.php` PHP syntax was never linted** (no php-cli on the VM) —
  if the Connect page shows a 500, that file is the first suspect. (Pre-existing.)

## Still open (not in this step)

- **Ops/Terminal dashboard page (SPEC §11)** — separate later build. Not built here.
  (It will display the usage stats from `getStats()`/JSONL and browse the vault.)
- **Media auto-save scope:** it archives media from ALL chats the bot sees,
  including groups. If group media volume gets noisy, scope it to 1:1 chats
  only (follow-up). Quoted media (a text reply to an image) is not archived —
  only messages that directly carry media.
- **Usage aggregates reset on restart** (in-memory only). The JSONL keeps the
  full history; rebuilding aggregates from it on startup is a follow-up if
  the dashboard needs pre-restart totals.
- Owner must add the three API keys above (`.ai` needs `bedrock.key` first).
- Owner must re-test `.ping` on WhatsApp (the fromMe fix deployed 17 Nov ~12:41 IST).
- Set up AWS CLI + GitHub CLI permanently on Kali when the user opens it.
- Live `.song` / `.video` download test on the EC2 (play-dl behaviour there).
