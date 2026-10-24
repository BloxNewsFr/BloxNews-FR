/* Search shortcuts, notification center and cross-site search scopes */
.global-search-scopes { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin:14px 4px 0; }
.global-search-scopes a { color:rgba(255,255,255,.72); text-decoration:none; font:600 12px Inter,sans-serif; padding:8px 12px; border:1px solid rgba(255,255,255,.12); border-radius:999px; background:rgba(255,255,255,.05); transition:.18s ease; }
.global-search-scopes a:hover,.global-search-scopes a[aria-current="page"] { color:#fff; border-color:rgba(255,255,255,.28); background:rgba(255,255,255,.13); }

/* ── Cloche notification ── */
.site-notification { position:relative; display:inline-flex; align-items:center; }

.site-notification__trigger {
    position:relative; border:0; background:transparent; color:inherit; cursor:pointer;
    display:grid; place-items:center;
    width:36px; height:36px; border-radius:10px;
    transition:background .2s;
    padding:0 !important;
}
.site-notification__trigger:hover { background:rgba(0,0,0,0.07); }
html[data-theme="dark"] .site-notification__trigger:hover { background:rgba(255,255,255,0.10); }
html:not([data-theme="dark"]) .site-notification__trigger { color:#25263a; }
.site-notification__trigger .material-symbols-outlined { padding:0 !important; font-size:22px; }

/* Badge compteur */
.site-notification__badge {
    position:absolute; top:1px; right:0;
    min-width:17px; height:17px; padding:0 4px;
    display:grid; place-items:center;
    border-radius:999px;
    background:#ef2525; color:#fff;
    font:800 10px Inter,sans-serif;
    box-shadow:0 2px 9px rgba(239,37,37,.4);
}

/* ── Panneau ── */
.site-notification__panel {
    position:absolute; z-index:100001;
    right:0; top:calc(100% + 10px);
    width:min(340px,calc(100vw - 28px));
    max-height:min(480px,72vh);
    overflow:hidden;
    color:#f5f5fb;
    background:rgba(16,17,28,0.97);
    border:1px solid rgba(255,255,255,.13);
    border-radius:20px;
    box-shadow:0 24px 60px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04) inset;
    backdrop-filter:blur(28px) saturate(1.6);
    -webkit-backdrop-filter:blur(28px) saturate(1.6);
    display:none;
    flex-direction:column;
}
.site-notification.is-open .site-notification__panel { display:flex; animation:siteNotifIn .18s ease-out; }

/* En-tête panneau */
.site-notification__head {
    display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding:14px 16px 12px;
    border-bottom:1px solid rgba(255,255,255,.08);
    flex-shrink:0;
}
.site-notification__head strong {
    font:800 13px/1 Inter,sans-serif;
    letter-spacing:.2px;
    color:#fff;
}
.site-notification__read {
    border:1px solid rgba(255,255,255,.1); border-radius:8px;
    color:rgba(255,255,255,.55); background:rgba(255,255,255,.04);
    cursor:pointer; font:600 11px Inter,sans-serif;
    padding:5px 10px; transition:all .15s;
}
.site-notification__read:hover { background:rgba(255,255,255,.1); color:#fff; }

/* Liste scrollable */
.site-notification__list { overflow-y:auto; flex:1; padding:8px 8px 10px; }
.site-notification__list::-webkit-scrollbar { width:4px; }
.site-notification__list::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:4px; }

/* Item individuel */
.site-notification__item {
    display:flex; flex-direction:column; gap:4px;
    color:inherit; text-decoration:none;
    padding:10px 10px;
    border-radius:12px;
    transition:background .15s;
    border-bottom:none;
}
.site-notification__item:hover { background:rgba(255,255,255,.07); }
.site-notification__item + .site-notification__item { border-top:1px solid rgba(255,255,255,.05); }

.site-notification__item b {
    display:block;
    font:700 12px/1.35 Inter,sans-serif;
    color:#eef0fa;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.site-notification__item small {
    display:flex; align-items:center; gap:6px;
    color:rgba(255,255,255,.38); font:500 10px Inter,sans-serif;
}
/* Puce source colorée */
.site-notification__item small::before {
    content:''; display:inline-block;
    width:6px; height:6px; border-radius:50%; flex-shrink:0;
    background:rgba(255,218,0,.7);
}

.site-notification__empty {
    padding:20px 12px 12px;
    color:rgba(255,255,255,.38);
    font:500 12px Inter,sans-serif;
    text-align:center; line-height:1.5;
}

@keyframes siteNotifIn { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }

@media(max-width:600px) {
    .site-notification__panel { right:-48px; }
    .global-search-scopes { gap:6px; }
    .global-search-scopes a { font-size:11px; padding:7px 10px; }
}