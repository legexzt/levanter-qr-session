// What: Provides QR auto-refresh on Connect and confirmation for WhatsApp disconnect forms.
// Called by: views/layout.php through a deferred /assets/app.js script tag.
// Needs: #qr-box with data-status and forms using the confirm-disconnect class.
(() => {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const qrBox = document.getElementById('qr-box');

        if (qrBox && (qrBox.dataset.status === 'waiting' || qrBox.dataset.status === 'unknown')) {
            const qrImage = qrBox.querySelector('img');
            const currentQrDataUrl = qrBox.dataset.qrDataUrl
                || (qrImage ? qrImage.getAttribute('src') : '')
                || '';

            const pollQrStatus = async () => {
                try {
                    const response = await fetch('index.php?action=qr-status', {
                        credentials: 'same-origin'
                    });

                    if (!response.ok) {
                        return;
                    }

                    const data = await response.json();

                    if (!data || typeof data !== 'object') {
                        return;
                    }

                    const connected = data.status === 'connected';
                    const changedQr = typeof data.qrDataUrl === 'string'
                        && data.qrDataUrl !== ''
                        && data.qrDataUrl !== currentQrDataUrl;

                    if (connected || changedQr) {
                        window.clearInterval(pollTimer);
                        location.reload();
                    }
                } catch {
                    // Network and JSON failures are ignored so polling can continue.
                }
            };

            const pollTimer = window.setInterval(pollQrStatus, 10000);

            window.setTimeout(() => {
                window.clearInterval(pollTimer);
            }, 600000);
        }

        document.querySelectorAll('form.confirm-disconnect').forEach((form) => {
            form.addEventListener('submit', (event) => {
                const message = 'Disconnect WhatsApp? The session will be removed and a new QR will be generated. Your saved data stays untouched.';

                if (!window.confirm(message)) {
                    event.preventDefault();
                }
            });
        });
    });
})();
