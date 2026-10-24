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
    widget.innerHTML = `<button class="site-notification__trigger" type="button" aria-label="Notifications" aria-expanded="false" title="Notifications"><span class="material-symbols-outlined" aria-hidden="true">notifications</span><span class="site-notification__badge" hidden></span></button><section class="site-notification__panel" aria-label="Notifications"><div class="site-notification__head"><strong>Dernières nouveautés</strong><button class="site-notification__read" type="button">Tout marquer comme lu</button></div><div class="site-notification__list"></div></section>`;
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
    trigger.addEventListener('click', event => { event.stopPropagation(); const open = widget.classList.toggle('is-open'); trigger.setAttribute('aria-expanded',String(open)); if (open) { const state=getState(); state.seen=Date.now(); saveState(state); render(); } });
    widget.querySelector('.site-notification__read').addEventListener('click', () => { const state=getState(); state.seen=Date.now(); saveState(state); render(); });
    document.addEventListener('click', event => { if (!widget.contains(event.target)) { widget.classList.remove('is-open'); trigger.setAttribute('aria-expanded','false'); } });
    let state = getState();
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

  ready(() => { initSearch(); initNotifications(); });
})();
