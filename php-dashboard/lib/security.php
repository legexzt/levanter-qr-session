<?php
// What: Provides HTTP, session-token, honeypot, and login-lockout security helpers.
// Called by: Public dashboard entry points during authentication and request handling.
// Needs: config.php, lib/db.php, PHP 8.2, and an active session for token helpers.
declare(strict_types=1);

require_once dirname(__DIR__) . '/config.php';
require_once __DIR__ . '/db.php';

function send_security_headers(): void
{
    if (headers_sent()) {
        return;
    }

    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header(
        "Content-Security-Policy: default-src 'self'; " .
        "img-src 'self' data:; " .
        "style-src 'self' 'unsafe-inline'; " .
        "script-src 'self'; " .
        "frame-ancestors 'none'; " .
        "base-uri 'self'; " .
        "form-action 'self'"
    );
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
}

function get_client_ip(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

    if (!is_string($ip) || $ip === '') {
        return 'unknown';
    }

    return $ip;
}

function block_bad_user_agents(): void
{
    $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $blocked = !is_string($userAgent) || trim($userAgent) === '';

    $blockedAgents = [
        'sqlmap',
        'nikto',
        'nmap',
        'masscan',
        'hydra',
        'dirbuster',
        'wpscan',
        'zgrab',
        'python-requests',
        'Go-http-client',
        'libwww',
    ];

    if (!$blocked) {
        foreach ($blockedAgents as $blockedAgent) {
            if (stripos($userAgent, $blockedAgent) !== false) {
                $blocked = true;
                break;
            }
        }
    }

    if ($blocked) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=UTF-8');
        echo 'Forbidden';
        exit;
    }
}

function csrf_token(): string
{
    if (
        !isset($_SESSION['csrf']) ||
        !is_string($_SESSION['csrf']) ||
        $_SESSION['csrf'] === ''
    ) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf'];
}

function verify_csrf(?string $t): bool
{
    $sessionToken = $_SESSION['csrf'] ?? null;

    if (
        $t === null ||
        $t === '' ||
        !is_string($sessionToken) ||
        $sessionToken === ''
    ) {
        return false;
    }

    return hash_equals($sessionToken, $t);
}

function form_token(): string
{
    $token = bin2hex(random_bytes(32));

    $_SESSION['form_token'] = $token;
    $_SESSION['form_token_created_at'] = time();

    return $token;
}

function verify_form_token(?string $t): bool
{
    if ($t === null || $t === '') {
        return false;
    }

    $storedToken = $_SESSION['form_token'] ?? null;
    $createdAt = $_SESSION['form_token_created_at'] ?? null;

    if (
        !is_string($storedToken) ||
        $storedToken === '' ||
        !is_int($createdAt)
    ) {
        return false;
    }

    if (!hash_equals($storedToken, $t)) {
        return false;
    }

    $now = time();

    if ($createdAt > $now) {
        return false;
    }

    return ($now - $createdAt) <= FORM_TOKEN_TTL;
}

function honeypot_filled(array $post): bool
{
    if (!isset($post['website'])) {
        return false;
    }

    $value = $post['website'];

    if (is_array($value)) {
        return true;
    }

    return trim((string) $value) !== '';
}

function record_login_attempt(string $ip, bool $success): void
{
    $statement = db()->prepare(
        'INSERT INTO login_attempts (ip, attempted_at, success)
         VALUES (:ip, :attempted_at, :success)'
    );
    $statement->bindValue(':ip', $ip, SQLITE3_TEXT);
    $statement->bindValue(':attempted_at', time(), SQLITE3_INTEGER);
    $statement->bindValue(
        ':success',
        $success ? 1 : 0,
        SQLITE3_INTEGER
    );
    $statement->execute();
}

function is_ip_locked(string $ip): bool
{
    $cutoff = time() - (LOCKOUT_MINUTES * 60);
    $statement = db()->prepare(
        'SELECT COUNT(*) AS failure_count
         FROM login_attempts
         WHERE ip = :ip
           AND success = 0
           AND attempted_at >= :cutoff'
    );
    $statement->bindValue(':ip', $ip, SQLITE3_TEXT);
    $statement->bindValue(':cutoff', $cutoff, SQLITE3_INTEGER);

    $result = $statement->execute();

    if ($result === false) {
        throw new RuntimeException('Unable to evaluate login lockout.');
    }

    $row = $result->fetchArray(SQLITE3_ASSOC);

    return $row !== false &&
        (int) $row['failure_count'] >= MAX_LOGIN_ATTEMPTS;
}

function login_lock_remaining(string $ip): int
{
    $now = time();
    $window = LOCKOUT_MINUTES * 60;
    $cutoff = $now - $window;

    $statement = db()->prepare(
        'SELECT COUNT(*) AS failure_count,
                MIN(attempted_at) AS oldest_failure
         FROM login_attempts
         WHERE ip = :ip
           AND success = 0
           AND attempted_at >= :cutoff'
    );
    $statement->bindValue(':ip', $ip, SQLITE3_TEXT);
    $statement->bindValue(':cutoff', $cutoff, SQLITE3_INTEGER);

    $result = $statement->execute();

    if ($result === false) {
        throw new RuntimeException('Unable to calculate login lockout.');
    }

    $row = $result->fetchArray(SQLITE3_ASSOC);

    if (
        $row === false ||
        (int) $row['failure_count'] < MAX_LOGIN_ATTEMPTS ||
        $row['oldest_failure'] === null
    ) {
        return 0;
    }

    $expiresAt = (int) $row['oldest_failure'] + $window;

    return max(0, $expiresAt - $now);
}
