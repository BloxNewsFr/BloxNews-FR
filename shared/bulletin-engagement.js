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
            scope: 'identify'
        });
        window.location.href = 'https://discord.com/api/oauth2/authorize?' + params.toString();
    };
    const specialThemes = { '012': 'matrix', '017': 'halloween', '019': 'rose', '023': 'matrix', '024': 'rebuild', '025': 'halloween' };
    if (specialThemes[bulletin]) root.classList.add(`bulletin-theme--${specialThemes[bulletin]}`);

    const nav = root.querySelector('.bulletin-pagination');
    const previous = Number(bulletin) - 1;
    const next = Number(bulletin) + 1;
    const makeLink = (direction, number, arrow) => {
        const link = document.createElement('a');
        link.className = 'bulletin-pagination__link bulletin-pagination__link--' + direction;
        if (number < 1 || number > 25) {
            link.href = '#';
            link.setAttribute('aria-disabled', 'true');
            link.tabIndex = -1;
        } else {
            const n = String(number).padStart(3, '0');
            link.href = `../${n}/bulletin-${n}.html`;
        }
        const text = document.createElement('span');
        text.innerHTML = `<span class="bulletin-pagination__direction">${direction === 'previous' ? 'Bulletin précédent' : 'Bulletin suivant'}</span><span class="bulletin-pagination__title">${number >= 1 && number <= 25 ? `Bulletin #${String(number).padStart(3, '0')}` : 'À venir'}</span>`;
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

    function currentUser() {
        if (window.currentUser && window.currentUser.username) return window.currentUser;
        try {
            const user = JSON.parse(localStorage.getItem('bloxbulletin_discord_user') || 'null');
            return user && user.username ? user : null;
        } catch (_) { return null; }
    }

    function avatarUrl(user) {
        if (user.avatar && user.avatar.startsWith('http')) return user.avatar;
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
        label.textContent = `Commenter en tant que ${user.global_name || user.username}`;
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
                    userId: latestUser.id || null,
                    username: latestUser.username,
                    avatar: avatarUrl(latestUser),
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
                hint.textContent = 'Impossible de publier. Vérifie ta connexion et réessaie.';
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

    function renderComments(snapshot) {
        const value = snapshot.val();
        const comments = Array.isArray(value) ? value.filter(Boolean)
            : value && typeof value === 'object' ? Object.keys(value).sort((a,b) => Number(a)-Number(b)).map(key => value[key]).filter(Boolean)
            : [];
        const items = comments.filter(comment => typeof comment.text === 'string')
            .map(comment => ({ ...comment, key: comment.id || '' }));
        const timestamp = item => {
            const value = item.createdAt || item.time || item.timestamp || 0;
            const parsed = typeof value === 'number' ? value : Date.parse(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        items.sort((a, b) => timestamp(b) - timestamp(a));
        countNode.textContent = items.length.toLocaleString('fr-FR');
        const countLabel = countNode.parentElement.lastChild;
        if (countLabel && countLabel.nodeType === Node.TEXT_NODE) countLabel.data = ` commentaire${items.length > 1 ? 's' : ''}`;
        if (!items.length) { setStatus('Aucun commentaire pour le moment. Lance la conversation !', 'bulletin-comments__empty'); return; }
        list.replaceChildren();
        items.forEach(item => {
            const row = document.createElement('article');
            row.className = 'bulletin-comment';
            const avatar = document.createElement('img');
            avatar.className = 'bulletin-comments__avatar';
            avatar.src = item.avatar || '';
            avatar.alt = '';
            avatar.onerror = () => { avatar.removeAttribute('src'); avatar.classList.add('bulletin-comments__avatar--empty'); };
            const content = document.createElement('div');
            content.className = 'bulletin-comment__content';
            const meta = document.createElement('div');
            meta.className = 'bulletin-comment__meta';
            const username = document.createElement('span');
            username.className = 'bulletin-comment__name';
            username.textContent = item.username || 'Membre';
            const date = document.createElement('time');
            date.className = 'bulletin-comment__date';
            const createdAt = timestamp(item);
            date.dateTime = new Date(createdAt || Date.now()).toISOString();
            date.textContent = dateLabel(createdAt);
            meta.append(username, date);
            const text = document.createElement('div');
            text.className = 'bulletin-comment__text';
            text.textContent = item.text;
            content.append(meta, text);
            const user = currentUser();
            if (user && (user.id === item.userId || user.username === item.username || ['fn_n0klip', 'neolixx', 'bryanbg'].includes(user.username))) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'bulletin-comment__delete';
                remove.textContent = 'Supprimer';
                remove.addEventListener('click', async () => {
                    if (!window.confirm('Supprimer ce commentaire ?')) return;
                    try {
                        await database.ref(commentsPath).transaction(value => {
                            const comments = Array.isArray(value) ? value.filter(Boolean)
                                : value && typeof value === 'object' ? Object.keys(value).sort((a,b) => Number(a)-Number(b)).map(key => value[key]).filter(Boolean)
                                : [];
                            return comments.filter(comment => comment && comment.id !== item.key);
                        });
                    }
                    catch (error) { console.error('[bulletin comments] Firebase delete failed', error); }
                });
                content.append(remove);
            }
            row.append(avatar, content);
            list.append(row);
        });
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
