(function () {
    'use strict';

    const match = window.location.pathname.match(/\/(\d{3})\//);
    if (!match) return;
    const bulletin = match[1];
    const root = document.getElementById('bulletinEngagement');
    if (!root) return;
    const discordRedirectUri = 'https://bloxnewsfr.github.io/BloxNews-FR/neo_bulletin.html';
    const pendingPageKey = 'bloxbulletin_oauth_pending_page';

    // Les pages de bulletin réutilisent l'URL OAuth déjà enregistrée du site,
    // puis neo_bulletin renvoie l'utilisateur à la page d'origine.
    window._discordLogin = function () {
        try { sessionStorage.setItem(pendingPageKey, window.location.pathname); } catch (_) {}
        const params = new URLSearchParams({
            client_id: '1517793695573999646',
            redirect_uri: discordRedirectUri,
            response_type: 'token',
            scope: 'identify',
            state: `/BloxNews-FR/${bulletin}/bulletin-${bulletin}.html`
        });
        window.location.href = 'https://discord.com/api/oauth2/authorize?' + params.toString();
    };
    const specialThemes = { '012': 'matrix', '017': 'halloween', '019': 'rose', '023': 'matrix', '024': 'rebuild', '025': 'halloween' };
    if (specialThemes[bulletin]) root.classList.add(`bulletin-theme--${specialThemes[bulletin]}`);

    const nav = root.querySelector('.bulletin-pagination');
    const maxBulletin = parseInt(root.dataset.max, 10) || 25;
    const previous = Number(bulletin) - 1;
    const next = Number(bulletin) + 1;
    const makeLink = (direction, number, arrow) => {
        const link = document.createElement('a');
        link.className = 'bulletin-pagination__link bulletin-pagination__link--' + direction;
        if (number < 1 || number > maxBulletin) {
            link.href = '#';
            link.setAttribute('aria-disabled', 'true');
            link.tabIndex = -1;
        } else {
            const n = String(number).padStart(3, '0');
            link.href = `../${n}/bulletin-${n}.html`;
        }
        const text = document.createElement('span');
        text.innerHTML = `<span class="bulletin-pagination__direction">${direction === 'previous' ? 'Bulletin précédent' : 'Bulletin suivant'}</span><span class="bulletin-pagination__title">${number >= 1 && number <= maxBulletin ? `Bulletin #${String(number).padStart(3, '0')}` : 'À venir'}</span>`;
        const icon = document.createElement('span');
        icon.className = 'bulletin-pagination__arrow';
        icon.textContent = arrow;
        if (direction === 'previous') { link.append(icon, text); } else { link.append(text, icon); }
        nav.append(link);
    };
    makeLink('previous', previous, '←');
    makeLink('next', next, '→');

    const commentsRoot = root.querySelector('.bulletin-comments');
    const countNode = commentsRoot.querySelector('[data-comments-count]');
    const compose = commentsRoot.querySelector('.bulletin-comments__compose');
    const list = commentsRoot.querySelector('.bulletin-comments__list');
    let database = null;
    const commentsPath = `card_comments/bulletin-${bulletin}`;
    const moderators = new Set(['fn_n0klip', 'neolixx', 'bryanbg']);
    const reactionEmojis = ['❤️', '😂', '😮', '🔥', '👍', '💀'];
    let commentItems = [];
    let sortMode = window.BloxProfile?.preferences().commentSort || 'top';
    const localStateKey = `bulletin-comment-state-${bulletin}`;
    let localState = {};
    try { localState = JSON.parse(localStorage.getItem(localStateKey) || '{}') || {}; } catch (_) {}

    function currentUser() {
        if (window.currentUser && window.currentUser.username) return window.currentUser;
        try {
            const user = JSON.parse(localStorage.getItem('bloxbulletin_discord_user') || 'null');
            return user && user.username ? user : null;
        } catch (_) { return null; }
    }

    function avatarUrl(user) {
        if (user.id && window.BloxProfile && currentUser()?.id === user.id) return window.BloxProfile.avatarSource(user) || user.avatar || '';
        if (user.avatar && (user.avatar.startsWith('http') || user.avatar.startsWith('data:'))) return user.avatar;
        if (user.avatar && user.id) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=96`;
        const index = user.discriminator && user.discriminator !== '0'
            ? Number(user.discriminator) % 5 : (BigInt(user.id || '0') >> 22n) % 6n;
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    }

    function setStatus(message, className) {
        list.replaceChildren();
        const status = document.createElement('div');
        status.className = className || 'bulletin-comments__status';
        status.textContent = message;
        list.append(status);
    }

    function renderCompose() {
        const user = currentUser();
        const userState = user ? `user:${user.id || user.username}` : 'guest';
        if (compose.dataset.userState === userState) return;
        compose.dataset.userState = userState;
        compose.replaceChildren();
        if (!user) {
            const box = document.createElement('div');
            box.className = 'bulletin-comments__login';
            const message = document.createElement('p');
            message.textContent = 'Connecte-toi avec Discord pour participer à la discussion.';
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Se connecter avec Discord';
            button.addEventListener('click', () => {
                if (typeof window._discordLogin === 'function') window._discordLogin();
                else message.textContent = 'La connexion Discord est indisponible sur cette page.';
            });
            box.append(message, button);
            compose.append(box);
            return;
        }

        const userLine = document.createElement('div');
        userLine.className = 'bulletin-comments__user';
        const avatar = document.createElement('img');
        avatar.className = 'bulletin-comments__avatar';
        avatar.src = avatarUrl(user);
        avatar.alt = '';
        const label = document.createElement('span');
        label.textContent = `Commenter en tant que ${window.BloxProfile?.aliasFor(user) || user.global_name || user.username}`;
        userLine.append(avatar, label);
        const textarea = document.createElement('textarea');
        textarea.className = 'bulletin-comments__textarea';
        textarea.maxLength = 600;
        textarea.placeholder = 'Partage ton avis sur ce bulletin…';
        textarea.setAttribute('aria-label', 'Votre commentaire');
        const actions = document.createElement('div');
        actions.className = 'bulletin-comments__actions';
        const hint = document.createElement('span');
        hint.className = 'bulletin-comments__hint';
        hint.textContent = '600 caractères maximum';
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'bulletin-comments__button';
        submit.textContent = 'Publier le commentaire';
        submit.addEventListener('click', async () => {
            const text = textarea.value.trim();
            if (!text) return;
            if (!database) {
                hint.textContent = 'La connexion aux commentaires n’est pas prête. Recharge la page puis réessaie.';
                return;
            }
            submit.disabled = true;
            submit.textContent = 'Publication…';
            const latestUser = currentUser();
            if (!latestUser) { submit.disabled = false; submit.textContent = 'Publier le commentaire'; renderComposeAgain(); return; }
            try {
                const comment = {
                    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
                    ...(window.BloxProfile ? window.BloxProfile.commentIdentity(latestUser) : { userId: latestUser.id || null, username: latestUser.username, avatar: avatarUrl(latestUser) }),
                    text,
                    time: new Date().toISOString(),
                    likes: 0,
                    pinned: false,
                    replies: [],
                    reactions: {},
                    images: []
                };
                // Même format et même écriture que les commentaires d'Actus dans
                // neo_bulletin : un tableau sous card_comments/<id>.
                const ref = database.ref(commentsPath);
                const snapshot = await ref.once('value');
                const value = snapshot.val();
                const comments = Array.isArray(value) ? value.filter(Boolean)
                    : value && typeof value === 'object' ? Object.keys(value).sort((a,b) => Number(a)-Number(b)).map(key => value[key]).filter(Boolean)
                    : [];
                comments.unshift(comment);
                await ref.set(comments);
                textarea.value = '';
                submit.textContent = 'Publié ✓';
                setTimeout(() => { submit.disabled = false; submit.textContent = 'Publier le commentaire'; }, 1200);
            } catch (error) {
                console.error('[bulletin comments] Firebase write failed', error);
                hint.textContent = error && error.code === 'PERMISSION_DENIED'
                    ? 'Firebase refuse l’écriture des commentaires. Vérifie les règles de la base.'
                    : 'Échec de connexion à Firebase. Vérifie ta connexion puis réessaie.';
                submit.disabled = false;
                submit.textContent = 'Réessayer';
            }
        });
        actions.append(hint, submit);
        compose.append(userLine, textarea, actions);
    }

    function renderComposeAgain() {
        renderCompose();
    }

    function dateLabel(timestamp) {
        return new Date(timestamp || Date.now()).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function userIsModerator(user = currentUser()) {
        return !!(user && moderators.has(String(user.discordUsername || user.username || '').toLowerCase()));
    }

    function userOwns(item, user = currentUser()) {
        if (!user || !item) return false;
        return (!!user.id && String(user.id) === String(item.userId || '')) ||
            String(user.discordUsername || user.username || '').toLowerCase() === String(item.discordUsername || item.username || '').toLowerCase();
    }

    function timestamp(item) {
        const value = item.createdAt || item.time || item.timestamp || 0;
        const parsed = typeof value === 'number' ? value : Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function persistLocalState() {
        try { localStorage.setItem(localStateKey, JSON.stringify(localState)); } catch (_) {}
    }

    function saveComments() {
        if (!database) return Promise.reject(new Error('Firebase unavailable'));
        const clean = commentItems.map(comment => {
            const item = { ...comment };
            delete item.key; delete item.likedByMe; delete item.myReactions;
            item.replies = (item.replies || []).map(reply => {
                const copy = { ...reply };
                delete copy.likedByMe; delete copy.myReactions;
                return copy;
            });
            return item;
        });
        return database.ref(commentsPath).set(clean);
    }

    function button(label, className, action, disabled = false) {
        const el = document.createElement('button');
        el.type = 'button'; el.className = className; el.textContent = label; el.disabled = disabled;
        el.addEventListener('click', action);
        return el;
    }

    function heartIcon(filled = false) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'bulletin-comment__action-icon');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z');
        if (filled) { path.setAttribute('fill', 'currentColor'); path.setAttribute('stroke', 'none'); }
        svg.append(path);
        return svg;
    }

    function likeButton(count, liked, action, disabled = false) {
        const el = button('', `bulletin-comment__action bulletin-comment__like${liked ? ' is-liked' : ''}`, action, disabled);
        const value = document.createElement('span');
        value.className = 'bulletin-comment__action-count';
        value.textContent = String(count);
        el.append(heartIcon(liked), value);
        return el;
    }

    function askDelete(message) { return window.confirm(message); }

    async function saveAfterChange() {
        try { await saveComments(); }
        catch (error) {
            console.error('[bulletin comments] Firebase update failed', error);
            setStatus(error && error.code === 'PERMISSION_DENIED'
                ? 'Firebase refuse cette action. Vérifie les règles de la base.'
                : 'Impossible d’enregistrer cette action. Réessaie.');
        }
    }

    function renderReply(reply, comment) {
        const row = document.createElement('div'); row.className = 'bulletin-comment__reply';
        const avatar = document.createElement('img'); avatar.className = 'bulletin-comments__avatar bulletin-comments__avatar--reply';
        avatar.src = reply.avatar || ''; avatar.alt = ''; avatar.onerror = () => avatar.classList.add('bulletin-comments__avatar--empty');
        const body = document.createElement('div'); body.className = 'bulletin-comment__reply-content';
        const meta = document.createElement('div'); meta.className = 'bulletin-comment__meta';
        const name = document.createElement('span'); name.className = 'bulletin-comment__name'; name.textContent = window.BloxProfile?.commentName(reply) || reply.username || 'Membre';
        const date = document.createElement('time'); date.className = 'bulletin-comment__date';
        date.dateTime = new Date(timestamp(reply) || Date.now()).toISOString(); date.textContent = dateLabel(timestamp(reply));
        meta.append(name, date);
        const text = document.createElement('div'); text.className = 'bulletin-comment__text'; text.textContent = reply.text || '';
        const actions = document.createElement('div'); actions.className = 'bulletin-comment__actions';
        const id = `${comment.id || comment.key}_r${reply.id}`;
        const liked = !!localState[id];
        actions.append(likeButton(Number(reply.likes) || 0, liked, async () => {
            if (!currentUser()) return;
            localState[id] = !liked; persistLocalState();
            reply.likes = Math.max(0, (Number(reply.likes) || 0) + (liked ? -1 : 1)); reply.likedByMe = !liked;
            renderComments({ val: () => commentItems }); await saveAfterChange();
        }, !currentUser()));
        if (userOwns(reply) || userIsModerator()) actions.append(button('Supprimer', 'bulletin-comment__action bulletin-comment__action--delete', async () => {
            if (!askDelete('Supprimer cette réponse ?')) return;
            comment.replies = (comment.replies || []).filter(item => String(item.id) !== String(reply.id));
            await saveAfterChange();
        }));
        body.append(meta, text, actions); row.append(avatar, body); return row;
    }

    function renderComment(item, index, items) {
        const row = document.createElement('article'); row.className = 'bulletin-comment';
        if (item.pinned) row.classList.add('is-pinned');
        const avatar = document.createElement('img'); avatar.className = 'bulletin-comments__avatar';
        avatar.src = item.avatar || ''; avatar.alt = ''; avatar.onerror = () => avatar.classList.add('bulletin-comments__avatar--empty');
        const content = document.createElement('div'); content.className = 'bulletin-comment__content';
        const meta = document.createElement('div'); meta.className = 'bulletin-comment__meta';
        const username = document.createElement('span'); username.className = 'bulletin-comment__name'; username.textContent = window.BloxProfile?.commentName(item) || item.username || 'Membre';
        const date = document.createElement('time'); date.className = 'bulletin-comment__date';
        date.dateTime = new Date(timestamp(item) || Date.now()).toISOString(); date.textContent = dateLabel(timestamp(item));
        meta.append(username);
        if (userIsModerator({ username: item.username, discordUsername: item.discordUsername })) { const tag = document.createElement('span'); tag.className = 'bulletin-comment__badge'; tag.textContent = 'ADMIN'; meta.append(tag); }
        if (item.pinned) { const tag = document.createElement('span'); tag.className = 'bulletin-comment__badge bulletin-comment__badge--pinned'; tag.textContent = 'ÉPINGLÉ'; meta.append(tag); }
        if (index === 0 && !item.pinned) { const tag = document.createElement('span'); tag.className = 'bulletin-comment__badge bulletin-comment__badge--first'; tag.textContent = 'À LA UNE'; meta.append(tag); }
        meta.append(date);
        const text = document.createElement('div'); text.className = 'bulletin-comment__text'; text.textContent = item.text;
        content.append(meta, text);
        const actions = document.createElement('div'); actions.className = 'bulletin-comment__actions';
        const id = String(item.id || item.key || ''); const liked = !!localState[id];
        actions.append(likeButton(Number(item.likes) || 0, liked, async () => {
            if (!currentUser()) return;
            localState[id] = !liked; persistLocalState(); item.likes = Math.max(0, (Number(item.likes) || 0) + (liked ? -1 : 1)); item.likedByMe = !liked;
            renderComments({ val: () => commentItems }); await saveAfterChange();
        }, !currentUser()));
        const replyButton = button('Répondre', 'bulletin-comment__action', () => {
            const form = content.querySelector('.bulletin-comment__reply-form');
            if (form) { form.hidden = !form.hidden; form.querySelector('textarea').focus(); }
        }, !currentUser());
        if (!currentUser()) replyButton.title = 'Connecte-toi pour répondre';
        actions.append(replyButton);
        if (userOwns(item) || userIsModerator()) actions.append(button('Supprimer', 'bulletin-comment__action bulletin-comment__action--delete', async () => {
            if (!askDelete('Supprimer ce commentaire ?')) return;
            commentItems = commentItems.filter(comment => String(comment.id || comment.key) !== id); await saveAfterChange(); renderComments({ val: () => commentItems });
        }));
        if (userIsModerator()) actions.append(button(item.pinned ? 'Désépingler' : 'Épingler', 'bulletin-comment__action bulletin-comment__action--admin', async () => {
            item.pinned = !item.pinned; await saveAfterChange(); renderComments({ val: () => commentItems });
        }));

        const picker = document.createElement('div'); picker.className = 'bulletin-comment__reactions';
        reactionEmojis.forEach(emoji => {
            const count = Number((item.reactions || {})[emoji]) || 0;
            const selected = !!((item.myReactions || {})[emoji]);
            if (!count && !selected) return;
            picker.append(button(`${emoji} ${count}`, `bulletin-comment__reaction${selected ? ' is-selected' : ''}`, async () => toggleReaction(item, emoji)));
        });
        const reactionMenu = document.createElement('details'); reactionMenu.className = 'bulletin-comment__reaction-menu';
        const summary = document.createElement('summary'); summary.textContent = '＋ Réaction'; reactionMenu.append(summary);
        const options = document.createElement('div'); options.className = 'bulletin-comment__reaction-options';
        reactionEmojis.forEach(emoji => options.append(button(emoji, 'bulletin-comment__emoji', async () => { await toggleReaction(item, emoji); })));
        reactionMenu.append(options); picker.append(reactionMenu);
        content.append(actions, picker);

        const form = document.createElement('form'); form.className = 'bulletin-comment__reply-form'; form.hidden = true;
        const textarea = document.createElement('textarea'); textarea.maxLength = 600; textarea.rows = 2; textarea.placeholder = 'Écris une réponse…'; textarea.setAttribute('aria-label', 'Votre réponse');
        const submit = button('Répondre', 'bulletin-comments__button', async () => {
            const textValue = textarea.value.trim(); const user = currentUser(); if (!textValue || !user) return;
            submit.disabled = true;
            item.replies = item.replies || [];
            item.replies.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, ...(window.BloxProfile ? window.BloxProfile.commentIdentity(user) : { userId: user.id || null, username: user.username, avatar: avatarUrl(user) }), text: textValue, time: new Date().toISOString(), likes: 0 });
            await saveAfterChange(); renderComments({ val: () => commentItems });
        });
        form.addEventListener('submit', event => { event.preventDefault(); submit.click(); }); form.append(textarea, submit); content.append(form);
        const replies = Array.isArray(item.replies) ? item.replies : [];
        if (replies.length) { const replyList = document.createElement('div'); replyList.className = 'bulletin-comment__replies'; replies.forEach(reply => replyList.append(renderReply(reply, item))); content.append(replyList); }
        row.append(avatar, content); return row;
    }

    async function toggleReaction(item, emoji) {
        if (!currentUser()) return;
        item.reactions = item.reactions || {}; item.myReactions = item.myReactions || {};
        if (item.myReactions[emoji]) { item.reactions[emoji] = Math.max(0, (Number(item.reactions[emoji]) || 0) - 1); delete item.myReactions[emoji]; }
        else { item.reactions[emoji] = (Number(item.reactions[emoji]) || 0) + 1; item.myReactions[emoji] = true; }
        renderComments({ val: () => commentItems }); await saveAfterChange();
    }

    function renderComments(snapshot) {
        const value = typeof snapshot.val === 'function' ? snapshot.val() : snapshot;
        const comments = Array.isArray(value) ? value.filter(Boolean)
            : value && typeof value === 'object' ? Object.keys(value).sort((a,b) => Number(a)-Number(b)).map(key => value[key]).filter(Boolean)
            : [];
        const prior = new Map(commentItems.map(comment => [String(comment.id || comment.key), comment]));
        commentItems = comments.filter(comment => comment && typeof comment.text === 'string').map(comment => {
            const item = { ...comment, key: comment.id || '' }; const old = prior.get(String(item.id || item.key));
            item.likedByMe = !!localState[String(item.id || item.key)];
            item.myReactions = old && old.myReactions || item.myReactions || {};
            item.replies = (item.replies || []).map(reply => ({ ...reply, likedByMe: !!localState[`${item.id || item.key}_r${reply.id}`] }));
            return item;
        });
        const items = [...commentItems].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) ||
            (sortMode === 'top' ? (Number(b.likes) || 0) - (Number(a.likes) || 0) || timestamp(b) - timestamp(a) : timestamp(b) - timestamp(a)));
        countNode.textContent = items.length.toLocaleString('fr-FR');
        const countLabel = countNode.parentElement.lastChild;
        if (countLabel && countLabel.nodeType === Node.TEXT_NODE) countLabel.data = ` commentaire${items.length > 1 ? 's' : ''}`;
        if (!items.length) { setStatus('Aucun commentaire pour le moment. Lance la conversation !', 'bulletin-comments__empty'); return; }
        list.replaceChildren();
        const toolbar = document.createElement('div'); toolbar.className = 'bulletin-comments__toolbar';
        const sortLabel = document.createElement('span'); sortLabel.textContent = 'Trier par'; toolbar.append(sortLabel);
        [['top', 'Top'], ['recent', 'Récents']].forEach(([mode, label]) => toolbar.append(button(label, `bulletin-comments__sort${sortMode === mode ? ' is-active' : ''}`, () => { sortMode = mode; window.BloxProfile?.saveCommentSort(mode); renderComments({ val: () => commentItems }); })));
        list.append(toolbar);
        items.forEach((item, index) => list.append(renderComment(item, index, items)));
    }

    function loadFirebase() {
        return new Promise((resolve, reject) => {
            if (window.firebase && window.firebase.database) { resolve(); return; }
            const urls = [
                'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
                'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js'
            ];
            const load = index => {
                if (index >= urls.length) { resolve(); return; }
                const script = document.createElement('script');
                script.src = urls[index];
                script.onload = () => load(index + 1);
                script.onerror = () => reject(new Error('Firebase SDK indisponible'));
                document.head.append(script);
            };
            load(0);
        });
    }

    setStatus('Chargement des commentaires…');
    renderCompose();
    window.addEventListener('blox-profile-preferences-changed', event => {
        sortMode = event.detail?.commentSort === 'recent' ? 'recent' : 'top';
        renderComments({ val: () => commentItems });
        renderComposeAgain();
    });
    const authRefresh = window.setInterval(renderComposeAgain, 700);
    window.setTimeout(() => window.clearInterval(authRefresh), 10000);
    loadFirebase().then(() => {
        const config = {
            apiKey: 'AIzaSyBkJsHWyoiEeqmEktUlgcED-8mBPnar_0w',
            authDomain: 'blox-bulletin-comments.firebaseapp.com',
            databaseURL: 'https://blox-bulletin-comments-default-rtdb.europe-west1.firebasedatabase.app',
            projectId: 'blox-bulletin-comments',
            storageBucket: 'blox-bulletin-comments.firebasestorage.app',
            messagingSenderId: '774633429491',
            appId: '1:774633429491:web:d1f534a0df346fbea79a86',
            measurementId: 'G-DKKQK7N4DQ'
        };
        if (!window.firebase.apps.length) window.firebase.initializeApp(config);
        database = window.firebase.database();
        database.ref(commentsPath).on('value', renderComments, error => {
            console.error('[bulletin comments] Firebase read failed', error);
            setStatus('Les commentaires ne sont pas disponibles pour le moment.');
        });
    }).catch(error => {
        console.error('[bulletin comments] Firebase init failed', error);
        setStatus('Connexion aux commentaires indisponible. Recharge la page pour réessayer.');
    });
})();
