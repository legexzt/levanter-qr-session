<?php
// Renders the Chats page: chat list (name, number, last message, unread
// badge) and, for the selected chat, its message thread (bubbles, text,
// media links) plus JSONL training-export downloads.
// Called by public/index.php, which renders this view inside views/layout.php.
// Requires lib/chats.php (list/messages helpers) and lib/ops.php
// (ops_format_time). All numbers come from the bot's /api/chats payload —
// nothing is guessed. When the bot API is down, the page says
// "Chats unavailable" instead of showing an empty list.
declare(strict_types=1);

require_once __DIR__ . '/../lib/chats.php';

$notice = isset($_GET['notice']) && is_string($_GET['notice'])
    ? $_GET['notice']
    : '';
$noticeMessages = [
    'download-failed' => 'That export could not be downloaded.',
];

$selectedJid = isset($_GET['chat']) && is_string($_GET['chat']) && $_GET['chat'] !== ''
    ? $_GET['chat']
    : null;
if ($selectedJid !== null && !chats_valid_jid($selectedJid)) {
    $selectedJid = null;
}

$before = isset($_GET['before']) && is_string($_GET['before']) && $_GET['before'] !== ''
    ? $_GET['before']
    : null;
if ($before !== null && strtotime($before) === false) {
    $before = null;
}

$chatsPayload = chats_list();
$chats = [];
if (is_array($chatsPayload) && isset($chatsPayload['chats']) && is_array($chatsPayload['chats'])) {
    $chats = $chatsPayload['chats'];
}

$thread = null;
$threadChat = null;
$threadMessages = [];
$threadHasMore = false;
$threadOldestTs = null;
if ($selectedJid !== null && $chatsPayload !== null) {
    // Opening a chat marks it read; paging back to older messages does
    // not (the user has not seen those yet).
    $thread = chats_messages($selectedJid, 100, $before, $before === null);
    if (is_array($thread)) {
        $threadChat = isset($thread['chat']) && is_array($thread['chat']) ? $thread['chat'] : null;
        $threadMessages = isset($thread['messages']) && is_array($thread['messages']) ? $thread['messages'] : [];
        $threadHasMore = ($thread['hasMore'] ?? false) === true;
        $threadOldestTs = isset($thread['oldestTs']) && is_string($thread['oldestTs']) ? $thread['oldestTs'] : null;
    }
}

$selectedName = null;
if ($selectedJid !== null) {
    foreach ($chats as $chat) {
        if (is_array($chat) && isset($chat['jid']) && $chat['jid'] === $selectedJid) {
            $selectedName = isset($chat['name']) && is_string($chat['name']) && $chat['name'] !== ''
                ? $chat['name']
                : (isset($chat['number']) && is_string($chat['number']) ? $chat['number'] : $selectedJid);
            break;
        }
    }
    if ($selectedName === null && is_array($threadChat)) {
        $selectedName = isset($threadChat['name']) && is_string($threadChat['name']) && $threadChat['name'] !== ''
            ? $threadChat['name']
            : $selectedJid;
    }
}
?>
<?php if ($notice !== '' && isset($noticeMessages[$notice])): ?>
    <p class="error-box" role="status"><?= legezt_esc($noticeMessages[$notice]) ?></p>
<?php endif; ?>

<?php if ($chatsPayload === null): ?>
    <section class="card error">
        <h2>Chats unavailable</h2>
        <p>legezt-bot on port 3001 is not responding. The chat list and message history cannot be shown right now.</p>
        <p class="muted">Check that the legezt-bot service is running, then refresh this page.</p>
        <p><a class="btn" href="?page=chats">Refresh</a></p>
    </section>
<?php else: ?>
    <section class="card">
        <div class="card-header">
            <h2>Chats</h2>
            <a class="btn primary" href="index.php?action=chats-export&amp;csrf=<?= legezt_esc(csrf_token()) ?>">Export all chats (JSONL)</a>
        </div>
        <p class="muted">Training store — every message you send or receive is archived here as one JSON line (timestamp, chat, sender, direction, type, text, media + vault hash). Archiving started 17 Nov 2026; messages from before that are not in the store. Export the JSONL to feed it to training later.</p>

        <?php if ($chats === []): ?>
            <p class="muted">No chats archived yet — messages you send or receive from now on will appear here.</p>
        <?php else: ?>
            <div class="chats-layout">
                <nav class="chat-list" aria-label="Chat list">
                    <?php foreach ($chats as $chat): ?>
                        <?php
                        if (!is_array($chat) || !isset($chat['jid']) || !is_string($chat['jid'])) {
                            continue;
                        }
                        $jid = $chat['jid'];
                        $name = isset($chat['name']) && is_string($chat['name']) && $chat['name'] !== ''
                            ? $chat['name']
                            : (isset($chat['number']) && is_string($chat['number']) && $chat['number'] !== '' ? $chat['number'] : $jid);
                        $number = isset($chat['number']) && is_string($chat['number']) ? $chat['number'] : '';
                        $lastTs = isset($chat['lastTs']) && is_string($chat['lastTs']) ? $chat['lastTs'] : null;
                        $preview = isset($chat['lastPreview']) && is_string($chat['lastPreview']) ? $chat['lastPreview'] : '';
                        $unread = isset($chat['unread']) && is_numeric($chat['unread']) ? (int) $chat['unread'] : 0;
                        $isGroup = ($chat['isGroup'] ?? false) === true;
                        $active = $selectedJid !== null && $selectedJid === $jid;
                        ?>
                        <a class="chat-item<?= $active ? ' active' : '' ?>" href="?page=chats&amp;chat=<?= legezt_esc(rawurlencode($jid)) ?>"<?= $active ? ' aria-current="true"' : '' ?>>
                            <span class="chat-item-top">
                                <span class="chat-item-name"><?= legezt_esc($name) ?><?php if ($isGroup): ?> <span class="badge badge-muted">group</span><?php endif; ?></span>
                                <?php if ($unread > 0): ?><span class="badge badge-green"><?= legezt_esc((string) $unread) ?> new</span><?php endif; ?>
                            </span>
                            <span class="chat-item-meta"><?= $number !== '' ? legezt_esc($number) . ' · ' : '' ?><?= legezt_esc(ops_format_time($lastTs)) ?></span>
                            <span class="chat-item-preview"><?= legezt_esc($preview) ?></span>
                        </a>
                    <?php endforeach; ?>
                </nav>

                <div class="chat-thread-wrap">
                    <?php if ($selectedJid === null): ?>
                        <p class="muted">Select a chat on the left to see its messages.</p>
                    <?php elseif ($thread === null): ?>
                        <p class="error-box">That chat could not be loaded — the bot did not answer. Try refreshing.</p>
                    <?php else: ?>
                        <div class="chat-thread-header">
                            <h3><?= legezt_esc($selectedName ?? $selectedJid) ?></h3>
                            <a class="btn" href="index.php?action=chats-export&amp;chat=<?= legezt_esc(rawurlencode($selectedJid)) ?>&amp;csrf=<?= legezt_esc(csrf_token()) ?>">Export this chat (JSONL)</a>
                        </div>

                        <?php if ($threadMessages === []): ?>
                            <p class="muted">No messages in this chat yet.</p>
                        <?php else: ?>
                            <div class="chat-thread">
                                <?php foreach ($threadMessages as $message): ?>
                                    <?php
                                    if (!is_array($message)) {
                                        continue;
                                    }
                                    $direction = isset($message['direction']) && $message['direction'] === 'out' ? 'out' : 'in';
                                    $text = isset($message['text']) && is_string($message['text']) ? $message['text'] : null;
                                    $type = isset($message['type']) && is_string($message['type']) ? $message['type'] : 'text';
                                    $time = isset($message['ts']) && is_string($message['ts']) ? $message['ts'] : null;
                                    $senderName = isset($message['senderName']) && is_string($message['senderName']) ? $message['senderName'] : null;
                                    $media = isset($message['media']) && is_array($message['media']) ? $message['media'] : null;
                                    $mediaHash = $media !== null && isset($media['vaultHash']) && is_string($media['vaultHash'])
                                        && preg_match('/^[0-9a-f]{64}$/', $media['vaultHash']) === 1
                                        ? $media['vaultHash']
                                        : null;
                                    $mediaKind = $media !== null && isset($media['kind']) && is_string($media['kind']) ? $media['kind'] : $type;
                                    ?>
                                    <div class="msg-bubble <?= $direction === 'out' ? 'out' : 'in' ?>">
                                        <?php if ($direction === 'in' && $senderName !== null): ?>
                                            <span class="msg-sender"><?= legezt_esc($senderName) ?></span>
                                        <?php endif; ?>
                                        <?php if ($text !== null): ?>
                                            <span class="msg-text"><?= nl2br(legezt_esc($text)) ?></span>
                                        <?php endif; ?>
                                        <?php if ($mediaHash !== null): ?>
                                            <span class="msg-media">📎 <?= legezt_esc(ucfirst($mediaKind)) ?> — <a href="index.php?action=vault-download&amp;hash=<?= legezt_esc($mediaHash) ?>&amp;csrf=<?= legezt_esc(csrf_token()) ?>">Download</a></span>
                                        <?php elseif ($media !== null): ?>
                                            <span class="msg-media">📎 <?= legezt_esc(ucfirst($mediaKind)) ?></span>
                                        <?php endif; ?>
                                        <span class="msg-meta"><?= legezt_esc(ops_format_time($time)) ?></span>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        <?php endif; ?>

                        <?php if ($threadHasMore && $threadOldestTs !== null): ?>
                            <p><a class="btn" href="?page=chats&amp;chat=<?= legezt_esc(rawurlencode($selectedJid)) ?>&amp;before=<?= legezt_esc(rawurlencode($threadOldestTs)) ?>">Load older messages</a></p>
                        <?php endif; ?>
                    <?php endif; ?>
                </div>
            </div>
        <?php endif; ?>
    </section>
<?php endif; ?>
