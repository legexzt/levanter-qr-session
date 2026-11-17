<?php
// Renders the Logs & Errors detail page: failures by command, recent
// failures, the bot error log, and the recent output log. Errors are
// recognisable at a glance — red for failures, green for ok.
// Called by public/index.php and captured into $content for the layout.
// Requires lib/ops.php, lib/security.php, and config.php.
declare(strict_types=1);

$data = ops_parsed();
?>
<?php if ($data === null): ?>
    <section class="card error">
        <h2>Logs service unavailable</h2>
        <p>legezt-bot on port 3001 is not responding. Logs and errors cannot be shown right now.</p>
        <p class="muted">Check that the legezt-bot service is running, then refresh this page.</p>
        <p><a class="btn" href="?page=logs">Refresh</a></p>
    </section>
<?php else: ?>
    <?php
    $status = $data['status'];
    $byCommand = $data['byCommand'];
    $recent = $data['recent'];
    $logOut = $data['logOut'];
    $logError = $data['logError'];
    $lastError = isset($status['lastError']) && is_string($status['lastError']) && trim($status['lastError']) !== ''
        ? trim($status['lastError'])
        : null;

    $failCommands = [];
    foreach ($byCommand as $row) {
        if ((int) ($row['fail'] ?? 0) > 0) {
            $failCommands[] = $row;
        }
    }
    usort($failCommands, static fn($a, $b) => (int) $b['fail'] <=> (int) $a['fail']);
    $recentFailures = array_values(array_filter($recent, static fn($event) => is_array($event) && ($event['ok'] ?? true) === false));
    $hasErrors = $failCommands !== [] || $recentFailures !== [] || $logError !== [] || $lastError !== null;
    ?>
    <?php if (!$hasErrors): ?>
        <section class="card success">
            <h2>✅ No errors</h2>
            <p>Nothing has failed. The bot is running clean — failures will appear here the moment one happens.</p>
        </section>
    <?php else: ?>
        <?php if ($lastError !== null): ?>
            <section class="card error">
                <h2>⚠️ Last error</h2>
                <p class="error-detail"><?= legezt_esc($lastError) ?></p>
            </section>
        <?php endif; ?>

        <?php if ($failCommands !== []): ?>
            <section class="card">
                <h2>Failures by command</h2>
                <ul class="activity-list">
                    <?php foreach ($failCommands as $row): ?>
                        <li><span class="badge badge-amber">failed</span> <?= legezt_esc($row['name']) ?> — <?= legezt_esc(number_format((int) $row['fail'])) ?> failed of <?= legezt_esc(number_format((int) $row['count'])) ?> calls</li>
                    <?php endforeach; ?>
                </ul>
            </section>
        <?php endif; ?>

        <?php if ($recentFailures !== []): ?>
            <section class="card">
                <h2>Recent failures</h2>
                <ul class="activity-list">
                    <?php foreach (array_slice($recentFailures, 0, 10) as $event): ?>
                        <?php
                        $time = ops_format_time(isset($event['time']) && is_string($event['time']) ? $event['time'] : null);
                        $label = isset($event['command']) && is_string($event['command']) && $event['command'] !== ''
                            ? $event['command']
                            : (isset($event['type']) && is_string($event['type']) ? $event['type'] : 'event');
                        ?>
                        <li><span class="badge badge-amber">failed</span> <?= legezt_esc($time) ?> — <?= legezt_esc($label) ?></li>
                    <?php endforeach; ?>
                </ul>
            </section>
        <?php endif; ?>

        <?php if ($logError !== []): ?>
            <section class="card">
                <h2>Error log (last <?= legezt_esc((string) count($logError)) ?> lines)</h2>
                <pre class="log-view log-view-error"><?= legezt_esc(implode("\n", $logError)) ?></pre>
            </section>
        <?php endif; ?>
    <?php endif; ?>

    <section class="card">
        <h2>Recent output log</h2>

        <?php if ($logOut === []): ?>
            <p class="muted">No log lines available.</p>
        <?php else: ?>
            <pre class="log-view"><?= legezt_esc(implode("\n", $logOut)) ?></pre>
        <?php endif; ?>
    </section>

    <p class="muted">Last checked: <?= legezt_esc(ops_format_time($data['checkedAt'])) ?> · Live status and controls live on the <a href="?page=ops">Ops page</a>.</p>
<?php endif; ?>
