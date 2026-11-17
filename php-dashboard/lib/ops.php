<?php
// Implements the Ops page's server-side client for the legezt-bot API
// (port 3001) plus formatting and storage helpers.
// Called by public/index.php (actions) and views/ops.php (rendering).
// Requires config.php and lib/qr.php (relay key); the vault key is never
// read here — vault downloads are decrypted by the bot, not by PHP.
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/qr.php';

define('OPS_TIMEOUT_SECONDS', 8);
define('OPS_MAX_VAULT_BYTES', 200 * 1024 * 1024);

// Calls a JSON endpoint on the bot API with the relay key. Returns the
// decoded array, or null when the bot is unreachable or the response is bad.
function ops_request_json(string $path, bool $post): ?array
{
    $key = qr_relay_key();

    if ($key === null) {
        return null;
    }

    $url = QR_BASE_URL . $path;
    $headers = ['Accept: application/json', 'X-Api-Key: ' . $key];

    if (function_exists('curl_init')) {
        $handle = curl_init();
        if ($handle === false) {
            return null;
        }

        $options = [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => OPS_TIMEOUT_SECONDS,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FAILONERROR => false,
            CURLOPT_HTTPHEADER => $headers,
        ];

        if ($post) {
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = '{}';
            $options[CURLOPT_HTTPHEADER] = array_merge(
                $headers,
                ['Content-Type: application/json']
            );
        }

        if (!curl_setopt_array($handle, $options)) {
            curl_close($handle);
            return null;
        }

        $body = curl_exec($handle);
        $code = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        curl_close($handle);

        if ($body === false || $code < 200 || $code >= 300) {
            return null;
        }
    } else {
        $http = [
            'method' => $post ? 'POST' : 'GET',
            'timeout' => OPS_TIMEOUT_SECONDS,
            'ignore_errors' => true,
            'header' => implode("\r\n", $headers) . "\r\n",
        ];

        if ($post) {
            $http['header'] .= "Content-Type: application/json\r\n";
            $http['content'] = '{}';
        }

        $context = stream_context_create(['http' => $http]);
        $body = @file_get_contents($url, false, $context);

        if ($body === false) {
            return null;
        }

        $code = 0;
        foreach ($http_response_header ?? [] as $headerLine) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $headerLine, $matches) === 1) {
                $code = (int) $matches[1];
            }
        }

        if ($code !== 0 && ($code < 200 || $code >= 300)) {
            return null;
        }
    }

    if (!is_string($body)) {
        return null;
    }

    $decoded = json_decode($body, true);

    return is_array($decoded) ? $decoded : null;
}

// Fetches the full Ops payload (status, usage, PM2, logs, vault list).
function ops_get(): ?array
{
    return ops_request_json('/api/ops', false);
}

// Asks the bot to restart (it exits; PM2 starts it again). Returns the
// decoded reply, or null when the bot did not answer.
function ops_restart(): ?array
{
    return ops_request_json('/api/restart', true);
}

// Streams one decrypted vault file (by content hash) to the browser.
// The bot decrypts; PHP only forwards the bytes. Returns true on success
// (and exits after streaming), false when the download failed.
function ops_vault_download(string $hash): bool
{
    $key = qr_relay_key();

    if ($key === null || !function_exists('curl_init')) {
        return false;
    }

    $tempPath = tempnam(sys_get_temp_dir(), 'legezt-vault-');
    if ($tempPath === false) {
        return false;
    }

    $tempHandle = fopen($tempPath, 'wb');
    if ($tempHandle === false) {
        @unlink($tempPath);
        return false;
    }

    $responseHeaders = [];
    $handle = curl_init();
    if ($handle === false) {
        fclose($tempHandle);
        @unlink($tempPath);
        return false;
    }

    curl_setopt_array($handle, [
        CURLOPT_URL => QR_BASE_URL . '/api/vault/download',
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['hash' => $hash]),
        CURLOPT_HTTPHEADER => [
            'Accept: application/octet-stream',
            'Content-Type: application/json',
            'X-Api-Key: ' . $key,
        ],
        CURLOPT_FILE => $tempHandle,
        CURLOPT_HEADERFUNCTION => function ($curl, $header) use (&$responseHeaders) {
            $length = strlen($header);
            $parts = explode(':', $header, 2);
            if (count($parts) === 2) {
                $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return $length;
        },
        CURLOPT_TIMEOUT => 120,
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
    if (!is_int($size) || $size <= 0 || $size > OPS_MAX_VAULT_BYTES) {
        @unlink($tempPath);
        return false;
    }

    $contentType = $responseHeaders['content-type'] ?? 'application/octet-stream';
    $disposition = $responseHeaders['content-disposition'] ?? 'attachment; filename="file"';

    header('Content-Type: ' . $contentType);
    header('Content-Disposition: ' . $disposition);
    header('Content-Length: ' . $size);
    header('Cache-Control: no-store');
    readfile($tempPath);
    @unlink($tempPath);

    return true;
}

// Formats seconds as "2h 14m", "3d 1h", or "45s".
function ops_format_uptime(int $seconds): string
{
    $seconds = max(0, $seconds);
    $days = (int) floor($seconds / 86400);
    $hours = (int) floor(($seconds % 86400) / 3600);
    $minutes = (int) floor(($seconds % 3600) / 60);

    if ($days > 0) {
        return $days . 'd ' . $hours . 'h';
    }

    if ($hours > 0) {
        return $hours . 'h ' . $minutes . 'm';
    }

    if ($minutes > 0) {
        return $minutes . 'm ' . ($seconds % 60) . 's';
    }

    return $seconds . 's';
}

// Formats bytes as "12.4 MB" / "850 KB" / "42 B".
function ops_format_bytes(int $bytes): string
{
    $bytes = max(0, $bytes);

    if ($bytes >= 1073741824) {
        return number_format($bytes / 1073741824, 2, '.', '') . ' GB';
    }

    if ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 2, '.', '') . ' MB';
    }

    if ($bytes >= 1024) {
        return number_format($bytes / 1024, 1, '.', '') . ' KB';
    }

    return $bytes . ' B';
}

// Bounded walk of /var/legezt (max 20,000 files, symlinks skipped).
function ops_storage_bytes(): int
{
    $root = '/var/legezt';
    $total = 0;

    if (!is_dir($root)) {
        return 0;
    }

    $directories = [$root];
    $filesWalked = 0;

    while ($directories !== [] && $filesWalked < 20000) {
        $directory = array_pop($directories);
        $entries = @scandir($directory);

        if ($entries === false) {
            continue;
        }

        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $path = $directory . DIRECTORY_SEPARATOR . $entry;

            if (is_link($path)) {
                continue;
            }

            if (is_dir($path)) {
                $directories[] = $path;
                continue;
            }

            if (!is_file($path)) {
                continue;
            }

            $filesWalked++;
            $size = @filesize($path);

            if (is_int($size) && $size > 0) {
                $total += $size;
            }

            if ($filesWalked >= 20000) {
                break;
            }
        }
    }

    return $total;
}

// Formats an ISO-8601 time as "17 Nov 13:05"; returns the raw value when
// it cannot be parsed.
function ops_format_time(?string $iso): string
{
    if ($iso === null || $iso === '') {
        return '—';
    }

    $ts = strtotime($iso);

    if ($ts === false) {
        return $iso;
    }

    return date('d M H:i', $ts);
}
