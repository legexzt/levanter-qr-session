<?php
// Implements the Chats page's server-side client for the legezt-bot API
// (port 3001): chat list, one chat's messages, and JSONL export download.
// Called by views/chats.php (rendering) and lib/ops-actions.php (export).
// Requires config.php, lib/qr.php (relay key), and lib/ops.php
// (ops_request_json + OPS_MAX_VAULT_BYTES as the export size cap).
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/qr.php';
require_once __DIR__ . '/ops.php';

define('CHATS_EXPORT_MAX_BYTES', OPS_MAX_VAULT_BYTES);

// The bot's JID rule, mirrored from legezt-bot/lib/chats.js: a local part
// of letters/digits/._- and one of the known WhatsApp domains.
function chats_valid_jid(string $jid): bool
{
    return preg_match('/^[A-Za-z0-9._-]+@(s\.whatsapp\.net|g\.us|lid|c\.us)$/', $jid) === 1
        && strlen($jid) >= 3
        && strlen($jid) <= 100;
}

// Fetches the chat list (newest message first). Returns the decoded array,
// or null when the bot is unreachable or the response is bad.
function chats_list(): ?array
{
    return ops_request_json('/api/chats', false);
}

// Fetches one page of a chat's messages (oldest first in the page).
// $before is an ISO cursor for older pages; $markRead clears the chat's
// unread count (only used when opening the chat, not when paging back).
function chats_messages(string $jid, int $limit, ?string $before, bool $markRead): ?array
{
    if (!chats_valid_jid($jid)) {
        return null;
    }

    $limit = max(1, min(200, $limit));
    $query = '/api/chats/' . rawurlencode($jid) . '/messages?limit=' . $limit;

    if ($before !== null && $before !== '') {
        $query .= '&before=' . rawurlencode($before);
    }

    if ($markRead) {
        $query .= '&markRead=1';
    }

    return ops_request_json($query, false);
}

// Streams a JSONL training export to the browser: the whole store when
// $jid is null, or one chat's messages when set. The bot streams the
// concatenated day files; PHP buffers them to a temp file first (same
// pattern as the vault download) so a failed or oversized export never
// reaches the browser half-sent. Returns true on success (and exits
// after streaming), false when the download failed.
function chats_export_download(?string $jid): bool
{
    $key = qr_relay_key();

    if ($key === null || !function_exists('curl_init')) {
        return false;
    }

    if ($jid !== null && !chats_valid_jid($jid)) {
        return false;
    }

    $path = $jid === null
        ? '/api/chats/export'
        : '/api/chats/' . rawurlencode($jid) . '/export';

    $tempPath = tempnam(sys_get_temp_dir(), 'legezt-chats-');
    if ($tempPath === false) {
        return false;
    }

    $tempHandle = fopen($tempPath, 'wb');
    if ($tempHandle === false) {
        @unlink($tempPath);
        return false;
    }

    $handle = curl_init();
    if ($handle === false) {
        fclose($tempHandle);
        @unlink($tempPath);
        return false;
    }

    curl_setopt_array($handle, [
        CURLOPT_URL => QR_BASE_URL . $path,
        CURLOPT_HTTPGET => true,
        CURLOPT_HTTPHEADER => [
            'Accept: application/x-ndjson',
            'X-Api-Key: ' . $key,
        ],
        CURLOPT_FILE => $tempHandle,
        CURLOPT_TIMEOUT => 300,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_FAILONERROR => false,
    ]);

    $ok = curl_exec($handle);
    $code = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    fclose($tempHandle);

    if ($ok === false || $code !== 200) {
        @unlink($tempPath);
        return false;
    }

    $size = @filesize($tempPath);
    if (!is_int($size) || $size < 0 || $size > CHATS_EXPORT_MAX_BYTES) {
        @unlink($tempPath);
        return false;
    }

    $stamp = date('Y-m-d');
    $filename = $jid === null
        ? 'legezt-chats-' . $stamp . '.jsonl'
        : 'legezt-chat-' . preg_replace('/[^A-Za-z0-9]/', '_', $jid) . '-' . $stamp . '.jsonl';

    header('Content-Type: application/x-ndjson; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . $size);
    header('Cache-Control: no-store');
    readfile($tempPath);
    @unlink($tempPath);

    return true;
}
