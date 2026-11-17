<?php
// Serves public JSON health information for the dashboard and host.
// Called directly by monitoring clients without a dashboard login.
// Needs config.php, lib/security.php, and the local QR service.
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/security.php';

try {
    send_security_headers();
} catch (Throwable) {
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
http_response_code(200);

$response = [
    'ok' => true,
    'whatsapp' => 'unavailable',
    'levanterUp' => null,
    'botUp' => null,
    'storage_used_mb' => 0,
    'uptime' => null,
];

function legezt_health_fetch(string $url): ?string
{
    try {
        if (function_exists('curl_init')) {
            $handle = curl_init($url);
            if ($handle === false) {
                return null;
            }

            curl_setopt_array($handle, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 3,
                CURLOPT_TIMEOUT => 3,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
                CURLOPT_USERAGENT => 'LEGEZT-Health/1.0',
            ]);

            $body = curl_exec($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            curl_close($handle);

            if (!is_string($body) || $status < 200 || $status >= 300) {
                return null;
            }

            return $body;
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 3,
                'follow_location' => 0,
                'ignore_errors' => false,
                'header' => "Accept: application/json\r\nConnection: close\r\n",
            ],
        ]);

        $body = @file_get_contents($url, false, $context);
        return is_string($body) ? $body : null;
    } catch (Throwable) {
        return null;
    }
}

function legezt_health_directory_size(string $directory, int &$fileCount): int
{
    if ($fileCount >= 20000 || !is_dir($directory)) {
        return 0;
    }

    $entries = @scandir($directory);
    if ($entries === false) {
        return 0;
    }

    $size = 0;

    foreach ($entries as $entry) {
        if ($fileCount >= 20000) {
            break;
        }

        if ($entry === '.' || $entry === '..') {
            continue;
        }

        $path = $directory . DIRECTORY_SEPARATOR . $entry;

        if (is_link($path)) {
            continue;
        }

        if (is_dir($path)) {
            $size += legezt_health_directory_size($path, $fileCount);
            continue;
        }

        if (is_file($path)) {
            $fileCount++;
            $fileSize = @filesize($path);

            if (is_int($fileSize) && $fileSize > 0) {
                $size += $fileSize;
            }
        }
    }

    return $size;
}

try {
    $url = rtrim(QR_BASE_URL, '/') . '/api/health';
    $body = legezt_health_fetch($url);

    if ($body !== null) {
        $health = json_decode($body, true, 512, JSON_THROW_ON_ERROR);

        if (is_array($health)) {
            $source = $health;

            if (isset($health['data']) && is_array($health['data'])) {
                $source = array_merge($health, $health['data']);
            }

            $status = null;
            $whatsapp = $source['whatsapp'] ?? null;

            if (is_string($whatsapp)) {
                $status = $whatsapp;
            } elseif (is_array($whatsapp)) {
                foreach (['status', 'state'] as $key) {
                    if (isset($whatsapp[$key]) && is_string($whatsapp[$key])) {
                        $status = $whatsapp[$key];
                        break;
                    }
                }
            }

            if ($status === null) {
                foreach (['status', 'state'] as $key) {
                    if (isset($source[$key]) && is_string($source[$key])) {
                        $status = $source[$key];
                        break;
                    }
                }
            }

            if (is_string($status) && trim($status) !== '') {
                $response['whatsapp'] = trim($status);
            }

            // Phase 2: legezt-bot reports botUp; fall back to the old levanterUp field.
            $up = $source['botUp'] ?? $source['levanterUp'] ?? null;

            if (is_bool($up)) {
                $response['levanterUp'] = $up;
                $response['botUp'] = $up;
            } elseif ($up === 1 || $up === '1') {
                $response['levanterUp'] = true;
                $response['botUp'] = true;
            } elseif ($up === 0 || $up === '0') {
                $response['levanterUp'] = false;
                $response['botUp'] = false;
            }
        }
    }
} catch (Throwable) {
    if ($response['whatsapp'] === 'unavailable') {
        $response['levanterUp'] = null;
    }
}

try {
    if (is_dir('/var/legezt')) {
        $fileCount = 0;
        $bytes = legezt_health_directory_size('/var/legezt', $fileCount);
        $response['storage_used_mb'] = round($bytes / 1048576, 2);
    }
} catch (Throwable) {
}

try {
    $procUptime = @file_get_contents('/proc/uptime');

    if (is_string($procUptime)) {
        $parts = preg_split('/\s+/', trim($procUptime));

        if (is_array($parts) && isset($parts[0]) && is_numeric($parts[0])) {
            $response['uptime'] = (int) floor((float) $parts[0]);
        }
    }
} catch (Throwable) {
}

$json = json_encode($response, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

if (!is_string($json)) {
    $json = '{"ok":true,"whatsapp":"unavailable","levanterUp":null,"storage_used_mb":0,"uptime":null}';
}

echo $json;
