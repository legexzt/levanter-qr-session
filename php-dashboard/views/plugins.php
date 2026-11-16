<?php
// What: Renders the Plugins placeholder and the planned LEGEZT bot plugin list.
// Called by: public/index.php, which renders this view inside views/layout.php.
// Needs: legezt_esc() and the standard dashboard view environment.
declare(strict_types=1);
?>
<section class="card" aria-labelledby="plugins-title">
    <div class="card-header">
        <h2 id="plugins-title">Plugins</h2>
        <span class="badge badge-muted">Phase 2</span>
    </div>
    <p>The bot plugin list with ON/OFF toggles (ping, help, sticker, downloaders, group tools) arrives with the LEGEZT bot core in Phase 2.</p>

    <h3>Planned plugins</h3>
    <ul>
        <li>ping (.ping)</li>
        <li>help (.help)</li>
        <li>sticker</li>
        <li>downloaders</li>
        <li>group admin</li>
    </ul>
</section>
