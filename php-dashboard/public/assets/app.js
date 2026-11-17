// What: Provides QR auto-refresh on Connect and confirmation for WhatsApp disconnect forms.
// Called by: views/layout.php through a deferred /assets/app.js script tag.
// Needs: #qr-box with data-status and forms using the confirm-disconnect class.
(() => {
    'use strict';

    function formatPairingCode(raw) {
        if (typeof raw === 'string' && /^[A-Z0-9]{8}$/.test(raw)) {
            return raw.slice(0, 4) + '-' + raw.slice(4);
        }

        return raw;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const setPairingStatus = (message) => {
            const status = document.getElementById('pairing-status');

            if (status) {
                status.textContent = message;
            }
        };

        const pairingCodeElement = document.getElementById('pairing-code');
        let currentPairingCode = pairingCodeElement
            ? (pairingCodeElement.dataset.pairingCode || '')
            : '';

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

                    if (typeof data.pairingCode === 'string' && data.pairingCode !== '') {
                        const codeElement = document.getElementById('pairing-code');

                        if (!codeElement) {
                            window.clearInterval(pollTimer);
                            location.reload();
                            return;
                        }

                        if (data.pairingCode !== currentPairingCode) {
                            codeElement.textContent = formatPairingCode(data.pairingCode);
                            codeElement.dataset.pairingCode = data.pairingCode;
                            currentPairingCode = data.pairingCode;
                        }
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

        const copyPairingButton = document.getElementById('copy-pairing-code');

        if (copyPairingButton && pairingCodeElement) {
            const copyWithTextarea = (text) => {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();

                let copied = false;

                try {
                    copied = document.execCommand('copy');
                } catch {
                    copied = false;
                }

                document.body.removeChild(textarea);
                return copied;
            };

            copyPairingButton.addEventListener('click', async () => {
                const rawCode = pairingCodeElement.dataset.pairingCode || '';
                let copied = false;

                if (
                    rawCode !== ''
                    && navigator.clipboard
                    && typeof navigator.clipboard.writeText === 'function'
                ) {
                    try {
                        await navigator.clipboard.writeText(rawCode);
                        copied = true;
                    } catch {
                        copied = false;
                    }
                }

                if (!copied && rawCode !== '') {
                    try {
                        copied = copyWithTextarea(rawCode);
                    } catch {
                        copied = false;
                    }
                }

                if (copied) {
                    copyPairingButton.textContent = 'Copied';
                    window.setTimeout(() => {
                        copyPairingButton.textContent = 'Copy code';
                    }, 2000);
                } else {
                    setPairingStatus('Copy failed \u2014 long-press the code to select it.');
                }
            });
        }

        const refreshPairingButton = document.getElementById('refresh-pairing-code');

        if (refreshPairingButton) {
            refreshPairingButton.addEventListener('click', async () => {
                refreshPairingButton.disabled = true;
                refreshPairingButton.textContent = '\u2026';

                try {
                    const response = await fetch('index.php?action=pairing-code', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: 'csrf=' + encodeURIComponent(refreshPairingButton.dataset.csrf || '')
                    });
                    const data = await response.json();

                    if (
                        data
                        && data.ok
                        && typeof data.pairingCode === 'string'
                        && data.pairingCode !== ''
                    ) {
                        const codeElement = document.getElementById('pairing-code');

                        if (codeElement) {
                            codeElement.textContent = formatPairingCode(data.pairingCode);
                            codeElement.dataset.pairingCode = data.pairingCode;
                            currentPairingCode = data.pairingCode;
                            setPairingStatus('New code ready.');
                        } else {
                            setPairingStatus('Could not get a new code.');
                        }
                    } else if (data && data.ok === false) {
                        let message = 'Could not get a new code.';

                        if (data.error === 'too-soon') {
                            message = 'Wait a few seconds and try again.';
                        } else if (data.error === 'phone-not-configured') {
                            message = 'Pairing code is not set up on the server yet.';
                        } else if (data.error === 'not-waiting') {
                            message = 'No QR is waiting right now.';
                        }

                        setPairingStatus(message);
                    } else {
                        setPairingStatus('Could not get a new code.');
                    }
                } catch {
                    setPairingStatus('Could not reach the server.');
                } finally {
                    refreshPairingButton.disabled = false;
                    refreshPairingButton.textContent = 'New code';
                }
            });
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
