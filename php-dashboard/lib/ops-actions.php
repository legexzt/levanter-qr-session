<?php
// Handles the Ops page's POST actions and the vault download.
// Called by public/index.php after the pairing-code action, before the
// login gate. Each action is CSRF-protected and written to the audit log.
// Requires config.php, lib/db.php, lib/security.php, lib/auth.php,
// lib/qr.php, and lib/ops.php.
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/security.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/qr.php';
require_once __DIR__ . '/ops.php';

function ops_control_csrf(): ?string
{
    return isset($_POST['csrf']) && is_string($_POST['csrf'])
        ? $_POST['csrf']
        : null;
}

function handle_ops_actions(string $action, string $requestMethod): void
{
    if ($action === 'ops-restart' && $requestMethod === 'POST') {
        if (!is_logged_in()) {
            json_response(['error' => 'unauthenticated'], 401);
        }

        if (!verify_csrf(ops_control_csrf())) {
            json_response(['error' => 'invalid-csrf'], 403);
        }

        // Restart exits the bot and PM2 starts it again; a null reply means
        // the bot did not confirm, so the notice says so instead of
        // claiming success.
        $result = ops_restart();
        db_log('ops_restart');
        dashboard_redirect('index.php?page=ops&notice=' . ($result === null ? 'restart-requested' : 'restarted'));
    }

    if ($action === 'ops-pause' && $requestMethod === 'POST') {
        if (!is_logged_in()) {
            json_response(['error' => 'unauthenticated'], 401);
        }

        if (!verify_csrf(ops_control_csrf())) {
            json_response(['error' => 'invalid-csrf'], 403);
        }

        $result = qr_api('POST', '/api/disconnect');
        db_log('ops_pause');
        dashboard_redirect('index.php?page=ops&notice=' . ($result === null ? 'ops-unavailable' : 'paused'));
    }

    if ($action === 'ops-resume' && $requestMethod === 'POST') {
        if (!is_logged_in()) {
            json_response(['error' => 'unauthenticated'], 401);
        }

        if (!verify_csrf(ops_control_csrf())) {
            json_response(['error' => 'invalid-csrf'], 403);
        }

        $result = qr_api('POST', '/api/connect');
        db_log('ops_resume');
        dashboard_redirect('index.php?page=ops&notice=' . ($result === null ? 'ops-unavailable' : 'resumed'));
    }

    if ($action === 'ops-disconnect' && $requestMethod === 'POST') {
        if (!is_logged_in()) {
            json_response(['error' => 'unauthenticated'], 401);
        }

        if (!verify_csrf(ops_control_csrf())) {
            json_response(['error' => 'invalid-csrf'], 403);
        }

        $result = qr_api('POST', '/api/disconnect');
        db_log('ops_disconnect');
        dashboard_redirect('index.php?page=ops&notice=' . ($result === null ? 'ops-unavailable' : 'disconnected'));
    }

    if ($action === 'ops-reconnect' && $requestMethod === 'POST') {
        if (!is_logged_in()) {
            json_response(['error' => 'unauthenticated'], 401);
        }

        if (!verify_csrf(ops_control_csrf())) {
            json_response(['error' => 'invalid-csrf'], 403);
        }

        $result = qr_api('POST', '/api/connect');
        db_log('ops_reconnect');
        dashboard_redirect('index.php?page=ops&notice=' . ($result === null ? 'ops-unavailable' : 'reconnected'));
    }

    // Vault download (SPEC §12): decrypts one vault file by content hash
    // and streams it to the owner. Only the hash prefix is logged, never
    // the file name.
    if ($action === 'vault-download' && $requestMethod === 'GET') {
        if (!is_logged_in()) {
            dashboard_redirect('index.php?error=1');
        }

        $csrf = isset($_GET['csrf']) && is_string($_GET['csrf'])
            ? $_GET['csrf']
            : null;
        $hash = isset($_GET['hash']) && is_string($_GET['hash'])
            ? $_GET['hash']
            : '';

        if (!verify_csrf($csrf) || preg_match('/^[0-9a-f]{64}$/', $hash) !== 1) {
            dashboard_redirect('index.php?page=ops&notice=download-failed');
        }

        db_log('vault_download', substr($hash, 0, 8));

        if (!ops_vault_download($hash)) {
            dashboard_redirect('index.php?page=ops&notice=download-failed');
        }

        exit;
    }
}
