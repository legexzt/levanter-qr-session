<?php
// Provides LEGEZT session handling and passcode authentication.
// Called by public/index.php and other dashboard entry points.
// Requires config.php, lib/db.php, lib/security.php, and PHP session/password functions.
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/security.php';

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_name('LEGEZTSESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    session_start();
}

function passcode_is_set(): bool
{
    try {
        if (!is_file(PASSCODE_HASH_FILE)) {
            return false;
        }

        $hash = @file_get_contents(PASSCODE_HASH_FILE);

        return is_string($hash) && trim($hash) !== '';
    } catch (Throwable $e) {
        return false;
    }
}

function verify_passcode(string $passcode): bool
{
    try {
        if (!is_file(PASSCODE_HASH_FILE)) {
            return false;
        }

        $contents = @file_get_contents(PASSCODE_HASH_FILE);
        if (!is_string($contents)) {
            return false;
        }

        $hash = trim($contents);
        if ($hash === '') {
            return false;
        }

        return password_verify($passcode, $hash);
    } catch (Throwable $e) {
        return false;
    }
}

function login(string $passcode): bool
{
    if (!verify_passcode($passcode)) {
        return false;
    }

    if (session_status() !== PHP_SESSION_ACTIVE) {
        start_session();
    }

    session_regenerate_id(true);
    $_SESSION['authed'] = true;
    $_SESSION['login_at'] = time();
    $_SESSION['last_activity'] = time();

    return true;
}

function is_logged_in(): bool
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return false;
    }

    if (!isset($_SESSION['authed'], $_SESSION['login_at'], $_SESSION['last_activity'])) {
        return false;
    }

    if ($_SESSION['authed'] !== true) {
        return false;
    }

    $loginAt = $_SESSION['login_at'];
    $lastActivity = $_SESSION['last_activity'];

    if (!is_int($loginAt) || !is_int($lastActivity)) {
        return false;
    }

    $now = time();

    if ($now - $loginAt > SESSION_ABSOLUTE_TIMEOUT) {
        return false;
    }

    if ($now - $lastActivity > SESSION_IDLE_TIMEOUT) {
        return false;
    }

    $_SESSION['last_activity'] = $now;

    return true;
}

function logout(): void
{
    $_SESSION = [];

    $cookieName = session_status() === PHP_SESSION_ACTIVE
        ? session_name()
        : 'LEGEZTSESSID';

    if (ini_get('session.use_cookies')) {
        setcookie($cookieName, '', [
            'expires' => time() - 42000,
            'path' => '/',
            'domain' => '',
            'secure' => is_https(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
}
