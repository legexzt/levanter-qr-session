<?php
// Renders the standalone passcode login page.
// Called by public/index.php for visitors who are not logged in.
// Needs legezt_esc() and the login variables supplied by the front controller.
declare(strict_types=1);

$errorMessage = null;

if ($error === '1') {
    $errorMessage = 'Invalid passcode. Try again.';
} elseif ($error === 'locked') {
    $minutes = (int) ceil(((int) $lock_remaining) / 60);
    $errorMessage = 'Too many failed attempts. Locked for ' . $minutes . ' minute(s).';
} elseif ($error === 'setup') {
    $errorMessage = 'Passcode is not set up yet.';
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>LEGEZT</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body class="login-page">
    <main class="login-container">
        <section class="login-card" aria-labelledby="login-title">
            <div class="login-logo" aria-hidden="true">
                <svg viewBox="0 0 40 40" width="52" height="52" role="img" aria-label="LEGEZT logo">
                    <defs>
                        <linearGradient id="legezt-login-grad" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stop-color="#7c5cff"/>
                            <stop offset="1" stop-color="#22d3ee"/>
                        </linearGradient>
                    </defs>
                    <rect width="40" height="40" rx="11" fill="url(#legezt-login-grad)"/>
                    <path d="M22.5 6 11 22h6.5L15.5 34 28.5 16h-7z" fill="#fff"/>
                </svg>
            </div>
            <h1 id="login-title" class="login-brand">LEGEZT</h1>
            <p class="login-subtitle">Private WhatsApp dashboard</p>

            <?php if ($errorMessage !== null): ?>
                <div class="alert alert-error" role="alert">
                    <?= legezt_esc($errorMessage) ?>
                </div>
            <?php endif; ?>

            <?php if (!$passcode_set): ?>
                <div class="alert alert-warning" role="alert">
                    Passcode is not set yet. On the server run:
                    <code>sudo php /home/ubuntu/levanter-qr-session/php-dashboard/scripts/set-passcode.php</code>
                </div>
            <?php else: ?>
                <form class="login-form" method="post" action="index.php?action=login">
                    <input type="hidden" name="csrf" value="<?= legezt_esc((string) $csrf_value) ?>">
                    <input type="hidden" name="form_token" value="<?= legezt_esc((string) $form_token_value) ?>">

                    <div class="form-field">
                        <label for="passcode">Passcode</label>
                        <input
                            type="password"
                            id="passcode"
                            name="passcode"
                            required
                            maxlength="128"
                            autofocus
                            autocomplete="current-password"
                        >
                    </div>

                    <div style="position:absolute;left:-9999px" aria-hidden="true">
                        <label for="website">Website</label>
                        <input
                            type="text"
                            id="website"
                            name="website"
                            value=""
                            tabindex="-1"
                            autocomplete="off"
                        >
                    </div>

                    <button type="submit" class="button button-primary">Sign in</button>
                </form>
            <?php endif; ?>

            <p class="login-footer">Only the owner can sign in. Every attempt is logged.</p>
        </section>
    </main>
</body>
</html>
