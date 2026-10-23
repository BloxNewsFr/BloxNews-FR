(function () {
    'use strict';

    const NUM = (window.location.pathname.match(/\/(\d{3})\//) || [])[1];
    if (!NUM) return;

    const PREFIX    = 'b' + NUM + '::';
    const IMG_P     = 'img::';
    const EDIT_KEY  = 'blox_content_edits_v1';
    const USER_KEY  = 'bloxbulletin_discord_user';
    const TOKEN_KEY = 'bloxbulletin_discord_token';
    const ADMIN_IDS = ['1503444854410317984', '775096691240992798'];
    const RELAY_URL = 'https://blox-update-relay.c9yz5m8pw6.workers.dev';
    const DB_URL    = 'https://blox-bulletin-comments-default-rtdb.europe-west1.firebasedatabase.app/content_edits.json';

    const SCOPE = 'main.bulletin-container, .journal-header';
    const TEXT_SELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', '.summary', '.wanted-subtitle', '.section-subtext', '.qa-user', '.qa-answer', '.journal-subtitle', '.byline'];
    const EXCLUDE = '.site-header, .social-share, .bulletin-pagination, .bulletin-comments, .back-button-container, .bulletin-engagement, .search-overlay, .mobile-nav-dropdown, .discord-dropdown, button, input, textarea, select, .logo, script, style';

    let _editMode = false;
    let _editEl   = null;
    let _editImgEl = null;
    let _appliedCache = {};

    function _isExcluded(el) {
        for (const sel of EXCLUDE.split(',')) {
            const s = sel.trim();
            if (s && (el.matches(s) || el.closest(s))) return true;
        }
        return false;
    }

    function _getDiscordUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
    }
    function _isAdmin() {
        const user = _getDiscordUser();
        return !!user && ADMIN_IDS.includes(String(user.id));
    }

    async function _relay(action, payload) {
        const session = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
        const token = typeof session === 'string' ? session : session?.token;
        if (!token) throw new Error('Reconnecte-toi avec Discord avant de publier.');
        const res = await fetch(RELAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, discordAccessToken: token, ...payload })
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || 'Relais indisponible (' + res.status + ').');
        return result;
    }

    function _loadLocal() {
        try { return JSON.parse(localStorage.getItem(EDIT_KEY)) || {}; } catch { return {}; }
    }
    function _saveLocal(obj) {
        try { localStorage.setItem(EDIT_KEY, JSON.stringify(obj)); } catch {}
    }
    function _encKey(path) {
        return encodeURIComponent(path).replace(/\./g, '%2E');
    }
    function _decKey(key) {
        try { return decodeURIComponent(key); } catch { return key; }
    }

    async function _fetchRemote() {
        const res = await fetch(DB_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('Firebase indisponible (' + res.status + ').');
        const data = await res.json().catch(() => ({}));
        const out = {};
        for (const [k, v] of Object.entries(data || {})) out[_decKey(k)] = v;
        return out;
    }

    async function _saveEdit(path, value) {
        const remote = await _fetchRemote();
        const local  = _loadLocal();
        const map    = { ...remote };
        for (const [k, v] of Object.entries(local)) {
            if (k.startsWith(PREFIX) && !(k in remote)) map[k] = v;
        }
        map[path] = value;
        const encoded = {};
        for (const [k, v] of Object.entries(map)) encoded[_encKey(k)] = v;
        await _relay('saveContentEdits', { edits: encoded });
        _saveLocal(map);
    }

    function _hexToInk(hex) {
        let value = String(hex || '').replace('#', '');
        if (value.length === 3) value = value.split('').map(c => c + c).join('');
        if (!/^[0-9a-fA-F]{6}$/.test(value)) return '#fff';
        const r = parseInt(value.slice(0, 2), 16), g = parseInt(value.slice(2, 4), 16), b = parseInt(value.slice(4, 6), 16);
        return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) > 0.62 ? '#211d18' : '#fff';
    }

    function _renderMarkdown(text) {
        if (!text) return '';
        let h = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        h = h.replace(/==\[#([0-9a-fA-F]{3,6})\](.+?)==/g,
            (m, color, txt) => `<mark style="color:${_hexToInk('#' + color)};background:#${color};padding:2px 8px;border-radius:4px;font-weight:bold">${txt}</mark>`);
        h = h.replace(/==(.+?)==/g,
            '<mark style="color:#cc0000;background:rgba(255,26,26,0.1);padding:2px 8px;border-radius:6px;font-weight:bold">$1</mark>');
        h = h.replace(/\[#([0-9a-fA-F]{3,8})\]([\s\S]+?)\[\/\]/g,
            (m, color, txt) => `<span style="color:#${color}">${txt}</span>`);
        h = h.replace(/__(.+?)__/g, '<u>$1</u>');
        h = h.replace(/~~(.+?)~~/g, '<s>$1</s>');
        h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
        h = h.replace(/\n/g, '<br>');
        return h;
    }

    function _getEditPath(el) {
        const parts = [];
        let cur = el;
        while (cur && cur !== document.body) {
            let tag = cur.tagName.toLowerCase();
            if (cur.id) { parts.unshift('#' + cur.id); break; }
            const parent = cur.parentNode;
            if (parent) {
                let idx = 0, total = 0;
                for (const child of parent.children) {
                    if (child.tagName !== cur.tagName) continue;
                    total++;
                    if (child === cur) idx = total;
                }
                if (total > 1) tag += ':nth(' + idx + ')';
            }
            parts.unshift(tag);
            cur = parent;
        }
        return parts.join('>');
    }

    function _resolve(path) {
        try { return document.querySelector(path.replace(/:nth\((\d+)\)/g, ':nth-of-type($1)')); } catch { return null; }
    }

    function _applyLocal() {
        const edits = _loadLocal();
        for (const [key, value] of Object.entries(edits)) {
            if (!key.startsWith(PREFIX)) continue;
            const cacheKey = key;
            if (_appliedCache[cacheKey] === value) continue;
            const rest = key.slice(PREFIX.length);
            const isImg = rest.startsWith(IMG_P);
            const sel = isImg ? rest.slice(IMG_P.length) : rest;
            const el = _resolve(sel);
            if (!el) continue;
            if (isImg) {
                if (value && el.tagName === 'IMG' && el.getAttribute('src') !== value) el.src = value;
            } else {
                el.innerHTML = _renderMarkdown(value);
            }
            _appliedCache[cacheKey] = value;
        }
    }

    function _tagEditables() {
        const scopes = document.querySelectorAll(SCOPE);
        scopes.forEach(scope => {
            TEXT_SELS.forEach(sel => {
                scope.querySelectorAll(sel).forEach(el => {
                    if (el.dataset.beEditable === '1' || _isExcluded(el)) return;
                    el.dataset.bePath = el.dataset.bePath || _getEditPath(el);
                    el.dataset.beEditable = '1';
                });
            });
            // Passe générique : tout élément avec du texte direct (divs custom
            // comme .blue-banner, .wanted-text, .journal-meta…) sauf s'il est
            // déjà couvert par un parent taggé.
            scope.querySelectorAll('*').forEach(el => {
                if (el.dataset.beEditable || _isExcluded(el)) return;
                const hasDirectText = [...el.childNodes].some(
                    n => n.nodeType === 3 && n.textContent.trim().length > 0
                );
                if (!hasDirectText) return;
                if (el.closest('[data-be-editable]')) return;
                el.dataset.bePath = el.dataset.bePath || _getEditPath(el);
                el.dataset.beEditable = '1';
            });
            scope.querySelectorAll('img').forEach(img => {
                if (img.dataset.beEditable === 'img' || _isExcluded(img)) return;
                img.dataset.bePath = img.dataset.bePath || _getEditPath(img);
                img.dataset.beEditable = 'img';
            });
        });
    }

    function _toast(msg, type) {
        const box = document.getElementById('beLog');
        if (!box) return;
        const line = document.createElement('div');
        line.className = 'be-log__line' + (type ? ' is-' + type : '');
        line.textContent = '› ' + msg;
        box.appendChild(line);
        while (box.childElementCount > 40) box.firstChild.remove();
        box.scrollTop = box.scrollHeight;
        const panel = document.getElementById('bePanel');
        if (panel && !panel.classList.contains('is-open')) panel.classList.add('is-open');
    }

    function _setMode(on) {
        _editMode = on;
        document.body.classList.toggle('edit-mode', on);
        const badge = document.getElementById('beBadge');
        if (badge) badge.textContent = on ? 'ACTIF' : 'INACTIF';
        if (on) {
            _tagEditables();
            _toast('Mode édition activé — clique sur un texte ou une image.', 'ok');
        } else {
            _closeText();
            _closeImg();
            _toast('Mode édition désactivé.', 'info');
        }
    }

    function _toggleMode() {
        if (!_isAdmin()) {
            _toast('Accès refusé — administrateurs uniquement.', 'err');
            return;
        }
        _setMode(!_editMode);
    }

    // ── Popups DOM ──────────────────────────────────────────────
    let _savedSel = null;
    let _hlColor = '#ffd000';
    let _textColor = '#ff5252';

    function _fmtWrap(marker) {
        const ta = document.getElementById('beTextarea');
        if (!ta) return;
        const s = _savedSel ? _savedSel.start : ta.selectionStart;
        const e = _savedSel ? _savedSel.end : ta.selectionEnd;
        _savedSel = null;
        const sel = ta.value.slice(s, e), before = ta.value.slice(0, s), after = ta.value.slice(e);
        if (sel) {
            ta.value = before + marker + sel + marker + after;
            ta.focus(); ta.setSelectionRange(s, e + marker.length * 2);
        } else {
            const ph = '…';
            ta.value = before + marker + ph + marker + after;
            ta.focus(); ta.setSelectionRange(s + marker.length, s + marker.length + ph.length);
        }
    }

    function _pickHlColor(hex) {
        const ta = document.getElementById('beTextarea');
        const s = _savedSel ? _savedSel.start : ta.selectionStart;
        const e = _savedSel ? _savedSel.end : ta.selectionEnd;
        _savedSel = null;
        const before = ta.value.slice(0, s), after = ta.value.slice(e), sel = ta.value.slice(s, e);
        const open = hex === '#ffd000' ? '==' : `==[#${hex.replace('#', '')}]`;
        if (sel) {
            ta.value = before + open + sel + '==' + after;
            ta.focus(); ta.setSelectionRange(s, e + open.length + 2);
        } else {
            const ph = '…';
            ta.value = before + open + ph + '==' + after;
            ta.focus(); ta.setSelectionRange(s + open.length, s + open.length + ph.length);
        }
    }

    function _pickTextColor(hex) {
        const ta = document.getElementById('beTextarea');
        const s = _savedSel ? _savedSel.start : ta.selectionStart;
        const e = _savedSel ? _savedSel.end : ta.selectionEnd;
        _savedSel = null;
        const before = ta.value.slice(0, s), after = ta.value.slice(e), sel = ta.value.slice(s, e);
        const open = `[#${hex.replace('#', '')}]`, close = '[/]';
        if (sel) {
            ta.value = before + open + sel + close + after;
            ta.focus(); ta.setSelectionRange(s, e + open.length + close.length);
        } else {
            const ph = '…';
            ta.value = before + open + ph + close + after;
            ta.focus(); ta.setSelectionRange(s + open.length, s + open.length + ph.length);
        }
    }

    function _openText(el, x, y) {
        _editEl = el;
        const popup = document.getElementById('beTextPopup');
        const ta = document.getElementById('beTextarea');
        const path = el.dataset.bePath || _getEditPath(el);
        const stored = _loadLocal()[PREFIX + path];
        if (stored !== undefined) ta.value = stored;
        else ta.value = el.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
        popup.classList.add('is-open');
        const pw = 330, ph = 210;
        popup.style.left = Math.min(x + 10, window.innerWidth - pw - 16) + 'px';
        popup.style.top  = Math.min(y + 10, window.innerHeight - ph - 16) + 'px';
        setTimeout(() => { ta.focus(); ta.select(); }, 0);
    }

    function _closeText() {
        _editEl = null;
        document.getElementById('beTextPopup')?.classList.remove('is-open');
    }

    function _saveText() {
        if (!_editEl) return;
        const raw = document.getElementById('beTextarea')?.value;
        if (raw === undefined) return;
        const text = raw.replace(/^[ \t]+|[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
        _editEl.innerHTML = _renderMarkdown(text);
        const path = PREFIX + (_editEl.dataset.bePath || _getEditPath(_editEl));
        _appliedCache[path] = text;
        const local = _loadLocal();
        local[path] = text;
        _saveLocal(local);
        _saveEdit(path, text).then(() => {
            _toast('Sauvegardé : "' + text.slice(0, 24) + '…"', 'ok');
        }).catch(err => {
            _toast('Échec sauvegarde : ' + (err?.message || err), 'err');
        });
        _closeText();
    }

    function _compressImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 1600;
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.width * scale));
                c.height = Math.max(1, Math.round(img.height * scale));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                let quality = 0.82;
                let out = c.toDataURL('image/jpeg', quality);
                while (out.length > 220_000 && quality > 0.35) {
                    quality -= 0.12;
                    out = c.toDataURL('image/jpeg', quality);
                }
                if (out.length > 250_000) reject(new Error('Image trop lourde même compressée.'));
                else resolve(out);
            };
            img.onerror = () => reject(new Error('Fichier image invalide.'));
            img.src = dataUrl;
        });
    }

    function _openImg(img, x, y) {
        _editImgEl = img;
        const popup = document.getElementById('beImgPopup');
        const preview = document.getElementById('beImgPreview');
        const urlInput = document.getElementById('beImgUrl');
        const stored = _loadLocal()[PREFIX + IMG_P + (img.dataset.bePath || _getEditPath(img))];
        const curSrc = stored || img.getAttribute('src') || '';
        preview.src = curSrc;
        urlInput.value = curSrc.startsWith('data:') ? '' : curSrc;
        urlInput.placeholder = curSrc.startsWith('data:') ? 'Image intégrée — colle une URL ou un fichier' : 'https://… ou image compressée';
        popup.classList.add('is-open');
        const pw = 320, ph = 250;
        popup.style.left = Math.min(x + 10, window.innerWidth - pw - 16) + 'px';
        popup.style.top  = Math.min(y + 10, window.innerHeight - ph - 16) + 'px';
    }

    function _closeImg() {
        _editImgEl = null;
        document.getElementById('beImgPopup')?.classList.remove('is-open');
        const fi = document.getElementById('beImgFile');
        if (fi) fi.value = '';
    }

    function _saveImg() {
        if (!_editImgEl) return;
        const src = (document.getElementById('beImgUrl')?.value || '').trim();
        if (!src) { _toast('Indique une URL ou choisis un fichier.', 'err'); return; }
        if (!/^(https?:\/\/|\.\/|\/|data:image\/)/i.test(src)) {
            _toast('Source invalide (https, chemin relatif ou data:image attendu).', 'err');
            return;
        }
        const img = _editImgEl;
        img.src = src;
        const path = PREFIX + IMG_P + (img.dataset.bePath || _getEditPath(img));
        _appliedCache[path] = src;
        const local = _loadLocal();
        local[path] = src;
        _saveLocal(local);
        _saveEdit(path, src).then(() => {
            _toast('Image sauvegardée.', 'ok');
        }).catch(err => {
            _toast('Échec sauvegarde image : ' + (err?.message || err), 'err');
        });
        _closeImg();
    }

    function _injectUi() {
        if (document.getElementById('beStyle')) return;
        const style = document.createElement('style');
        style.id = 'beStyle';
        style.textContent = `
            body.edit-mode [data-be-editable="1"] { outline: 1px dashed rgba(255,218,0,0.55); outline-offset: 2px; cursor: text; }
            body.edit-mode [data-be-editable="1"]:hover { outline-color: #ff1a1a; }
            body.edit-mode img[data-be-editable="img"] { outline: 2px dashed rgba(255,218,0,0.75); outline-offset: 2px; cursor: pointer; }
            body.edit-mode img[data-be-editable="img"]:hover { outline-color: #ff1a1a; }
            body.edit-mode .hero-image-wrapper::before, body.edit-mode .hero-image-wrapper::after { pointer-events: none; }
            #bePanel {
                position: fixed; bottom: 14px; left: 14px; z-index: 99990;
                background: rgba(14,14,22,0.97); backdrop-filter: blur(16px);
                border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
                padding: 10px 12px; width: 280px; max-width: 88vw;
                box-shadow: 0 12px 44px rgba(0,0,0,0.45); color: #fff;
                font-family: 'Inter', system-ui, sans-serif; display: none;
            }
            #bePanel.is-open { display: block; }
            #bePanelHeader { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
            #bePanelTitle { font-size: 12px; font-weight: 800; letter-spacing: 0.5px; flex: 1; }
            #beBadge {
                font-size: 9px; font-weight: 800; letter-spacing: 1px;
                background: rgba(255,218,0,0.15); color: #ffda00;
                border-radius: 6px; padding: 2px 6px;
            }
            #bePanelClose {
                background: none; border: none; color: rgba(255,255,255,0.5);
                cursor: pointer; font-size: 13px; padding: 2px 4px;
            }
            #bePanelClose:hover { color: #fff; }
            #beLog { max-height: 120px; overflow-y: auto; font-size: 11px; line-height: 1.5; }
            .be-log__line { color: rgba(255,255,255,0.55); }
            .be-log__line.is-ok { color: #6fdc8c; }
            .be-log__line.is-err { color: #ff6b6b; }
            .be-log__line.is-info { color: rgba(255,255,255,0.75); }
            .be-popup {
                position: fixed; z-index: 99992;
                background: rgba(14,14,22,0.98); backdrop-filter: blur(18px);
                border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
                padding: 12px 14px; width: 310px; max-width: 92vw;
                box-shadow: 0 16px 60px rgba(0,0,0,0.5);
                display: none; color: #fff;
                font-family: 'Inter', system-ui, sans-serif;
            }
            .be-popup.is-open { display: block; }
            .be-popup__label {
                font-size: 10px; text-transform: uppercase; letter-spacing: 1px;
                color: rgba(255,255,255,0.35); font-weight: 700; margin-bottom: 6px;
            }
            #beTextarea {
                width: 100%; border: 1px solid rgba(255,255,255,0.1);
                background: rgba(255,255,255,0.06); border-radius: 8px;
                padding: 8px 10px; color: #fff; font-size: 13px;
                font-family: 'Inter', sans-serif; outline: none; resize: vertical;
                min-height: 90px; box-sizing: border-box;
            }
            #beTextarea:focus { border-color: rgba(255,26,26,0.5); }
            .be-fmt { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; flex-wrap: wrap; }
            .be-fmt button {
                width: 26px; height: 26px; border: none; border-radius: 6px;
                background: rgba(255,255,255,0.08); color: #fff; font-size: 12px;
                cursor: pointer; font-family: 'Inter', sans-serif;
            }
            .be-fmt button:hover { background: rgba(255,255,255,0.16); }
            .be-fmt .be-dot { width: 13px; height: 13px; border-radius: 50%; display: inline-block; border: 1px solid rgba(255,255,255,0.3); }
            .be-fmt .be-fmt--hl { width: auto; padding: 0 7px; display: inline-flex; align-items: center; gap: 5px; }
            .be-fmt input[type="color"] {
                position: absolute; top: 0; left: 0;
                width: 1px; height: 1px; padding: 0; border: none; background: none;
                opacity: 0; pointer-events: none;
            }
            .be-fmt .be-hint { font-size: 9px; color: rgba(255,255,255,0.3); margin-left: auto; }
            .be-actions { display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end; }
            .be-btn {
                padding: 5px 14px; border-radius: 8px; border: none; font-size: 12px;
                font-weight: 700; cursor: pointer; font-family: 'Inter', sans-serif;
            }
            .be-btn--cancel { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.5); }
            .be-btn--cancel:hover { background: rgba(255,255,255,0.13); }
            .be-btn--save {
                background: linear-gradient(135deg, #ff1a1a, #cc0000);
                color: #fff; box-shadow: 0 3px 10px rgba(255,26,26,0.35);
            }
            #beImgPreview {
                width: 100%; height: 110px; object-fit: cover;
                border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
                margin-bottom: 8px; background: rgba(255,255,255,0.04);
            }
            #beImgUrl {
                width: 100%; border: 1px solid rgba(255,255,255,0.1);
                background: rgba(255,255,255,0.06); border-radius: 8px;
                padding: 7px 10px; color: #fff; font-size: 12px;
                font-family: 'Inter', sans-serif; outline: none; box-sizing: border-box;
            }
            #beImgUrl:focus { border-color: rgba(255,26,26,0.5); }
            .be-img-row { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
            .be-img-row .be-btn--save { margin-left: auto; }
            @media (max-width: 640px) {
                #bePanel { left: 8px; right: 8px; bottom: 8px; width: auto; }
                .be-popup {
                    left: 8px !important; right: 8px; top: auto !important; bottom: 8px;
                    width: auto; border-radius: 16px 16px 12px 12px;
                }
            }
        `;
        document.head.appendChild(style);

        document.body.insertAdjacentHTML('beforeend', `
            <div id="bePanel">
                <div id="bePanelHeader">
                    <span>✏️</span>
                    <span id="bePanelTitle">Mode Édition Bulletin #${NUM}</span>
                    <span id="beBadge">INACTIF</span>
                    <button id="bePanelClose" title="Fermer">✕</button>
                </div>
                <div id="beLog"></div>
            </div>
            <div id="beTextPopup" class="be-popup">
                <div class="be-popup__label">Modifier le texte</div>
                <div class="be-fmt" id="beFmtBar">
                    <button type="button" data-fmt="**" title="Gras"><b>B</b></button>
                    <button type="button" data-fmt="*" title="Italique"><i>I</i></button>
                    <button type="button" data-fmt="__" title="Souligné"><u>U</u></button>
                    <button type="button" data-fmt="~~" title="Barré"><s>S</s></button>
                    <button type="button" class="be-fmt--hl" id="beHlBtn" title="Surligné">
                        <span class="be-dot" id="beHlDot" style="background:#ffd000"></span>
                    </button>
                    <button type="button" class="be-fmt--hl" id="beTextColorBtn" title="Couleur du texte">
                        <span class="be-dot" id="beTextColorDot" style="background:#ff5252"></span>
                    </button>
                    <span class="be-hint">**gras** ==surligné== [#c]couleur[/]</span>
                    <input type="color" id="beHlColorInput" value="#ffd000">
                    <input type="color" id="beTextColorInput" value="#ff5252">
                </div>
                <textarea id="beTextarea" rows="5"></textarea>
                <div class="be-actions">
                    <button type="button" class="be-btn be-btn--cancel" id="beTextCancel">Annuler</button>
                    <button type="button" class="be-btn be-btn--save" id="beTextSave">Sauvegarder</button>
                </div>
            </div>
            <div id="beImgPopup" class="be-popup">
                <div class="be-popup__label">Changer l'image</div>
                <img id="beImgPreview" alt="">
                <input type="text" id="beImgUrl" placeholder="https://… ou image compressée">
                <div class="be-img-row">
                    <button type="button" class="be-btn be-btn--cancel" id="beImgFileBtn">Fichier…</button>
                    <input type="file" id="beImgFile" accept="image/*" style="display:none">
                    <button type="button" class="be-btn be-btn--cancel" id="beImgCancel">Annuler</button>
                    <button type="button" class="be-btn be-btn--save" id="beImgSave">Appliquer</button>
                </div>
            </div>
        `);

        document.getElementById('bePanelClose').addEventListener('click', () => {
            document.getElementById('bePanel').classList.remove('is-open');
        });

        const bar = document.getElementById('beFmtBar');
        bar.querySelectorAll('button[data-fmt]').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                const ta = document.getElementById('beTextarea');
                _savedSel = { start: ta.selectionStart, end: ta.selectionEnd };
            });
            btn.addEventListener('click', () => _fmtWrap(btn.dataset.fmt));
        });

        function _captureSel(e) {
            e.preventDefault();
            const ta = document.getElementById('beTextarea');
            _savedSel = { start: ta.selectionStart, end: ta.selectionEnd };
        }
        document.getElementById('beHlBtn').addEventListener('mousedown', _captureSel);
        document.getElementById('beTextColorBtn').addEventListener('mousedown', _captureSel);
        document.getElementById('beHlBtn').addEventListener('click', () => {
            if (!_savedSel) {
                const ta = document.getElementById('beTextarea');
                _savedSel = { start: ta.selectionStart, end: ta.selectionEnd };
            }
            document.getElementById('beHlColorInput').click();
        });
        document.getElementById('beTextColorBtn').addEventListener('click', () => {
            if (!_savedSel) {
                const ta = document.getElementById('beTextarea');
                _savedSel = { start: ta.selectionStart, end: ta.selectionEnd };
            }
            document.getElementById('beTextColorInput').click();
        });
        document.getElementById('beHlColorInput').addEventListener('change', e => {
            _hlColor = e.target.value;
            document.getElementById('beHlDot').style.background = _hlColor;
            _pickHlColor(_hlColor);
        });
        document.getElementById('beTextColorInput').addEventListener('change', e => {
            _textColor = e.target.value;
            document.getElementById('beTextColorDot').style.background = _textColor;
            _pickTextColor(_textColor);
        });

        document.getElementById('beTextCancel').addEventListener('click', _closeText);
        document.getElementById('beTextSave').addEventListener('click', _saveText);
        document.getElementById('beImgCancel').addEventListener('click', _closeImg);
        document.getElementById('beImgSave').addEventListener('click', _saveImg);
        document.getElementById('beImgFileBtn').addEventListener('click', () => {
            document.getElementById('beImgFile').click();
        });
        document.getElementById('beImgFile').addEventListener('change', e => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file || !_editImgEl) return;
            if (!file.type.startsWith('image/')) { _toast('Fichier refusé : uniquement des images.', 'err'); return; }
            const reader = new FileReader();
            reader.onload = ev => {
                _compressImage(ev.target.result).then(dataUrl => {
                    document.getElementById('beImgPreview').src = dataUrl;
                    document.getElementById('beImgUrl').value = dataUrl;
                    _toast('Image compressée — clique sur Appliquer.', 'info');
                }).catch(err => _toast(err.message, 'err'));
            };
            reader.readAsDataURL(file);
        });
    }

    // ── Événements ──────────────────────────────────────────────
    document.addEventListener('click', e => {
        if (!_editMode) return;
        if (e.target.closest('.be-popup') || e.target.closest('#bePanel')) return;
        const el = e.target.closest('[data-be-editable]');
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (el.dataset.beEditable === 'img') _openImg(el, e.clientX, e.clientY);
        else _openText(el, e.clientX, e.clientY);
    }, true);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (_editImgEl) { _closeImg(); return; }
            if (_editEl) { _closeText(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey && _editEl) {
            e.preventDefault(); _saveText(); return;
        }
        const ta = document.getElementById('beTextarea');
        if (_editEl && ta && document.activeElement === ta && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            const k = e.key.toLowerCase();
            const wraps = { b: '**', i: '*', u: '__' };
            if (wraps[k]) {
                e.preventDefault(); e.stopPropagation();
                _savedSel = { start: ta.selectionStart, end: ta.selectionEnd };
                _fmtWrap(wraps[k]);
            } else if (k === 'h') {
                e.preventDefault(); e.stopPropagation();
                if (!_savedSel) _savedSel = { start: ta.selectionStart, end: ta.selectionEnd };
                document.getElementById('beHlColorInput').click();
            }
        }
    });

    document.addEventListener('keydown', e => {
        if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e')) return;
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            // Dans le popup texte → surlignage (comme neo_bulletin)
            if (active.id === 'beTextarea') {
                e.preventDefault();
                if (!_savedSel) _savedSel = { start: active.selectionStart, end: active.selectionEnd };
                document.getElementById('beHlColorInput').click();
                return;
            }
            if (active.closest('.be-popup')) return;
            // Ne pas voler le raccourci si l'overlay de recherche est réellement ouvert
            const overlay = active.closest('.search-overlay');
            if (overlay && overlay.classList.contains('is-active')) return;
        }
        e.preventDefault();
        _toggleMode();
    });

    // ── Init ────────────────────────────────────────────────────
    function _init() {
        _injectUi();
        _applyLocal();
        _fetchRemote().then(remote => {
            const merged = { ..._loadLocal(), ...remote };
            _saveLocal(merged);
            if (!_editMode) _applyLocal();
        }).catch(() => {});
        if (_isAdmin()) {
            setTimeout(() => {
                const panel = document.getElementById('bePanel');
                if (panel) panel.classList.add('is-open');
                _toast('Ctrl+Shift+E pour activer le mode édition.', 'info');
            }, 1200);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
