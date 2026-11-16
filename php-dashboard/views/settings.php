<?php
// What: Renders read-only Phase 1 configuration values and passcode-change guidance.
// Called by: public/index.php, which renders this view inside views/layout.php.
// Needs: legezt_esc() and the dashboard session, security, URL, and directory constants.
declare(strict_types=1);

$settings = [
    ['Session idle timeout', ((string) SESSION_IDLE_TIMEOUT) . ' seconds'],
    ['Session absolute timeout', ((string) SESSION_ABSOLUTE_TIMEOUT) . ' seconds'],
    ['Maximum login attempts', (string) MAX_LOGIN_ATTEMPTS],
    ['Login lockout', ((string) LOCKOUT_MINUTES) . ' minutes'],
    ['QR service URL', (string) QR_BASE_URL],
    ['Config directory', (string) CONFIG_DIR],
    ['Data directory', (string) DATA_DIR],
    ['Storage directory', (string) STORAGE_DIR],
];

$passcodeCommand = 'sudo php /home/ubuntu/levanter-qr-session/php-dashboard/scripts/set-passcode.php';
?>
<section class="card" aria-labelledby="settings-title">
    <div class="card-header">
        <h2 id="settings-title">Settings</h2>
        <span class="badge badge-muted">Read-only</span>
    </div>

    <p>These Phase 1 configuration values are read-only in the dashboard.</p>

    <dl class="settings-list">
        <?php foreach ($settings as [$label, $value]): ?>
            <div class="setting-row">
                <dt><?= legezt_esc($label) ?></dt>
                <dd><code><?= legezt_esc($value) ?></code></dd>
            </div>
        <?php endforeach; ?>
    </dl>

    <p class="muted">Passcode changes and storage limits arrive in Phase 2. To change the passcode now, run on the server:</p>
    <pre><code><?= legezt_esc($passcodeCommand) ?></code></pre>
</section>
