<?php
// Renders WhatsApp status, statistics, recent activity, and quick actions.
// Called by public/index.php and captured into $content for the layout.
// Requires lib/qr.php, lib/db.php, lib/security.php, and config.php.
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
$storageBytes = 0;
$storageRoot = '/var/legezt';

if (is_dir($storageRoot)) {
    $directories = [$storageRoot];
    $filesWalked = 0;

    while ($directories !== [] && $filesWalked < 20000) {
        $directory = array_pop($directories);
        $entries = @scandir($directory);

        if ($entries === false) {
            continue;
        }

        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $path = $directory . DIRECTORY_SEPARATOR . $entry;

            if (is_link($path)) {
                continue;
            }

            if (is_dir($path)) {
                $directories[] = $path;
                continue;
            }

            if (!is_file($path)) {
                continue;
            }

            $filesWalked++;
            $size = @filesize($path);

            if (is_int($size) && $size > 0) {
                $storageBytes += $size;
            }

            if ($filesWalked >= 20000) {
                break;
            }
        }
    }
}

$storageLabel = number_format($storageBytes / 1048576, 2, '.', '') . ' MB';
$activities = [];

try {
    $statement = db()->prepare(
        'SELECT event, detail, created_at
         FROM audit_log
         ORDER BY created_at DESC
         LIMIT :limit'
    );

    if ($statement !== false) {
        $statement->bindValue(':limit', 8, SQLITE3_INTEGER);
        $result = $statement->execute();

        if ($result !== false) {
            while (($row = $result->fetchArray(SQLITE3_ASSOC)) !== false) {
                $activities[] = $row;
            }
            $result->finalize();
        }
    }
} catch (Throwable) {
    $activities = [];
}
?>
<section class="card">
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
            <p class="muted">The qr-session service on port 8080 is not responding.</p>
        <?php else: ?>
            <p class="status-line">
                <span class="dot amber" aria-hidden="true"></span>
                Not connected yet — no fresh QR
            </p>
            <p class="muted">Open Connect to see the pairing QR and link WhatsApp.</p>
        <?php endif; ?>
    <?php endif; ?>
</section>

<section class="stats-grid" aria-label="Dashboard statistics">
    <article class="card stat-card">
        <h3>Messages today</h3>
        <p class="stat-value">0</p>
        <p class="muted">Phase 3</p>
    </article>

    <article class="card stat-card">
        <h3>Media saved</h3>
        <p class="stat-value">0</p>
        <p class="muted">Phase 3</p>
    </article>

    <article class="card stat-card">
        <h3>Storage used</h3>
        <p class="stat-value"><?= legezt_esc($storageLabel) ?></p>
        <p class="muted">Under /var/legezt</p>
    </article>

    <article class="card stat-card">
        <h3>Bot</h3>
        <p class="stat-value">LEGEZT</p>
        <p class="muted">Phase 1</p>
    </article>
</section>

<section class="card">
    <h2>Recent activity</h2>

    <?php if ($activities === []): ?>
        <p class="muted">No activity yet.</p>
    <?php else: ?>
        <ul class="activity-list">
            <?php foreach ($activities as $activity): ?>
                <?php
                $createdAt = $activity['created_at'] ?? 0;

                if (is_numeric($createdAt)) {
                    $ts = (int) $createdAt;
                } else {
                    $parsedTs = strtotime((string) $createdAt);
                    $ts = $parsedTs === false ? 0 : $parsedTs;
                }

                $time = $ts > 0 ? date('H:i:s', $ts) : '--:--:--';
                $event = trim((string) ($activity['event'] ?? ''));
                $detail = (string) ($activity['detail'] ?? '');

                if ($event === '') {
                    $event = 'event';
                }
                ?>
                <li>
                    <?= legezt_esc($time) ?> — <?= legezt_esc($event) ?><?php if ($detail !== ''): ?> (<?= legezt_esc($detail) ?>)<?php endif; ?>
                </li>
            <?php endforeach; ?>
        </ul>
    <?php endif; ?>
</section>

<section class="card">
    <h2>Quick actions</h2>
    <div class="actions">
        <a class="btn" href="?page=connect">Open Connect / QR</a>

        <?php if ($connected): ?>
            <form method="post" action="index.php?action=disconnect">
                <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                <button type="submit" class="btn danger">Disconnect WhatsApp</button>
            </form>
        <?php endif; ?>
    </div>
</section>
