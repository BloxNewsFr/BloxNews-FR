#!/usr/bin/env python3
"""
fetch_bulletin.py - Blox Fruits FR auto-bulletin
Utilise Google Gemini (gratuit) pour traduire les bulletins.
"""

import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
BLOG_URL       = "https://gamerrobot.com/blogs/news"
FEED_URL       = BLOG_URL + ".atom"
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MAX_NEW        = int(os.getenv("MAX_NEW_PER_RUN", "3"))
REPO_ROOT      = Path(__file__).resolve().parent
STATE          = REPO_ROOT / "sources.json"
INDEX          = REPO_ROOT / "index.html"
HEADERS        = {"User-Agent": "Mozilla/5.0 (compatible; BloxBulletinBot/1.0)"}
TIMEOUT        = 30
KEYWORDS: list[str] = []

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/{model}:generateContent?key={key}"

# ─────────────────────────────────────────────────────────────────────────────
# PROMPT
# ─────────────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Tu es le rédacteur principal du site BloxNewsFr, le média communautaire français dédié à Blox Fruits (Roblox). Tu reçois le contenu HTML brut d'un bulletin officiel en anglais publié par GamerRobot.

TA MISSION :
- Traduire fidèlement le bulletin en français, section par section, sans rien inventer.
- Adopter un ton dynamique, fluide et accrocheur, directement adressé aux joueurs.
- Utiliser le jargon communautaire français de Blox Fruits.
- Ajouter à la fin de chaque section un encadré résumé.

VOCABULAIRE OBLIGATOIRE (ne jamais traduire) :
Rework, Sneak peek, Teaser, Sea 1/2/3, Buff, Nerf, Stock, Dealer, Bounty, Honor, Stats, Build, Spam, Combo, Leak, Leaker, Race, Update, Fruit, Grinding, Farm, PvP, PvE

TON : tutoiement, enthousiaste mais clair, fidèle à l'original.

FORMAT DE SORTIE STRICT :
Ligne 1 : "TITRE: <titre FR accrocheur max 80 caractères>"
Ligne 2 : "SOUS_TITRE: <sous-titre FR court>"
Ligne 3 : "DATE_FR: <date en français, ex: 31 Juillet 2026>"
Ensuite uniquement du HTML avec <h2>, <p>, <ul>, <li>, <strong>, <em>.
À la fin de chaque section : <div class="summary"><b>📌 Résumé :</b> [résumé court]</div>
Pas de <html>, <body>, <h1>, pas de backticks Markdown."""

# ─────────────────────────────────────────────────────────────────────────────
# TEMPLATE HTML
# ─────────────────────────────────────────────────────────────────────────────
HTML_TEMPLATE = '''<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Neo Bulletin #{NUMBER} – {TITLE}</title>
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Blox Fruits News">
    <meta property="og:title" content="Neo Bulletin #{NUMBER} – {TITLE}">
    <meta property="og:description" content="Bulletin #{NUMBER} – Toute l'actualité Blox Fruits.">
    <meta property="og:image" content="https://bloxnewsfr.github.io/BloxNews-FR/{NUMBER}/img/{OG_IMAGE}">
    <meta property="og:url" content="https://bloxnewsfr.github.io/BloxNews-FR/{NUMBER}/bulletin-{NUMBER}.html">
    <meta property="og:locale" content="fr_FR">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/png" href="../shared/favicon.png">
    <link rel="shortcut icon" href="../shared/bf_logo.png" type="image/png">
    <link href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&family=Inter:wght@300;400;500;600;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0">
    <style>
        @font-face {{ font-family: \'LuckiestGuy Regular\'; src: url(\'../fonts/LuckiestGuy-Regular.ttf\') format(\'truetype\'); }}
        :root {{ --color-text: #333132; --color-primary: #ffda00; }}
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; font-family: \'Inter\', sans-serif; color: var(--color-text); background: #fff; min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }}
        .site-header {{ display: flex; align-items: center; justify-content: center; padding: 0 55px; position: sticky; top: 0; z-index: 1000; height: 72px; background: rgba(255,255,255,0.15); backdrop-filter: blur(50px) saturate(180%); -webkit-backdrop-filter: blur(50px) saturate(180%); border-top: 1px solid rgba(255,255,255,0.30); border-bottom: 1px solid rgba(255,255,255,0.08); box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset, 0 8px 32px rgba(0,0,0,0.08); }}
        .site-header__logo {{ position: absolute; left: 55px; }}
        .site-header__logo img {{ height: 42px; width: auto; display: block; }}
        .site-nav {{ display: flex; gap: 8px; padding: 0; margin: 0; list-style: none; }}
        .site-nav a {{ color: rgba(0,0,0,0.85); text-decoration: none; font-weight: 900; font-size: 17px; text-transform: uppercase; font-family: \'LuckiestGuy Regular\', cursive; padding: 8px 16px; border-radius: 10px; transition: background 0.2s; }}
        .site-nav a:hover {{ background: var(--color-primary); color: #000; }}
        .site-header__icons {{ display: flex; gap: 12px; color: rgba(0,0,0,0.85); cursor: pointer; align-items: center; position: absolute; right: 55px; }}
        .site-header__icons span {{ padding: 8px; border-radius: 10px; transition: background 0.2s; }}
        .mobile-menu-btn {{ display: none; }}
        .mobile-nav-dropdown, .mobile-nav-backdrop {{ display: none; }}
        @media (max-width: 768px) {{
            .site-header {{ padding: 0 16px; height: 60px; }}
            .site-header__logo {{ left: 16px; }}
            .site-header__logo img {{ height: 32px; }}
            .site-header__icons {{ right: 16px; gap: 6px; }}
            .site-nav {{ display: none; }}
            .mobile-menu-btn {{ display: block; }}
            .mobile-nav-dropdown {{ display: flex; flex-direction: column; position: fixed; top: 0; right: -85vw; bottom: 0; width: min(82vw,320px); background: rgba(10,10,20,0.96); backdrop-filter: blur(28px); z-index: 9991; transition: right 0.35s cubic-bezier(0.4,0,0.2,1); overflow-y: auto; gap: 0; }}
            .mobile-nav-dropdown.is-open {{ right: 0; }}
            .mnav-header {{ display: flex; align-items: center; justify-content: space-between; padding: 20px 18px 16px; border-bottom: 1px solid rgba(255,255,255,0.07); }}
            .mnav-header__title {{ font-family: \'LuckiestGuy Regular\', cursive; font-size: 20px; color: #fff; text-transform: uppercase; }}
            .mnav-close {{ width: 36px; height: 36px; border-radius: 50%; border: none; background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }}
            .mnav-links {{ display: flex; flex-direction: column; gap: 6px; padding: 14px; }}
            .mobile-nav-dropdown a.mnav-link {{ display: flex; align-items: center; gap: 14px; text-decoration: none; color: rgba(255,255,255,0.85); font-weight: 800; font-size: 15px; padding: 13px 16px; border-radius: 14px; transition: background 0.2s; }}
            .mnav-link__icon {{ font-size: 22px; color: rgba(255,255,255,0.4); flex-shrink: 0; }}
        }}
        .mobile-nav-backdrop {{ position: fixed; inset: 0; z-index: 9990; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); display: none; opacity: 0; transition: opacity 0.35s; }}
        .mobile-nav-backdrop.is-open {{ display: block; opacity: 1; }}
        .main-content {{ flex: 1; display: flex; flex-direction: column; align-items: center; }}
        .countdown-wrapper {{ width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; text-align: center; background: radial-gradient(ellipse at 50% 0%, rgba(255,218,0,0.06) 0%, transparent 50%); }}
        .soon-badge {{ font-family: \'LuckiestGuy Regular\', cursive; font-size: 18px; letter-spacing: 6px; color: var(--color-primary); text-transform: uppercase; margin-bottom: 8px; animation: soonPulse 2s ease-in-out infinite; }}
        @keyframes soonPulse {{ 0%,100%{{opacity:1}} 50%{{opacity:0.4}} }}
        .soon-title {{ font-family: \'LuckiestGuy Regular\', cursive; font-size: clamp(48px,12vw,96px); color: #111; margin: 0 0 16px; line-height: 1.1; }}
        .soon-subtitle {{ font-size: clamp(16px,3vw,22px); color: rgba(0,0,0,0.55); margin-bottom: 60px; }}
        .countdown {{ display: flex; gap: clamp(16px,4vw,40px); justify-content: center; flex-wrap: wrap; }}
        .countdown-item {{ display: flex; flex-direction: column; align-items: center; min-width: clamp(70px,14vw,140px); }}
        .countdown-number {{ font-size: clamp(48px,12vw,100px); font-weight: 900; color: #111; line-height: 1; background: rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.1); border-radius: 20px; padding: clamp(12px,3vw,28px) clamp(8px,2vw,20px); min-width: clamp(70px,14vw,140px); text-align: center; box-shadow: 0 0 40px rgba(255,218,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8); }}
        .countdown-label {{ font-size: clamp(11px,2vw,14px); font-weight: 600; color: rgba(0,0,0,0.5); text-transform: uppercase; letter-spacing: 3px; margin-top: 12px; }}
        .countdown-sep {{ font-size: clamp(36px,8vw,72px); font-weight: 900; color: rgba(0,0,0,0.2); align-self: center; padding-bottom: clamp(30px,6vw,56px); }}
        .cta-back {{ margin-top: 60px; display: inline-flex; align-items: center; gap: 10px; padding: 14px 32px; border-radius: 100px; background: var(--color-primary); color: #000; text-decoration: none; font-weight: 900; font-size: 15px; text-transform: uppercase; transition: all 0.25s; box-shadow: 0 4px 20px rgba(255,218,0,0.3); }}
        #countdown-section.hidden {{ opacity: 0; pointer-events: none; transition: opacity 0.6s; }}
        #bulletin-content {{ display: none; width: 100%; }}
        #bulletin-content.visible {{ display: block; animation: fadeInUp 0.8s ease forwards; }}
        @keyframes fadeInUp {{ from{{opacity:0;transform:translateY(20px)}} to{{opacity:1;transform:translateY(0)}} }}
        .bulletin-container {{ max-width: 1100px; margin: 40px auto; padding: 0 24px; }}
        @keyframes shimmerBanner {{ 0%{{background-position:0% center}} 100%{{background-position:200% center}} }}
        .blue-banner {{ display: block; text-align: center; background: linear-gradient(135deg,#175ec2,#2980d4,#175ec2); background-size: 200% auto; color: #fff; padding: 16px 60px; font-size: 36px; text-transform: uppercase; letter-spacing: 3px; border-radius: 100px; font-family: \'LuckiestGuy Regular\', cursive; box-shadow: 0 8px 32px rgba(23,94,194,0.45), inset 0 1px 0 rgba(255,255,255,0.2); animation: shimmerBanner 3s linear infinite; margin-bottom: 20px; }}
        .hero-image-wrapper {{ width: 100%; margin-bottom: 6px; }}
        .hero-image {{ width: 100%; height: auto; display: block; border-radius: 20px; box-shadow: 0 8px 30px rgba(0,0,0,0.1); cursor: zoom-in; }}
        .publish-date {{ font-size: 12px; color: rgba(0,0,0,0.4); margin-bottom: 18px; }}
        .journal-header {{ text-align: center; margin-top: 30px; }}
        .journal-title {{ font-family: \'LuckiestGuy Regular\', cursive; font-size: 38px; font-weight: bold; color: #111; margin: 0 0 10px; letter-spacing: -1px; }}
        .journal-subtitle {{ font-style: italic; font-size: 18px; color: #555; margin: 0 0 25px; }}
        .journal-meta {{ font-weight: bold; font-size: 14px; color: #111; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }}
        .dashed-line {{ border-top: 1px dashed #ccc; margin: 20px 0 35px; }}
        .bulletin-section {{ margin-bottom: 40px; }}
        .bulletin-section h2 {{ border-bottom: 2px solid #111; padding-bottom: 5px; font-size: 22px; font-weight: 900; margin: 0 0 8px; color: #111; }}
        .bulletin-section p {{ font-size: 14.5px; line-height: 1.6; margin: 0 0 12px; }}
        .bulletin-section ul {{ padding-left: 20px; margin: 0 0 12px; }}
        .bulletin-section li {{ font-size: 14.5px; line-height: 1.6; margin-bottom: 6px; }}
        .bulletin-section img {{ width: 100%; height: auto; border-radius: 14px; margin: 16px 0; box-shadow: 0 4px 20px rgba(0,0,0,0.1); cursor: zoom-in; display: block; }}
        .img-grid {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); gap: 12px; margin: 16px 0; }}
        .img-grid img {{ margin: 0; }}
        .summary {{ background: rgba(88,101,242,0.09); border-left: 4px solid #5865f2; padding: 12px 16px; margin-top: 15px; font-size: 13.5px; font-style: italic; color: #2c3e50; border-radius: 0 6px 6px 0; }}
        .summary b {{ color: #5865f2; text-transform: uppercase; font-size: 11px; font-style: normal; display: block; margin-bottom: 4px; letter-spacing: 0.5px; }}
        .social-share {{ display: flex; justify-content: center; gap: 12px; margin: 30px 0; width: 100%; flex-wrap: wrap; }}
        .social-share a {{ display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 100px; font-size: 13px; font-weight: 900; text-decoration: none; text-transform: uppercase; transition: all 0.25s; }}
        .social-share a.td {{ background: #5865F2; color: #fff; }}
        .social-share a.tt {{ background: linear-gradient(135deg,#1d56f2,#f21de4); color: #fff; }}
        .social-share a.ty {{ background: #ec1717e0; color: #fff; }}
        .social-share a img {{ width: 18px; height: 18px; }}
        .back-button-container {{ text-align: center; margin: 40px 0 50px; }}
        .back-button {{ background: linear-gradient(135deg,#ffda00,#ffc200); color: #000; text-decoration: none; font-weight: 900; padding: 11px 24px; border-radius: 100px; font-size: 13px; text-transform: uppercase; box-shadow: 0 4px 15px rgba(255,218,0,0.4); border: 2px solid rgba(0,0,0,0.08); display: inline-block; }}
        body.dark-mode {{ background: #0b0b12; color: #ddd; }}
        body.dark-mode .site-header {{ background: rgba(10,10,18,0.75); }}
        body.dark-mode .bulletin-section h2 {{ border-bottom-color: #444; color: #eee; }}
        body.dark-mode .bulletin-section p, body.dark-mode .bulletin-section li {{ color: #ccc; }}
        body.dark-mode .journal-title {{ color: #eee; }}
        body.dark-mode .soon-title {{ color: #fff; }}
        body.dark-mode .countdown-number {{ color: #fff; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }}
        @media (max-width: 768px) {{ .blue-banner {{ font-size: 24px; padding: 12px 30px; }} }}
    </style>
    <link rel="stylesheet" href="../shared/bulletin-lightbox.css">
</head>
<body>
    <header class="site-header">
        <div class="site-header__logo"><img src="../BF_news.png" alt="Blox Fruits"></div>
        <nav><ul class="site-nav">
            <li><a href="https://www.roblox.com/fr/games/2753915549/Blox-Fruits">Game</a></li>
            <li><a href="../index.html" class="nav-news">News</a></li>
            <li><a href="../neo_bulletin.html" class="nav-leaks">Leaks</a></li>
            <li><a href="../archives.html">Archives</a></li>
        </ul></nav>
        <div class="site-header__icons">
            <span class="material-symbols-outlined dark-mode-toggle" id="darkModeToggle" onclick="toggleDarkMode()" role="button" tabindex="0">dark_mode</span>
            <span class="material-symbols-outlined mobile-menu-btn" id="menuToggle">menu</span>
        </div>
    </header>
    <div class="mobile-nav-backdrop" id="mobileNavBackdrop"></div>
    <nav class="mobile-nav-dropdown" id="mobileNav" aria-hidden="true">
        <div class="mnav-header">
            <span class="mnav-header__title">Menu</span>
            <button class="mnav-close" id="mobileNavClose"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="mnav-links">
            <a href="https://www.roblox.com/fr/games/2753915549/Blox-Fruits" class="mnav-link"><span class="material-symbols-outlined mnav-link__icon">sports_esports</span> Jouer</a>
            <a href="../index.html" class="mnav-link"><span class="material-symbols-outlined mnav-link__icon">newspaper</span> News</a>
            <a href="../neo_bulletin.html" class="mnav-link"><span class="material-symbols-outlined mnav-link__icon">key</span> Leaks</a>
            <a href="../archives.html" class="mnav-link"><span class="material-symbols-outlined mnav-link__icon">inventory_2</span> Archives</a>
        </div>
    </nav>
    <main class="main-content">
        <div id="countdown-section" class="countdown-wrapper">
            <div class="soon-badge">&#9679; Bient\u00f4t</div>
            <h1 class="soon-title">Bulletin #{NUMBER}</h1>
            <p class="soon-subtitle">Le prochain bulletin arrive dans&hellip;</p>
            <div class="countdown">
                <div class="countdown-item"><div class="countdown-number" id="days">00</div><div class="countdown-label">Jours</div></div>
                <div class="countdown-sep">:</div>
                <div class="countdown-item"><div class="countdown-number" id="hours">00</div><div class="countdown-label">Heures</div></div>
                <div class="countdown-sep">:</div>
                <div class="countdown-item"><div class="countdown-number" id="minutes">00</div><div class="countdown-label">Minutes</div></div>
                <div class="countdown-sep">:</div>
                <div class="countdown-item"><div class="countdown-number" id="seconds">00</div><div class="countdown-label">Secondes</div></div>
            </div>
            <a href="../index.html" class="cta-back"><span class="material-symbols-outlined" style="font-size:18px">arrow_back</span> Retour aux bulletins</a>
        </div>
        <div id="bulletin-content" class="bulletin-container">
            <div class="blue-banner">The Blox Bulletin #{NUMBER}</div>
            <div class="hero-image-wrapper">
                <img src="img/{HERO_IMG}" class="hero-image" alt="The Blox Bulletin {NUMBER}">
            </div>
            <div class="publish-date">{DATE_FR}</div>
            <div class="journal-header">
                <h1 class="journal-title">{TITLE}</h1>
                <p class="journal-subtitle">{SUBTITLE}</p>
                <div class="journal-meta">Num\u00e9ro : {NUMBER} | {DATE_FR}</div>
            </div>
            <div class="dashed-line"></div>
            {CONTENT}
            <div style="text-align:center;font-style:italic;background:#f8f8f8;border:1px solid #ddd;border-radius:12px;padding:24px;margin-bottom:30px">
                <p style="margin:0;font-size:15px"><em>Ceci conclut le Blox Bulletin #{NUMBER}. Restez connect\u00e9s !</em></p>
            </div>
            <div class="social-share">
                <a href="https://discord.gg/a6S6eugPn" class="td"><img src="../shared/discord.png" alt="Discord"> Discord</a>
                <a href="https://tiktok.com/@dc_neolixx" class="tt"><img src="../shared/tiktok.png" alt="TikTok"> TikTok</a>
                <a href="https://www.youtube.com/@Dc_neolixx" class="ty"><img src="../shared/youtube.png" alt="Youtube"> Youtube</a>
            </div>
            <div class="back-button-container">
                <a href="../index.html#bulletin-{NUMBER}" class="back-button">&larr; Retour aux Actualit\u00e9s</a>
            </div>
        </div>
    </main>
    <script>
        const TARGET=new Date(\'{RELEASE_TS}\');
        function pad(n){{return String(n).padStart(2,\'0\')}}
        let revealed=false;
        function revealBulletin(){{if(revealed)return;revealed=true;const cd=document.getElementById(\'countdown-section\'),bl=document.getElementById(\'bulletin-content\');cd.classList.add(\'hidden\');setTimeout(()=>{{cd.style.display=\'none\';bl.classList.add(\'visible\')}},650);}}
        function updateCountdown(){{const diff=TARGET-Date.now();if(diff<=0){{revealBulletin();return;}}const s=Math.floor(diff/1000);document.getElementById(\'days\').textContent=pad(Math.floor(s/86400));document.getElementById(\'hours\').textContent=pad(Math.floor((s%86400)/3600));document.getElementById(\'minutes\').textContent=pad(Math.floor((s%3600)/60));document.getElementById(\'seconds\').textContent=pad(s%60);}}
        updateCountdown();const iv=setInterval(()=>{{updateCountdown();if(revealed)clearInterval(iv)}},1000);
        (function(){{const btn=document.getElementById(\'menuToggle\'),nav=document.getElementById(\'mobileNav\'),bd=document.getElementById(\'mobileNavBackdrop\'),cl=document.getElementById(\'mobileNavClose\');function open(){{nav.classList.add(\'is-open\');bd.classList.add(\'is-open\');btn.textContent=\'close\';document.body.style.overflow=\'hidden\';}}function close(){{nav.classList.remove(\'is-open\');bd.classList.remove(\'is-open\');btn.textContent=\'menu\';document.body.style.overflow=\'\';}}btn.addEventListener(\'click\',()=>nav.classList.contains(\'is-open\')?close():open());bd.addEventListener(\'click\',close);cl.addEventListener(\'click\',close);document.addEventListener(\'keydown\',e=>{{if(e.key===\'Escape\')close()}});nav.querySelectorAll(\'a\').forEach(a=>a.addEventListener(\'click\',close));}})();
        function toggleDarkMode(){{document.body.classList.toggle(\'dark-mode\');localStorage.setItem(\'blox_dark_mode\',document.body.classList.contains(\'dark-mode\'));document.getElementById(\'darkModeToggle\').textContent=document.body.classList.contains(\'dark-mode\')?\'light_mode\':\'dark_mode\';}}
        (function(){{if(localStorage.getItem(\'blox_dark_mode\')===\'true\'){{document.body.classList.add(\'dark-mode\');const el=document.getElementById(\'darkModeToggle\');if(el)el.textContent=\'light_mode\';}}}})();
    </script>
    <script src="../shared/bulletin-lightbox.js"></script>
</body>
</html>'''


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"seen": []}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def next_number() -> int:
    nums = [int(p.name) for p in REPO_ROOT.iterdir() if p.is_dir() and re.fullmatch(r"\d{3}", p.name)]
    return (max(nums) if nums else 0) + 1


def fetch_entries() -> list[dict]:
    entries = _from_atom()
    if entries:
        return entries
    print("Atom feed unavailable, falling back to HTML scrape.")
    return _from_html()


def _from_atom() -> list[dict]:
    try:
        r = requests.get(FEED_URL, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        ns = {"a": "http://www.w3.org/2005/Atom"}
        root = ET.fromstring(r.content)
        out = []
        for e in root.findall("a:entry", ns):
            link = next((l.get("href") for l in e.findall("a:link", ns)
                         if l.get("rel", "alternate") == "alternate"), None)
            content = (e.findtext("a:content", default="", namespaces=ns) or
                       e.findtext("a:summary", default="", namespaces=ns))
            out.append({
                "title": (e.findtext("a:title", default="", namespaces=ns) or "").strip(),
                "url":   link,
                "date":  (e.findtext("a:published", default="", namespaces=ns) or "")[:10],
                "html":  content or "",
            })
        return [x for x in out if x["url"]]
    except Exception as exc:
        print(f"[atom] {exc}")
        return []


def _from_html() -> list[dict]:
    r = requests.get(BLOG_URL, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    seen, links = set(), []
    for a in soup.select("a[href*='/blogs/news/']"):
        href = urljoin(BLOG_URL, a["href"]).split("?")[0]
        if href.rstrip("/") == BLOG_URL.rstrip("/") or href in seen:
            continue
        seen.add(href); links.append(href)
    out = []
    for url in links:
        pr = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        pr.raise_for_status()
        ps = BeautifulSoup(pr.text, "html.parser")
        body = ps.select_one("article, .article-template, .rte, main") or ps
        title_tag = ps.find("h1")
        time_tag = ps.find("time")
        out.append({
            "title": title_tag.get_text(strip=True) if title_tag else url,
            "url":   url,
            "date":  (time_tag.get("datetime", "")[:10] if time_tag else ""),
            "html":  str(body),
        })
    return out


def is_relevant(entry: dict) -> bool:
    if not KEYWORDS:
        return True
    hay = (entry["title"] + " " + BeautifulSoup(entry["html"], "html.parser").get_text()).lower()
    return any(k in hay for k in KEYWORDS)


def extract_images(entry: dict) -> list[str]:
    soup = BeautifulSoup(entry["html"], "html.parser")
    images = []
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        if not src:
            continue
        full = urljoin(entry["url"], src)
        if full.startswith("//"):
            full = "https:" + full
        if full not in images:
            images.append(full)
    return images


def download_images(urls: list[str], img_dir: Path) -> list[str]:
    img_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for i, url in enumerate(urls, 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            ext = Path(urlparse(url).path).suffix.lower()
            if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
                ext = ".jpg"
            name = f"image-{i:02d}{ext}"
            (img_dir / name).write_bytes(r.content)
            saved.append(name)
            print(f"    image {name} OK")
        except Exception as exc:
            print(f"    image ignorée ({url}) : {exc}")
    return saved


def call_gemini(prompt: str) -> str:
    """Appelle l'API Gemini et retourne le texte généré."""
    # On essaie d'abord v1, puis v1beta en fallback
    for version in ["v1", "v1beta"]:
        url = f"https://generativelanguage.googleapis.com/{version}/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        payload = {
            "contents": [{"parts": [{"text": SYSTEM_PROMPT + "\n\n" + prompt}]}],
            "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.3}
        }
        try:
            r = requests.post(url, json=payload, timeout=120)
            if r.status_code == 404 and version == "v1":
                print(f"  [gemini] v1 introuvable, essai v1beta...")
                continue
            r.raise_for_status()
            data = r.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except requests.exceptions.HTTPError as e:
            if version == "v1beta":
                raise
            print(f"  [gemini] {e}, essai version suivante...")
    raise RuntimeError("Gemini API inaccessible sur v1 et v1beta")


def translate_content(entry: dict, image_names: list[str]) -> tuple[str, str, str, str]:
    img_info = ""
    if image_names:
        img_info = "\n\nImages disponibles dans img/ :\n"
        img_info += "\n".join(f"  - img/{n}" for n in image_names)
        img_info += "\nLa première image est le hero banner. Groupe plusieurs images avec <div class=\"img-grid\">."

    soup = BeautifulSoup(entry["html"], "html.parser")
    imgs = soup.find_all("img")
    for i, img in enumerate(imgs):
        if i < len(image_names):
            img["src"] = f"img/{image_names[i]}"
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    clean_html = str(soup)

    prompt = (
        f"Titre original : {entry['title']}\n"
        f"Date originale : {entry['date']}\n"
        f"{img_info}\n\n"
        f"HTML du bulletin :\n{clean_html}"
    )

    raw = call_gemini(prompt)
    raw = re.sub(r"^```(?:html)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()

    title_fr = entry["title"]
    subtitle_fr = ""
    date_fr = entry["date"]

    m = re.match(r"TITRE:\s*(.+)", raw)
    if m:
        title_fr = m.group(1).strip()
        raw = raw[m.end():].strip()

    m = re.match(r"SOUS_TITRE:\s*(.+)", raw)
    if m:
        subtitle_fr = m.group(1).strip()
        raw = raw[m.end():].strip()

    m = re.match(r"DATE_FR:\s*(.+)", raw)
    if m:
        date_fr = m.group(1).strip()
        raw = raw[m.end():].strip()

    content = re.sub(
        r"(<h2[^>]*>.*?</h2>)",
        r'</div><div class="bulletin-section">\1',
        raw, flags=re.DOTALL
    )
    content = re.sub(r"^</div>", "", content.strip())
    if not content.endswith("</div>"):
        content += "</div>"
    if not content.startswith('<div class="bulletin-section">'):
        content = '<div class="bulletin-section">' + content

    return title_fr, subtitle_fr, date_fr, content


def build_page(number, title, subtitle, date_fr, date_iso, images, content):
    hero_img = images[0] if images else "image-01.jpg"
    try:
        dt = datetime.strptime(date_iso, "%Y-%m-%d")
        release_ts = dt.strftime("%Y-%m-%dT10:00:00Z")
    except Exception:
        release_ts = "2026-01-01T10:00:00Z"
    return HTML_TEMPLATE.format(
        NUMBER=number, TITLE=escape(title), SUBTITLE=escape(subtitle),
        DATE_FR=date_fr, DATE_ISO=date_iso, OG_IMAGE=hero_img,
        HERO_IMG=hero_img, CONTENT=content, RELEASE_TS=release_ts,
    )


def update_index(number, date_iso, images):
    if not INDEX.exists():
        print("  index.html introuvable, skip.")
        return
    hero_img = images[0] if images else "image-01.jpg"
    new_line = (
        f'            {{ num: "{number}", img: "./{number}/img/{hero_img}", '
        f'href: "./{number}/bulletin-{number}.html", date: "{date_iso}" }},'
    )
    html = INDEX.read_text(encoding="utf-8")
    if f'./{number}/bulletin-{number}.html' in html:
        print(f"  index.html : bulletin {number} déjà présent, skip.")
        return
    pattern = r'(\{ num: "[^"]+", img: "[^"]+", href: "[^"]+", date: "[^"]+" \},?\s*\n)(\s*\];)'
    matches = list(re.finditer(pattern, html))
    if not matches:
        print("  index.html : tableau bulletins non trouvé, skip.")
        return
    insert_pos = matches[-1].end(1)
    html = html[:insert_pos] + new_line + "\n" + html[insert_pos:]
    INDEX.write_text(html, encoding="utf-8")
    print(f"  ✔ index.html mis à jour avec bulletin {number}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    if not GEMINI_API_KEY:
        print("GEMINI_API_KEY manquante.")
        return 1

    init_mode = "--init" in sys.argv
    state = load_state()
    entries = fetch_entries()
    if not entries:
        print("No entries fetched.")
        return 1

    if init_mode:
        state["seen"] = sorted({*state["seen"], *(e["url"] for e in entries)})
        save_state(state)
        print(f"{len(entries)} entries marked as seen.")
        return 0

    new = [e for e in entries if e["url"] not in state["seen"] and is_relevant(e)]
    if not new:
        print("No new bulletin.")
        return 0

    new = list(reversed(new))[:MAX_NEW]

    for entry in new:
        number = f"{next_number():03d}"
        print(f"→ New bulletin {number}: {entry['title']}")

        folder = REPO_ROOT / number
        image_urls = extract_images(entry)
        saved_images = download_images(image_urls, folder / "img")

        title_fr, subtitle_fr, date_fr, content = translate_content(entry, saved_images)
        page = build_page(number, title_fr, subtitle_fr, date_fr, entry["date"], saved_images, content)
        (folder / f"bulletin-{number}.html").write_text(page, encoding="utf-8")

        update_index(number, entry["date"], saved_images)

        state["seen"].append(entry["url"])
        save_state(state)
        print(f"  ✔ {folder.name}/bulletin-{number}.html ({len(saved_images)} images)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
