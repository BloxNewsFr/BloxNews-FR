(() => {
  const page = location.pathname.split('/').pop() || 'index.html';
  const routes = [
    { file: 'index.html', label: 'Actualités' },
    { file: 'neo_bulletin.html', label: 'Leaks' },
    { file: 'archives.html', label: 'Archives' },
  ];
  const safe = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ready = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once:true }) : fn();

  function initSearch() {
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (typeof window.openSearch === 'function') window.openSearch();
        else document.getElementById('archiveJump')?.focus();
      }
    });
    const overlay = document.getElementById('searchOverlay');
    const container = overlay?.querySelector('.search-container');
    if (!overlay || !container) {
      const query = new URLSearchParams(location.search).get('q');
      const archiveInput = document.getElementById('archiveJump');
      if (query && archiveInput) { archiveInput.value = query; archiveInput.dispatchEvent(new Event('input', { bubbles:true })); }
      return;
    }
    if (!container.querySelector('.global-search-scopes')) {
      const scopes = document.createElement('nav');
      scopes.className = 'global-search-scopes';
      scopes.setAttribute('aria-label', 'Chercher dans une section');
      scopes.innerHTML = routes.map(r => `<a href="./${r.file}" data-route="${r.file}">${r.label}</a>`).join('');
      container.append(scopes);
      scopes.addEventListener('click', event => {
        const link = event.target.closest('a[data-route]');
        if (!link) return;
        const q = document.getElementById('searchInput')?.value.trim();
        if (q) { event.preventDefault(); location.href = `./${link.dataset.route}?q=${encodeURIComponent(q)}`; }
      });
    }
    const current = container.querySelector(`[data-route="${CSS.escape(page)}"]`);
    current?.setAttribute('aria-current','page');
    const query = new URLSearchParams(location.search).get('q');
    if (query) {
      const input = document.getElementById('searchInput');
      if (input && typeof window.executeSearch === 'function') {
        input.value = query;
        window.executeSearch();
      }
    }
    if (page === 'neo_bulletin.html') {
      const params = new URLSearchParams(location.search);
      const category = params.get('category'), cardId = params.get('card');
      if (category && /^cat-[a-z0-9-]+$/.test(category)) setTimeout(() => {
        document.querySelector(`.leaks-tab[data-target="${CSS.escape(category)}"]`)?.click();
        if (cardId) setTimeout(() => { const card=document.getElementById(cardId); card?.scrollIntoView({behavior:'smooth',block:'center'}); }, 450);
      }, 100);
    }
  }

  const STORAGE = 'bloxsite_notifications_v1';
  function getState() { try { return JSON.parse(localStorage.getItem(STORAGE) || '{"knownByPage":{},"items":[],"seen":0}'); } catch { return {knownByPage:{},items:[],seen:0}; } }
  function saveState(s) { try { localStorage.setItem(STORAGE, JSON.stringify(s)); } catch {} }
  function collectContent() {
    const out = [];
    if (page === 'index.html') {
      document.querySelectorAll('.news-grid .news-card, .bulletin-card, .news-card, [data-num]').forEach((el, i) => {
        const title = el.querySelector('.news-card__title, h2, h3, .card-title')?.textContent.trim() || el.getAttribute('aria-label') || el.dataset.num;
        const link = el.matches('a[href]') ? el.href : el.querySelector('a[href]')?.href;
        if (title && link) out.push({ id:`news:${link}`, title, href:link, source:'Actualités' });
      });
      document.querySelectorAll('.bulletin-card a[href], a.bulletin-card[href], .news-card a[href]').forEach(a => {
        // On privilégie le titre de la carte ; le lien peut n'être qu'un bouton
        // (« Lire maintenant → ») et ne doit jamais devenir le libellé.
        const card = a.closest('.news-card, .bulletin-card, article') || a;
        const title = card.querySelector('.news-card__title, h2, h3, .card-title')?.textContent.trim() || a.textContent.trim().slice(0,90);
        if (title) out.push({id:`news:${a.href}`,title,href:a.href,source:'Actualités'});
      });
    } else if (page === 'neo_bulletin.html') {
      document.querySelectorAll('#neoTabsAndSections .category-section .news-card, #neoTabsAndSections .category-section .group-card, #neoTabsAndSections .category-section .secret-bulletin').forEach(el => {
        const title = el.querySelector('.news-card__title, .group-card__title, .bulletin-header h2, h2')?.textContent.trim();
        if (title) {
          const section=el.closest('.category-section');
          const href=`./neo_bulletin.html?category=${encodeURIComponent(section?.id || '')}&card=${encodeURIComponent(el.id || '')}`;
          out.push({ id:`leak:${el.id || el.dataset.ccId || title}`, title, href, source:'Leaks' });
        }
      });
    }
    // Déduplication : on garde la PREMIÈRE occurrence (titre de carte),
    // pas la dernière (qui peut être un bouton).
    const byId = new Map();
    out.forEach(item => { if (!byId.has(item.id)) byId.set(item.id, item); });
    return [...byId.values()];
  }
  function initNotifications() {
    const icons = document.querySelector('.site-header__icons');
    if (!icons || icons.querySelector('.site-notification')) return;
    const widget = document.createElement('div');
    widget.className = 'site-notification';
    widget.innerHTML = `<button class="site-notification__trigger" type="button" aria-label="Notifications" aria-expanded="false" title="Notifications" style="all:unset;position:relative;cursor:pointer;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;transition:background .2s;flex-shrink:0;box-sizing:border-box"><span class="material-symbols-outlined" aria-hidden="true" style="font-size:22px;line-height:1;padding:0;transform:none;display:block">notifications</span><span class="site-notification__badge" hidden></span></button><section class="site-notification__panel" aria-label="Notifications"><div class="site-notification__head"><strong>Dernières nouveautés</strong><button class="site-notification__read" type="button">Tout marquer comme lu</button></div><div class="site-notification__list"></div></section>`;
    icons.prepend(widget);
    const trigger = widget.querySelector('button');
    const panel = widget.querySelector('.site-notification__panel');
    const render = () => {
      const state = getState();
      const unread = Math.max(0, state.items.filter(item => item.created > state.seen).length);
      const badge = widget.querySelector('.site-notification__badge');
      badge.hidden = !unread;
      badge.textContent = unread > 9 ? '9+' : String(unread);
      const list = widget.querySelector('.site-notification__list');
      list.innerHTML = state.items.length ? state.items.slice(0,12).map(item => `<a class="site-notification__item" href="${safe(item.href)}"><b>${safe(item.title)}</b><small>${safe(item.source)} · ${new Date(item.created).toLocaleDateString('fr-FR')}</small></a>`).join('') : '<div class="site-notification__empty">Tu es à jour. Les nouveaux contenus apparaîtront ici.</div>';
    };
    trigger.addEventListener('click', event => { event.stopPropagation(); const open = widget.classList.toggle('is-open'); trigger.setAttribute('aria-expanded',String(open)); if (open) render(); });
    widget.querySelector('.site-notification__read').addEventListener('click', () => { const state=getState(); state.seen=Date.now(); saveState(state); render(); });
    document.addEventListener('click', event => { if (!widget.contains(event.target)) { widget.classList.remove('is-open'); trigger.setAttribute('aria-expanded','false'); } });
    let state = getState();
    if (state.readModeVersion !== 2) {
      state.seen = 0;
      state.readModeVersion = 2;
    }
    const inventory = collectContent();
    state.knownByPage ||= {};
    const firstNeoVisit = page === 'neo_bulletin.html' && !Array.isArray(state.knownByPage[page]);
    if (firstNeoVisit) state.knownByPage[page] = null;
    else if (!Array.isArray(state.knownByPage[page])) state.knownByPage[page] = inventory.map(item => item.id);
    else {
      const known = new Set(state.knownByPage[page]);
      const fresh = inventory.filter(item => !known.has(item.id));
      state.items = [...fresh.map(item => ({...item,created:Date.now()})), ...(state.items || [])].slice(0,30);
      state.knownByPage[page] = [...new Set([...state.knownByPage[page],...inventory.map(item => item.id)])].slice(-1000);
    }
    saveState(state); render();
    const watchRoot = page === 'neo_bulletin.html' ? document.getElementById('neoTabsAndSections') : page === 'index.html' ? document.getElementById('news-grid') : null;
    const watch = () => {
      if (!watchRoot) return;
      new MutationObserver(() => {
        const current = collectContent(); const snapshot = getState(); snapshot.knownByPage ||= {}; const known = new Set(snapshot.knownByPage[page] || []);
        const fresh = current.filter(item => !known.has(item.id));
        if (fresh.length) { snapshot.items=[...fresh.map(item=>({...item,created:Date.now()})),...(snapshot.items||[])].slice(0,30); snapshot.knownByPage[page]=[...new Set([...known,...current.map(item=>item.id)])].slice(-1000); saveState(snapshot); render(); }
      }).observe(watchRoot,{childList:true,subtree:true});
    };
    if (firstNeoVisit && watchRoot) {
      setTimeout(() => { const baseline=getState(); baseline.knownByPage ||= {}; baseline.knownByPage[page]=collectContent().map(item=>item.id); saveState(baseline); watch(); }, 2200);
    } else watch();
  }

  // ── PWA : manifest + meta theme-color ──
  function initPWA() {
    // Manifest
    if (!document.querySelector('link[rel="manifest"]')) {
      const l = document.createElement('link');
      l.rel = 'manifest'; l.href = '/BloxNews-FR/manifest.json';
      document.head.appendChild(l);
    }
    // Theme color
    if (!document.querySelector('meta[name="theme-color"]')) {
      const m = document.createElement('meta');
      m.name = 'theme-color'; m.content = '#e20000';
      document.head.appendChild(m);
    }
    // Apple touch icon
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const a = document.createElement('link');
      a.rel = 'apple-touch-icon'; a.href = '/BloxNews-FR/icons/icon-192x192.png';
      document.head.appendChild(a);
    }
  }

  // ── Notifications push FCM ──
  // Clé publique Web Push du projet Firebase.
  const VAPID_PUBLIC_KEY = 'BDxYpmLmyw5GrZByri54qulYuyS-mfvCWMkw89xluUSzCOJChVLrhm7v_S74PUgMa1QII8-k1jSSDwAJ_5ITbBo';
  const FCM_STORAGE_KEY  = 'bloxsite_fcm_token_v1';
  const FCM_REGISTERED_KEY = 'bloxsite_fcm_registered_v1';
  let messagingScriptsPromise = null;
  let foregroundMessageBound = false;

  function appBasePath() {
    return location.pathname.startsWith('/BloxNews-FR/') ? '/BloxNews-FR/' : '/';
  }

  function loadClassicScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === src);
      if (existing?.dataset.loaded === 'true') { resolve(); return; }
      const script = existing || document.createElement('script');
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once:true });
      script.addEventListener('error', () => reject(new Error('Impossible de charger Firebase Messaging.')), { once:true });
      if (!existing) { script.src = src; script.async = true; document.head.appendChild(script); }
    });
  }

  async function loadFirebaseMessaging() {
    if (messagingScriptsPromise) return messagingScriptsPromise;
    messagingScriptsPromise = (async () => {
      if (!window.firebase) await loadClassicScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
      if (!window.firebase) throw new Error('Firebase ne s’est pas chargé.');
      if (!firebase.apps.length) firebase.initializeApp({
        apiKey: 'AIzaSyBkJsHWyoiEeqmEktUlgcED-8mBPnar_0w',
        authDomain: 'blox-bulletin-comments.firebaseapp.com',
        databaseURL: 'https://blox-bulletin-comments-default-rtdb.europe-west1.firebasedatabase.app',
        projectId: 'blox-bulletin-comments',
        storageBucket: 'blox-bulletin-comments.firebasestorage.app',
        messagingSenderId: '774633429491',
        appId: '1:774633429491:web:d1f534a0df346fbea79a86'
      });
      if (typeof firebase.messaging !== 'function') {
        await loadClassicScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');
      }
      if (typeof firebase.messaging !== 'function') throw new Error('Le module Firebase Messaging est indisponible.');
      return firebase.messaging();
    })().catch(error => { messagingScriptsPromise = null; throw error; });
    return messagingScriptsPromise;
  }

  async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('Les notifications push ne sont pas prises en charge par ce navigateur.');
    }
    if (Notification.permission !== 'granted') throw new Error('Autorise les notifications dans les réglages du navigateur.');

    try {
      // Enregistre le service worker
      const basePath = appBasePath();
      const reg = await navigator.serviceWorker.register(`${basePath}firebase-messaging-sw.js`, { scope: basePath });

      const messaging = window.firebaseMessaging || await loadFirebaseMessaging();
      window.firebaseMessaging = messaging;

      // Récupère le token FCM
      const token = await messaging.getToken({ vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: reg });
      if (!token) throw new Error('Firebase n’a pas fourni de jeton pour cet appareil.');

      // Réenregistre le jeton à chaque activation : cela répare aussi un ancien
      // jeton resté uniquement dans le stockage local après une erreur réseau.
      localStorage.setItem(FCM_STORAGE_KEY, token);
      const registerResponse = await fetch('https://blox-update-relay.c9yz5m8pw6.workers.dev', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'registerPushToken', token })
      });
      const registerResult = await registerResponse.json().catch(() => ({}));
      if (!registerResponse.ok || !registerResult.ok) throw new Error(registerResult.error || 'Le serveur n’a pas enregistré cet appareil.');
      localStorage.setItem(FCM_REGISTERED_KEY, '1');
      document.querySelector('.site-notification .site-notif-push-btn')?.remove();

      if (!foregroundMessageBound && typeof messaging.onMessage === 'function') {
        messaging.onMessage(payload => {
          const data = payload?.data || payload?.notification || {};
          if (Notification.permission === 'granted' && data.title) {
            const notice = new Notification(data.title, {
              body: data.body || 'Une nouveauté est disponible.',
              icon: data.icon || '/BloxNews-FR/icons/icon-192x192.png',
              data: { url: data.url || '/BloxNews-FR/index.html' }
            });
            notice.onclick = () => { window.focus(); location.href = notice.data.url; notice.close(); };
          }
        });
        foregroundMessageBound = true;
      }
      return true;
    } catch (err) {
      console.error('[PWA] Push init failed:', err.message);
      throw err;
    }
  }

  // Action discrète pour activer les notifications push
  function injectPushToggle(widget) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted' && localStorage.getItem(FCM_REGISTERED_KEY) === '1') return;
    const panel = widget.querySelector('.site-notification__panel');
    if (!panel || panel.querySelector('.site-notif-push-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'site-notif-push-btn';
    btn.type = 'button';
    btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">notifications_active</span><span>Recevoir les alertes</span><span class="site-notif-push-btn__arrow" aria-hidden="true">→</span>';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const label = btn.querySelector('span:nth-child(2)');
      const originalLabel = label?.textContent || 'Recevoir les alertes';
      try {
        const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (perm !== 'granted') throw new Error('Autorisation refusée. Modifie-la dans les réglages du navigateur.');
        await initPushNotifications();
        btn.remove();
      } catch (error) {
        if (label) label.textContent = error.message || 'Activation impossible';
        btn.disabled = false;
        btn.setAttribute('aria-label', error.message || 'Réessayer d’activer les alertes');
        setTimeout(() => { if (label?.isConnected) label.textContent = originalLabel; }, 5000);
      }
    });
    panel.querySelector('.site-notification__list').before(btn);
  }

  ready(() => {
    initPWA();
    initSearch();
    initNotifications();
    setTimeout(() => {
      const widget = document.querySelector('.site-notification');
      if (widget) injectPushToggle(widget);
      if ('Notification' in window && Notification.permission === 'granted') {
        initPushNotifications().catch(error => {
          console.warn('[PWA] Push re-registration failed:', error.message);
          localStorage.removeItem(FCM_REGISTERED_KEY);
          if (widget) injectPushToggle(widget);
        });
      }
    }, 500);
  });
})();
