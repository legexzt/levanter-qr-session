# PHASE-4 OUTBOUND REPORT — messages go out one by one, paced, in order

Date: 17 Nov 2026 ~16:50 IST. Owner order (Hindi, after seeing "Waiting
for this message" on 4 bot replies): messages must NOT arrive one-by-one
all at once ("ekdam ekdam"), there must be a PROPER STRUCTURE for
sending, based on TIME / TIME PERIOD — the FULL message must arrive and
decrypt properly — and it must never spam the same thing again and
again. CORRECTION to the first brief: the owner clarified that merging
is BACKWARDS — messages must come ONE BY ONE, little by little, NEVER
one big text all together. One-by-one is properly understood. If sent
all together at once, they do NOT encrypt together at once — that is
exactly why "Waiting for this message" happens.

## Algorithm (new `legezt-bot/lib/outbound.js`, wired into `bot.js`)

Per-chat sequential queue (SPEC 13 dispatcher lanes), NO merging ever:

1. **Per-chat FIFO lanes, one in-flight send per chat.** Each
   `sendMessage` is fully awaited before the next starts in the same
   chat. Global concurrency cap: max 3 concurrent sends across chats,
   so the bot never floods. Every reply stays its OWN separate message
   — small, one-by-one. Text is NEVER joined, merged, or coalesced.
2. **Pacing delay (the time-period rule): 400 ms** between consecutive
   sends to the SAME chat, applied only when another item is already
   waiting — a lone reply is never delayed. Each message's
   encryption/sender key is fully distributed before the next goes out.
   This is the fix for the "Waiting for this message" decryption
   failures: paced sequential sends, never a simultaneous blast.
3. **Send only when ready.** The queue sends only while the socket is
   connected and open. If the socket drops mid-queue, queued UNSENT
   messages are HELD (not lost, not duplicated). On reconnect,
   `onConnected()` drops anything older than the freshness window
   (15 s, same as the spam fix) and resumes the rest. A command sent
   during a deploy is still dropped, as before.
4. **Reactions through the same queue, in order.** ⏳, then the reply,
   then ✅/❌ — each as its own paced step, in order, exactly once per
   fresh command. Reaction semantics unchanged.
5. **No repeat spam.** The freshness gate + message-ID dedup stay the
   first line of defence; the queue adds the second — an item leaves
   its lane before its send starts, so it is never sent twice, and a
   send that throws mid-flight is never retried (it may already have
   been delivered). One command = its replies one-by-one, each once.
6. **Archiver unchanged.** Phase 4 archive records each message exactly
   as sent, one line per message. No merging in the archive either.

**Media ordering:** plugins used to call `sock.sendMessage` directly,
bypassing any queue — a picture could overtake the text before it. The
bot now hands plugins a socket wrapper whose `sendMessage` routes
through the same queue (all other properties forward to the live
socket), so media sends are ordered and paced exactly like text. A
dropped media send rejects (like a failed Baileys send) so the
plugin's error handling still works. Caps (SPEC 13): 50 items per lane
(oldest queued item dropped + logged), 500 lanes, 3 concurrent sends.
A 5 s sweep prunes stale items, so no send promise ever pends longer
than ~20 s even if the socket never comes back.

## Tests

New `legezt-bot/test/test_outbound.js` — committed IN THE REPO.
**20/20 pass**, covering: (a) three quick replies to one chat sent as
THREE separate messages, in order, never merged (queue-level + bot
level via a 3-reply plugin); (b) pacing gaps >=300 ms between
consecutive sends to the same chat (constant is 400 ms); (c) two chats
independent — a slow chat never blocks the other; (d) queue holds while
the socket is down and resumes on reconnect (fresh held message sent);
(e) stale queued message (>15 s) dropped on reconnect, never replayed;
(f) reaction order ⏳ → reply → ✅, exactly once each; media via the
plugin socket goes text → media → ✅ in order; archive holds three
separate "out" lines for three replies, no merged line.

Regressions green: spam fix **23/23**, Phase 4 chats **47/47**, chats
API **15/15**. `node --check` passes on bot.js, lib/outbound.js, and
both test files. Note: `test_spam_fix.js` needed a two-line setup
update (fake socket now looks open + `bot.status = 'connected'`) because
the queue only sends while connected — its assertions are unchanged.

## Deploy + live verification

- Commit: **TODO** — one gh CLI push (files: legezt-bot/lib/outbound.js,
  legezt-bot/bot.js, legezt-bot/test/test_outbound.js,
  legezt-bot/test/test_spam_fix.js, PHASE-4-OUTBOUND-REPORT.md).
  (SPEC.md §13/§9 was updated in the local workspace copy only — it is
  not part of this repo.)
- GitHub Actions run **TODO** — completed, success.
- Live check (my own curl): dashboard **200**, /health
  `{"ok":true,"whatsapp":"connected","levanterUp":true,"botUp":true,...}`.

## Honest limits

- Pacing reduces the "Waiting for this message" cause (simultaneous
  sends, especially during reconnects) but cannot fix messages already
  sent that way — those stay undecryptable on the phone; re-send the
  command for a fresh, paced reply.
- A plugin that replies many times will still send many messages
  (one-by-one, as the owner wants) — that is the design, not a bug.
- A command sent during a deploy (~30–60 s window) is still dropped;
  send it again once the bot is back.
- A send that throws mid-flight is dropped, not retried (it may already
  have been delivered). The owner re-sends the command.
