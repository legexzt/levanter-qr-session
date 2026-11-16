<?php
// What: Renders the Chats placeholder for the LEGEZT dashboard.
// Called by: public/index.php, which renders this view inside views/layout.php.
// Needs: legezt_esc() and the standard dashboard view environment.
declare(strict_types=1);
?>
<section class="card" aria-labelledby="chats-title">
    <div class="card-header">
        <h2 id="chats-title">Chats</h2>
        <span class="badge badge-muted">Phase 2 / 3</span>
    </div>
    <p>Chat list and message history arrive with the LEGEZT bot core (Phase 2) and message archiving (Phase 3). For now, use the Connect page to check the WhatsApp link status.</p>
</section>
