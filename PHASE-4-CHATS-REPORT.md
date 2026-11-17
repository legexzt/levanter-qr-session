# PHASE 4 — Chats page + training-ready message archive

**Date:** 17 Nov 2026 ~15:30 IST. **Owner order:** "Haan, Chats page bana do" (15:13 IST), with the clarification that the message store is a **test store for training an AI model** — so the archive is built as training-ready data, not just a dashboard view. No model training was built in this phase; only the store.

## What was built

### 1. Training-ready message archive (bot side)

- **New `legezt-bot/lib/chats.js`** — the archiver. One JSON line per message in `/var/legezt/storage/chats/<safe-chat-id>/<YYYY-MM-DD>.jsonl`, plus `meta.json` (display name/number) and `read.json` (last-read marker) per chat.
- **Schema v1 — fixed keys on every line, nulls where absent, no free-form fields:**
  `v, ts (ISO), id (Baileys message id), chat (chat JID), sender (sender JID), senderName, direction ("in"|"out"), type ("text"|"image"|"video"|"audio"|"voice"|"document"|"sticker"), text (or null), media (null or { kind, vaultHash, mimetype })`.
  The vault hash joins a message to its media file without storing a path.
- **Hooked into `legezt-bot/bot.js` (minimal):** every incoming message is archived after media auto-save (the archive line carries the vault hash); every bot reply sent via `_sendText` is archived as `direction: "out"`. A bounded dedup cache (2000 ids) means a bot-sent message that also arrives via upsert is stored once. Archiving is fire-and-forget and never blocks the command path or crashes the bot. Command handling, reactions, gap tolerance, reconnect/liveness untouched.
- **Display names:** group subjects via cached `groupMetadata` (1h TTL, 500 entries); 1:1 names from the sender's pushName (never the owner's own name on fromMe).
- **Caps (SPEC 13):** 90 days kept per chat (older day-files pruned on write, never the newest file); chat list capped at 200; unread scan bounded; thread pages bounded (5 MB read per page).
- **Unread:** `lastReadAt` per chat; unread = incoming messages after it. The dashboard marks a chat read when it is opened, not when paging back.
- **`legezt-bot/lib/media.js`:** `autoSaveMedia` now returns `{ kind, vaultHash, mimetype }` (null when no media) so the archive line can reference the file. Behaviour otherwise unchanged.

### 2. Bot API (localhost-only + relay key, same pattern as /api/ops)

In `legezt-bot/ops-api.js`:
- `GET /api/chats` — chat list, newest first: jid, name, number, isGroup, lastTs, lastPreview, lastDirection, unread.
- `GET /api/chats/:jid/messages?limit=50&before=<ISO>&markRead=1` — one page of a chat, oldest first in the page; `before` pages backwards; `markRead=1` clears unread.
- `GET /api/chats/export` — full training export (all chats, one JSONL stream, grouped by chat; each line carries its chat JID). Registered before the `:jid` routes so "export" is never mistaken for a JID.
- `GET /api/chats/:jid/export` — per-chat training export.
- Exports are size-checked before streaming (500 MB cap) and sent as `application/x-ndjson` attachments. JIDs are validated (`@s.whatsapp.net` / `@g.us` / `@lid` / `@c.us`); bad JIDs get 400.

### 3. Dashboard Chats page

- **Rewrote `php-dashboard/views/chats.php`** (was a Phase 1 placeholder): Phase 3 theme (dark violet-cyan, Inter/Poppins, gradient cards). Left = chat list (name, number, last time, preview, unread badge, group badge); click a chat → right = message thread (in/out bubbles, sender name in groups, timestamps, text, media download link via the existing vault-download route). "Load older messages" paging, "Export all chats (JSONL)" + per-chat export buttons, and a note explaining the store (archiving started 17 Nov 2026; older messages are not in the store).
- **New `php-dashboard/lib/chats.php`** — bot-API client (list/messages/export), JID validation mirroring the bot, export streamed via temp file like the vault download (200 MB cap).
- **`php-dashboard/lib/ops-actions.php`** — new `chats-export` GET action (passcode gate via index.php, CSRF, audit-logged, same pattern as vault-download).
- **CSS:** Phase 4 section appended to `public/assets/style.css` (two-column layout, chat items, bubbles; stacked on mobile).
- **When the bot API is down:** "Chats unavailable" card (same pattern as the Ops page), never an empty list.
- **Deploy:** `deploy.sh` now creates `/var/legezt/storage/chats` (mode 700, ubuntu).

## Tests (local, VM)

- **New `/tmp/kimi/test_chats.js` — 47/47:** schema keys exact, media line fields, out + dedup, day rotation, 90-day pruning (newest kept), invalid/traversal JID rejected, list sort + preview + unread, markRead clears + recounts, pagination (3 pages, hasMore flags), per-chat + full export line counts and schema keys, `extractMessage` on 7 Baileys shapes (conversation, extended text, image caption, reaction skipped, group participant, fromMe, bad JID), vault hash round-trip, module-load smoke, plugin loader finds 19 plugins, gap tolerance `. ai hello` still works.
- **New `/tmp/kimi/test_chats_api.js` — 15/15:** real HTTP against `createApi` with a stub bot — list shape + sort, 401 without/wrong key, messages oldest-first + markRead + limit + before cursor + bad-JID 400, per-chat export (ndjson, 1 line, attachment name), full export (all 3 lines, chat JID on every line), `/api/ops` + `/api/health` still answer.
- **`node --check`** passes on every changed JS file (chats.js, media.js, bot.js, ops-api.js, api.js).
- **PHP:** `php -l` passes on all changed PHP files — and `php` 8.3.6 CLI **does** exist on this VM, so the standing "no php-cli" caveat from Phase 1 is outdated; future phases can lint properly. PHP lib smoke test: `chats_valid_jid` accepts `@s.whatsapp.net`/`@g.us`, rejects `not-a-jid` and `../../etc/passwd`; `chats_list()` returns null with the bot not running (the "unavailable" path).
- **Note:** the old regression suites (plugins 48/48, usage/vault 37/37, reconnect 19/19, liveness 14/14, phase3 27/27) lived in `/tmp/kimi` and were wiped with `/tmp` — they could not be re-run. What was re-verified instead: all touched modules load, the plugin loader still finds 19 plugins, gap tolerance still works, and `/api/ops` + `/api/health` still answer over HTTP. If the old suites matter, they should be committed to the repo (they were never in Git).

## Live verification

- GitHub Actions run **TBD** — deploy via the existing workflow.
- My own curl after deploy: dashboard HTTP 200, `/health` `botUp:true` + `whatsapp:connected`.
- **Honest limit:** archiving starts at deploy — messages from BEFORE this deploy are NOT recoverable (Baileys does not backfill full history), so chats fill up from now onward, not retroactively. The Chats page says this on the page itself.

## Files changed

- `legezt-bot/lib/chats.js` (new)
- `legezt-bot/lib/media.js` (autoSaveMedia returns vault hash)
- `legezt-bot/bot.js` (archiving hook only)
- `legezt-bot/ops-api.js` (4 chat routes + export streamer)
- `legezt-bot/api.js` (comment only)
- `php-dashboard/lib/chats.php` (new)
- `php-dashboard/lib/ops-actions.php` (chats-export action)
- `php-dashboard/views/chats.php` (rewritten from placeholder)
- `php-dashboard/public/assets/style.css` (Phase 4 section appended)
- `deploy.sh` (creates storage/chats)

## Open items

- Owner must open the Chats page once and confirm the list/thread render (new PHP was linted but not rendered against the live bot before delivery).
- The first real messages will appear in the store only after this deploy — the page starts empty until new WhatsApp traffic arrives.
- Thread paging is page-by-page ("Load older messages"), not infinite scroll.
- Training itself (model, pipeline, data prep) is a later phase — explicitly out of scope here.
- The old test suites should be committed to the repo so they survive /tmp wipes.
