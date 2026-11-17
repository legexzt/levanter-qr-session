<?php
// Routes dashboard authentication, QR-service actions, and page rendering.
// Called by nginx for public/index.php requests; health checks belong to health.php.
// Requires config.php, the database/security/auth libraries, and the dashboard views.
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/security.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/qr.php';

block_bad_user_agents();
send_security_headers();
start_session();

function qr_api(string $method, string $path): ?array
{
    $method = strtoupper($method);
    $url = QR_BASE_URL . $path;

    try {
        $status = 0;

        if (function_exists('curl_init')) {
            $curl = curl_init($url);
            if ($curl === false) {
                return null;
            }

            $options = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_TIMEOUT => 5,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
            ];

            if ($method === 'POST') {
                $options[CURLOPT_POST] = true;
                $options[CURLOPT_POSTFIELDS] = '{}';
                $options[CURLOPT_HTTPHEADER] = [
                    'Accept: application/json',
                    'Content-Type: application/json',
                ];
            } elseif ($method !== 'GET') {
                $options[CURLOPT_CUSTOMREQUEST] = $method;
            }

            if (!curl_setopt_array($curl, $options)) {
                curl_close($curl);
                return null;
            }

            $body = curl_exec($curl);
            $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            $failed = $body === false || curl_errno($curl) !== 0;
            curl_close($curl);

            if ($failed || $status < 200 || $status >= 300) {
                return null;
            }
        } else {
            $http = [
                'method' => $method,
                'timeout' => 5,
                'ignore_errors' => true,
                'header' => "Accept: application/json\r\n",
            ];

            if ($method === 'POST') {
                $http['header'] .= "Content-Type: application/json\r\n";
                $http['content'] = '{}';
            }

            $context = stream_context_create(['http' => $http]);
            $body = @file_get_contents($url, false, $context);

            if ($body === false) {
                return null;
            }

            foreach ($http_response_header ?? [] as $headerLine) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $headerLine, $matches) === 1) {
                    $status = (int) $matches[1];
                }
            }

            if ($status !== 0 && ($status < 200 || $status >= 300)) {
                return null;
            }
        }

        if (!is_string($body)) {
            return null;
        }

        $decoded = json_decode($body, true);

        return is_array($decoded) ? $decoded : null;
    } catch (Throwable $e) {
        return null;
    }
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');

    $json = json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );

    if ($json === false) {
        http_response_code(502);
        $json = '{"error":"qr-service-unavailable"}';
    }

    echo $json;
    exit;
}

function dashboard_redirect(string $location): void
{
    header('Location: ' . $location, true, 302);
    exit;
}

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$action = isset($_GET['action']) && is_string($_GET['action'])
    ? $_GET['action']
    : '';
$ip = get_client_ip();

if ($action === 'logout' && $requestMethod === 'GET') {
    if (is_logged_in()) {
        db_log('logout');
    }

    logout();
    dashboard_redirect('index.php');
}

if ($action === 'qr-status' && $requestMethod === 'GET') {
    if (!is_logged_in()) {
        json_response(['error' => 'unauthenticated'], 401);
    }

    $result = qr_api('GET', '/api/qr');
    if ($result === null) {
        json_response(['error' => 'qr-service-unavailable'], 502);
    }

    json_response($result);
}

if ($action === 'disconnect' && $requestMethod === 'POST') {
    if (!is_logged_in()) {
        json_response(['error' => 'unauthenticated'], 401);
    }

    $csrf = isset($_POST['csrf']) && is_string($_POST['csrf'])
        ? $_POST['csrf']
        : null;

    if (!verify_csrf($csrf)) {
        json_response(['error' => 'invalid-csrf'], 403);
    }

    $result = qr_api('POST', '/api/disconnect');
    db_log('disconnect');

    if ($result === null) {
        json_response(['error' => 'qr-service-unavailable'], 502);
    }

    json_response($result);
}

if ($action === 'reconnect' && $requestMethod === 'POST') {
    if (!is_logged_in()) {
        json_response(['error' => 'unauthenticated'], 401);
    }

    $csrf = isset($_POST['csrf']) && is_string($_POST['csrf'])
        ? $_POST['csrf']
        : null;

    if (!verify_csrf($csrf)) {
        json_response(['error' => 'invalid-csrf'], 403);
    }

    // Phase 2: resumes legezt-bot after a manual disconnect (auth files kept).
    $result = qr_api('POST', '/api/connect');
    db_log('reconnect');

    if ($result === null) {
        json_response(['error' => 'qr-service-unavailable'], 502);
    }

    json_response($result);
}

if ($action === 'login' && $requestMethod === 'POST') {
    $passcode = isset($_POST['passcode']) && is_string($_POST['passcode'])
        ? $_POST['passcode']
        : null;
    $csrf = isset($_POST['csrf']) && is_string($_POST['csrf'])
        ? $_POST['csrf']
        : null;
    $formToken = isset($_POST['form_token']) && is_string($_POST['form_token'])
        ? $_POST['form_token']
        : null;

    if (honeypot_filled($_POST)) {
        db_log('honeypot_blocked', $ip);
        sleep(1);
        dashboard_redirect('index.php?error=1');
    }

    if (is_ip_locked($ip)) {
        db_log('login_locked', $ip);
        dashboard_redirect('index.php?error=locked');
    }

    if (!verify_csrf($csrf) || !verify_form_token($formToken)) {
        db_log('login_bad_token');
        dashboard_redirect('index.php?error=1');
    }

    if (!passcode_is_set()) {
        db_log('login_no_passcode');
        dashboard_redirect('index.php?error=setup');
    }

    if ($passcode === null || $passcode === '' || strlen($passcode) > 128) {
        dashboard_redirect('index.php?error=1');
    }

    if (login($passcode)) {
        record_login_attempt($ip, true);
        db_log('login_success');
        dashboard_redirect('index.php?page=dashboard');
    }

    record_login_attempt($ip, false);
    db_log('login_failed');
    dashboard_redirect('index.php?error=1');
}

if (!is_logged_in()) {
    $error = isset($_GET['error']) && is_string($_GET['error'])
        ? $_GET['error']
        : null;
    $lock_remaining = is_ip_locked($ip) ? login_lock_remaining($ip) : 0;
    $passcode_set = passcode_is_set();
    $form_token_value = form_token();
    $csrf_value = csrf_token();

    require LEGEZT_ROOT . '/views/login.php';
    exit;
}

$allowedPages = [
    'dashboard',
    'connect',
    'chats',
    'media',
    'plugins',
    'listener',
    'settings',
];

$page = isset($_GET['page']) && is_string($_GET['page'])
    ? $_GET['page']
    : 'dashboard';

if (!in_array($page, $allowedPages, true)) {
    $page = 'dashboard';
}

$titles = [
    'dashboard' => 'Dashboard',
    'connect' => 'Connect WhatsApp',
    'chats' => 'Chats',
    'media' => 'Media & Storage',
    'plugins' => 'Plugins',
    'listener' => 'Listener & Learning',
    'settings' => 'Settings',
];

$title = $titles[$page];
$bufferLevel = ob_get_level();

ob_start();

try {
    require LEGEZT_ROOT . '/views/' . $page . '.php';
    $content = (string) ob_get_clean();
} catch (Throwable $e) {
    while (ob_get_level() > $bufferLevel) {
        ob_end_clean();
    }

    throw $e;
}

require LEGEZT_ROOT . '/views/layout.php';
