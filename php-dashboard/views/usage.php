<?php
// Renders the AI Usage detail page: totals, per-command and per-day tables,
// and recent activity. All numbers come from the bot's /api/ops payload.
// Called by public/index.php and captured into $content for the layout.
// Requires lib/ops.php, lib/security.php, and config.php.
declare(strict_types=1);

$data = ops_parsed();
?>
<?php if ($data === null): ?>
    <section class="card error">
        <h2>Usage service unavailable</h2>
        <p>legezt-bot on port 3001 is not responding. AI usage cannot be shown right now.</p>
        <p class="muted">Check that the legezt-bot service is running, then refresh this page.</p>
        <p><a class="btn" href="?page=usage">Refresh</a></p>
    </section>
<?php else: ?>
    <?php
    $totals = $data['totals'];
    $byCommand = array_slice($data['byCommand'], 0, 20);
    $byDay = array_slice($data['byDay'], 0, 30);
    $recent = $data['recent'];
    ?>
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
            <p class="muted">See Logs for details</p>
        </article>
    </section>

    <section class="card">
        <h2>Per command</h2>

        <?php if ($byCommand === []): ?>
            <p class="muted">No commands used yet — usage appears here after the first command.</p>
        <?php else: ?>
            <div class="table-scroll">
                <table class="data-table">
                    <tr><th>Command</th><th>Calls</th><th>OK</th><th>Failed</th><th>Tokens</th></tr>
                    <?php foreach ($byCommand as $row): ?>
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
    </section>

    <?php if ($byDay !== []): ?>
        <section class="card">
            <h2>Per day (last 30 days)</h2>
            <div class="table-scroll">
                <table class="data-table">
                    <tr><th>Day</th><th>Events</th><th>OK</th><th>Failed</th><th>Tokens</th></tr>
                    <?php foreach ($byDay as $row): ?>
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
        </section>
    <?php endif; ?>

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

    <p class="muted">Last checked: <?= legezt_esc(ops_format_time($data['checkedAt'])) ?> · Full detail, including errors and PM2, lives on the <a href="?page=ops">Ops page</a>.</p>
<?php endif; ?>
