<?php
// What: Renders the Media & Storage placeholder and measures current local storage usage.
// Called by: public/index.php, which renders this view inside views/layout.php.
// Needs: legezt_esc() and read access to as much of /var/legezt as PHP can traverse.
declare(strict_types=1);

$storageRoot = '/var/legezt';
$storageBytes = 0;
$fileCount = 0;
$maxFiles = 20000;

if (is_dir($storageRoot)) {
    try {
        $directory = new RecursiveDirectoryIterator(
            $storageRoot,
            FilesystemIterator::SKIP_DOTS
        );
        $iterator = new RecursiveIteratorIterator(
            $directory,
            RecursiveIteratorIterator::LEAVES_ONLY,
            RecursiveIteratorIterator::CATCH_GET_CHILD
        );

        foreach ($iterator as $fileInfo) {
            if ($fileCount >= $maxFiles) {
                break;
            }

            try {
                if ($fileInfo->isLink() || !$fileInfo->isFile()) {
                    continue;
                }

                $fileCount++;
                $size = $fileInfo->getSize();

                if (is_int($size) && $size > 0) {
                    $storageBytes += $size;
                }
            } catch (Throwable) {
                continue;
            }
        }
    } catch (Throwable) {
        // Unreadable paths leave the total at the amount that could be read.
    }
}

$storageUsed = number_format($storageBytes / 1048576, 1, '.', '') . ' MB';
?>
<section class="card" aria-labelledby="media-title">
    <div class="card-header">
        <h2 id="media-title">Media &amp; Storage</h2>
        <span class="badge badge-muted">Phase 3</span>
    </div>
    <p>The file browser for images, compressed videos, audio, and documents, together with per-folder sizes, arrives in Phase 3.</p>

    <div class="storage-metric">
        <span class="metric-label">Storage used so far</span>
        <strong class="metric-value"><?= legezt_esc($storageUsed) ?></strong>
    </div>

    <p class="muted">Recursive measurement under <code><?= legezt_esc($storageRoot) ?></code>, capped at a 20,000-file walk.</p>
</section>
