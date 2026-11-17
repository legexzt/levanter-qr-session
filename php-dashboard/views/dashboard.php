<?php
// Renders the dashboard overview: SHORT summary cards only. Details live
// on their own pages (Usage, Vault, Logs, Ops) — never crammed here.
// Called by public/index.php and captured into $content for the layout.
// Requires lib/qr.php, lib/db.php, lib/ops.php, lib/security.php, and config.php.
declare(strict_types=1);

$qr = qr_status();
$status = 'unknown';

if (
    $qr !== null
    && isset($qr['status'])
    && is_string($qr['status'])
    && in_array($qr['status'], ['waiting', 'connected', 'unknown'], true)
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

$connected = $status === 'connected' && $qr !== null;
$storageBytes = ops_storage_bytes();
$storageLabel = number_format($storageBytes / 1048576, 2, '.', '') . ' MB';

$ops = ops_parsed();
$totals = $ops === null ? null : $ops['totals'];
$vaultCount = $ops === null ? null : count($ops['vault']);
?>
<section class="card card-status">
    <h2>WhatsApp</h2>

    <?php if ($connected): ?>
        <p class="status-line">
            <span class="dot green" aria-hidden="true"></span>
            Connected<?php if ($account !== null): ?> — <?= legezt_esc($account) ?><?php endif; ?>
        </p>
    <?php elseif ($qr !== null && $status === 'waiting'): ?>
        <p class="status-line">
            <span class="dot amber" aria-hidden="true"></span>
            Waiting to scan — open Connect to scan the QR
        </p>
    <?php else: ?>
        <?php if ($qr === null): ?>
            <p class="status-line">
                <span class="dot grey" aria-hidden="true"></span>
                QR service unreachable
            </p>
            <p class="muted">The bot service is not responding.</p>
        <?php else: ?>
            <p class="status-line">
                <span class="dot amber" aria-hidden="true"></span>
                Not connected yet — no fresh QR
            </p>
            <p class="muted">Open Connect to see the pairing QR and link WhatsApp.</p>
        <?php endif; ?>
    <?php endif; ?>
</section>

<section class="stats-grid" aria-label="Dashboard summary">
    <article class="card stat-card stat-accent-ai">
        <span class="stat-icon" aria-hidden="true">🤖</span>
        <h3>AI calls</h3>
        <p class="stat-value"><?= $totals === null ? '—' : legezt_esc(number_format((int) $totals['aiCalls'])) ?></p>
        <p class="muted"><?= $totals === null ? 'Bot API unavailable' : legezt_esc(number_format((int) $totals['aiTokens'])) . ' tokens used' ?></p>
        <p><a href="?page=usage">See usage →</a></p>
    </article>

    <article class="card stat-card stat-accent-tasks">
        <span class="stat-icon" aria-hidden="true">✅</span>
        <h3>Tasks done</h3>
        <p class="stat-value"><?= $totals === null ? '—' : legezt_esc(number_format((int) $totals['tasks'])) ?></p>
        <p class="muted"><?= $totals === null ? 'Bot API unavailable' : legezt_esc(number_format((int) $totals['tasksFail'])) . ' failed' ?></p>
        <p><a href="?page=logs">See logs →</a></p>
    </article>

    <article class="card stat-card stat-accent-vault">
        <span class="stat-icon" aria-hidden="true">🔒</span>
        <h3>Vault files</h3>
        <p class="stat-value"><?= $vaultCount === null ? '—' : legezt_esc(number_format($vaultCount)) ?></p>
        <p class="muted">Encrypted, owner-only</p>
        <p><a href="?page=vault">Open vault →</a></p>
    </article>

    <article class="card stat-card stat-accent-storage">
        <span class="stat-icon" aria-hidden="true">💾</span>
        <h3>Storage used</h3>
        <p class="stat-value"><?= legezt_esc($storageLabel) ?></p>
        <p class="muted">Under /var/legezt</p>
        <p><a href="?page=ops">Open Ops →</a></p>
    </article>
</section>

<section class="card">
    <h2>Quick actions</h2>
    <div class="actions">
        <a class="btn primary" href="?page=connect">Open Connect / QR</a>
        <a class="btn" href="?page=usage">AI Usage</a>
        <a class="btn" href="?page=vault">Vault</a>
        <a class="btn" href="?page=ops">Ops &amp; Terminal</a>

        <?php if ($connected): ?>
            <form method="post" action="index.php?action=disconnect">
                <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                <button type="submit" class="btn danger">Disconnect WhatsApp</button>
            </form>
        <?php endif; ?>
    </div>
</section>
