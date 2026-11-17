<?php
// Renders the real bot plugin list from the bot's /api/ops payload.
// Called by public/index.php and captured into $content for the layout.
// Requires lib/ops.php, lib/security.php, and config.php.
declare(strict_types=1);

$data = ops_parsed();
$plugins = $data === null ? null : $data['plugins'];
?>
<?php if ($data === null): ?>
    <section class="card error">
        <h2>Plugin list unavailable</h2>
        <p>legezt-bot on port 3001 is not responding. The plugin list cannot be shown right now.</p>
        <p class="muted">Check that the legezt-bot service is running, then refresh this page.</p>
        <p><a class="btn" href="?page=plugins">Refresh</a></p>
    </section>
<?php else: ?>
    <section class="card">
        <div class="card-header">
            <h2>Plugins</h2>
            <span class="badge badge-green"><?= legezt_esc((string) count($plugins)) ?> loaded</span>
        </div>
        <p class="muted">Every command the bot answers on WhatsApp. Send one on WhatsApp to run it — for example, <code>.ping</code> or <code>.help</code>.</p>

        <?php if ($plugins === []): ?>
            <p class="muted">No plugins loaded — the bot is running without commands.</p>
        <?php else: ?>
            <div class="table-scroll">
                <table class="data-table">
                    <tr><th>Command</th><th>What it does</th></tr>
                    <?php foreach ($plugins as $plugin): ?>
                        <?php
                        if (!is_array($plugin)) continue;
                        $command = isset($plugin['command']) && is_string($plugin['command']) ? $plugin['command'] : '—';
                        $description = isset($plugin['description']) && is_string($plugin['description']) ? $plugin['description'] : '';
                        ?>
                        <tr>
                            <td><code><?= legezt_esc($command) ?></code></td>
                            <td><?= legezt_esc($description) ?></td>
                        </tr>
                    <?php endforeach; ?>
                </table>
            </div>
        <?php endif; ?>
    </section>

    <p class="muted">Last checked: <?= legezt_esc(ops_format_time($data['checkedAt'])) ?> · Usage per command lives on the <a href="?page=usage">Usage page</a>.</p>
<?php endif; ?>
