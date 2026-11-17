<?php
// Renders the WhatsApp connection state, pairing QR code, and disconnect action.
// Called by public/index.php and captured into $content for the layout.
// Requires lib/qr.php, lib/security.php, config.php, and app.js for auto-refresh.
declare(strict_types=1);

$qr = qr_status();
$status = 'unknown';

if (
    $qr !== null
    && isset($qr['status'])
    && is_string($qr['status'])
    && in_array($qr['status'], ['waiting', 'connected', 'unknown', 'disconnected', 'starting'], true)
) {
    $status = $qr['status'];
}

$account = null;
if ($qr !== null && isset($qr['account']) && is_string($qr['account'])) {
    $candidate = trim($qr['account']);
    if ($candidate !== '') {
        $account = $candidate;
    }
}

$lastPollAt = 'never';
if ($qr !== null && isset($qr['lastPollAt']) && is_string($qr['lastPollAt'])) {
    $candidate = trim($qr['lastPollAt']);
    if ($candidate !== '') {
        $lastPollAt = $candidate;
    }
}

$qrDataUrl = null;
if (
    $qr !== null
    && !empty($qr['qrDataUrl'])
    && is_string($qr['qrDataUrl'])
) {
    $qrDataUrl = $qr['qrDataUrl'];
}

$qrAgeSec = null;
if ($qr !== null && isset($qr['qrAgeSec']) && is_numeric($qr['qrAgeSec'])) {
    $qrAgeSec = max(0, (int) $qr['qrAgeSec']);
}

$pairingCode = null;
if ($qr !== null && isset($qr['pairingCode']) && is_string($qr['pairingCode'])) {
    $candidate = strtoupper($qr['pairingCode']);
    if (preg_match('/^[A-Z0-9]{8}$/', $candidate) === 1) {
        $pairingCode = $candidate;
    }
}

$lastError = null;
if ($qr !== null && isset($qr['lastError']) && is_string($qr['lastError'])) {
    $candidate = trim($qr['lastError']);
    if ($candidate !== '') {
        $lastError = $candidate;
    }
}
?>
<div id="qr-box" data-status="<?= legezt_esc($status) ?>">
    <?php if ($qr === null): ?>
        <section class="card error">
            <h2>QR service unavailable</h2>
            <p>legezt-bot is not responding (port 3001). Check that the legezt-bot service is running.</p>
            <p><a class="btn" href="?page=connect">Retry</a></p>
        </section>
    <?php elseif ($status === 'disconnected'): ?>
        <section class="card">
            <h2>WhatsApp disconnected</h2>
            <p>The bot is paused. Your session and data are kept &mdash; nothing was deleted.</p>
            <form method="post" action="index.php?action=reconnect">
                <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                <button type="submit" class="btn primary">Reconnect WhatsApp</button>
            </form>
            <?php if ($lastError !== null): ?>
                <p class="error-detail">Last error: <?= legezt_esc($lastError) ?></p>
            <?php endif; ?>
        </section>
    <?php elseif ($status === 'connected'): ?>
        <section class="card success">
            <p class="status-line">
                <span class="dot green" aria-hidden="true"></span>
                <?php if ($account !== null): ?>
                    Connected as <strong><?= legezt_esc($account) ?></strong>
                <?php else: ?>
                    Connected
                <?php endif; ?>
            </p>
            <p class="muted">Last poll: <?= legezt_esc($lastPollAt) ?></p>

            <form method="post" action="index.php?action=disconnect">
                <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                <button type="submit" class="btn danger">Disconnect WhatsApp</button>
            </form>
        </section>
    <?php elseif ($status === 'waiting' && $qrDataUrl !== null): ?>
        <section class="card">
            <h2>Scan to connect WhatsApp</h2>
            <img
                class="qr-image"
                src="<?= legezt_esc($qrDataUrl) ?>"
                alt="WhatsApp pairing QR code"
            >
            <ol>
                <li>Open WhatsApp on your phone.</li>
                <li>Go to Linked devices.</li>
                <li>Tap Link a device and scan this code.</li>
            </ol>
            <?php if ($pairingCode !== null): ?>
                <div class="pairing-block" id="pairing-block">
                    <p class="pairing-label">Or link with a code instead of scanning:</p>
                    <p class="pairing-code" id="pairing-code" data-pairing-code="<?= legezt_esc($pairingCode) ?>"><?= legezt_esc(substr($pairingCode, 0, 4) . '-' . substr($pairingCode, 4)) ?></p>
                    <div class="pairing-actions">
                        <button type="button" class="btn" id="copy-pairing-code">Copy code</button>
                        <button type="button" class="btn" id="refresh-pairing-code" data-csrf="<?= legezt_esc(csrf_token()) ?>">New code</button>
                    </div>
                    <p class="muted pairing-note">WhatsApp &rarr; Linked devices &rarr; Link with phone number &rarr; enter this code.</p>
                    <p class="muted" id="pairing-status" role="status"></p>
                </div>
            <?php else: ?>
                <div class="pairing-block" id="pairing-block">
                    <p class="muted">Pairing code is not available right now &mdash; you can still scan the QR above.</p>
                </div>
            <?php endif; ?>
            <?php if ($qrAgeSec !== null): ?>
                <p>QR updated <?= legezt_esc((string) $qrAgeSec) ?> seconds ago.</p>
            <?php else: ?>
                <p>QR update time is not available.</p>
            <?php endif; ?>
            <p class="muted">This page refreshes automatically while waiting.</p>
        </section>
    <?php elseif ($status === 'waiting'): ?>
        <section class="card">
            <div class="spinner" aria-hidden="true"></div>
            <p>Waiting for a QR code &mdash; the bot is starting up. This page refreshes automatically.</p>
        </section>
    <?php else: ?>
        <section class="card">
            <p>Status unknown &mdash; the bot may be restarting. This page refreshes automatically.</p>
            <?php if ($lastError !== null): ?>
                <p class="error-detail">Last error: <?= legezt_esc($lastError) ?></p>
            <?php endif; ?>
        </section>
    <?php endif; ?>

    <p class="muted">Last checked: <?= legezt_esc($lastPollAt) ?></p>
</div>
