/**
 * BloxNews-FR — Créateur de bulletin (admin)
 * Génère un bulletin au design standard (base 001), gère les thèmes
 * Halloween / Saint-Valentin, compresse les images et publie via le
 * Worker createBulletin (Git Data API).
 */
(function () {
    'use strict';

    const RELAY_URL = 'https://blox-update-relay.c9yz5m8pw6.workers.dev';
    const MAX_NUM = 999;

    const esc = (s) => String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const fmtNum = (n) => String(n).padStart(3, '0');

    const FR_MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    function formatDateFR(iso) {
        const d = new Date(iso + 'T12:00:00');
        if (isNaN(d)) return iso;
        return d.getDate() + ' ' + FR_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    /* ── Markdown-lite (mêmes tokens que bulletin-editor) ── */
    function _hexToInk(hex) {
        const h = (hex || '').replace('#', '');
        if (!/^[0-9a-fA-F]{3,8}$/.test(h)) return '#000';
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 140 ? '#000' : '#fff';
    }

    function mdToHtml(src) {
        let s = esc(src);
        s = s.replace(/\r\n/g, '\n');
        s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        s = s.replace(/^# (.+)$/gm, '<h2>$1</h2>');
        s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        s = s.replace(/^---+$/gm, '<hr>');
        s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
        s = s.replace(/(?:<li>.*?<\/li>\n?)+/g, (m) => '<ul>' + m + '</ul>');
        s = s.replace(/\[==([0-9a-fA-F]{3,8})==\]([\s\S]*?)\[\/==\]/g,
            (m, c, t) => `<span style="background:#${c};color:${_hexToInk(c)};padding:0 5px;border-radius:3px">${t}</span>`);
        s = s.replace(/==(\[[0-9a-fA-F]{3,8}\])?([\s\S]*?)==/g,
            (m, c, t) => `<mark style="background:${c ? '#' + c.slice(1, -1) : '#fce83a'};color:#000;padding:0 4px;border-radius:3px">${t}</mark>`);
        s = s.replace(/\[([0-9a-fA-F]{3,8})\]([\s\S]*?)\[\/\]/g,
            (m, c, t) => `<span style="color:#${c}">${t}</span>`);
        s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/__([^_\n]+)__/g, '<u>$1</u>');
        s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
        s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        const blocks = s.split(/\n{2,}/).map(b => {
            const t = b.trim();
            if (!t) return '';
            if (/^<(h[234]|ul|blockquote|hr|div|p\b)/.test(t)) return t;
            if (/^<li>/.test(t)) return '<ul>' + t + '</ul>';
            return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
        });
        return blocks.filter(Boolean).join('\n');
    }

    /* ── Compression image ── */
    function compressImage(file, maxDim, quality, maxChars) {
        maxChars = maxChars || 85000; // sous la limite 100 Ko Cloudflare (blob base64)
        return new Promise((resolve, reject) => {
            if (!file) return reject(new Error('Fichier manquant'));
            if (!/^image\//.test(file.type)) return reject(new Error('Type invalide : ' + file.type));
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Lecture impossible'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('Image invalide'));
                img.onload = () => {
                    let w0 = img.width, h0 = img.height;
                    let dim = Math.min(maxDim, Math.max(w0, h0));
                    let q = quality;
                    let out = '';
                    const draw = (size) => {
                        let w = w0, h = h0;
                        if (Math.max(w, h) > size) {
                            const r = size / Math.max(w, h);
                            w = Math.round(w * r); h = Math.round(h * r);
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        return canvas.toDataURL('image/jpeg', q);
                    };
                    out = draw(dim);
                    let guard = 0;
                    while (out.length > maxChars && guard++ < 12) {
                        if (q > 0.35) {
                            q = Math.max(0.35, q - 0.1);
                        } else if (dim > 480) {
                            dim = Math.round(dim * 0.72);
                        } else {
                            break;
                        }
                        out = draw(dim);
                    }
                    if (out.length > maxChars * 1.35) {
                        reject(new Error('Image trop lourde même compressée — essaie une image plus petite.'));
                        return;
                    }
                    resolve({ dataUrl: out, bytes: Math.round(out.length * 0.75) });
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    /* ── Mini-markdown toolbar ── */
    function applyMdToken(textarea, token) {
        const s = textarea.selectionStart, e = textarea.selectionEnd;
        const sel = textarea.value.slice(s, e);
        let ins, caret;
        if (token === 'hl') { ins = '==[FFD700]' + (sel || 'surligné') + '=='; caret = s + ins.length; }
        else if (token === 'color') { ins = '[175ec2]' + (sel || 'texte') + '[/]'; caret = s + ins.length; }
        else if (token === 'link') {
            ins = '[' + (sel || 'libellé') + '](url)';
            caret = s + ins.length;
        } else {
            ins = token + (sel || '') + token;
            caret = sel ? s + ins.length : s + token.length;
        }
        textarea.setRangeText(ins, s, e, 'end');
        textarea.focus();
    }

    /* ── Template HTML bulletin (base 001) ── */
    function buildBulletinHtml(opts) {
        const n = fmtNum(opts.num);
        const title = esc(opts.title || 'Le Bulletin Blox #' + n);
        const subtitle = esc(opts.subtitle || '');
        const author = esc(opts.author || 'BloxNews');
        const dateFr = esc(opts.dateFr);
        const themeClass = opts.theme ? ' theme-' + opts.theme : '';
        const extraCss = opts.theme
            ? `\n    <link rel="stylesheet" href="../shared/bulletin-theme-${opts.theme}.css">`
            : '';
        const fonts = opts.theme === 'halloween'
            ? 'Luckiest+Guy&family=Inter:wght@300;400;500;600;700;900&family=Creepster'
            : 'Luckiest+Guy&family=Inter:wght@300;400;500;600;700;900';
        const heroSrc = opts.hero ? esc(opts.hero) : '../shared/background.png';
        const ogImage = opts.hero && opts.hero.startsWith('data:')
            ? `https://bloxnewsfr.github.io/BloxNews-FR/${n}/img/hero.jpg`
            : (opts.hero || 'https://bloxnewsfr.github.io/BloxNews-FR/shared/background.png');

        let body = '';

        if (opts.wanted && opts.wanted.title) {
            body += `
        <div class="wanted-box">
            <h2 class="wanted-title">${esc(opts.wanted.title)}</h2>
            ${opts.wanted.author ? `<span class="wanted-subtitle">Par ${esc(opts.wanted.author)}</span>` : ''}
            ${opts.wanted.image ? `<img src="${esc(opts.wanted.image)}" alt="" class="wanted-img">` : ''}
            <div class="wanted-text">
                ${mdToHtml(opts.wanted.body || '')}
                ${opts.wanted.summary ? `<div class="summary"><b>📌 Résumé :</b>${esc(opts.wanted.summary)}</div>` : ''}
            </div>
        </div>`;
        }

        const articles = (opts.articles || []).filter(a => a && a.title);
        if (articles.length) {
            body += `
        <div class="content-columns">
            <div class="left-col">`;
            articles.forEach((a) => {
                body += `
                <h2>${esc(a.title)}</h2>
                ${a.author ? `<span class="section-subtext">Par ${esc(a.author)}</span>` : ''}
                ${a.image ? `<img src="${esc(a.image)}" alt="" class="side-img">` : ''}
                <div class="bulletin-section">${mdToHtml(a.body || '')}
                    ${a.summary ? `<div class="summary"><b>📌 Résumé :</b>${esc(a.summary)}</div>` : ''}
                </div>`;
            });
            body += `
            </div>`;
            const side = opts.side;
            if (side && side.title) {
                body += `
            <div class="right-col">
                <h2 style="font-size: 18px; border-bottom: 2px solid #111; padding-bottom: 10px;">${esc(side.title)}</h2>
                ${side.author ? `<span class="section-subtext" style="margin-top: 5px;">Par ${esc(side.author)}</span>` : ''}
                ${side.image ? `<img src="${esc(side.image)}" class="side-img" alt="">` : ''}
                <div class="side-text">${mdToHtml(side.body || '')}
                    ${side.summary ? `<div class="summary"><b>📌 Résumé :</b>${esc(side.summary)}</div>` : ''}
                </div>
            </div>`;
            }
            body += `
        </div>`;
        }

        if (opts.box && opts.box.title) {
            body += `
        <div class="yellow-box">
            <h3>${esc(opts.box.title)}</h3>
            ${opts.box.image ? `<img src="${esc(opts.box.image)}" alt="">` : ''}
            ${opts.box.body ? mdToHtml(opts.box.body) : ''}
            ${opts.box.summary ? `<div class="summary"><b>📌 Résumé :</b>${esc(opts.box.summary)}</div>` : ''}
        </div>`;
        }

        if (!body) {
            body = `
        <div class="wanted-box">
            <h2 class="wanted-title">Bulletin en préparation</h2>
            <div class="wanted-text"><p>Aucun contenu pour le moment.</p></div>
        </div>`;
        }

        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} – Blox Fruits</title>
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Blox Fruits News">
    <meta property="og:title" content="${title} – Blox Fruits">
    <meta property="og:description" content="Bulletin #${n} – Toute l'actualité Blox Fruits : mises à jour, événements et news officielles du jeu Roblox Blox Fruits.">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:url" content="https://bloxnewsfr.github.io/BloxNews-FR/${n}/bulletin-${n}.html">
    <meta property="og:locale" content="fr_FR">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/png" href="../shared/favicon.png">
    <link rel="shortcut icon" href="../shared/bf_logo.png" type="image/png">
    <link href="https://fonts.googleapis.com/css2?family=${fonts}&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0">
    <link rel="stylesheet" href="./bulletin-${n}.css">
    <link rel="stylesheet" href="../shared/bulletin-lightbox.css">
    <link rel="stylesheet" href="../astuces/astuces.css">
    <link rel="stylesheet" href="../shared/bulletin-engagement.css">${extraCss}
</head>
<body class="theme-${opts.theme || 'default'}${themeClass ? '' : ''}">

    <header class="site-header">
        <div class="site-header__logo">
            <img class="logo" src="../BF_news.png" alt="Blox Fruits">
        </div>
        <nav>
            <ul class="site-nav">
                <li><a href="https://www.roblox.com/fr/games/2753915549/Blox-Fruits">Game</a></li>
                <li><a href="../index.html" class="nav-news">News</a></li>
                <li><a href="../neo_bulletin.html" class="nav-leaks">Leaks</a></li>
                <li><a href="../archives.html">Archives</a></li>
            </ul>
        </nav>
        <div class="site-header__icons">
            <span class="material-symbols-outlined" onclick="openSearch()">search</span>
            <span class="material-symbols-outlined dark-mode-toggle" id="darkModeToggle" onclick="toggleDarkMode()" title="Dark Mode">dark_mode</span>
            <div class="discord-skeleton" id="discordSkeleton"></div>
            <button class="discord-login-btn" id="discordLoginBtn" onclick="_discordLogin()" style="display:none">
                <svg width="16" height="12" viewBox="0 0 71 55" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.44077 45.4204 0.52529C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.52529C25.5141 0.44359 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" fill="white"/>
                </svg>
                Connexion
            </button>
            <div class="discord-user-pill" id="discordUserPill">
                <img class="discord-avatar" id="discordAvatar" src="" alt="Avatar">
                <span class="discord-username" id="discordUsername"></span>
                <span class="discord-chevron">&#9660;</span>
                <div class="discord-dropdown" id="discordDropdown">
                    <div class="discord-dropdown-header">
                        <img class="discord-dropdown-avatar" id="discordDropdownAvatar" src="" alt="">
                        <div>
                            <div class="discord-dropdown-name" id="discordDropdownName"></div>
                            <div class="discord-dropdown-tag" id="discordDropdownTag">Connect&#233; via Discord</div>
                        </div>
                    </div>
                    <div class="discord-dropdown-body">
                        <div class="discord-dropdown-item" onclick="_discordLogout()">
                            <span>&#128682;</span> Se d&#233;connecter
                        </div>
                    </div>
                </div>
            </div>
            <span class="material-symbols-outlined mobile-menu-btn" id="menuToggle">menu</span>
        </div>
    </header>

    <div class="mobile-nav-backdrop" id="mobileNavBackdrop"></div>
    <nav class="mobile-nav-dropdown" id="mobileNav" aria-hidden="true">
        <div class="mnav-header">
            <span class="mnav-header__title">Menu</span>
            <button class="mnav-close" id="mobileNavClose" aria-label="Fermer le menu">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
        <div class="mnav-links">
            <a href="https://www.roblox.com/fr/games/2753915549/Blox-Fruits" class="mnav-link">
                <span class="material-symbols-outlined mnav-link__icon">sports_esports</span> Jouer
            </a>
            <a href="../index.html" class="mnav-link nav-news active">
                <span class="material-symbols-outlined mnav-link__icon">newspaper</span> News
            </a>
            <a href="../neo_bulletin.html" class="mnav-link nav-leaks">
                <span class="material-symbols-outlined mnav-link__icon">key</span> Leaks
            </a>
            <a href="../archives.html" class="mnav-link">
                <span class="material-symbols-outlined mnav-link__icon">inventory_2</span> Archive
            </a>
        </div>
    </nav>

    <main class="bulletin-container">

        <div class="blue-banner">${esc(opts.bannerText || ('The Blox Bulletin #' + n))}</div>

        <div class="hero-image-wrapper">
            <img src="${heroSrc}" class="hero-image" alt="${title}">
        </div>

        <div class="journal-header">
            <h1 class="journal-title">${esc(opts.journalTitle || 'The Blox Bulletin')}</h1>
            ${subtitle ? `<p class="journal-subtitle">${subtitle}</p>` : ''}
            <div class="journal-meta">Numéro : ${n} | ${dateFr}</div>
        </div>

        <div class="dashed-line"></div>
${body}

        <div class="social-share">
            <a href="https://discord.gg/a6S6eugPn" class="td">
                <img src="../shared/discord.png" class="discord-icon" alt="Discord"> Discord
            </a>
            <a href="https://tiktok.com/@dc_neolixx" class="tt">
                <img src="../shared/tiktok.png" class="tiktok-icon" alt="TikTok"> TikTok
            </a>
            <a href="https://www.youtube.com/@Dc_neolixx" class="ty">
                <img src="../shared/youtube.png" class="youtube-icon" alt="Youtube"> Youtube
            </a>
        </div>

        <section class="bulletin-engagement" id="bulletinEngagement" aria-label="Navigation et commentaires du bulletin ${n}" data-max="${opts.num}">
            <nav class="bulletin-pagination" aria-label="Bulletin précédent et suivant"></nav>
            <section class="bulletin-comments" aria-labelledby="bulletinCommentsTitle">
                <div class="bulletin-comments__heading">
                    <h2 class="bulletin-comments__title" id="bulletinCommentsTitle">La discussion</h2>
                    <span class="bulletin-comments__count"><span data-comments-count>0</span> commentaire(s)</span>
                </div>
                <div class="bulletin-comments__compose"></div>
                <div class="bulletin-comments__list" aria-live="polite"></div>
            </section>
        </section>

        <div class="back-button-container">
            <a href="../index.html#bulletin-${n}" class="back-button">← Retour aux Actualités</a>
        </div>

    </main>

<script>
    const menuBtn = document.getElementById('menuToggle');
    const mobileNav = document.getElementById('mobileNav');
    const mobileNavBackdrop = document.getElementById('mobileNavBackdrop');
    const mobileNavClose = document.getElementById('mobileNavClose');
    function openMobileNav() {
        mobileNav.classList.add('is-open');
        mobileNavBackdrop?.classList.add('is-open');
        mobileNav.setAttribute('aria-hidden', 'false');
        menuBtn.textContent = 'close';
        menuBtn.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }
    function closeMobileNav() {
        mobileNav.classList.remove('is-open');
        mobileNavBackdrop?.classList.remove('is-open');
        mobileNav.setAttribute('aria-hidden', 'true');
        menuBtn.textContent = 'menu';
        menuBtn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }
    if (menuBtn && mobileNav) {
        menuBtn.addEventListener('click', () => {
            mobileNav.classList.contains('is-open') ? closeMobileNav() : openMobileNav();
        });
        menuBtn.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menuBtn.click(); }
        });
        mobileNavBackdrop?.addEventListener('click', closeMobileNav);
        mobileNavClose?.addEventListener('click', closeMobileNav);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileNav(); });
        mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMobileNav));
    }

    window.addEventListener('scroll', () => {
        const header = document.querySelector('.site-header');
        const darkZones = document.querySelectorAll('.blue-banner, .hero-image');
        let isOverDarkZone = false;
        const headerCenter = header.getBoundingClientRect().top + (header.offsetHeight / 2);
        darkZones.forEach(zone => {
            const rect = zone.getBoundingClientRect();
            if (headerCenter >= rect.top && headerCenter <= rect.bottom) isOverDarkZone = true;
        });
        if (isOverDarkZone) header.classList.add('nav-light-text');
        else header.classList.remove('nav-light-text');
    });
    window.dispatchEvent(new Event('scroll'));

    function toggleDarkMode() {
        const isDark = !document.body.classList.contains('dark-mode');
        document.body.classList.toggle('dark-mode', isDark);
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        localStorage.setItem('blox_dark_mode', isDark);
        localStorage.setItem('blox_theme', isDark ? 'dark' : 'light');
        document.getElementById('darkModeToggle').textContent = isDark ? 'light_mode' : 'dark_mode';
    }
    (function() {
        const dark = localStorage.getItem('blox_dark_mode') === 'true' || localStorage.getItem('blox_theme') === 'dark';
        if (dark) {
            document.body.classList.add('dark-mode');
            document.documentElement.setAttribute('data-theme', 'dark');
            var el = document.getElementById('darkModeToggle');
            if (el) el.textContent = 'light_mode';
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    })();

    let searchMatches = [];
    let searchCurrent = -1;
    function openSearch() {
        document.getElementById('searchOverlay').classList.add('is-active');
        const inp = document.getElementById('searchInput');
        inp.value = '';
        document.getElementById('searchStats').textContent = '';
        searchMatches = []; searchCurrent = -1;
        removeHighlights();
        setTimeout(() => inp.focus(), 200);
    }
    function closeSearch(keepHl) {
        document.getElementById('searchOverlay').classList.remove('is-active');
        if (!keepHl) removeHighlights();
        if (!keepHl) { searchMatches = []; searchCurrent = -1; }
    }
    function removeHighlights() {
        document.querySelectorAll('mark.search-hl').forEach(m => {
            const p = m.parentNode;
            p.replaceChild(document.createTextNode(m.textContent), m);
            p.normalize();
        });
    }
    function executeSearch() {
        const q = document.getElementById('searchInput').value.trim().toLowerCase();
        removeHighlights();
        searchMatches = []; searchCurrent = -1;
        const stats = document.getElementById('searchStats');
        stats.textContent = '';
        if (!q) return;
        const root = document.querySelector('main.main-content, main.bulletin-container, .bulletin-container') || document.body;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: n => {
                const p = n.parentNode;
                if (!p || p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE') return NodeFilter.FILTER_REJECT;
                if (p.closest('.search-overlay, .material-symbols-outlined, .mobile-menu-btn')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = []; let n;
        while (n = walker.nextNode()) nodes.push(n);
        nodes.forEach(textNode => {
            const text = textNode.textContent;
            const lower = text.toLowerCase();
            let idx = lower.indexOf(q);
            if (idx === -1) return;
            const frag = document.createDocumentFragment();
            let last = 0;
            while (idx !== -1) {
                if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
                const mark = document.createElement('mark');
                mark.className = 'search-hl';
                mark.textContent = text.slice(idx, idx + q.length);
                frag.appendChild(mark);
                searchMatches.push(mark);
                last = idx + q.length;
                idx = lower.indexOf(q, last);
            }
            if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
            textNode.parentNode.replaceChild(frag, textNode);
        });
        const c = searchMatches.length;
        if (c > 0) {
            searchCurrent = 0;
            searchMatches[0].classList.add('active');
            searchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            stats.textContent = c + ' résultat' + (c > 1 ? 's' : '');
            closeSearch(true);
        } else {
            stats.textContent = 'Aucun résultat';
        }
    }
</script>

<div id="searchOverlay" class="search-overlay" onclick="if(event.target===this)closeSearch()">
    <div class="search-container">
        <div class="search-bar">
            <span class="material-symbols-outlined search-icon" style="font-size:22px;color:#999;flex-shrink:0">search</span>
            <input id="searchInput" type="text" placeholder="Rechercher&#8230;" onkeydown="if(event.key==='Escape')closeSearch();if(event.key==='Enter'){event.preventDefault();executeSearch()}">
            <button class="search-go-btn" onclick="executeSearch()">Chercher</button>
            <button class="search-close-btn" onclick="closeSearch()">&#10005;</button>
        </div>
        <div id="searchStats" class="search-stats"></div>
    </div>
</div>

    <script>
    const DISCORD_CLIENT_ID   = '1517793695573999646';
    const DISCORD_REDIRECT_URI = window.location.href.split('#')[0].split('?')[0];
    const DISCORD_SCOPE        = 'identify';
    const DISCORD_TOKEN_KEY    = 'bloxbulletin_discord_token';
    const DISCORD_USER_KEY     = 'bloxbulletin_discord_user';
    function _discordLogin() {
        const params = new URLSearchParams({
            client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_REDIRECT_URI,
            response_type: 'token', scope: DISCORD_SCOPE,
        });
        window.location.href = 'https://discord.com/api/oauth2/authorize?' + params.toString();
    }
    async function _discordFetchUser(token) {
        const res = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('Token invalide');
        return res.json();
    }
    function _discordAvatarUrl(user) {
        if (user.avatar) return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.webp?size=80';
        const idx = user.discriminator !== '0' ? parseInt(user.discriminator) % 5 : (parseInt(user.id) >> 22) % 6;
        return 'https://cdn.discordapp.com/embed/avatars/' + idx + '.png';
    }
    function _discordShowUser(user) {
        const avatarUrl = _discordAvatarUrl(user);
        const displayName = user.global_name || user.username;
        document.getElementById('discordLoginBtn').style.display = 'none';
        document.getElementById('discordSkeleton').classList.remove('is-visible');
        const pill = document.getElementById('discordUserPill');
        document.getElementById('discordAvatar').src = avatarUrl;
        document.getElementById('discordUsername').textContent = displayName;
        pill.classList.add('is-visible');
        document.getElementById('discordDropdownAvatar').src = avatarUrl;
        document.getElementById('discordDropdownName').textContent = displayName;
        document.getElementById('discordDropdownTag').textContent = '@' + user.username;
        pill.onclick = function(e) { e.stopPropagation(); pill.classList.toggle('dropdown-open'); };
        document.addEventListener('click', function() { pill.classList.remove('dropdown-open'); });
    }
    function _discordLogout() {
        localStorage.removeItem(DISCORD_TOKEN_KEY);
        localStorage.removeItem(DISCORD_USER_KEY);
        document.getElementById('discordUserPill').classList.remove('is-visible', 'dropdown-open');
        document.getElementById('discordLoginBtn').style.display = '';
    }
    (async function() {
        var skeleton = document.getElementById('discordSkeleton');
        var loginBtn = document.getElementById('discordLoginBtn');
        var hash = window.location.hash;
        if (hash.includes('access_token=')) {
            var params = new URLSearchParams(hash.slice(1));
            var token = params.get('access_token');
            var expiresIn = parseInt(params.get('expires_in') || '604800');
            var expiresAt = Date.now() + expiresIn * 1000;
            history.replaceState(null, '', window.location.pathname + window.location.search);
            if (token) {
                skeleton.classList.add('is-visible');
                try {
                    var user = await _discordFetchUser(token);
                    localStorage.setItem(DISCORD_TOKEN_KEY, JSON.stringify({ token: token, expiresAt: expiresAt }));
                    localStorage.setItem(DISCORD_USER_KEY, JSON.stringify(user));
                    _discordShowUser(user);
                } catch(e) { skeleton.classList.remove('is-visible'); loginBtn.style.display = ''; }
                return;
            }
        }
        try {
            var stored = JSON.parse(localStorage.getItem(DISCORD_TOKEN_KEY) || 'null');
            var cachedUser = JSON.parse(localStorage.getItem(DISCORD_USER_KEY) || 'null');
            if (cachedUser) {
                _discordShowUser(cachedUser);
                if (stored && stored.expiresAt > Date.now()) {
                    try {
                        var freshUser = await _discordFetchUser(stored.token);
                        localStorage.setItem(DISCORD_USER_KEY, JSON.stringify(freshUser));
                        _discordShowUser(freshUser);
                    } catch(e) {}
                }
                return;
            }
        } catch(e) {}
        loginBtn.style.display = '';
    })();
    </script>
    <script src="../shared/bulletin-lightbox.js"></script>
    <script src="../astuces/astuces.js"></script>
    <script src="../shared/bulletin-engagement.js"></script>
    <script src="../shared/bulletin-editor.js"></script>
</body>
</html>`;
    }

    /* ── Injection carte spéciale dans index.html (texte) ── */
    function specialCardEntry(num, theme) {
        const n = fmtNum(num);
        if (theme === 'halloween') {
            return `"${n}": { className: "halloween-card", badge: "#${n}", status: "HALLOWEEN", eyebrow: "Halloween Event", title: "BULLETIN #${n}", button: "Ouvrir la porte" },`;
        }
        if (theme === 'valentine') {
            return `"${n}": { className: "valentine-card", badge: "#${n}", status: "SAINT-VALENTIN", eyebrow: "Saint-Valentin", title: "BULLETIN #${n}", button: "Lire la lettre" },`;
        }
        return null;
    }

    function patchIndexHtml(src, entry) {
        if (!entry) return src;
        const re = /(const\s+specialCards\s*=\s*\{)/;
        if (!re.test(src)) return src;
        return src.replace(re, '$1\n            ' + entry);
    }

    function patchArchivesHtml(src, num, dateIso) {
        const n = fmtNum(num);
        if (src.includes(`"${n}"`)) return src;
        const re = /(const\s+bulletins\s*=\s*\[)/;
        if (!re.test(src)) return src;
        const line = `\n            { num: "${n}", img: "./${n}/img/hero.jpg", href: "./${n}/bulletin-${n}.html", date: "${dateIso}" },`;
        return src.replace(re, '$1' + line);
    }

    function patchSourcesJson(src, num) {
        let data;
        try { data = JSON.parse(src); } catch (e) { return src; }
        if (typeof data.last_bulletin_num === 'number' && num > data.last_bulletin_num) {
            data.last_bulletin_num = num;
        }
        return JSON.stringify(data, null, 2) + '\n';
    }

    function patchPrevBulletinEngagement(src, num) {
        const re = /(<section class="bulletin-engagement"[^>]*?)(\s*data-max="\d+")?(\s*id="bulletinEngagement")/;
        if (!re.test(src)) return src;
        return src.replace(re, (m, p1, _dm, p3) => `${p1} data-max="${fmtNum(num)}"${p3}`);
    }

    /* ── Publication via le Worker ── */
    async function callUpdateRelay(action, payload) {
        let token = null;
        try {
            const raw = localStorage.getItem('bloxbulletin_discord_token');
            if (raw) token = JSON.parse(raw).token;
        } catch (e) { /* ignore */ }
        const res = await fetch(RELAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, discordAccessToken: token, ...payload })
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* ignore */ }
        if (!res.ok || (data && data.ok === false)) {
            let msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
            // Erreurs connues → messages explicites
            if (/Action (Git )?inconnue|Action inconnue/i.test(msg)) {
                msg = 'Le Worker Cloudflare n\'a pas les nouvelles actions (gitBase/gitBlob/gitCommit). Redéploie update-relay.js sur Cloudflare.';
            } else if (/trop volumineuse/i.test(msg)) {
                msg = 'Requête trop volumineuse — le Worker a peut-être encore l\'ancienne limite. Redéploie update-relay.js (nouvelle limite 3,5 Mo + envoi chunked).';
            } else if (/Reconnecte-toi/i.test(msg)) {
                msg = 'Session Discord expirée. Reconnecte-toi dans Paramètres.';
            } else if (/GITHUB_/i.test(msg)) {
                msg = 'Secrets GitHub manquants côté Worker (GITHUB_TOKEN, GITHUB_REPO…).';
            } else if (/UPLOAD_SESSIONS/i.test(msg)) {
                msg = 'Binding KV UPLOAD_SESSIONS manquant dans le Worker Cloudflare.';
            }
            throw new Error(msg);
        }
        return data;
    }

    /* ── Form state helpers ── */
    let _defaultCssCache = null;
    function _sharedBase() {
        // index.html est à la racine ; les bulletins sont dans NNN/
        return /\/\d{3}\//.test(location.pathname) ? '../shared/' : './shared/';
    }
    async function loadDefaultCss() {
        if (_defaultCssCache) return _defaultCssCache;
        const res = await fetch(_sharedBase() + 'bulletin-default.css');
        if (!res.ok) throw new Error('CSS par défaut introuvable (' + res.status + ')');
        _defaultCssCache = await res.text();
        return _defaultCssCache;
    }

    async function loadThemeCss(theme) {
        if (!theme) return '';
        const res = await fetch(_sharedBase() + 'bulletin-theme-' + theme + '.css');
        return res.ok ? res.text() : '';
    }

    async function fetchText(url) {
        try {
            const res = await fetch(url);
            return res.ok ? res.text() : null;
        } catch (e) { return null; }
    }

    /* ── Build full publish payload ── */
    async function buildPayload(form) {
        const n = parseInt(form.num, 10);
        if (!n || n < 1 || n > MAX_NUM) throw new Error('Numéro invalide (1–' + MAX_NUM + ')');
        const num = fmtNum(n);
        const dateIso = form.date || new Date().toISOString().slice(0, 10);

        const html = buildBulletinHtml({
            num: n,
            title: form.journalTitle || 'Le Bulletin Blox #' + num,
            subtitle: form.subtitle,
            journalTitle: form.journalTitle || 'The Blox Bulletin',
            bannerText: form.bannerText,
            author: form.author,
            dateFr: formatDateFR(dateIso),
            theme: form.theme || null,
            hero: form.heroImg || null,
            wanted: form.wanted,
            articles: form.articles,
            side: form.side,
            box: form.box
        });

        const baseCss = await loadDefaultCss();
        const themeCss = await loadThemeCss(form.theme);
        const css = baseCss + (themeCss ? '\n\n/* ── Thème ' + form.theme + ' ── */\n' + themeCss : '');

        const files = [
            { path: `${num}/bulletin-${num}.html`, content: html, encoding: 'utf-8' },
            { path: `${num}/bulletin-${num}.css`, content: css, encoding: 'utf-8' }
        ];

        const images = [
            { key: 'hero', file: form.heroFile, dest: `${num}/img/hero.jpg`, maxDim: 1280, quality: 0.72 },
            { key: 'wanted', file: form.wanted && form.wanted.file, dest: `${num}/img/wanted.jpg`, maxDim: 1100, quality: 0.7 },
            { key: 'side', file: form.side && form.side.file, dest: `${num}/img/side.jpg`, maxDim: 900, quality: 0.68 },
            { key: 'box', file: form.box && form.box.file, dest: `${num}/img/box.jpg`, maxDim: 900, quality: 0.68 }
        ];
        (form.articles || []).forEach((a, i) => {
            if (a && a.file) {
                images.push({ key: 'art' + i, file: a.file, dest: `${num}/img/article-${i + 1}.jpg`, maxDim: 900, quality: 0.68 });
            }
        });
        let heroCardImg = null;
        let totalChars = html.length + css.length;
        for (const img of images) {
            if (!img.file) continue;
            // budget restant pour rester sous la limite worker (~1,6 Mo utiles)
            const remaining = 1_600_000 - totalChars;
            const maxChars = Math.max(60000, Math.min(85000, Math.floor(remaining / Math.max(1, images.filter(x => x.file).length - images.indexOf(img)))));
            const { dataUrl } = await compressImage(img.file, img.maxDim, img.quality, maxChars);
            totalChars += dataUrl.length;
            files.push({ path: img.dest, content: dataUrl, encoding: 'base64-dataurl' });
            if (img.key === 'hero') heroCardImg = './' + img.dest;
        }
        if (totalChars > 1_900_000) {
            throw new Error('Trop d\'images pour une seule publication (' + Math.round(totalChars / 1024) + ' Ko). Réduis le nombre ou la taille des images.');
        }

        const [indexSrc, archivesSrc, sourcesSrc, prevSrc] = await Promise.all([
            fetchText('./index.html'),
            fetchText('./archives.html'),
            fetchText('./sources.json'),
            fetchText(`./${fmtNum(Math.max(1, n - 1))}/bulletin-${fmtNum(Math.max(1, n - 1))}.html`)
        ]);

        const entry = specialCardEntry(n, form.theme);
        if (indexSrc) {
            let patched = patchIndexHtml(indexSrc, entry);
            const cardRe = new RegExp('(const\\s+bulletins\\s*=\\s*\\[)');
            if (cardRe.test(patched)) {
                patched = patched.replace(cardRe,
                    `$1\n            { num: "${num}", img: "${heroCardImg || './' + num + '/img/hero.jpg'}", href: "./${num}/bulletin-${num}.html", date: "${dateIso}" },`);
            }
            files.push({ path: 'index.html', content: patched, encoding: 'utf-8', overwrite: true });
        }
        if (archivesSrc) {
            files.push({ path: 'archives.html', content: patchArchivesHtml(archivesSrc, n, dateIso), encoding: 'utf-8', overwrite: true });
        }
        if (sourcesSrc) {
            files.push({ path: 'sources.json', content: patchSourcesJson(sourcesSrc, n), encoding: 'utf-8', overwrite: true });
        }
        if (prevSrc && n > 1) {
            const prevNum = fmtNum(n - 1);
            files.push({
                path: `${prevNum}/bulletin-${prevNum}.html`,
                content: patchPrevBulletinEngagement(prevSrc, n),
                encoding: 'utf-8',
                overwrite: true
            });
        }

        return { num, dateIso, theme: form.theme || null, files };
    }

    /* ── Preview ── */
    async function buildPreviewCss(form) {
        const parts = [];
        try { parts.push(await loadDefaultCss()); } catch (e) { /* fallback minimal */ }
        try {
            const themeCss = await loadThemeCss(form.theme);
            if (themeCss) parts.push('/* thème ' + form.theme + ' */\n' + themeCss);
        } catch (e) { /* ignore */ }
        // assets communs (lightbox / engagement / astuces) — chemins depuis la page hôte
        const rootBase = location.pathname.replace(/[^/]*$/, '');
        for (const path of [
            _sharedBase() + 'bulletin-lightbox.css',
            rootBase + 'astuces/astuces.css',
            _sharedBase() + 'bulletin-engagement.css'
        ]) {
            try {
                const res = await fetch(path);
                if (res.ok) parts.push(await res.text());
            } catch (e) { /* ignore */ }
        }
        return parts.join('\n\n');
    }

    async function renderPreview(iframe, form) {
        let html = buildBulletinHtml({
            num: parseInt(form.num, 10) || 26,
            title: form.journalTitle || 'Le Bulletin Blox',
            subtitle: form.subtitle,
            journalTitle: form.journalTitle || 'The Blox Bulletin',
            bannerText: form.bannerText,
            author: form.author,
            dateFr: form.date ? formatDateFR(form.date) : formatDateFR(new Date().toISOString().slice(0, 10)),
            theme: form.theme || null,
            hero: form.heroPreview || null,
            wanted: form.wanted,
            articles: (form.articles || []).map(a => ({
                ...a,
                image: a.image || null
            })),
            side: form.side,
            box: form.box
        });

        // Inline le CSS du bulletin (le fichier NNN/bulletin-NNN.css n'existe
        // pas encore) + les CSS partagés, pour que l'aperçu soit fidèle.
        const inlineCss = await buildPreviewCss(form);
        html = html
            .replace(/<link rel="stylesheet" href="\.\/bulletin-[^"]+">\s*/g, '')
            .replace(/<link rel="stylesheet" href="\.\.\/shared\/bulletin-theme-[^"]+">\s*/g, '')
            .replace(/<link rel="stylesheet" href="\.\.\/shared\/bulletin-lightbox\.css">\s*/g, '')
            .replace(/<link rel="stylesheet" href="\.\.\/astuces\/astuces\.css">\s*/g, '')
            .replace(/<link rel="stylesheet" href="\.\.\/shared\/bulletin-engagement\.css">\s*/g, '')
            .replace(/(<meta charset="utf-8">)/, `$1\n    <base href="${_previewBaseHref()}">`)
            .replace('</head>', `    <style>\n${inlineCss}\n    </style>\n</head>`);

        const doc = iframe.contentDocument;
        doc.open();
        doc.write(html);
        doc.close();

        // fallback thème si le CSS de thème n'a pas pu être fetché
        if (form.theme === 'halloween' && !inlineCss.includes('theme-halloween') && !inlineCss.includes('--orange')) {
            const s = doc.createElement('style');
            s.textContent = `
                body { background: #0d0505 !important; color: #e8dcc8; }
                .blue-banner { background: linear-gradient(135deg,#1a0505,#3a0a0a,#0d0d0d,#2a0a00) !important; color:#ff9500 !important; font-family:Creepster,cursive !important; border:2px solid #ff6a00; border-radius:14px; text-shadow:0 0 20px #ff6a00; }
                .journal-title { color:#ff9500 !important; font-family:Creepster,cursive !important; text-shadow:0 0 20px #ff6a00,2px 2px 0 #000; }
                .wanted-box, .right-col { background:rgba(20,10,20,0.85) !important; border-color:rgba(255,106,0,0.25) !important; }
                h2 { color:#ff9500 !important; border-bottom-color:rgba(255,106,0,0.35) !important; }
            `;
            doc.head.appendChild(s);
        } else if (form.theme === 'valentine' && !inlineCss.includes('theme-valentine') && !inlineCss.includes('--rose')) {
            const s = doc.createElement('style');
            s.textContent = `
                body { background: linear-gradient(170deg,#1a0a0f,#2d0a1e 30%,#3d1025 60%,#1a0a0f) !important; color:#f0d0d8 !important; }
                .blue-banner { background: linear-gradient(135deg,#8b0000,#c2185b,#d4a017,#c2185b,#8b0000) !important; background-size:300% auto !important; }
                .journal-title { color:#ffd700 !important; }
                .wanted-box, .right-col { background:rgba(40,5,20,0.85) !important; border-color:rgba(255,55,95,0.4) !important; }
                h2 { color:#ff8aa8 !important; border-bottom-color:rgba(255,55,95,0.5) !important; }
            `;
            doc.head.appendChild(s);
        }
    }

    function _previewBaseHref() {
        // Depuis index.html (racine) on simule un sous-dossier NNN/ pour que
        // les chemins ../shared/… et ../BF_news.png du template résolvent.
        const dir = location.pathname.replace(/[^/]*$/, '');
        return location.origin + dir + '000/';
    }

    /* ── UI ── */
    function ensureStyles() {
        if (document.getElementById('bcStyles')) return;
        const css = `
.bcx-overlay{position:fixed;inset:0;z-index:99990;background:rgba(5,5,18,0.55);backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;opacity:0;pointer-events:none;transition:opacity .35s}
.bcx-overlay.is-active{opacity:1;pointer-events:auto}
.bcx-panel{width:min(980px,100%);max-height:calc(100vh - 48px);overflow-y:auto;background:linear-gradient(165deg,rgba(30,30,60,0.82),rgba(14,14,32,0.92));border:1px solid rgba(255,255,255,0.12);border-radius:24px;color:#e8e8f5;font-family:Inter,sans-serif;box-shadow:0 32px 100px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.1),inset 0 -1px 0 rgba(0,0,0,0.3);backdrop-filter:blur(40px) saturate(1.6);-webkit-backdrop-filter:blur(40px) saturate(1.6)}
.bcx-head{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid rgba(255,255,255,0.08);position:sticky;top:0;background:linear-gradient(180deg,rgba(30,30,60,0.95),rgba(14,14,32,0.98));z-index:2;border-radius:24px 24px 0 0;backdrop-filter:blur(20px)}
.bcx-title{font-size:18px;font-weight:900;margin:0;letter-spacing:.3px;background:linear-gradient(135deg,#fff,#a8b4d8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.bcx-close{width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.05);color:#aaa;font-size:18px;cursor:pointer;backdrop-filter:blur(10px);transition:all .2s}
.bcx-close:hover{background:rgba(255,60,60,0.2);color:#ff6b6b;border-color:rgba(255,60,60,0.3)}
.bcx-body{padding:22px 24px 28px}
.bcx-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:720px){.bcx-grid{grid-template-columns:1fr}}
.bcx-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.bcx-field label{font-size:12px;font-weight:700;color:#9aa0b8;text-transform:uppercase;letter-spacing:.5px}
.bcx-field input,.bcx-field textarea,.bcx-field select{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 14px;color:#eee;font-family:Inter,sans-serif;font-size:14px;outline:none;backdrop-filter:blur(10px);transition:border-color .2s,background .2s,box-shadow .2s}
.bcx-field input:focus,.bcx-field textarea:focus{border-color:rgba(120,140,255,0.55);background:rgba(255,255,255,0.09);box-shadow:0 0 0 3px rgba(120,140,255,0.12)}
.bcx-field textarea{min-height:90px;resize:vertical;line-height:1.5}
.bcx-mdbar{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
.bcx-mdbar button{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.08);color:#ccc;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;backdrop-filter:blur(8px);transition:all .15s}
.bcx-mdbar button:hover{background:rgba(255,255,255,0.14);color:#fff;transform:translateY(-1px)}
.bcx-section{border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:18px;margin-bottom:18px;background:rgba(255,255,255,0.03);backdrop-filter:blur(16px) saturate(1.3);box-shadow:inset 0 1px 0 rgba(255,255,255,0.06),0 4px 24px rgba(0,0,0,0.15)}
.bcx-section h3{margin:0 0 12px;font-size:14px;font-weight:800;color:#aeb6d0;text-transform:uppercase;letter-spacing:.6px}
.bcx-checks{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0}
.bcx-check{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13.5px;color:#ccc;padding:8px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.03);backdrop-filter:blur(8px);transition:all .2s}
.bcx-check:hover{background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.12)}
.bcx-check input{accent-color:#7a8cff;width:16px;height:16px}
.bcx-theme-preview{width:100%;height:90px;border-radius:14px;border:2px solid rgba(255,255,255,0.1);margin-top:8px;display:flex;align-items:center;justify-content:center;font-family:LuckiestGuy,cursive;font-size:16px;letter-spacing:1px;transition:all .3s;backdrop-filter:blur(12px)}
.bcx-theme-preview.preview-halloween{background:linear-gradient(135deg,rgba(26,5,5,0.9),rgba(58,10,10,0.9),rgba(13,13,13,0.9));color:#ff9500;font-family:Creepster,cursive;border-color:rgba(255,106,0,0.5);text-shadow:0 0 14px #ff6a00;box-shadow:0 0 30px rgba(255,106,0,0.2)}
.bcx-theme-preview.preview-valentine{background:linear-gradient(135deg,rgba(139,0,0,0.9),rgba(194,24,91,0.9),rgba(212,160,23,0.9),rgba(194,24,91,0.9));color:#fff;text-shadow:0 0 12px rgba(255,20,80,0.6);border-color:rgba(255,48,96,0.5);box-shadow:0 0 30px rgba(255,20,80,0.2)}
.bcx-theme-preview.preview-default{background:linear-gradient(135deg,rgba(23,94,194,0.85),rgba(41,128,212,0.85),rgba(23,94,194,0.85));color:#fff;box-shadow:0 0 30px rgba(23,94,194,0.15)}
.bcx-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.bcx-btn{border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:12px 22px;font-weight:800;font-size:13px;cursor:pointer;font-family:Inter,sans-serif;transition:all .2s;backdrop-filter:blur(12px);position:relative;overflow:hidden}
.bcx-btn::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.15),transparent 50%);opacity:0;transition:opacity .2s}
.bcx-btn:hover::before{opacity:1}
.bcx-btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.25)}
.bcx-btn:active{transform:translateY(0)}
.bcx-btn--primary{background:linear-gradient(135deg,rgba(255,218,0,0.95),rgba(255,194,0,0.95));color:#000;border-color:rgba(255,218,0,0.3);box-shadow:0 4px 20px rgba(255,218,0,0.3)}
.bcx-btn--ghost{background:rgba(255,255,255,0.07);color:#ddd}
.bcx-btn--danger{background:linear-gradient(135deg,rgba(198,40,40,0.9),rgba(229,57,53,0.9));color:#fff;border-color:rgba(255,80,80,0.2)}
.bcx-btn:disabled{opacity:.45;cursor:not-allowed;transform:none!important}
.bcx-status{margin-top:14px;font-size:13px;color:#8ea0c0;min-height:18px;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);backdrop-filter:blur(8px)}
.bcx-status.ok{color:#6fcf97;border-color:rgba(111,207,151,0.2);background:rgba(111,207,151,0.06)}
.bcx-status.err{color:#ff7b7b;border-color:rgba(255,123,123,0.2);background:rgba(255,123,123,0.06)}
.bcx-preview-wrap{margin-top:18px;border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.2)}
.bcx-preview-bar{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.07);font-size:12px;color:#99a;backdrop-filter:blur(8px)}
.bcx-preview-frame{width:100%;height:420px;border:none;display:block;background:#f5f6fa}
.bcx-imglabel{display:inline-flex;align-items:center;gap:6px;margin-top:4px;font-size:12px;color:#8890a8}
.bcx-imglabel img{width:36px;height:36px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,0.15)}
`;
        const st = document.createElement('style');
        st.id = 'bcStyles';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function mdBar(targetId) {
        return `<div class="bcx-mdbar">
            <button type="button" onclick="_bcMd('${targetId}','**')">Gras</button>
            <button type="button" onclick="_bcMd('${targetId}','*')">Ital</button>
            <button type="button" onclick="_bcMd('${targetId}','__')">Soul</button>
            <button type="button" onclick="_bcMd('${targetId}','~~')">Barré</button>
            <button type="button" onclick="_bcMd('${targetId}','hl')">Surligner</button>
            <button type="button" onclick="_bcMd('${targetId}','color')">Couleur</button>
        </div>`;
    }

    window._bcMd = function (id, token) {
        const ta = document.getElementById(id);
        if (ta) applyMdToken(ta, token);
    };

    let _bcState = { theme: null, sections: [] };

    function buildFormHtml(nextNum) {
        const today = new Date().toISOString().slice(0, 10);
        return `
<div class="bcx-head">
    <h2 class="bcx-title">📝 Créer un bulletin</h2>
    <button class="bcx-close" onclick="BulletinCreator.close()" aria-label="Fermer">✕</button>
</div>
<div class="bcx-body">
    <div class="bcx-grid">
        <div class="bcx-field">
            <label for="bcNum">Numéro</label>
            <input id="bcNum" type="number" min="1" max="999" value="${nextNum}">
        </div>
        <div class="bcx-field">
            <label for="bcDate">Date de publication</label>
            <input id="bcDate" type="date" value="${today}">
        </div>
        <div class="bcx-field">
            <label for="bcBanner">Texte du bandeau</label>
            <input id="bcBanner" type="text" placeholder="The Blox Bulletin #${fmtNum(nextNum)}">
        </div>
        <div class="bcx-field">
            <label for="bcJournal">Titre journal</label>
            <input id="bcJournal" type="text" value="The Blox Bulletin">
        </div>
        <div class="bcx-field" style="grid-column:1/-1">
            <label for="bcSubtitle">Sous-titre</label>
            <input id="bcSubtitle" type="text" placeholder="Un chapitre s'ouvre…">
        </div>
        <div class="bcx-field">
            <label for="bcAuthor">Auteur principal</label>
            <input id="bcAuthor" type="text" value="BloxNews">
        </div>
        <div class="bcx-field">
            <label for="bcHero">Image à la une (hero)</label>
            <input id="bcHero" type="file" accept="image/*">
            <span class="bcx-imglabel" id="bcHeroLabel"></span>
        </div>
    </div>

    <div class="bcx-section">
        <h3>✨ Carte spéciale (index + thème du bulletin)</h3>
        <div class="bcx-checks">
            <label class="bcx-check"><input type="checkbox" id="bcThemeHalloween"> 🎃 Halloween</label>
            <label class="bcx-check"><input type="checkbox" id="bcThemeValentine"> ❤️ Saint-Valentin</label>
            <label class="bcx-check"><input type="checkbox" id="bcThemeNone" checked> ⬜ Standard</label>
        </div>
        <div class="bcx-theme-preview preview-default" id="bcThemePreview">THE BLOX BULLETIN</div>
    </div>

    <div class="bcx-section">
        <h3>📌 À la une (wanted-box)</h3>
        <div class="bcx-field">
            <label for="bcWantedTitle">Titre</label>
            <input id="bcWantedTitle" type="text" placeholder="L'ÎLE TORTUE ASSIÉGÉE…">
        </div>
        <div class="bcx-field">
            <label for="bcWantedAuthor">Par</label>
            <input id="bcWantedAuthor" type="text">
        </div>
        <div class="bcx-field">
            <label for="bcWantedImg">Image</label>
            <input id="bcWantedImg" type="file" accept="image/*">
            <span class="bcx-imglabel" id="bcWantedImgLabel"></span>
        </div>
        <div class="bcx-field">
            <label for="bcWantedBody">Corps (markdown-lite)</label>
            ${mdBar('bcWantedBody')}
            <textarea id="bcWantedBody" placeholder="**Gras**, *ital*, ==surligné==, [#hex]couleur[/]"></textarea>
        </div>
        <div class="bcx-field">
            <label for="bcWantedSummary">Résumé</label>
            <input id="bcWantedSummary" type="text">
        </div>
    </div>

    <div class="bcx-section">
        <h3>📰 Articles (colonnes)</h3>
        <div id="bcArticles"></div>
        <button class="bcx-btn bcx-btn--ghost" type="button" onclick="BulletinCreator.addArticle()">+ Ajouter un article</button>
    </div>

    <div class="bcx-section">
        <h3>🧩 Colonne latérale (right-col)</h3>
        <div class="bcx-field">
            <label for="bcSideTitle">Titre</label>
            <input id="bcSideTitle" type="text">
        </div>
        <div class="bcx-field">
            <label for="bcSideAuthor">Par</label>
            <input id="bcSideAuthor" type="text">
        </div>
        <div class="bcx-field">
            <label for="bcSideImg">Image</label>
            <input id="bcSideImg" type="file" accept="image/*">
            <span class="bcx-imglabel" id="bcSideImgLabel"></span>
        </div>
        <div class="bcx-field">
            <label for="bcSideBody">Corps (markdown-lite)</label>
            ${mdBar('bcSideBody')}
            <textarea id="bcSideBody"></textarea>
        </div>
        <div class="bcx-field">
            <label for="bcSideSummary">Résumé</label>
            <input id="bcSideSummary" type="text">
        </div>
    </div>

    <div class="bcx-section">
        <h3>🟡 Encadré (yellow-box)</h3>
        <div class="bcx-field">
            <label for="bcBoxTitle">Titre</label>
            <input id="bcBoxTitle" type="text" placeholder="ACHETEZ MAINTENANT – …">
        </div>
        <div class="bcx-field">
            <label for="bcBoxImg">Image</label>
            <input id="bcBoxImg" type="file" accept="image/*">
            <span class="bcx-imglabel" id="bcBoxImgLabel"></span>
        </div>
        <div class="bcx-field">
            <label for="bcBoxBody">Corps (markdown-lite)</label>
            ${mdBar('bcBoxBody')}
            <textarea id="bcBoxBody"></textarea>
        </div>
        <div class="bcx-field">
            <label for="bcBoxSummary">Résumé</label>
            <input id="bcBoxSummary" type="text">
        </div>
    </div>

    <div class="bcx-actions">
        <button class="bcx-btn bcx-btn--ghost" type="button" onclick="BulletinCreator.preview()">👁 Aperçu</button>
        <button class="bcx-btn bcx-btn--primary" type="button" id="bcPublishBtn" onclick="BulletinCreator.publish()">🚀 Publier le bulletin</button>
    </div>
    <div class="bcx-status" id="bcStatus"></div>

    <div class="bcx-preview-wrap">
        <div class="bcx-preview-bar"><span>Aperçu (design standard)</span><span id="bcPreviewMeta"></span></div>
        <iframe class="bcx-preview-frame" id="bcPreviewFrame" title="Aperçu bulletin"></iframe>
    </div>
</div>`;
    }

    function articleRowHtml(i) {
        return `
<div class="bcx-section bcx-article" data-i="${i}" style="background:rgba(120,140,255,0.04)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">Article ${i + 1}</h3>
        <button type="button" class="bcx-btn bcx-btn--danger" style="padding:6px 12px;font-size:12px" onclick="BulletinCreator.removeArticle(${i})">Retirer</button>
    </div>
    <div class="bcx-grid">
        <div class="bcx-field">
            <label>Titre</label>
            <input type="text" class="bc-art-title" placeholder="Questions aux Développeurs">
        </div>
        <div class="bcx-field">
            <label>Par</label>
            <input type="text" class="bc-art-author">
        </div>
        <div class="bcx-field" style="grid-column:1/-1">
            <label>Image</label>
            <input type="file" class="bc-art-img" accept="image/*">
            <span class="bcx-imglabel bc-art-imglabel"></span>
        </div>
    </div>
    <div class="bcx-field">
        <label>Corps (markdown-lite)</label>
        ${mdBar('bcArtBody' + i)}
        <textarea id="bcArtBody${i}" class="bc-art-body"></textarea>
    </div>
    <div class="bcx-field">
        <label>Résumé</label>
        <input type="text" class="bc-art-summary">
    </div>
</div>`;
    }

    function collectForm() {
        const num = parseInt(document.getElementById('bcNum').value, 10);
        const heroFile = document.getElementById('bcHero').files[0] || null;
        const heroPreview = heroFile ? URL.createObjectURL(heroFile) : null;
        const articles = [...document.querySelectorAll('.bcx-article')].map(row => {
            const file = row.querySelector('.bc-art-img').files[0] || null;
            return {
                title: row.querySelector('.bc-art-title').value.trim(),
                author: row.querySelector('.bc-art-author').value.trim(),
                body: row.querySelector('.bc-art-body').value,
                summary: row.querySelector('.bc-art-summary').value.trim(),
                file,
                image: file ? URL.createObjectURL(file) : null
            };
        });
        const wantedFile = document.getElementById('bcWantedImg').files[0] || null;
        const sideFile = document.getElementById('bcSideImg').files[0] || null;
        const boxFile = document.getElementById('bcBoxImg').files[0] || null;
        return {
            num,
            date: document.getElementById('bcDate').value,
            bannerText: document.getElementById('bcBanner').value.trim(),
            journalTitle: document.getElementById('bcJournal').value.trim(),
            subtitle: document.getElementById('bcSubtitle').value.trim(),
            author: document.getElementById('bcAuthor').value.trim(),
            theme: _bcState.theme || null,
            heroFile,
            heroPreview,
            heroImg: heroPreview,
            wanted: {
                title: document.getElementById('bcWantedTitle').value.trim(),
                author: document.getElementById('bcWantedAuthor').value.trim(),
                body: document.getElementById('bcWantedBody').value,
                summary: document.getElementById('bcWantedSummary').value.trim(),
                image: wantedFile ? URL.createObjectURL(wantedFile) : null,
                file: wantedFile
            },
            articles,
            side: {
                title: document.getElementById('bcSideTitle').value.trim(),
                author: document.getElementById('bcSideAuthor').value.trim(),
                body: document.getElementById('bcSideBody').value,
                summary: document.getElementById('bcSideSummary').value.trim(),
                image: sideFile ? URL.createObjectURL(sideFile) : null,
                file: sideFile
            },
            box: {
                title: document.getElementById('bcBoxTitle').value.trim(),
                body: document.getElementById('bcBoxBody').value,
                summary: document.getElementById('bcBoxSummary').value.trim(),
                image: boxFile ? URL.createObjectURL(boxFile) : null,
                file: boxFile
            }
        };
    }

    function setStatus(msg, kind) {
        const el = document.getElementById('bcStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'bcx-status' + (kind ? ' ' + kind : '');
    }

    function wireThemeChecks() {
        const h = document.getElementById('bcThemeHalloween');
        const v = document.getElementById('bcThemeValentine');
        const n = document.getElementById('bcThemeNone');
        const prev = document.getElementById('bcThemePreview');
        function sync(source) {
            if (source === 'h') { v.checked = false; n.checked = false; }
            else if (source === 'v') { h.checked = false; n.checked = false; }
            else if (source === 'n') { h.checked = false; v.checked = false; }
            if (!h.checked && !v.checked) n.checked = true;
            _bcState.theme = h.checked ? 'halloween' : (v.checked ? 'valentine' : null);
            prev.className = 'bcx-theme-preview preview-' + (_bcState.theme || 'default');
            prev.textContent = _bcState.theme === 'halloween' ? '🎃 THE BLOX BULLETIN 👻'
                : _bcState.theme === 'valentine' ? '❤ THE BLOX BULLETIN ❤'
                : 'THE BLOX BULLETIN';
        }
        h.addEventListener('change', () => sync('h'));
        v.addEventListener('change', () => sync('v'));
        n.addEventListener('change', () => sync('n'));
    }

    function wireImgLabel(inputId, labelId) {
        const inp = document.getElementById(inputId);
        const lab = document.getElementById(labelId);
        if (!inp || !lab) return;
        inp.addEventListener('change', () => {
            const f = inp.files[0];
            if (!f) { lab.innerHTML = ''; return; }
            const url = URL.createObjectURL(f);
            lab.innerHTML = `<img src="${url}" alt=""> ${esc(f.name)} (${Math.round(f.size / 1024)} Ko)`;
        });
    }

    const API = {
        isOpen: false,

        open(nextNum) {
            ensureStyles();
            let ov = document.getElementById('bcxOverlay');
            if (!ov) {
                ov = document.createElement('div');
                ov.id = 'bcxOverlay';
                ov.className = 'bcx-overlay';
                ov.innerHTML = '<div class="bcx-panel" id="bcxPanel" role="dialog" aria-modal="true" aria-label="Créer un bulletin"></div>';
                document.body.appendChild(ov);
                ov.addEventListener('click', (e) => { if (e.target === ov) API.close(); });
                document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && API.isOpen) API.close(); });
            }
            const n = nextNum || (window.BLOX_LAST_BULLETIN || 25) + 1;
            document.getElementById('bcxPanel').innerHTML = buildFormHtml(n);
            _bcState = { theme: null, articles: [] };
            wireThemeChecks();
            wireImgLabel('bcHero', 'bcHeroLabel');
            wireImgLabel('bcWantedImg', 'bcWantedImgLabel');
            wireImgLabel('bcSideImg', 'bcSideImgLabel');
            wireImgLabel('bcBoxImg', 'bcBoxImgLabel');
            API.addArticle();
            ov.classList.add('is-active');
            API.isOpen = true;
            setStatus('');
        },

        close() {
            const ov = document.getElementById('bcxOverlay');
            if (ov) ov.classList.remove('is-active');
            API.isOpen = false;
        },

        addArticle() {
            const wrap = document.getElementById('bcArticles');
            if (!wrap) return;
            const i = wrap.querySelectorAll('.bcx-article').length;
            wrap.insertAdjacentHTML('beforeend', articleRowHtml(i));
        },

        removeArticle(i) {
            const row = document.querySelector(`.bcx-article[data-i="${i}"]`);
            if (row) row.remove();
        },

        async preview() {
            try {
                const form = collectForm();
                if (!form.num) { setStatus('Numéro invalide', 'err'); return; }
                const frame = document.getElementById('bcPreviewFrame');
                setStatus('Chargement de l’aperçu…');
                await renderPreview(frame, form);
                document.getElementById('bcPreviewMeta').textContent =
                    '#' + fmtNum(form.num) + (form.theme ? ' · ' + form.theme : ' · standard');
                setStatus('');
            } catch (e) {
                setStatus('Aperçu impossible : ' + e.message, 'err');
            }
        },

        async publish() {
            const btn = document.getElementById('bcPublishBtn');
            try {
                const form = collectForm();
                if (!form.num || form.num < 1) throw new Error('Numéro invalide');
                if (!form.wanted.title && !form.articles.some(a => a.title)) {
                    throw new Error('Ajoutez au moins un contenu (à la une ou article)');
                }
                setStatus('Génération des fichiers…');
                btn.disabled = true;
                const payload = await buildPayload(form);

                let result = null;
                try {
                    // Envoi fractionné : gitBase → gitBlob (ou chunked) → gitCommit
                    setStatus('Récupération de la base Git…');
                    const base = await callUpdateRelay('gitBase', {});
                    const entries = [];
                    let i = 0;
                    const CHUNK_LIMIT = 80000;
                    for (const file of payload.files) {
                        i++;
                        setStatus(`Envoi ${i}/${payload.files.length} : ${file.path}…`);
                        if (file.content.length <= CHUNK_LIMIT) {
                            const res = await callUpdateRelay('gitBlob', { file });
                            entries.push({ path: file.path, sha: res.sha });
                        } else {
                            const start = await callUpdateRelay('gitBlobStart', { path: file.path, encoding: file.encoding });
                            const content = file.content;
                            for (let off = 0; off < content.length; off += CHUNK_LIMIT) {
                                const chunk = content.slice(off, off + CHUNK_LIMIT);
                                await callUpdateRelay('gitBlobChunk', { uploadId: start.uploadId, chunk });
                            }
                            const fin = await callUpdateRelay('gitBlobFinish', { uploadId: start.uploadId });
                            entries.push({ path: file.path, sha: fin.sha });
                        }
                    }
                    setStatus('Création du commit…');
                    result = await callUpdateRelay('gitCommit', {
                        baseCommitSha: base.baseCommitSha,
                        baseTreeSha: base.baseTreeSha,
                        entries,
                        message: payload.theme
                            ? `bulletin: publie #${payload.num} (theme ${payload.theme})`
                            : `bulletin: publie #${payload.num}`,
                        num: payload.num,
                        theme: payload.theme
                    });
                } catch (chunkErr) {
                    // Fallback : ancienne méthode createBulletin (tout en un)
                    setStatus('Méthode alternative…');
                    result = await callUpdateRelay('createBulletin', {
                        num: payload.num,
                        theme: payload.theme,
                        files: payload.files
                    });
                }

                setStatus(`✅ Bulletin #${payload.num} publié ! ` + (result.commit ? `(commit ${result.commit.slice(0, 7)})` : ''), 'ok');
                if (result.commit) {
                    setTimeout(() => { window.location.href = './' + payload.num + '/bulletin-' + payload.num + '.html'; }, 1600);
                }
            } catch (e) {
                setStatus('❌ ' + e.message, 'err');
            } finally {
                btn.disabled = false;
            }
        }
    };

    window.BulletinCreator = API;
})();
