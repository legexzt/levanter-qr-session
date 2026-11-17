<?php
// Renders the Ops & Terminal page: live bot status, AI usage, errors,
// PM2 state, secret-vault browser, controls, and recent logs.
// Called by public/index.php and captured into $content for the layout.
// Requires lib/ops.php, lib/security.php, and config.php. All numbers come
// from the bot's /api/ops payload — nothing is guessed.
declare(strict_types=1);

$ops = ops_get();
$storageBytes = ops_storage_bytes();

$notice = isset($_GET['notice']) && is_string($_GET['notice'])
    ? $_GET['notice']
    : '';
$noticeMessages = [
    'restarted' => 'Restart requested — the bot exits and PM2 starts it again (about 10 seconds).',
    'restart-requested' => 'Restart requested, but the bot did not confirm — check the status below.',
    'paused' => 'Bot paused — it will not answer commands. Your session and data stay.',
    'resumed' => 'Bot resumed — reconnecting to WhatsApp.',
    'disconnected' => 'WhatsApp disconnected — session and data kept, nothing deleted.',
    'reconnected' => 'Reconnect requested — the bot is linking WhatsApp again.',
    'download-failed' => 'That vault file could not be downloaded.',
    'ops-unavailable' => 'The bot API did not respond — the action was not run.',
];

$status = [];
$totals = ['aiCalls' => 0, 'aiTokens' => 0, 'aiInputTokens' => 0, 'aiOutputTokens' => 0, 'tasks' => 0, 'tasksOk' => 0, 'tasksFail' => 0];
$byCommand = [];
$byDay = [];
$recent = [];
$pm2 = null;
$logOut = [];
$logError = [];
$vault = [];
$checkedAt = null;

if (is_array($ops)) {
    $status = isset($ops['status']) && is_array($ops['status']) ? $ops['status'] : [];
    $totals = array_merge($totals, isset($ops['totals']) && is_array($ops['totals']) ? $ops['totals'] : []);
    $stats = isset($ops['stats']) && is_array($ops['stats']) ? $ops['stats'] : [];
    $byCommand = isset($stats['byCommand']) && is_array($stats['byCommand']) ? $stats['byCommand'] : [];
    $byDay = isset($stats['byDay']) && is_array($stats['byDay']) ? $stats['byDay'] : [];
    $recent = isset($ops['recent']) && is_array($ops['recent']) ? $ops['recent'] : [];
    $pm2 = isset($ops['pm2']) && is_array($ops['pm2']) ? $ops['pm2'] : null;
    $logs = isset($ops['logs']) && is_array($ops['logs']) ? $ops['logs'] : [];
    $logOut = isset($logs['out']) && is_array($logs['out']) ? $logs['out'] : [];
    $logError = isset($logs['error']) && is_array($logs['error']) ? $logs['error'] : [];
    $vault = isset($ops['vault']) && is_array($ops['vault']) ? $ops['vault'] : [];
    $checkedAt = isset($ops['checkedAt']) && is_string($ops['checkedAt']) ? $ops['checkedAt'] : null;
}

$botStatus = isset($status['status']) && is_string($status['status']) ? $status['status'] : 'unknown';
$account = isset($status['account']) && is_string($status['account']) && trim($status['account']) !== ''
    ? trim($status['account'])
    : null;
$paused = isset($status['paused']) && $status['paused'] === true;
$uptimeSec = isset($status['uptimeSec']) && is_numeric($status['uptimeSec']) ? (int) $status['uptimeSec'] : null;
$lastError = isset($status['lastError']) && is_string($status['lastError']) && trim($status['lastError']) !== ''
    ? trim($status['lastError'])
    : null;

$connected = $botStatus === 'connected';
$dotClass = $connected ? 'green' : ($botStatus === 'waiting' ? 'amber' : 'grey');

$commandRows = [];
foreach ($byCommand as $name => $row) {
    if (!is_array($row)) {
        continue;
    }
    $commandRows[] = [
        'name' => (string) $name, 'count' => (int) ($row['count'] ?? 0),
        'ok' => (int) ($row['ok'] ?? 0), 'fail' => (int) ($row['fail'] ?? 0),
        'tokens' => (int) ($row['tokens'] ?? 0),
    ];
}
usort($commandRows, static fn($a, $b) => $b['count'] <=> $a['count']);
$commandRows = array_slice($commandRows, 0, 10);

$dayRows = [];
foreach ($byDay as $day => $row) {
    if (!is_array($row)) {
        continue;
    }
    $dayRows[] = [
        'day' => (string) $day, 'count' => (int) ($row['count'] ?? 0),
        'ok' => (int) ($row['ok'] ?? 0), 'fail' => (int) ($row['fail'] ?? 0),
        'tokens' => (int) ($row['tokens'] ?? 0),
    ];
}
usort($dayRows, static fn($a, $b) => strcmp($b['day'], $a['day']));
$dayRows = array_slice($dayRows, 0, 30);

$failCommands = [];
foreach ($byCommand as $name => $row) {
    if (!is_array($row)) {
        continue;
    }
    $fail = (int) ($row['fail'] ?? 0);
    if ($fail > 0) {
        $failCommands[] = [
            'name' => (string) $name,
            'count' => (int) ($row['count'] ?? 0),
            'fail' => $fail,
        ];
    }
}
usort($failCommands, static fn($a, $b) => $b['fail'] <=> $a['fail']);
$recentFailures = array_values(array_filter($recent, static fn($event) => is_array($event) && ($event['ok'] ?? true) === false));
$hasErrors = $failCommands !== [] || $recentFailures !== [] || $logError !== [] || $lastError !== null;
?>
<?php if ($notice !== '' && isset($noticeMessages[$notice])): ?>
    <p class="success-box" role="status"><?= legezt_esc($noticeMessages[$notice]) ?></p>
<?php endif; ?>

<?php if ($ops === null): ?>
    <section class="card error">
        <h2>Ops service unavailable</h2>
        <p>legezt-bot on port 3001 is not responding. Usage, errors, PM2, logs, and the vault cannot be shown right now.</p>
        <p class="muted">Check that the legezt-bot service is running, then refresh this page.</p>
        <p><a class="btn" href="?page=ops">Refresh</a></p>
    </section>
<?php else: ?>
    <section class="card">
        <h2>Live status</h2>
        <p class="status-line">
            <span class="dot <?= legezt_esc($dotClass) ?>" aria-hidden="true"></span>
            <?php if ($connected): ?>
                Connected<?php if ($account !== null): ?> — <?= legezt_esc($account) ?><?php endif; ?>
            <?php elseif ($botStatus === 'waiting'): ?>
                Waiting to scan — open Connect to scan the QR
            <?php elseif ($botStatus === 'disconnected'): ?>
                Disconnected (paused)
            <?php else: ?>
                Status: <?= legezt_esc($botStatus) ?>
            <?php endif; ?>
            <?php if ($paused): ?>
                <span class="badge badge-amber">Paused</span>
            <?php endif; ?>
        </p>
        <table class="kv-table">
            <tr><th>Bot uptime</th><td><?= $uptimeSec === null ? '—' : legezt_esc(ops_format_uptime($uptimeSec)) ?></td></tr>
            <tr><th>Storage used</th><td><?= legezt_esc(ops_format_bytes($storageBytes)) ?> (under /var/legezt)</td></tr>
            <tr><th>Last checked</th><td><?= legezt_esc(ops_format_time($checkedAt)) ?></td></tr>
            <?php if ($lastError !== null): ?>
                <tr><th>Last error</th><td class="error-detail"><?= legezt_esc($lastError) ?></td></tr>
            <?php endif; ?>
        </table>
    </section>

    <section class="stats-grid" aria-label="AI usage totals">
        <article class="card stat-card">
            <h3>AI calls</h3>
            <p class="stat-value"><?= legezt_esc(number_format((int) $totals['aiCalls'])) ?></p>
            <p class="muted">Kimi K3 via .ai</p>
        </article>

        <article class="card stat-card">
            <h3>AI tokens</h3>
            <p class="stat-value"><?= legezt_esc(number_format((int) $totals['aiTokens'])) ?></p>
            <p class="muted">In <?= legezt_esc(number_format((int) $totals['aiInputTokens'])) ?> / Out <?= legezt_esc(number_format((int) $totals['aiOutputTokens'])) ?></p>
        </article>

        <article class="card stat-card">
            <h3>Tasks done</h3>
            <p class="stat-value"><?= legezt_esc(number_format((int) $totals['tasks'])) ?></p>
            <p class="muted"><?= legezt_esc(number_format((int) $totals['tasksOk'])) ?> ok</p>
        </article>

        <article class="card stat-card">
            <h3>Tasks failed</h3>
            <p class="stat-value"><?= legezt_esc(number_format((int) $totals['tasksFail'])) ?></p>
            <p class="muted">See Errors below</p>
        </article>
    </section>

    <section class="card">
        <h2>AI usage</h2>

        <?php if ($commandRows === []): ?>
            <p class="muted">No commands used yet — usage appears here after the first command.</p>
        <?php else: ?>
            <h3>Per command</h3>
            <div class="table-scroll">
                <table class="data-table">
                    <tr><th>Command</th><th>Calls</th><th>OK</th><th>Failed</th><th>Tokens</th></tr>
                    <?php foreach ($commandRows as $row): ?>
                        <tr>
                            <td><?= legezt_esc($row['name']) ?></td>
                            <td><?= legezt_esc(number_format($row['count'])) ?></td>
                            <td><?= legezt_esc(number_format($row['ok'])) ?></td>
                            <td><?= legezt_esc(number_format($row['fail'])) ?></td>
                            <td><?= legezt_esc(number_format($row['tokens'])) ?></td>
                        </tr>
                    <?php endforeach; ?>
                </table>
            </div>
        <?php endif; ?>

        <?php if ($dayRows !== []): ?>
            <h3>Per day (last 30 days)</h3>
            <div class="table-scroll">
                <table class="data-table">
                    <tr><th>Day</th><th>Events</th><th>OK</th><th>Failed</th><th>Tokens</th></tr>
                    <?php foreach ($dayRows as $row): ?>
                        <tr>
                            <td><?= legezt_esc($row['day']) ?></td>
                            <td><?= legezt_esc(number_format($row['count'])) ?></td>
                            <td><?= legezt_esc(number_format($row['ok'])) ?></td>
                            <td><?= legezt_esc(number_format($row['fail'])) ?></td>
                            <td><?= legezt_esc(number_format($row['tokens'])) ?></td>
                        </tr>
                    <?php endforeach; ?>
                </table>
            </div>
        <?php endif; ?>
    </section>

    <section class="card">
        <h2>Recent activity</h2>

        <?php if ($recent === []): ?>
            <p class="muted">No activity recorded yet.</p>
        <?php else: ?>
            <ul class="activity-list">
                <?php foreach ($recent as $event): ?>
                    <?php
                    if (!is_array($event)) {
                        continue;
                    }
                    $time = ops_format_time(isset($event['time']) && is_string($event['time']) ? $event['time'] : null);
                    $label = isset($event['command']) && is_string($event['command']) && $event['command'] !== ''
                        ? $event['command']
                        : (isset($event['type']) && is_string($event['type']) ? $event['type'] : 'event');
                    $tokens = isset($event['tokens']) && is_numeric($event['tokens']) ? (int) $event['tokens'] : null;
                    $ok = ($event['ok'] ?? true) === true;
                    ?>
                    <li><?= legezt_esc($time) ?> — <?= legezt_esc($label) ?><?php if ($tokens !== null): ?> (<?= legezt_esc(number_format($tokens)) ?> tokens)<?php endif; ?> <?php if ($ok): ?><span class="badge badge-green">ok</span><?php else: ?><span class="badge badge-amber">failed</span><?php endif; ?></li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </section>

    <section class="card">
        <h2>Errors</h2>

        <?php if (!$hasErrors): ?>
            <p class="muted">No errors recorded.</p>
        <?php else: ?>
            <?php if ($failCommands !== []): ?>
                <h3>Failures by command</h3>
                <ul class="activity-list">
                    <?php foreach ($failCommands as $row): ?>
                        <li><?= legezt_esc($row['name']) ?> — <?= legezt_esc(number_format($row['fail'])) ?> failed of <?= legezt_esc(number_format($row['count'])) ?> calls</li>
                    <?php endforeach; ?>
                </ul>
            <?php endif; ?>

            <?php if ($recentFailures !== []): ?>
                <h3>Recent failures</h3>
                <ul class="activity-list">
                    <?php foreach (array_slice($recentFailures, 0, 10) as $event): ?>
                        <?php
                        $time = ops_format_time(isset($event['time']) && is_string($event['time']) ? $event['time'] : null);
                        $label = isset($event['command']) && is_string($event['command']) && $event['command'] !== ''
                            ? $event['command']
                            : (isset($event['type']) && is_string($event['type']) ? $event['type'] : 'event');
                        ?>
                        <li><?= legezt_esc($time) ?> — <?= legezt_esc($label) ?></li>
                    <?php endforeach; ?>
                </ul>
            <?php endif; ?>

            <?php if ($logError !== []): ?>
                <h3>Error log (last <?= legezt_esc((string) count($logError)) ?> lines)</h3>
                <pre class="log-view"><?= legezt_esc(implode("\n", $logError)) ?></pre>
            <?php endif; ?>
        <?php endif; ?>
    </section>

    <section class="card">
        <h2>Processes (PM2)</h2>

        <?php if ($pm2 === null): ?>
            <p class="muted">PM2 info is unavailable right now.</p>
        <?php elseif ($pm2 === []): ?>
            <p class="muted">No PM2 processes found — legezt-bot, levanter, and qr-session are not running under PM2.</p>
        <?php else: ?>
            <div class="table-scroll">
                <table class="data-table">
                    <tr><th>Process</th><th>Status</th><th>Uptime</th><th>Restarts</th><th>Memory</th></tr>
                    <?php foreach ($pm2 as $proc): ?>
                        <?php if (!is_array($proc)) continue; ?>
                        <tr>
                            <td><?= legezt_esc(isset($proc['name']) ? (string) $proc['name'] : '—') ?></td>
                            <td><?= legezt_esc(isset($proc['status']) ? (string) $proc['status'] : '—') ?></td>
                            <td><?= isset($proc['uptimeSec']) && is_numeric($proc['uptimeSec']) ? legezt_esc(ops_format_uptime((int) $proc['uptimeSec'])) : '—' ?></td>
                            <td><?= isset($proc['restarts']) && is_numeric($proc['restarts']) ? legezt_esc(number_format((int) $proc['restarts'])) : '—' ?></td>
                            <td><?= isset($proc['memoryBytes']) && is_numeric($proc['memoryBytes']) ? legezt_esc(ops_format_bytes((int) $proc['memoryBytes'])) : '—' ?></td>
                        </tr>
                    <?php endforeach; ?>
                </table>
            </div>
        <?php endif; ?>
    </section>

    <section class="card">
        <h2>Secret vault</h2>
        <p class="muted">PDFs, files, and voice notes the bot saves for you — stored encrypted. A file is decrypted only when you download it.</p>

        <?php if ($vault === []): ?>
            <p class="muted">The vault is empty — files you receive on WhatsApp are saved here encrypted.</p>
        <?php else: ?>
            <div class="table-scroll">
                <table class="data-table">
                    <tr><th>File</th><th>Type</th><th>Size</th><th>Stored</th><th></th></tr>
                    <?php foreach ($vault as $file): ?>
                        <?php
                        if (!is_array($file)) continue;
                        $hash = isset($file['hash']) && is_string($file['hash']) && preg_match('/^[0-9a-f]{64}$/', $file['hash']) === 1
                            ? $file['hash']
                            : null;
                        $name = isset($file['originalName']) && is_string($file['originalName']) && $file['originalName'] !== ''
                            ? $file['originalName']
                            : (isset($file['name']) ? (string) $file['name'] : 'file');
                        $type = isset($file['type']) && is_string($file['type']) ? $file['type'] : 'File';
                        $size = isset($file['size']) && is_numeric($file['size']) ? (int) $file['size'] : null;
                        $stored = ops_format_time(isset($file['storedAt']) && is_string($file['storedAt']) ? $file['storedAt'] : null);
                        ?>
                        <tr>
                            <td><?= legezt_esc($name) ?></td>
                            <td><?= legezt_esc($type) ?></td>
                            <td><?= $size === null ? '—' : legezt_esc(ops_format_bytes($size)) ?></td>
                            <td><?= legezt_esc($stored) ?></td>
                            <td>
                                <?php if ($hash !== null): ?>
                                    <a class="btn" href="index.php?action=vault-download&amp;hash=<?= legezt_esc($hash) ?>&amp;csrf=<?= legezt_esc(csrf_token()) ?>">Download</a>
                                <?php else: ?>
                                    —
                                <?php endif; ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </table>
            </div>
        <?php endif; ?>
    </section>

    <section class="card">
        <h2>Controls</h2>
        <div class="actions">
            <form method="post" action="index.php?action=ops-restart" class="confirm-action" data-confirm="Restart the bot? It exits and PM2 starts it again (about 10 seconds).">
                <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                <button type="submit" class="btn primary">Restart bot</button>
            </form>

            <?php if ($paused): ?>
                <form method="post" action="index.php?action=ops-resume">
                    <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                    <button type="submit" class="btn">Resume bot</button>
                </form>
            <?php else: ?>
                <form method="post" action="index.php?action=ops-pause" class="confirm-action" data-confirm="Pause the bot? It will stop answering commands. Your session and data stay.">
                    <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                    <button type="submit" class="btn">Pause bot</button>
                </form>
            <?php endif; ?>

            <?php if ($connected): ?>
                <form method="post" action="index.php?action=ops-disconnect" class="confirm-action" data-confirm="Disconnect WhatsApp? Your session and data are kept — nothing is deleted.">
                    <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                    <button type="submit" class="btn danger">Disconnect WhatsApp</button>
                </form>
            <?php else: ?>
                <form method="post" action="index.php?action=ops-reconnect">
                    <input type="hidden" name="csrf" value="<?= legezt_esc(csrf_token()) ?>">
                    <button type="submit" class="btn primary">Reconnect WhatsApp</button>
                </form>
            <?php endif; ?>

            <a class="btn" href="?page=ops">Refresh</a>
        </div>
        <p class="muted ops-note">Restart exits the bot and PM2 starts it again. Pause stops the bot answering; Disconnect closes the WhatsApp link. Both keep your session, vault, and data — nothing is deleted. There is no raw shell here by design — only these safe controls.</p>
    </section>

    <section class="card">
        <h2>Recent logs</h2>

        <?php if ($logOut === [] && $logError === []): ?>
            <p class="muted">No log lines available.</p>
        <?php else: ?>
            <?php if ($logOut !== []): ?>
                <h3>Output (last <?= legezt_esc((string) count($logOut)) ?> lines)</h3>
                <pre class="log-view"><?= legezt_esc(implode("\n", $logOut)) ?></pre>
            <?php endif; ?>
        <?php endif; ?>
    </section>
<?php endif; ?>
