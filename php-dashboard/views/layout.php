<?php
// Renders the LEGEZT admin sidebar, top bar, and page content.
// Called by public/index.php after it captures an authenticated page view.
// Needs legezt_esc() plus $page, $title, $content, and $titles.
// Phase 3: inline SVG icons, LEGEZT logo mark, collapsible sidebar with
// a hamburger toggle (state in localStorage, overlay on mobile).
declare(strict_types=1);

// Inline SVG icons (24x24, stroke=currentColor). No external icon font.
$icons = [
    'dashboard' => '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'connect' => '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'chats' => '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'media' => '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    'plugins' => '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 13v8M13 17h8"/>',
    'listener' => '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    'usage' => '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
    'vault' => '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'logs' => '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    'ops' => '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    'settings' => '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M2 14h4M10 8h4M18 16h4"/>',
];

$navigation = [
    'dashboard' => 'Dashboard',
    'connect' => 'Connect',
    'chats' => 'Chats',
    'media' => 'Media',
    'plugins' => 'Plugins',
    'listener' => 'Listener',
    'usage' => 'Usage',
    'vault' => 'Vault',
    'logs' => 'Logs',
    'ops' => 'Ops',
    'settings' => 'Settings',
];
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= legezt_esc((string) $title) ?> — LEGEZT</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/style.css">
    <script src="/assets/app.js" defer></script>
</head>
<body class="admin-page">
    <div class="admin-shell" id="admin-shell">
        <div class="sidebar-overlay" id="sidebar-overlay" aria-hidden="true"></div>
        <aside class="sidebar" id="sidebar" aria-label="Sidebar">
            <a class="sidebar-brand" href="index.php?page=dashboard">
                <span class="logo-mark" aria-hidden="true">
                    <svg viewBox="0 0 40 40" width="32" height="32" role="img" aria-label="LEGEZT logo">
                        <defs>
                            <linearGradient id="legezt-logo-grad" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0" stop-color="#7c5cff"/>
                                <stop offset="1" stop-color="#22d3ee"/>
                            </linearGradient>
                        </defs>
                        <rect width="40" height="40" rx="11" fill="url(#legezt-logo-grad)"/>
                        <path d="M22.5 6 11 22h6.5L15.5 34 28.5 16h-7z" fill="#fff"/>
                    </svg>
                </span>
                <span class="brand-text">LEGEZT</span>
            </a>

            <nav class="sidebar-nav" aria-label="Main navigation">
                <?php foreach ($navigation as $slug => $label): ?>
                    <?php
                    $label = isset($titles[$slug])
                        ? (string) $titles[$slug]
                        : $label;
                    $active = (string) $page === $slug;
                    $icon = $icons[$slug] ?? '';
                    ?>
                    <a
                        class="nav-link<?= $active ? ' active' : '' ?>"
                        href="<?= legezt_esc('index.php?page=' . $slug) ?>"
                        <?= $active ? 'aria-current="page"' : '' ?>
                    >
                        <span class="nav-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><?= $icon ?></svg></span>
                        <span class="nav-label"><?= legezt_esc($label) ?></span>
                    </a>
                <?php endforeach; ?>
            </nav>
        </aside>

        <div class="main-area">
            <header class="topbar">
                <button class="hamburger" id="sidebar-toggle" type="button" aria-label="Toggle menu" aria-expanded="true">
                    <span aria-hidden="true"></span>
                    <span aria-hidden="true"></span>
                    <span aria-hidden="true"></span>
                </button>
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
