/* Collecte publique des statistiques, avec écritures limitées par le Worker. */
(function () {
    'use strict';

    const ENDPOINT = 'https://blox-update-relay.c9yz5m8pw6.workers.dev';
    const VISITOR_KEY = 'blox_stats_visitor_id';
    const VISIT_CONSENT_KEY = 'blox_stats_associate_visits';
    const LOGIN_EVENT_KEY = 'blox_stats_discord_login_event';
    const LOGIN_RECORDED_KEY = 'blox_stats_discord_login_recorded';
    let visitPromise = null;
    let visitRecorded = false;
    let lastVisitState = '';
    let loginPromise = null;

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

    function hasVisitConsent() {
        try { return localStorage.getItem(VISIT_CONSENT_KEY) === 'true'; } catch (_) { return false; }
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
        const consent = hasVisitConsent();
        const token = consent ? discordToken() : '';
        const state = `${consent}:${token}`;
        if (visitPromise) {
            return visitPromise.then(() => {
                if (state !== lastVisitState) return recordVisit();
            });
        }
        const countPageview = !visitRecorded;
        const payload = {
            action: 'statsVisit', visitorId: visitorId(), countPageview,
            page: window.location.pathname,
            associateVisits: consent,
            ...(token ? { discordAccessToken: token } : {})
        };
        visitPromise = send(payload)
            .then(result => {
                visitRecorded = visitRecorded || countPageview;
                lastVisitState = state;
                if (token && typeof result.visitConsent === 'boolean') {
                    try { localStorage.setItem(VISIT_CONSENT_KEY, result.visitConsent ? 'true' : 'false'); } catch (_) {}
                }
                return result;
            })
            .catch(error => { console.warn('[Stats] Visite non enregistrée :', error); })
            .finally(() => { visitPromise = null; });
        return visitPromise;
    }

    function recordDiscordLogin() {
        if (loginPromise) return loginPromise;
        const token = discordToken();
        let eventId = '';
        try { eventId = sessionStorage.getItem(LOGIN_EVENT_KEY) || ''; } catch (_) {}
        if (!token || !/^\d{10,16}_[a-zA-Z0-9_-]{6,40}$/.test(eventId)) return Promise.resolve();
        try { if (sessionStorage.getItem(LOGIN_RECORDED_KEY) === eventId) return Promise.resolve(); } catch (_) {}
        loginPromise = send({ action: 'statsDiscordLogin', discordAccessToken: token, eventId })
            .then(result => {
                try { sessionStorage.setItem(LOGIN_RECORDED_KEY, eventId); } catch (_) {}
                if (typeof result.visitConsent === 'boolean') {
                    try { localStorage.setItem(VISIT_CONSENT_KEY, result.visitConsent ? 'true' : 'false'); } catch (_) {}
                    if (result.visitConsent) return recordVisit();
                }
            })
            .catch(error => console.warn('[Stats] Connexion Discord non enregistrée :', error))
            .finally(() => { loginPromise = null; });
        return loginPromise;
    }

    async function setVisitConsent(consent) {
        const token = discordToken();
        if (!token) throw new Error('Connecte-toi avec Discord pour modifier ce choix.');
        await send({ action: 'statsSetVisitConsent', discordAccessToken: token, consent: !!consent });
        try { localStorage.setItem(VISIT_CONSENT_KEY, consent ? 'true' : 'false'); } catch (_) {}
        lastVisitState = '';
        if (consent) await recordVisit();
        if (typeof window._refreshVisitConsentControl === 'function') window._refreshVisitConsentControl();
        return !!consent;
    }

    function loadDiscordDashboard(profileId) {
        const token = discordToken();
        if (!token) return Promise.reject(new Error('Reconnecte-toi avec un compte administrateur Discord.'));
        return send({ action: 'getDiscordStats', discordAccessToken: token, ...(profileId ? { profileId: String(profileId) } : {}) });
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

    window.BloxStats = {
        recordVisit, recordDiscordLogin, recordBulletinView, recordCardView,
        hasVisitConsent, hasDiscordSession: () => !!discordToken(), setVisitConsent, loadDiscordDashboard,
    };
    window.addEventListener('blox-discord-authenticated', recordVisit);
    window.addEventListener('blox-discord-login-success', recordDiscordLogin);
    recordDiscordLogin();
    recordVisit();

    let authChecks = 0;
    const authCheckTimer = setInterval(() => {
        authChecks += 1;
        recordDiscordLogin();
        if (authChecks >= 20) clearInterval(authCheckTimer);
    }, 500);

    const path = window.location.pathname;
    const numbered = path.match(/\/(\d{3})\/bulletin-\1\.html$/);
    if (numbered) recordBulletinView(numbered[1]);
    else if (/\/pvp1\/bulletin-pvp1\.html$/.test(path)) recordBulletinView('pvp1');
})();
