<?php
// What: Opens and initializes the LEGEZT SQLite database and writes audit events.
// Called by: Security helpers and other dashboard server-side PHP files.
// Needs: config.php, PHP 8.2 with SQLite3, and write access to DATA_DIR.
declare(strict_types=1);

require_once dirname(__DIR__) . '/config.php';

function db(): SQLite3
{
    static $connection = null;

    if ($connection instanceof SQLite3) {
        return $connection;
    }

    ensure_dir(DATA_DIR);

    $database = new SQLite3(
        DB_FILE,
        SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE
    );
    $database->enableExceptions(true);
    $database->busyTimeout(5000);

    $database->exec(
        'CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY,
            ip TEXT NOT NULL,
            attempted_at INTEGER NOT NULL,
            success INTEGER NOT NULL
        )'
    );

    $database->exec(
        'CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY,
            ip TEXT NOT NULL,
            event TEXT NOT NULL,
            detail TEXT,
            created_at INTEGER NOT NULL
        )'
    );

    $database->exec(
        'CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_attempted_at
         ON login_attempts (ip, attempted_at)'
    );

    $database->exec(
        'CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
         ON audit_log (created_at)'
    );

    $connection = $database;

    return $connection;
}

function db_log(string $event, string $detail = ''): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

    if (!is_string($ip) || $ip === '') {
        $ip = 'unknown';
    }

    $statement = db()->prepare(
        'INSERT INTO audit_log (ip, event, detail, created_at)
         VALUES (:ip, :event, :detail, :created_at)'
    );
    $statement->bindValue(':ip', $ip, SQLITE3_TEXT);
    $statement->bindValue(':event', $event, SQLITE3_TEXT);
    $statement->bindValue(':detail', $detail, SQLITE3_TEXT);
    $statement->bindValue(':created_at', time(), SQLITE3_INTEGER);
    $statement->execute();
}
