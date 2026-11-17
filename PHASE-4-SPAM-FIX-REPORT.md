# PHASE-4 SPAM FIX REPORT — bot re-answers old commands on every restart

Date: 17 Nov 2026 ~15:30 IST. Owner report: "every time the bot starts, it
reacts to old commands and replies again — one command gives several
reactions and several replies."

## Cause (verified by reading bot.js)

`_onMessagesUpsert` already ignored `type !== 'notify'` (history sync), but
it had NO timestamp check and NO message-ID dedup. On every (re)connect
— including every deploy, which restarts the bot via PM2 — WhatsApp
re-delivers recent unread messages as `notify`, and Baileys can redeliver
the same message. Each delivery ran the full command path (⏳ reaction,
plugin, reply, ✅ reaction), so one old command produced a fresh burst of
reactions and replies on every restart.

## Fix (legezt-bot/bot.js only — 2 gates on the COMMAND path)

1. **Freshness gate.** `_connectedAt` is captured when the socket opens
   (`connection === 'open'`). In `_onMessagesUpsert`, a message whose
   `messageTimestamp` (seconds; number, string, or Baileys Long) is older
   than `_connectedAt` minus a 15-second grace is a replay: skipped
   silently — no reaction, no reply, no usage event. Only messages sent
   after the bot connected are commands. Messages with no readable
   timestamp, or arriving before any connection has opened, are treated
   as fresh (fail open — a live command is never silently dropped).
2. **Message-ID dedup.** A bounded in-memory Set (last 2000 IDs, FIFO
   eviction) of answered message IDs. A repeat delivery of the same ID is
   skipped entirely. One command = one ⏳ + one reply + one ✅/❌,
   guaranteed.

Scope: the gates sit AFTER the media auto-save + Phase 4 archiver, which
KEEP running for ALL messages including old ones — the training store
wants the full history, and archiving never sends anything to WhatsApp,
so it cannot spam. Antispam rate limits, gap tolerance, typo tolerance,
loading reactions, reconnect/liveness, and the relay path (`respond()`
never touches the gate — it has no message key and is live by definition)
are untouched.

## Tests

New `legezt-bot/test/test_spam_fix.js` — committed IN THE REPO (the
Phase 4 report noted /tmp gets wiped; tests now live with the code).
**23/23 pass**, covering: stale message 5 min old ignored (no reaction /
reply / plugin run) AND still archived; 10s-before-connect inside the
15s grace answered; 20s-before-connect outside the grace ignored; fresh
message processed exactly once (⏳ then ✅, one reply); same ID delivered
twice answered once; `type: 'append'` still ignored; gap tolerance
(`.  ping`) intact; missing timestamp fails open; Long timestamp honoured;
dedup set capped at 2000 with FIFO eviction; relay `respond()` works with
no connect time at all.

Regressions green: Phase 4 chats **47/47**, chats API **15/15**.
`node --check` passes on bot.js and the new test.

## Deploy + live verification

- Commit: **2c2dce7** — "Spam fix: freshness gate + message-ID dedup so
  restarts never re-answer old commands" (one push via gh CLI; 3 files:
  legezt-bot/bot.js, legezt-bot/test/test_spam_fix.js,
  PHASE-4-SPAM-FIX-REPORT.md).
- GitHub Actions run **44060272048** — completed, success, 17s.
- Live check (my own curl, twice, 7s apart): dashboard **200**,
  /health `{"ok":true,"whatsapp":"connected","levanterUp":true,"botUp":true,"storage_used_mb":0.03}`
  both times. The deploy restarted the bot via PM2 and it reconnected
  cleanly with the session persisted (no re-scan needed) — and this very
  restart is the first one protected by the gate: any old command
  re-delivered on this reconnect is now ignored instead of answered.

## Honest limits

- This fix stops FUTURE spam. It cannot unsend replies already sent —
  the duplicates the owner already received stay in his WhatsApp.
- A command sent while the bot is down for a deploy (~30–60s window)
  arrives with a timestamp older than the new connect time minus 15s, so
  it is dropped, not answered. If the bot ever ignores a command sent
  during a restart, just send it again once the bot is back.
- The dedup set lives in memory only: a bot restart clears it. The
  freshness gate is what protects across restarts; the dedup set covers
  duplicate deliveries inside one live session.
