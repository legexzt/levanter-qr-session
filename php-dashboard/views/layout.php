<?php
// Renders the LEGEZT admin sidebar, top bar, and page content.
// Called by public/index.php after it captures an authenticated page view.
// Needs legezt_esc() plus $page, $title, $content, and $titles.
declare(strict_types=1);

$navigation = [
    'dashboard' => ['glyph' => '▦', 'label' => 'Dashboard'],
    'connect' => ['glyph' => '▣', 'label' => 'Connect'],
    'chats' => ['glyph' => '✉', 'label' => 'Chats'],
    'media' => ['glyph' => '▤', 'label' => 'Media'],
    'plugins' => ['glyph' => '⚙', 'label' => 'Plugins'],
    'listener' => ['glyph' => '◉', 'label' => 'Listener'],
    'ops' => ['glyph' => '▧', 'label' => 'Ops'],
    'settings' => ['glyph' => '⛭', 'label' => 'Settings'],
];
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= legezt_esc((string) $title) ?> — LEGEZT</title>
    <link rel="stylesheet" href="/assets/style.css">
    <script src="/assets/app.js" defer></script>
</head>
<body class="admin-page">
    <div class="admin-shell">
        <aside class="sidebar">
            <div class="sidebar-brand">LEGEZT</div>

            <nav class="sidebar-nav" aria-label="Main navigation">
                <?php foreach ($navigation as $slug => $item): ?>
                    <?php
                    $label = isset($titles[$slug])
                        ? (string) $titles[$slug]
                        : $item['label'];
                    $active = (string) $page === $slug;
                    ?>
                    <a
                        class="nav-link<?= $active ? ' active' : '' ?>"
                        href="<?= legezt_esc('index.php?page=' . $slug) ?>"
                        <?= $active ? 'aria-current="page"' : '' ?>
                    >
                        <span class="nav-glyph" aria-hidden="true"><?= legezt_esc($item['glyph']) ?></span>
                        <span class="nav-label"><?= legezt_esc($label) ?></span>
                    </a>
                <?php endforeach; ?>
            </nav>
        </aside>

        <div class="main-area">
            <header class="topbar">
                <h1 class="topbar-title"><?= legezt_esc((string) $title) ?></h1>

                <div class="topbar-actions">
                    <span class="topbar-status">
                        <span class="status-dot status-dot-green" aria-hidden="true"></span>
                        <span>LEGEZT</span>
                    </span>
                    <a class="logout-link" href="index.php?action=logout">Logout</a>
                </div>
            </header>

            <main class="content">
                <?= $content ?>
            </main>
        </div>
    </div>
</body>
</html>
