# PHASE-3-REPORT — Dashboard redesign + WhatsApp UX (17 Nov 2026)

Built from SPEC.md §14 (owner order 17 Nov 2026 ~13:50 IST). The dashboard
looked boring and the WhatsApp menu was not attractive. Both are now
redesigned. No logic was rewritten on the dashboard — restyle only — and
no P0-fix code was touched except the minimal bot.js wiring for the
reaction + command normalisation.

## What was built

### Part A — Dashboard redesign (restyle, logic untouched)
- **New look:** dark theme with a violet → cyan accent palette, gradients,
  glass-touched cards with shadows and hover lift, fade-in animations on
  page load (staggered per card), Inter for UI + Poppins for headings via
  Google Fonts (system-font fallback if the fonts host is unreachable).
  CSP updated in `lib/security.php` to allow `fonts.googleapis.com` /
  `fonts.gstatic.com` only — everything else stays locked down.
- **Logo + icons:** a proper LEGEZT logo mark (inline SVG, gradient bolt)
  in the sidebar and on the login page; inline SVG icons for every sidebar
  item (no emoji in the UI). Stat cards have a gradient accent bar + icon.
- **Structure:** the main dashboard now shows SHORT summary cards only
  (WhatsApp status, AI calls, tasks done, vault files, storage) with links
  to the detail pages. Details live on SEPARATE pages:
  - **Usage** (`views/usage.php`) — AI usage totals, per-command and
    per-day tables, recent activity.
  - **Vault** (`views/vault.php`) — secret-vault browser with
    decrypt-on-download and per-type icons.
  - **Logs** (`views/logs.php`) — failures by command, recent failures,
    red-tinted error log, recent output log. A clean bot shows a green
    "No errors" card.
  - **Plugins** (`views/plugins.php`) — now lists the REAL loaded plugins
    from the bot's `/api/ops` payload (new `plugins` field in
    `legezt-bot/ops-api.js`), instead of the old Phase 2 placeholder.
  - **Ops** — unchanged logic, restyled to match (same cards, same theme).
- **Collapsible sidebar:** hamburger toggle in the topbar; on desktop it
  collapses to icons-only and the choice is remembered in localStorage;
  on mobile it slides in as an overlay (tap the overlay or press Escape
  to close). The hamburger animates into an X while open.
- **Kept:** passcode gate, CSRF, security headers, all existing routes
  and pages (Dashboard, Connect, Chats, Media, Plugins, Listener, Usage,
  Vault, Logs, Ops, Settings). Every file ≤400 lines (ops.php 397,
  lib/ops.php 392 — both untouched limits).

### Part B — WhatsApp menu + replies
- **`.help` / `.menu` redesigned:** grouped by category with emojis
  (🤖 AI, 🌤️ Weather, 🖼️ Images, 🎵 Music & Video, 🛠️ Tools, ⚙️ Bot),
  bold headings, clean dividers, one line per command + short description.
  It still reads the plugins Map, so new plugins appear automatically;
  a plugin with no category falls into "Bot" instead of disappearing.
- **Shared formatter (`legezt-bot/lib/format.js`):** `title`, `card`,
  `success`, `errorCard`, `menuSection`, `DIVIDER`, `FOOTER`. The menu,
  `.about`, and the bot's common error replies use it, so every reply
  looks consistent and recognisable (bold title + divider + 🤖 LEGEZT
  footer). WhatsApp formatting (`*bold*`, `_italic_`) is used throughout.

### Part C — Command gap tolerance
- `bot.js` `_parseCommand` now normalises before lookup on BOTH the
  WhatsApp path and the Muse relay path: trim, collapse multiple spaces
  to one, allow a space between `.` and the command name. `. ai`,
  `.  weather  Delhi`, `.ai   hello` all work. Typo tolerance
  (Did you mean) still works after normalisation.

### Part D — Loading reaction (the WhatsApp loader)
- On the WhatsApp path, the bot reacts to the owner's message with ⏳
  the moment a command arrives, then replaces it with ✅ on success or
  ❌ on failure, then sends the normal reply. The reaction is the loader;
  the reply is the result. Reactions are best-effort: a failed reaction
  is logged once and never blocks the command or crashes the bot.
  Non-command messages get no reaction. The relay path has no message
  key, so it has no reaction (unchanged).

## Files changed
- `legezt-bot/lib/format.js` (new) — shared reply formatter.
- `legezt-bot/plugins/help.js` — grouped menu.
- `legezt-bot/plugins/about.js` — card format.
- `legezt-bot/bot.js` — gap-tolerant `_parseCommand`, `_react` helper,
  ⏳/✅/❌ wiring, formatted backstop error.
- `legezt-bot/ops-api.js` — `/api/ops` now also returns `plugins`.
- `php-dashboard/lib/security.php` — CSP allows Google Fonts hosts only.
- `php-dashboard/lib/ops.php` — new `ops_parsed()` helper (shared by the
  Usage/Vault/Logs pages; `views/ops.php` keeps its own parsing).
- `php-dashboard/public/index.php` — routes `usage`, `vault`, `logs`.
- `php-dashboard/public/assets/style.css` — Phase 3 theme (appended;
  earlier rules untouched; three pre-existing undefined classes
  `.sidebar-nav`, `.admin-page`, `.status-dot-green` now have rules).
- `php-dashboard/public/assets/app.js` — sidebar toggle + overlay.
- `php-dashboard/views/layout.php` — fonts, SVG logo/icons, hamburger,
  overlay, 11-item nav.
- `php-dashboard/views/login.php` — fonts + logo mark.
- `php-dashboard/views/dashboard.php` — summary cards only, real numbers.
- `php-dashboard/views/usage.php`, `views/vault.php`, `views/logs.php`
  (new) — detail pages.
- `php-dashboard/views/plugins.php` — real plugin list.

## Tests (local, VM, 17 Nov 2026)
- New `/tmp/kimi/test_phase3.js` — **27/27 passed**: formatter helpers;
  grouped menu (all 6 sections, every loaded command, unknown plugin
  still appears); gap parsing (`.  weather  Delhi`, `  .ai   hello   world  `,
  `.ping` unchanged); `respond('. ai')` and `respond('.  weather  Delhi')`
  find the right plugin; reaction sequence ⏳ → ✅ for `.ping`, ⏳ → ❌
  for a throwing plugin, reaction targets the original message key, a
  failing reaction never breaks the command, the reply still goes out,
  non-command messages get no reaction.
- Regressions still green: `test_plugins.js` **48/48**,
  `test_usage_vault.js` **37/37**, `test_reconnect.js` **19/19**,
  `test_liveness.js` **14/14**.
- `node --check` passes on every changed JS file.
- PHP: `php -l` is NOT available on the VM (no php-cli) — a structural
  balance check passed on all 10 changed PHP files, plus a CSS-class
  cross-check (every class the changed views use is defined in
  style.css) and a full re-read of every changed view.

## Deploy + live verification
- Pushed via gh CLI in one push: commit `8648366` (Phase 3).
  GitHub Actions run `44046726456` — completed, success, 16s.
- Live curl after deploy: `/health` =
  `{"ok":true,"whatsapp":"connected","levanterUp":true,"botUp":true,"storage_used_mb":0.02,"uptime":56821}`
  — bot reconnected after the PM2 restart, session persisted, no re-scan.
  Dashboard HTTP 200.

## Still open (not in this step)
- **New pages were never php-linted** (no php-cli on the VM) — if Usage,
  Vault, Logs, or the restyled Dashboard/Plugins ever show a 500, that
  file is the first suspect (same standing note as `views/connect.php`
  and `views/ops.php`).
- **Owner must log in and open the dashboard once** to confirm the new
  theme renders (fonts, sidebar, stat cards) — the passcode is not
  recorded anywhere, so the pages could not be opened via curl. If his
  network blocks fonts.googleapis.com, the system-font fallback applies
  and the layout still works.
- **`bot.js` is now 581 lines** (was 545; SPEC §10 says ≤400). The growth
  is the Phase 3 wiring; the reconnect table was already extracted to
  `lib/reconnect.js`. Further splitting (e.g. connection lifecycle) is a
  follow-up refactor — not done to avoid touching stable live core logic.
- The Usage/Vault/Logs pages show "service unavailable" when the bot API
  is down (by design — never guessed numbers).
- Pre-existing notes carried over: `.song` / `.video` downloads are
  best-effort (play-dl unverified on EC2, link fallback); Pause and
  Disconnect share the same `pause()` mechanism.
