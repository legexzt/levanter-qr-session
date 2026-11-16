<?php
// Sets or changes the LEGEZT owner passcode hash at /var/legezt/config/passcode.hash.
// Called manually by the server owner from the command line.
// Requires PHP 8.2 CLI with Argon2id support and write permission for /var/legezt/config.
declare(strict_types=1);

if (php_sapi_name() !== 'cli') {
    print 'This script runs from the command line only.' . PHP_EOL;
    exit(1);
}

$configDir = '/var/legezt/config';
$hashFile = '/var/legezt/config/passcode.hash';

$readLine = static function (): string {
    $line = fgets(STDIN);

    return $line === false ? '' : rtrim($line, "\r\n");
};

$readHiddenLine = static function (string $prompt): string {
    echo $prompt;
    $restoreEcho = false;

    try {
        shell_exec('stty -echo');
        $restoreEcho = true;
        $line = fgets(STDIN);

        return $line === false ? '' : rtrim($line, "\r\n");
    } finally {
        if ($restoreEcho) {
            shell_exec('stty echo');
        }

        echo PHP_EOL;
    }
};

$lastError = static function (string $fallback): string {
    $error = error_get_last();

    return is_array($error) && isset($error['message'])
        ? $error['message']
        : $fallback;
};

if (stream_isatty(STDIN)) {
    $passcode = $readHiddenLine('Enter new passcode: ');
    $confirmation = $readHiddenLine('Confirm passcode: ');
} else {
    $passcode = $readLine();
    $confirmation = $readLine();
}

if ($passcode === '') {
    print 'Passcode cannot be empty.' . PHP_EOL;
    exit(1);
}

if ($passcode !== $confirmation) {
    print 'Passcodes do not match.' . PHP_EOL;
    exit(1);
}

if (strlen($passcode) < 8) {
    print 'Passcode must be at least 8 characters.' . PHP_EOL;
    exit(1);
}

try {
    $hash = password_hash($passcode, PASSWORD_ARGON2ID);
} catch (Throwable $exception) {
    fwrite(STDERR, 'Failed to hash passcode: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}

if (!is_dir($configDir)) {
    if (!@mkdir($configDir, 0700, true) && !is_dir($configDir)) {
        fwrite(
            STDERR,
            'Failed to create config directory: '
            . $lastError('unknown error')
            . PHP_EOL
        );
        exit(1);
    }

    if (!@chmod($configDir, 0700)) {
        fwrite(
            STDERR,
            'Failed to secure config directory: '
            . $lastError('unknown error')
            . PHP_EOL
        );
        exit(1);
    }
}

$previousUmask = umask(0077);

try {
    $bytesWritten = @file_put_contents($hashFile, $hash . "\n", LOCK_EX);
} finally {
    umask($previousUmask);
}

if ($bytesWritten === false) {
    fwrite(
        STDERR,
        'Failed to write passcode hash: ' . $lastError('unknown error') . PHP_EOL
    );
    exit(1);
}

if (!@chmod($hashFile, 0600)) {
    fwrite(
        STDERR,
        'Failed to set passcode hash permissions: '
        . $lastError('unknown error')
        . PHP_EOL
    );
    exit(1);
}

// php-fpm runs as www-data on Ubuntu, so the web app can only read the
// hash if the file belongs to the www-data group. When that group exists,
// hand the file to it (mode 0640); otherwise keep the strict 0600.
if (function_exists('posix_getgrnam') && posix_getgrnam('www-data') !== false) {
    if (@chgrp($hashFile, 'www-data')) {
        @chmod($hashFile, 0640);
    }
}

$storedContents = @file_get_contents($hashFile);

if ($storedContents === false) {
    fwrite(
        STDERR,
        'Failed to read back passcode hash: '
        . $lastError('unknown error')
        . PHP_EOL
    );
    exit(1);
}

$storedHash = trim($storedContents);

if ($storedHash === '' || !password_verify($passcode, $storedHash)) {
    fwrite(STDERR, 'Passcode verification failed.' . PHP_EOL);
    exit(1);
}

print 'Passcode saved.' . PHP_EOL;
exit(0);
