/* Collecte publique des statistiques, avec écritures limitées par le Worker. */
(function () {
    'use strict';

    const ENDPOINT = 'https://blox-update-relay.c9yz5m8pw6.workers.dev';
    const VISITOR_KEY = 'blox_stats_visitor_id';
    let visitPromise = null;
    let visitRecorded = false;
    let lastVisitToken = '';

    function visitorId() {
        try {
            let id = localStorage.getItem(VISITOR_KEY);
            if (!id) {
                id = (window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g, '');
                localStorage.setItem(VISITOR_KEY, id);
            }
            return id;
        } catch (_) {
            return Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
    }

    function discordToken() {
        try {
            const stored = JSON.parse(localStorage.getItem('bloxbulletin_discord_token') || 'null');
            const token = typeof stored === 'string' ? stored : stored && stored.token;
            const expiresAt = typeof stored === 'object' && stored ? stored.expiresAt : Infinity;
            return token && (!expiresAt || expiresAt > Date.now()) ? token : '';
        } catch (_) { return ''; }
    }

    async function send(payload) {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        return response.json().catch(() => ({}));
    }

    function recordVisit() {
        if (visitPromise) {
            return visitPromise.then(() => {
                const token = discordToken();
                if (token && token !== lastVisitToken) return recordVisit();
            });
        }
        const countPageview = !visitRecorded;
        const token = discordToken();
        visitPromise = send({ action: 'statsVisit', visitorId: visitorId(), countPageview, ...(token ? { discordAccessToken: token } : {}) })
            .then(result => { visitRecorded = visitRecorded || countPageview; if (token) lastVisitToken = token; return result; })
            .catch(error => { console.warn('[Stats] Visite non enregistrée :', error); })
            .finally(() => { visitPromise = null; });
        return visitPromise;
    }

    function recordBulletinView(bulletinId) {
        if (!/^(?:\d{3}|pvp1)$/.test(String(bulletinId)) || bulletinId === '000') return Promise.resolve();
        const key = `blox_stats_read_${bulletinId}`;
        try { if (sessionStorage.getItem(key)) return Promise.resolve(); } catch (_) {}
        return send({ action: 'statsBulletinView', bulletinId: String(bulletinId) })
            .then(() => { try { sessionStorage.setItem(key, '1'); } catch (_) {} })
            .catch(error => console.warn('[Stats] Lecture non enregistrée :', error));
    }

    function recordCardView(cardId, title) {
        return send({ action: 'statsCardView', cardId: String(cardId), title: String(title || cardId).slice(0, 160) })
            .catch(error => console.warn('[Stats] Vue de card non enregistrée :', error));
    }

    window.BloxStats = { recordVisit, recordBulletinView, recordCardView };
    window.addEventListener('blox-discord-authenticated', recordVisit);
    recordVisit();

    let authChecks = 0;
    const authCheckTimer = setInterval(() => {
        authChecks += 1;
        const token = discordToken();
        if (token && token !== lastVisitToken) recordVisit();
        if (authChecks >= 20) clearInterval(authCheckTimer);
    }, 500);

    const path = window.location.pathname;
    const numbered = path.match(/\/(\d{3})\/bulletin-\1\.html$/);
    if (numbered) recordBulletinView(numbered[1]);
    else if (/\/pvp1\/bulletin-pvp1\.html$/.test(path)) recordBulletinView('pvp1');
})();
