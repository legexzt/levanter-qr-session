<?php
// Implements a server-side client for the local legezt-bot HTTP API (port 3001).
// Called by public/index.php and the dashboard and connect views.
// Requires config.php and either cURL or PHP HTTP stream support.
declare(strict_types=1);

require_once __DIR__ . '/../config.php';

function qr_request(string $path, bool $post): ?array
{
    $url = QR_BASE_URL . $path;

    if (function_exists('curl_init')) {
        $handle = curl_init();
        if ($handle === false) {
            return null;
        }

        $options = [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FAILONERROR => false,
        ];

        if ($post) {
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = '{}';
            $options[CURLOPT_HTTPHEADER] = ['Content-Type: application/json'];
        }

        if (!curl_setopt_array($handle, $options)) {
            curl_close($handle);
            return null;
        }

        $response = curl_exec($handle);
        $httpCode = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);

        if ($response === false || $httpCode !== 200) {
            return null;
        }
    } else {
        $http = [
            'method' => $post ? 'POST' : 'GET',
            'timeout' => 5,
            'ignore_errors' => true,
        ];

        if ($post) {
            $http['header'] = "Content-Type: application/json\r\n";
            $http['content'] = '{}';
        }

        $context = stream_context_create(['http' => $http]);
        $response = @file_get_contents($url, false, $context);

        if ($response === false) {
            return null;
        }

        $httpCode = 0;
        foreach ($http_response_header ?? [] as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $header, $matches) === 1) {
                $httpCode = (int) $matches[1];
            }
        }

        if ($httpCode !== 200) {
            return null;
        }
    }

    $data = json_decode($response, true);

    if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
        return null;
    }

    return $data;
}

function qr_get(string $path): ?array
{
    return qr_request($path, false);
}

function qr_post(string $path): ?array
{
    return qr_request($path, true);
}

function qr_status(): ?array
{
    return qr_get('/api/qr');
}

function qr_health(): ?array
{
    return qr_get('/api/health');
}

function qr_disconnect(): ?array
{
    return qr_post('/api/disconnect');
}

function qr_connect(): ?array
{
    return qr_post('/api/connect');
}
