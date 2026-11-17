<?php
// What: Defines LEGEZT application constants and filesystem/path helpers.
// Called by: Public entry points and library files via require_once.
// Needs: PHP 8.1 and access to the configured server filesystem paths.
declare(strict_types=1);

define('LEGEZT_ROOT', __DIR__);
define('CONFIG_DIR', '/var/legezt/config');
define('DATA_DIR', '/var/legezt/data');
define('STORAGE_DIR', '/var/legezt/storage');
define('PASSCODE_HASH_FILE', CONFIG_DIR . '/passcode.hash');
define('DB_FILE', DATA_DIR . '/legezt.sqlite');
// Phase 2: the QR/connect API is our own legezt-bot (port 3001), NOT the
// Levanter qr-session on 8080 (its QR dies after ~20s; owner order 17 Nov 2026).
define('QR_BASE_URL', 'http://127.0.0.1:3001');
define('SESSION_IDLE_TIMEOUT', 1800);
define('SESSION_ABSOLUTE_TIMEOUT', 28800);
define('MAX_LOGIN_ATTEMPTS', 5);
define('LOCKOUT_MINUTES', 15);
define('FORM_TOKEN_TTL', 600);

function is_https(): bool
{
    return ($_SERVER['HTTPS'] ?? null) === 'on';
}

function ensure_dir(string $path, int $mode = 0700): void
{
    if (is_dir($path)) {
        return;
    }

    if (!@mkdir($path, $mode, true) && !is_dir($path)) {
        throw new RuntimeException('Unable to create directory: ' . $path);
    }
}

function legezt_esc(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
