/* Préférences de profil BloxNews conservées sur cet appareil. */
(function () {
    'use strict';

    const KEY = 'bloxnews_profile_preferences';
    const REACTION_KEY = 'bloxnews_hide_reaction_animations';
    const ADMIN_IDS = new Set(['1503444854410317984', '775096691240992798', '965365062334308412']);
    const AVATARS = {
        discord: '',
        ninja: '🥷',
        fruit: '🍍',
        dragon: '🐉',
        wave: '🌊',
        flame: '🔥',
        star: '⭐',
        fox: '🦊',
    };

    function preferences() {
        try {
            const value = JSON.parse(localStorage.getItem(KEY) || '{}');
            return {
                alias: typeof value.alias === 'string' ? value.alias : '',
                avatar: Object.hasOwn(AVATARS, value.avatar) ? value.avatar : 'discord',
                commentSort: value.commentSort === 'recent' ? 'recent' : 'top',
                hideReactionAnimations: localStorage.getItem(REACTION_KEY) === '1' || value.hideReactionAnimations === true,
            };
        } catch (_) { return { alias: '', avatar: 'discord', commentSort: 'top', hideReactionAnimations: false }; }
    }

    function save(next) {
        const updated = { ...preferences(), ...next };
        try {
            localStorage.setItem(KEY, JSON.stringify(updated));
            localStorage.setItem(REACTION_KEY, updated.hideReactionAnimations ? '1' : '0');
        } catch (_) {}
        document.body.classList.toggle('profile-hide-reaction-animations', reactionAnimationsHidden());
        window.dispatchEvent(new CustomEvent('blox-profile-preferences-changed', { detail: preferences() }));
        return preferences();
    }

    function currentDiscordUser() {
        try { return JSON.parse(localStorage.getItem('bloxbulletin_discord_user') || 'null'); } catch (_) { return null; }
    }

    function aliasFor(user = currentDiscordUser()) {
        const pref = preferences();
        return pref.alias || user?.global_name || user?.username || '';
    }

    function discordUsername(user = currentDiscordUser()) {
        return String(user?.discordUsername || user?.username || user?.global_name || '');
    }

    function escapeXml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
    }

    function avatarSource(user = currentDiscordUser()) {
        const choice = preferences().avatar;
        if (choice !== 'discord' && AVATARS[choice]) {
            const emoji = escapeXml(AVATARS[choice]);
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#625cf5"/><stop offset="1" stop-color="#238bd3"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(#g)"/><text x="48" y="63" text-anchor="middle" font-size="48">${emoji}</text></svg>`;
            return `data:image/svg+xml,${encodeURIComponent(svg)}`;
        }
        if (!user) return '';
        if (user.avatar && String(user.avatar).startsWith('http')) return user.avatar;
        if (user.avatar && user.id) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=96`;
        if (!user.id) return '';
        const index = user.discriminator && user.discriminator !== '0'
            ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n);
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    }

    function commentIdentity(user = currentDiscordUser()) {
        if (!user) return {};
        const account = currentDiscordUser() || user;
        const accountId = user.id || user.userId || account.id || account.userId || null;
        const accountName = user.discordUsername || user.username || account.username || account.global_name || '';
        return {
            userId: accountId,
            username: preferences().alias || user.displayName || account.global_name || accountName,
            discordUsername: String(accountName),
            customDisplayName: !!preferences().alias,
            avatar: avatarSource(account) || user.avatar || '',
        };
    }

    function commentName(item) {
        const shown = String(item?.username || 'Membre');
        const original = String(item?.discordUsername || '');
        const viewer = currentDiscordUser();
        return viewer && ADMIN_IDS.has(String(viewer.id)) && item?.customDisplayName === true && original && original.toLocaleLowerCase() !== shown.toLocaleLowerCase()
            ? `${shown} (${original})` : shown;
    }

    function renderSettings() {
        const user = currentDiscordUser();
        const options = document.getElementById('settingsProfileOptions');
        if (options) options.classList.toggle('is-hidden', !user);
        if (!user) return;
        const pref = preferences();
        const alias = document.getElementById('profileDisplayName');
        const avatar = document.getElementById('profileAvatarChoice');
        const sort = document.getElementById('profileCommentSort');
        const hideMotion = document.getElementById('profileHideReactionAnimations');
        const status = document.getElementById('profilePreferencesStatus');
        if (alias && document.activeElement !== alias) alias.value = pref.alias;
        if (avatar) avatar.value = pref.avatar;
        if (sort) sort.value = pref.commentSort;
        if (hideMotion) hideMotion.setAttribute('aria-checked', reactionAnimationsHidden() ? 'true' : 'false');
        const previewName = document.getElementById('settingsName');
        if (previewName) previewName.textContent = aliasFor(user);
        const previewAvatar = document.getElementById('settingsAvatar');
        if (previewAvatar) previewAvatar.src = avatarSource(user);
        const navAvatar = document.getElementById('discordAvatar');
        if (navAvatar) navAvatar.src = avatarSource(user);
        const navDropAvatar = document.getElementById('discordDropdownAvatar');
        if (navDropAvatar) navDropAvatar.src = avatarSource(user);
        const navName = document.getElementById('discordUsername');
        if (navName) navName.textContent = aliasFor(user);
        const navDropName = document.getElementById('discordDropdownName');
        if (navDropName) navDropName.textContent = aliasFor(user);
        if (status && !status.textContent) status.textContent = 'Préférences enregistrées dans ce navigateur.';
        document.body.classList.toggle('profile-hide-reaction-animations', reactionAnimationsHidden());
    }

    function validAlias(value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';
        if (trimmed.length < 2 || trimmed.length > 24 || !/^[\p{L}\p{N} _.-]+$/u.test(trimmed)) {
            throw new Error('Le pseudo doit faire 2 à 24 caractères (lettres, chiffres, espaces, tiret, point ou _).');
        }
        return trimmed;
    }

    function saveAlias(value) {
        let alias;
        try { alias = validAlias(value); }
        catch (error) {
            const status = document.getElementById('profilePreferencesStatus');
            if (status) status.textContent = error.message;
            const input = document.getElementById('profileDisplayName');
            if (input) input.value = preferences().alias;
            return false;
        }
        save({ alias });
        const status = document.getElementById('profilePreferencesStatus');
        if (status) status.textContent = alias ? 'Pseudo BloxNews enregistré sur cet appareil.' : 'Le pseudo Discord est utilisé.';
        renderSettings();
        return true;
    }

    function saveAvatar(value) {
        if (!Object.hasOwn(AVATARS, value)) return;
        save({ avatar: value });
        const status = document.getElementById('profilePreferencesStatus');
        if (status) status.textContent = 'Avatar enregistré sur cet appareil.';
        renderSettings();
    }

    function saveCommentSort(value) {
        save({ commentSort: value === 'recent' ? 'recent' : 'top' });
        const status = document.getElementById('profilePreferencesStatus');
        if (status) status.textContent = 'Tri par défaut enregistré.';
    }

    function reactionAnimationsHidden() {
        try { return localStorage.getItem(REACTION_KEY) === '1'; } catch (_) { return false; }
    }

    function toggleReactionAnimations() {
        const next = !reactionAnimationsHidden();
        save({ hideReactionAnimations: next });
        const status = document.getElementById('profilePreferencesStatus');
        if (status) status.textContent = next ? 'Effets de réactions masqués.' : 'Effets de réactions activés.';
    }

    function resetPreferences() {
        try { localStorage.removeItem(KEY); localStorage.removeItem(REACTION_KEY); } catch (_) {}
        document.body.classList.remove('profile-hide-reaction-animations');
        window.dispatchEvent(new CustomEvent('blox-profile-preferences-changed', { detail: preferences() }));
        renderSettings();
        const status = document.getElementById('profilePreferencesStatus');
        if (status) status.textContent = 'Personnalisation réinitialisée sur cet appareil.';
    }

    async function deleteMyProfileData() {
        if (!window.BloxStats?.deleteDiscordProfileData) throw new Error('La gestion des données du compte est indisponible.');
        await window.BloxStats.deleteDiscordProfileData();
        try { localStorage.removeItem(KEY); localStorage.removeItem(REACTION_KEY); } catch (_) {}
        document.body.classList.remove('profile-hide-reaction-animations');
        renderSettings();
        const status = document.getElementById('profileDataStatus');
        if (status) status.textContent = 'Données statistiques du profil, visites associées et préférences locales supprimées. Les compteurs agrégés anonymes et les commentaires publics restent.';
    }

    document.addEventListener('DOMContentLoaded', renderSettings, { once: true });
    window.addEventListener('blox-discord-authenticated', renderSettings);
    window.addEventListener('blox-profile-preferences-changed', renderSettings);
    window.addEventListener('storage', event => { if (event.key === KEY) renderSettings(); });
    window.BloxProfile = {
        preferences, aliasFor, avatarSource, commentIdentity, commentName,
        isAdmin: () => { const user = currentDiscordUser(); return !!(user && ADMIN_IDS.has(String(user.id))); },
        reactionAnimationsHidden, saveAlias, saveAvatar, saveCommentSort,
        toggleReactionAnimations, deleteMyProfileData, renderSettings,
        resetPreferences,
    };
})();
