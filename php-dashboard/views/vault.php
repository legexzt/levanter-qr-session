<?php
// Renders the Secret Vault browser: every file the bot saved for the owner,
// stored encrypted. A file is decrypted only when the owner downloads it.
// Called by public/index.php and captured into $content for the layout.
// Requires lib/ops.php, lib/security.php, and config.php.
declare(strict_types=1);

$data = ops_parsed();
$vault = $data === null ? null : $data['vault'];
?>
<?php if ($data === null): ?>
    <section class="card error">
        <h2>Vault service unavailable</h2>
        <p>legezt-bot on port 3001 is not responding. The vault cannot be shown right now.</p>
        <p class="muted">Check that the legezt-bot service is running, then refresh this page.</p>
        <p><a class="btn" href="?page=vault">Refresh</a></p>
    </section>
<?php else: ?>
    <section class="card">
        <div class="card-header">
            <h2>Secret vault</h2>
            <span class="badge badge-green"><?= legezt_esc((string) count($vault)) ?> file<?= count($vault) === 1 ? '' : 's' ?></span>
        </div>
        <p class="muted">PDFs, files, and voice notes the bot saves for you — stored encrypted (AES-256-GCM). A file is decrypted only when you download it. Nothing here leaves the server unless you ask for it.</p>

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
                        $typeIcon = $type === 'PDF' ? '📄' : ($type === 'Image' ? '🖼️' : ($type === 'Video' ? '🎬' : ($type === 'Audio' ? '🎵' : ($type === 'Archive' ? '📦' : '📁'))));
                        ?>
                        <tr>
                            <td><?= legezt_esc($typeIcon) ?> <?= legezt_esc($name) ?></td>
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

    <p class="muted">Last checked: <?= legezt_esc(ops_format_time($data['checkedAt'])) ?> · The vault key lives only on the server and is never shown here.</p>
<?php endif; ?>
