(function () {
    'use strict';

    let profiles = [];
    let selectedId = '';
    let loading = false;

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[char]);
    }

    function dateTime(value) {
        if (!value) return '—';
        return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function initials(name) { return esc((String(name || '?').trim()[0] || '?').toUpperCase()); }

    function refreshConsentControl(message) {
        const toggle = document.getElementById('settingsVisitConsentToggle');
        const status = document.getElementById('visitConsentStatus');
        if (!toggle) return;
        const connected = !!(window.BloxStats && window.BloxStats.hasDiscordSession());
        const consent = !!(window.BloxStats && window.BloxStats.hasVisitConsent());
        toggle.disabled = !connected;
        toggle.setAttribute('aria-checked', consent ? 'true' : 'false');
        if (status) status.textContent = message || (connected
            ? 'Profil de connexion conservé 180 jours. Association facultative : 100 visites maximum pendant 30 jours; aucune visite passée ne sera rattachée.'
            : 'Connecte-toi à Discord pour choisir. Ce suivi est facultatif, limité à 100 visites pendant 30 jours; aucune visite passée ne sera rattachée.');
    }

    async function toggleVisitConsent() {
        const button = document.getElementById('settingsVisitConsentToggle');
        const next = !(window.BloxStats && window.BloxStats.hasVisitConsent());
        if (!window.BloxStats) return;
        if (button) button.disabled = true;
        try {
            await window.BloxStats.setVisitConsent(next);
            refreshConsentControl(next ? 'Accord enregistré. Les prochaines visites seront associées; les précédentes restent anonymes.' : 'Accord retiré. L’historique nominatif associé a été supprimé.');
        } catch (error) {
            refreshConsentControl(error.message || 'Impossible d’enregistrer ce choix.');
        } finally {
            if (button) button.disabled = !window.BloxStats.hasDiscordSession();
        }
    }

    function renderMetrics(metrics) {
        const values = {
            discordStatTodayConnections: metrics.todayConnections,
            discordStatTodayAccounts: metrics.todayAccounts,
            discordStatTotalConnections: metrics.totalConnections,
            discordStatRetainedProfiles: metrics.retainedProfiles,
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = Number(value || 0).toLocaleString('fr-FR');
        });
    }

    function renderList() {
        const list = document.getElementById('discordStatsProfileList');
        const count = document.getElementById('discordStatsListCount');
        const search = document.getElementById('discordStatsSearch');
        if (!list) return;
        const query = String(search && search.value || '').trim().toLocaleLowerCase('fr-FR');
        const visible = profiles.filter(profile => `${profile.username} ${profile.id}`.toLocaleLowerCase('fr-FR').includes(query));
        if (count) count.textContent = `${profiles.length.toLocaleString('fr-FR')} profil${profiles.length === 1 ? ' récent' : 's récents'}${profiles.length >= 100 ? ' · 100 max.' : ''}`;
        if (!visible.length) {
            list.innerHTML = `<div class="discord-stats-empty">${profiles.length ? 'Aucun profil correspondant.' : 'Aucun profil Discord conservé pour le moment.'}</div>`;
            return;
        }
        list.innerHTML = visible.map(profile => {
            const avatar = profile.avatar
                ? `<img src="${esc(profile.avatar)}" alt="" loading="lazy" onerror="this.remove()">`
                : `<span class="discord-stats-avatar-empty">${initials(profile.username)}</span>`;
            return `<button type="button" class="discord-stats-profile-option${profile.id === selectedId ? ' is-selected' : ''}" data-profile-id="${esc(profile.id)}">
                ${avatar}<span class="discord-stats-profile-option-text"><strong>${esc(profile.username)}</strong><small>Dernière connexion : ${esc(dateTime(profile.lastConnection))}</small></span>
            </button>`;
        }).join('');
        list.querySelectorAll('[data-profile-id]').forEach(button => button.addEventListener('click', () => {
            selectedId = button.dataset.profileId;
            renderList();
            load(selectedId);
        }));
    }

    function renderDetail(profile, visits) {
        const detail = document.getElementById('discordStatsProfileDetail');
        if (!detail) return;
        if (!profile) {
            detail.innerHTML = '<div class="discord-stats-empty">Sélectionne un profil pour voir ses détails.</div>';
            return;
        }
        const avatar = profile.avatar
            ? `<img class="discord-stats-detail-avatar" src="${esc(profile.avatar)}" alt="" onerror="this.remove()">`
            : `<span class="discord-stats-detail-avatar discord-stats-avatar-empty">${initials(profile.username)}</span>`;
        const visitsHtml = profile.visitConsent
            ? (visits && visits.length
                ? `<div class="discord-stats-associated-visits">${visits.map(visit => `<div class="discord-stats-visit"><span>${esc(visit.p || 'Visite du site')}</span><time>${esc(dateTime(visit.t))}</time></div>`).join('')}</div>`
                : '<div class="discord-stats-empty discord-stats-empty--compact">Aucun historique nominatif consenti disponible. Les visites anonymes passées ne sont jamais rattachées rétroactivement.</div>')
            : '<div class="discord-stats-empty discord-stats-empty--compact">Aucun accord distinct. Aucune visite n’est associée à ce profil.</div>';
        detail.innerHTML = `<div class="discord-stats-detail-head">${avatar}<div><strong>${esc(profile.username)}</strong><small>ID Discord : ${esc(profile.id)}</small></div></div>
            <dl class="discord-stats-detail-facts">
                <dt>Première connexion</dt><dd>${esc(dateTime(profile.firstConnection))}</dd>
                <dt>Dernière connexion</dt><dd>${esc(dateTime(profile.lastConnection))}</dd>
                <dt>Connexions réussies</dt><dd>${Number(profile.connections || 0).toLocaleString('fr-FR')}</dd>
                <dt>Profil conservé jusqu’au</dt><dd>${esc(dateTime(profile.expiresAt))}</dd>
            </dl>
            <h3>Visites associées volontairement</h3>${visitsHtml}
            <p class="discord-stats-retention-note">Historique uniquement après accord distinct, limité à 30 jours et 100 visites récentes. Aucune ancienne visite anonyme n’est identifiée.</p>`;
    }

    async function load(profileId) {
        if (loading || !window.BloxStats) return;
        loading = true;
        const detail = document.getElementById('discordStatsProfileDetail');
        try {
            const result = await window.BloxStats.loadDiscordDashboard(profileId || '');
            renderMetrics(result.metrics || {});
            profiles = Array.isArray(result.profiles) ? result.profiles : [];
            if (profileId && !profiles.some(profile => profile.id === profileId)) selectedId = '';
            if (!selectedId && profiles.length) selectedId = profiles[0].id;
            renderList();
            if (profileId) renderDetail(result.selected, result.visits || []);
            else if (selectedId) {
                // Charger le consentement et l’historique seulement pour le profil sélectionné.
                loading = false;
                return load(selectedId);
            } else renderDetail(null, []);
        } catch (error) {
            if (detail) detail.innerHTML = `<div class="discord-stats-empty">${esc(error.message || 'Impossible de charger les statistiques Discord.')}</div>`;
            const list = document.getElementById('discordStatsProfileList');
            if (list) list.innerHTML = '<div class="discord-stats-empty">Chargement refusé ou indisponible.</div>';
        } finally {
            loading = false;
        }
    }

    function bind() {
        const search = document.getElementById('discordStatsSearch');
        if (search && !search.dataset.bound) {
            search.dataset.bound = 'true';
            search.addEventListener('input', renderList);
        }
        refreshConsentControl();
    }

    window.BloxDiscordStats = { load, toggleVisitConsent, refreshConsentControl };
    window._refreshVisitConsentControl = refreshConsentControl;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
    else bind();
})();
