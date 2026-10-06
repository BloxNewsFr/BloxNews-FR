#!/usr/bin/env python3
"""
fetch_bulletin.py
Détecte les nouveaux bulletins Blox Fruits sur GamerRobot, les traduit en français
via l'API Anthropic, télécharge les images et génère NNN/bulletin-NNN.html
dans le dépôt en respectant fidèlement le style du site BloxNewsFr.

Usage :
    python fetch_bulletin.py          # publie les nouveaux bulletins
    python fetch_bulletin.py --init   # marque les bulletins actuels comme "déjà vus"
"""

import base64
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlparse

import anthropic
import requests
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
BLOG_URL  = "https://gamerrobot.com/blogs/news"
FEED_URL  = BLOG_URL + ".atom"
MODEL     = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
MAX_NEW   = int(os.getenv("MAX_NEW_PER_RUN", "3"))
REPO_ROOT = Path(__file__).resolve().parent
STATE     = REPO_ROOT / "sources.json"
HEADERS   = {"User-Agent": "Mozilla/5.0 (compatible; BloxBulletinBot/1.0)"}
TIMEOUT   = 30
# Filtre désactivé : on publie TOUT ce qui sort sur GamerRobot (bulletins, patches, events...)
KEYWORDS: list[str] = []

# ─────────────────────────────────────────────────────────────────────────────
# PROMPT ANTHROPIC
# ─────────────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """
Tu es le rédacteur principal du site BloxNewsFr, le média communautaire français
dédié à Blox Fruits (Roblox). Tu reçois le contenu HTML brut d'un bulletin officiel
en anglais publié par GamerRobot.

TA MISSION :
- Traduire fidèlement le bulletin en français, section par section, sans rien inventer.
- Adopter un ton dynamique, fluide et accrocheur, directement adressé aux joueurs.
- Utiliser le jargon communautaire français de Blox Fruits (voir ci-dessous).
- Ajouter à la fin de chaque section un encadré résumé.

VOCABULAIRE OBLIGATOIRE (ne jamais traduire ces termes) :
- Rework (pas remaniement)
- Sneak peek / Teaser
- Sea 1, Sea 2, Sea 3 (pas Mer 1, Mer 2...)
- Buff / Nerf
- Stock / Dealer
- Bounty / Honor
- Stats / Build
- Spam / Combo
- Leak / Leaker
- Race (pour les races du jeu)
- Update
- Fruit (pour désigner les Devil Fruits)
- Grinding / Farm
- PvP / PvE

TON :
- Tutoiement, enthousiaste mais clair.
- Pas trop scolaire, ni trop familier non plus.
- Reste fidèle à l'histoire et aux infos du texte original.

FORMAT DE SORTIE STRICT :
Ligne 1 : "TITRE: <titre FR accrocheur maximum 80 caractères>"
Ligne 2 : "SOUS_TITRE: <sous-titre FR court>"
Ligne 3 : "DATE_FR: <date en français, ex: 31 Juillet 2026>"
Ensuite, le contenu HTML de l'article, en utilisant UNIQUEMENT ces balises :
  <h2>, <p>, <ul>, <li>, <strong>, <em>
À la fin de chaque grande section thématique, ajoute un encadré résumé exactement ainsi :
  <div class="summary"><b>📌 Résumé :</b> [résumé court de la section]</div>
Pas de <html>, <body>, <h1>, pas de backticks Markdown, pas de commentaires HTML.
"""

# ─────────────────────────────────────────────────────────────────────────────
# TEMPLATE HTML — copié sur le style du bulletin 024
# Placeholders : {NUMBER} {TITLE} {SUBTITLE} {DATE_FR} {DATE_ISO}
#                {OG_IMAGE} {HERO_IMG} {CONTENT} {RELEASE_TS}
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
    <meta property="og:description" content="Bulletin #{NUMBER} – Toute l'actualité Blox Fruits : mises à jour, événements et news officielles du jeu Roblox Blox Fruits.">
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
        :root {{ --color-text: #333132; --color-border: #ebebeb; --color-primary: #ffda00; }}
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; font-family: \'Inter\', sans-serif; color: var(--color-text); background: #ffffff; min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }}

        .site-header {{
            display: flex; align-items: center; justify-content: center;
            padding: 0 55px; position: sticky; top: 0; z-index: 1000; height: 72px;
            background: rgba(255,255,255,0.15);
            backdrop-filter: blur(50px) saturate(180%); -webkit-backdrop-filter: blur(50px) saturate(180%);
            border-top: 1px solid rgba(255,255,255,0.30); border-bottom: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset, 0 8px 32px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
        }}
        .site-header__logo {{ position: absolute; left: 55px; }}
        .site-header__logo img {{ height: 42px; width: auto; display: block; }}
        .site-nav {{ display: flex; gap: 8px; padding: 0; margin: 0; list-style: none; }}
        .site-nav a {{ color: rgba(0,0,0,0.85); text-decoration: none; font-weight: 900; font-size: 17px; text-transform: uppercase; font-family: \'LuckiestGuy Regular\', cursive; padding: 8px 16px; border-radius: 10px; transition: background 0.2s, color 0.2s; }}
        .site-nav a:hover {{ background: var(--color-primary); color: #000; }}
        .site-header__icons {{ display: flex; gap: 12px; color: rgba(0,0,0,0.85); cursor: pointer; align-items: center; position: absolute; right: 55px; }}
        .site-header__icons span {{ padding: 8px; border-radius: 10px; transition: background 0.2s; }}
        .site-header__icons span:hover {{ background: rgba(0,0,0,0.08); }}
        .mobile-menu-btn {{ display: none; }}
        .mobile-nav-dropdown, .mobile-nav-backdrop {{ display: none; }}

        @media (max-width: 768px) {{
            .site-header {{ padding: 0 16px; height: 60px; }}
            .site-header__logo {{ left: 16px; }}
            .site-header__logo img {{ height: 32px; }}
            .site-header__icons {{ right: 16px; gap: 6px; }}
            .site-nav {{ display: none; }}
            .mobile-menu-btn {{ display: block; }}
            .mobile-nav-dropdown {{
                display: flex; flex-direction: column;
                position: fixed; top: 0; right: -85vw; bottom: 0;
                width: min(82vw, 320px);
                background: rgba(10,10,20,0.96);
                backdrop-filter: blur(28px) saturate(180%); -webkit-backdrop-filter: blur(28px) saturate(180%);
                box-shadow: -12px 0 50px rgba(0,0,0,0.5);
                z-index: 9991; transition: right 0.35s cubic-bezier(0.4,0,0.2,1);
                overflow-y: auto; padding-bottom: env(safe-area-inset-bottom, 0); gap: 0;
            }}
            .mobile-nav-dropdown.is-open {{ right: 0; }}
            .mnav-header {{ display: flex; align-items: center; justify-content: space-between; padding: 20px 18px 16px; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,0.07); }}
            .mnav-header__title {{ font-family: \'LuckiestGuy Regular\', cursive; font-size: 20px; color: #fff; text-transform: uppercase; }}
            .mnav-close {{ width: 36px; height: 36px; border-radius: 50%; border: none; background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }}
            .mnav-links {{ display: flex; flex-direction: column; gap: 6px; padding: 14px; }}
            .mobile-nav-dropdown a.mnav-link {{ display: flex; align-items: center; gap: 14px; text-decoration: none; color: rgba(255,255,255,0.85); font-weight: 800; font-family: \'Inter\', sans-serif; font-size: 15px; padding: 13px 16px; border-radius: 14px; transition: background 0.2s; }}
            .mnav-link__icon {{ font-size: 22px; color: rgba(255,255,255,0.4); flex-shrink: 0; }}
            .mobile-nav-dropdown a.mnav-link:hover {{ background: rgba(255,255,255,0.06); }}
        }}
        .mobile-nav-backdrop {{ position: fixed; inset: 0; z-index: 9990; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); display: none; opacity: 0; transition: opacity 0.35s; }}
        .mobile-nav-backdrop.is-open {{ display: block; opacity: 1; }}

        .main-content {{ flex: 1; display: flex; flex-direction: column; align-items: center; }}

        .countdown-wrapper {{ width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; text-align: center;
            background: radial-gradient(ellipse at 50% 0%, rgba(255,218,0,0.06) 0%, transparent 50%);
        }}
        .soon-badge {{ font-family: \'LuckiestGuy Regular\', cursive; font-size: 18px; letter-spacing: 6px; color: var(--color-primary); text-transform: uppercase; margin-bottom: 8px; animation: soonPulse 2s ease-in-out infinite; }}
        @keyframes soonPulse {{ 0%,100%{{opacity:1}} 50%{{opacity:0.4}} }}
        .soon-title {{ font-family: \'LuckiestGuy Regular\', cursive; font-size: clamp(48px,12vw,96px); color: #111; margin: 0 0 16px; line-height: 1.1; }}
        .soon-subtitle {{ font-size: clamp(16px,3vw,22px); color: rgba(0,0,0,0.55); margin-bottom: 60px; }}
        .countdown {{ display: flex; gap: clamp(16px,4vw,40px); justify-content: center; flex-wrap: wrap; }}
        .countdown-item {{ display: flex; flex-direction: column; align-items: center; min-width: clamp(70px,14vw,140px); }}
        .countdown-number {{ font-family: \'Inter\', sans-serif; font-size: clamp(48px,12vw,100px); font-weight: 900; color: #111; line-height: 1; background: rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.1); border-radius: 20px; padding: clamp(12px,3vw,28px) clamp(8px,2vw,20px); min-width: clamp(70px,14vw,140px); text-align: center; box-shadow: 0 0 40px rgba(255,218,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8); }}
        .countdown-label {{ font-size: clamp(11px,2vw,14px); font-weight: 600; color: rgba(0,0,0,0.5); text-transform: uppercase; letter-spacing: 3px; margin-top: 12px; }}
        .countdown-sep {{ font-size: clamp(36px,8vw,72px); font-weight: 900; color: rgba(0,0,0,0.2); align-self: center; padding-bottom: clamp(30px,6vw,56px); }}
        .cta-back {{ margin-top: 60px; display: inline-flex; align-items: center; gap: 10px; padding: 14px 32px; border-radius: 100px; background: var(--color-primary); color: #000; text-decoration: none; font-weight: 900; font-size: 15px; text-transform: uppercase; transition: all 0.25s ease; box-shadow: 0 4px 20px rgba(255,218,0,0.3); }}
        .cta-back:hover {{ transform: translateY(-3px); box-shadow: 0 8px 30px rgba(255,218,0,0.5); }}
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
        .bulletin-section .byline {{ font-style: italic; font-size: 13px; color: #666; display: block; margin-bottom: 16px; }}
        .bulletin-section p {{ font-size: 14.5px; line-height: 1.6; margin: 0 0 12px; }}
        .bulletin-section ul {{ padding-left: 20px; margin: 0 0 12px; }}
        .bulletin-section li {{ font-size: 14.5px; line-height: 1.6; margin-bottom: 6px; }}
        .bulletin-section img {{
            width: 100%; height: auto; border-radius: 14px;
            margin: 16px 0; box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            cursor: zoom-in; display: block;
        }}
        .img-grid {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); gap: 12px; margin: 16px 0; }}
        .img-grid img {{ margin: 0; }}

        .summary {{ background: rgba(88,101,242,0.09); border-left: 4px solid #5865f2; padding: 12px 16px; margin-top: 15px; font-size: 13.5px; font-style: italic; color: #2c3e50; border-radius: 0 6px 6px 0; }}
        .summary b {{ color: #5865f2; text-transform: uppercase; font-size: 11px; font-style: normal; display: block; margin-bottom: 4px; letter-spacing: 0.5px; }}

        .social-share {{ display: flex; justify-content: center; gap: 12px; margin: 30px 0; width: 100%; flex-wrap: wrap; }}
        .social-share a {{ display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 100px; font-size: 13px; font-weight: 900; text-decoration: none; text-transform: uppercase; transition: all 0.25s ease; }}
        .social-share a:hover {{ transform: translateY(-3px); }}
        .social-share a.td {{ background: #5865F2; color: #fff; box-shadow: 0 4px 15px rgba(88,101,242,0.4); }}
        .social-share a.tt {{ background: linear-gradient(135deg,#1d56f2,#f21de4); color: #fff; box-shadow: 0 4px 15px rgba(29,86,242,0.4); }}
        .social-share a.ty {{ background: #ec1717e0; color: #fff; box-shadow: 0 4px 15px rgba(236,23,23,0.4); }}
        .social-share a img {{ width: 18px; height: 18px; }}
        .back-button-container {{ text-align: center; margin: 40px 0 50px; }}
        .back-button {{ background: linear-gradient(135deg,#ffda00,#ffc200); color: #000; text-decoration: none; font-weight: 900; padding: 11px 24px; border-radius: 100px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; transition: transform 0.1s; box-shadow: 0 4px 15px rgba(255,218,0,0.4); border: 2px solid rgba(0,0,0,0.08); display: inline-block; }}
        .back-button:hover {{ transform: scale(1.05); }}

        .search-overlay {{ position: fixed; inset: 0; background: linear-gradient(135deg,rgba(5,5,20,0.93),rgba(10,8,25,0.88)); backdrop-filter: blur(24px); z-index: 99999; display: flex; flex-direction: column; align-items: center; padding-top: 120px; opacity: 0; pointer-events: none; transition: opacity 0.35s; }}
        .search-overlay.is-active {{ opacity: 1; pointer-events: auto; }}
        .search-container {{ width: 92%; max-width: 640px; transform: translateY(-24px) scale(0.94); transition: transform 0.45s cubic-bezier(0.34,1.56,0.64,1); }}
        .search-overlay.is-active .search-container {{ transform: translateY(0) scale(1); }}
        .search-bar {{ display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 4px 4px 4px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }}
        .search-bar input {{ flex: 1; border: none; outline: none; font-size: 17px; font-family: \'Inter\'; color: #fff; background: transparent; padding: 14px 0; }}
        .search-bar input::placeholder {{ color: rgba(255,255,255,0.3); }}
        .search-go-btn {{ padding: 10px 22px; border-radius: 12px; border: none; background: linear-gradient(135deg,#444,#222); color: #fff; font-weight: 800; font-size: 13px; cursor: pointer; text-transform: uppercase; flex-shrink: 0; }}
        .search-nav-btn {{ width: 36px; height: 36px; border-radius: 10px; border: none; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; }}
        .search-close-btn {{ width: 36px; height: 36px; border-radius: 10px; border: none; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; }}
        .search-stats {{ color: rgba(255,255,255,0.35); font-size: 14px; margin-top: 12px; text-align: center; }}
        mark.search-hl {{ background: linear-gradient(135deg,#fce83a,#ffd700); color: #000; border-radius: 3px; padding: 1px 4px; }}
        mark.search-hl.active {{ background: linear-gradient(135deg,#ff6b35,#ff4500); color: #fff; }}

        .discord-login-btn {{ display: flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 20px; border: none; cursor: pointer; background: #5865F2; color: #fff; font-size: 13px; font-weight: 700; font-family: \'Inter\'; transition: all 0.22s; box-shadow: 0 2px 12px rgba(88,101,242,0.35); white-space: nowrap; }}
        .discord-login-btn:hover {{ background: #4752c4; transform: translateY(-1px); }}
        .discord-user-pill {{ display: none; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; border-radius: 20px; cursor: pointer; background: rgba(88,101,242,0.12); border: 1px solid rgba(88,101,242,0.25); transition: all 0.2s; user-select: none; position: relative; }}
        .discord-user-pill.is-visible {{ display: flex; }}
        .discord-avatar {{ width: 30px; height: 30px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(88,101,242,0.5); }}
        .discord-username {{ font-size: 13px; font-weight: 700; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
        .discord-chevron {{ font-size: 10px; color: rgba(88,101,242,0.7); margin-left: 2px; transition: transform 0.2s; }}
        .discord-user-pill.dropdown-open .discord-chevron {{ transform: rotate(180deg); }}
        .discord-dropdown {{ position: absolute; top: calc(100% + 10px); right: 0; background: rgba(12,12,20,0.98); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; width: 220px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.5); opacity: 0; pointer-events: none; transform: translateY(-6px); transition: opacity 0.2s, transform 0.2s; z-index: 9999; }}
        .discord-user-pill.dropdown-open .discord-dropdown {{ opacity: 1; pointer-events: all; transform: translateY(0); }}
        .discord-dropdown-header {{ padding: 14px 16px; background: rgba(88,101,242,0.08); border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 10px; }}
        .discord-dropdown-avatar {{ width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(88,101,242,0.5); }}
        .discord-dropdown-name {{ font-size: 13px; font-weight: 700; color: #fff; }}
        .discord-dropdown-tag {{ font-size: 11px; color: rgba(88,101,242,0.8); }}
        .discord-dropdown-body {{ padding: 8px; }}
        .discord-dropdown-item {{ display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 8px; cursor: pointer; color: rgba(255,255,255,0.55); font-size: 13px; font-weight: 600; transition: all 0.15s; }}
        .discord-dropdown-item:hover {{ background: rgba(255,255,255,0.06); color: #fff; }}
        .discord-skeleton {{ width: 120px; height: 30px; border-radius: 20px; background: linear-gradient(90deg,rgba(0,0,0,0.05) 25%,rgba(0,0,0,0.1) 50%,rgba(0,0,0,0.05) 75%); background-size: 200% 100%; animation: skeletonShimmer 1.4s infinite; display: none; }}
        .discord-skeleton.is-visible {{ display: block; }}
        @keyframes skeletonShimmer {{ 0%{{background-position:200% 0}} 100%{{background-position:-200% 0}} }}

        body.dark-mode {{ background: #0b0b12; color: #ddd; }}
        body.dark-mode .site-header {{ background: rgba(10,10,18,0.75); }}
        body.dark-mode .site-nav a {{ color: #ccc; }}
        body.dark-mode .bulletin-section h2 {{ border-bottom-color: #444; color: #eee; }}
        body.dark-mode .bulletin-section p,
        body.dark-mode .bulletin-section li {{ color: #ccc; }}
        body.dark-mode .journal-title {{ color: #eee; }}
        body.dark-mode .journal-subtitle {{ color: #bbb; }}
        body.dark-mode .soon-title {{ color: #fff; }}
        body.dark-mode .countdown-number {{ color: #fff; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }}
        body.dark-mode .dashed-line {{ border-top-color: #2a2a35; }}

        @media (max-width: 768px) {{
            .blue-banner {{ font-size: 24px; padding: 12px 30px; }}
            .search-overlay {{ padding-top: 80px; }}
        }}
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
            <span class="material-symbols-outlined" onclick="openSearch()" title="Rechercher" role="button" tabindex="0">search</span>
            <span class="material-symbols-outlined dark-mode-toggle" id="darkModeToggle" onclick="toggleDarkMode()" role="button" tabindex="0">dark_mode</span>
            <div class="discord-skeleton" id="discordSkeleton"></div>
            <button class="discord-login-btn" id="discordLoginBtn" onclick="_discordLogin()" style="display:none">
                <svg width="16" height="12" viewBox="0 0 71 55" fill="none"><path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.44077 45.4204 0.52529C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.52529C25.5141 0.44359 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" fill="white"/></svg>
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
                        <div class="discord-dropdown-item" onclick="_discordLogout()">&#128682; Se d&#233;connecter</div>
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
            <div class="soon-badge">&#9679; Bientôt</div>
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
                <div class="journal-meta">Numéro : {NUMBER} | {DATE_FR}</div>
            </div>
            <div class="dashed-line"></div>

            {CONTENT}

            <div style="text-align:center;font-style:italic;background:#f8f8f8;border:1px solid #ddd;border-radius:12px;padding:24px;margin-bottom:30px">
                <p style="margin:0;font-size:15px"><em>Ceci conclut le Blox Bulletin #{NUMBER}. Restez connectés via notre Discord et nos réseaux sociaux pour les prochaines actus !</em></p>
            </div>

            <div class="social-share">
                <a href="https://discord.gg/a6S6eugPn" class="td"><img src="../shared/discord.png" alt="Discord"> Discord</a>
                <a href="https://tiktok.com/@dc_neolixx" class="tt"><img src="../shared/tiktok.png" alt="TikTok"> TikTok</a>
                <a href="https://www.youtube.com/@Dc_neolixx" class="ty"><img src="../shared/youtube.png" alt="Youtube"> Youtube</a>
            </div>

            <div class="back-button-container">
                <a href="../index.html#bulletin-{NUMBER}" class="back-button">&larr; Retour aux Actualités</a>
            </div>
        </div>

    </main>

    <script>
        const TARGET = new Date(\'{RELEASE_TS}\');
        function pad(n){{return String(n).padStart(2,\'0\')}}
        let revealed = false;
        function revealBulletin(){{
            if(revealed)return; revealed=true;
            const cd=document.getElementById(\'countdown-section\');
            const bl=document.getElementById(\'bulletin-content\');
            cd.classList.add(\'hidden\');
            setTimeout(()=>{{cd.style.display=\'none\';bl.classList.add(\'visible\')}},650);
        }}
        function updateCountdown(){{
            const diff=TARGET-Date.now();
            if(diff<=0){{revealBulletin();return;}}
            const s=Math.floor(diff/1000);
            document.getElementById(\'days\').textContent=pad(Math.floor(s/86400));
            document.getElementById(\'hours\').textContent=pad(Math.floor((s%86400)/3600));
            document.getElementById(\'minutes\').textContent=pad(Math.floor((s%3600)/60));
            document.getElementById(\'seconds\').textContent=pad(s%60);
        }}
        updateCountdown();
        const iv=setInterval(()=>{{updateCountdown();if(revealed)clearInterval(iv)}},1000);

        (function(){{
            const btn=document.getElementById(\'menuToggle\');
            const nav=document.getElementById(\'mobileNav\');
            const bd=document.getElementById(\'mobileNavBackdrop\');
            const cl=document.getElementById(\'mobileNavClose\');
            function open(){{nav.classList.add(\'is-open\');bd.classList.add(\'is-open\');btn.textContent=\'close\';document.body.style.overflow=\'hidden\';}}
            function close(){{nav.classList.remove(\'is-open\');bd.classList.remove(\'is-open\');btn.textContent=\'menu\';document.body.style.overflow=\'\';}}
            btn.addEventListener(\'click\',()=>nav.classList.contains(\'is-open\')?close():open());
            bd.addEventListener(\'click\',close);cl.addEventListener(\'click\',close);
            document.addEventListener(\'keydown\',e=>{{if(e.key===\'Escape\')close()}});
            nav.querySelectorAll(\'a\').forEach(a=>a.addEventListener(\'click\',close));
        }})();
    </script>

    <div id="searchOverlay" class="search-overlay" onclick="if(event.target===this)closeSearch()">
        <div class="search-container">
            <div class="search-bar">
                <span class="material-symbols-outlined" style="font-size:22px;color:#999;flex-shrink:0">search</span>
                <input id="searchInput" type="text" placeholder="Rechercher&hellip;" onkeydown="if(event.key===\'Escape\')closeSearch();if(event.key===\'Enter\'){{event.preventDefault();executeSearch()}}">
                <button class="search-go-btn" onclick="executeSearch()">Chercher</button>
                <button class="search-nav-btn" onclick="prevMatch()" id="searchPrevBtn">&#9650;</button>
                <button class="search-nav-btn" onclick="nextMatch()" id="searchNextBtn">&#9660;</button>
                <button class="search-close-btn" onclick="closeSearch()">&#10005;</button>
            </div>
            <div id="searchStats" class="search-stats"></div>
        </div>
    </div>

    <script>
        let searchMatches=[],searchCurrent=-1;
        function openSearch(){{document.getElementById(\'searchOverlay\').classList.add(\'is-active\');const i=document.getElementById(\'searchInput\');i.value=\'\';document.getElementById(\'searchStats\').textContent=\'\';searchMatches=[];searchCurrent=-1;removeHighlights();setTimeout(()=>i.focus(),200);}}
        function closeSearch(k){{document.getElementById(\'searchOverlay\').classList.remove(\'is-active\');if(!k){{removeHighlights();searchMatches=[];searchCurrent=-1;}}}}
        function removeHighlights(){{document.querySelectorAll(\'mark.search-hl\').forEach(m=>{{const p=m.parentNode;p.replaceChild(document.createTextNode(m.textContent),m);p.normalize();}});}}
        function executeSearch(){{
            const q=document.getElementById(\'searchInput\').value.trim().toLowerCase();removeHighlights();searchMatches=[];searchCurrent=-1;
            document.getElementById(\'searchPrevBtn\').disabled=true;document.getElementById(\'searchNextBtn\').disabled=true;
            const stats=document.getElementById(\'searchStats\');stats.textContent=\'\';if(!q)return;
            const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{{acceptNode:n=>{{const p=n.parentNode;if(!p||p.nodeName===\'SCRIPT\'||p.nodeName===\'STYLE\')return NodeFilter.FILTER_REJECT;if(p.closest(\'.search-overlay\'))return NodeFilter.FILTER_REJECT;return NodeFilter.FILTER_ACCEPT;}}}});
            const nodes=[];let n;while(n=walker.nextNode())nodes.push(n);
            nodes.forEach(t=>{{const tx=t.textContent,lo=tx.toLowerCase();let i=lo.indexOf(q);if(i===-1)return;const f=document.createDocumentFragment();let l=0;while(i!==-1){{if(i>l)f.appendChild(document.createTextNode(tx.slice(l,i)));const m=document.createElement(\'mark\');m.className=\'search-hl\';m.textContent=tx.slice(i,i+q.length);f.appendChild(m);searchMatches.push(m);l=i+q.length;i=lo.indexOf(q,l);}};if(l<tx.length)f.appendChild(document.createTextNode(tx.slice(l)));t.parentNode.replaceChild(f,t);}});
            const c=searchMatches.length;if(c>0){{searchCurrent=0;searchMatches[0].classList.add(\'active\');searchMatches[0].scrollIntoView({{behavior:\'smooth\',block:\'center\'}});stats.textContent=c+\' résultat\'+(c>1?\'s\':\'\');document.getElementById(\'searchPrevBtn\').disabled=false;document.getElementById(\'searchNextBtn\').disabled=false;closeSearch(true);}}else{{stats.textContent=\'Aucun résultat\';}}
        }}
        function nextMatch(){{if(!searchMatches.length)return;searchMatches[searchCurrent]?.classList.remove(\'active\');searchCurrent=(searchCurrent+1)%searchMatches.length;searchMatches[searchCurrent].classList.add(\'active\');searchMatches[searchCurrent].scrollIntoView({{behavior:\'smooth\',block:\'center\'}});document.getElementById(\'searchStats\').textContent=(searchCurrent+1)+\'/\'+searchMatches.length;}}
        function prevMatch(){{if(!searchMatches.length)return;searchMatches[searchCurrent]?.classList.remove(\'active\');searchCurrent=(searchCurrent-1+searchMatches.length)%searchMatches.length;searchMatches[searchCurrent].classList.add(\'active\');searchMatches[searchCurrent].scrollIntoView({{behavior:\'smooth\',block:\'center\'}});document.getElementById(\'searchStats\').textContent=(searchCurrent+1)+\'/\'+searchMatches.length;}}
        function toggleDarkMode(){{document.body.classList.toggle(\'dark-mode\');localStorage.setItem(\'blox_dark_mode\',document.body.classList.contains(\'dark-mode\'));document.getElementById(\'darkModeToggle\').textContent=document.body.classList.contains(\'dark-mode\')?\'light_mode\':\'dark_mode\';}}
        (function(){{if(localStorage.getItem(\'blox_dark_mode\')=== \'true\'){{document.body.classList.add(\'dark-mode\');const el=document.getElementById(\'darkModeToggle\');if(el)el.textContent=\'light_mode\';}}}})();
        const DISCORD_CLIENT_ID=\'1517793695573999646\';
        const DISCORD_REDIRECT_URI=window.location.href.split(\'#\')[0].split(\'?\')[0];
        const DISCORD_SCOPE=\'identify\';
        const DISCORD_TOKEN_KEY=\'bloxbulletin_discord_token\';
        const DISCORD_USER_KEY=\'bloxbulletin_discord_user\';
        function _discordLogin(){{const p=new URLSearchParams({{client_id:DISCORD_CLIENT_ID,redirect_uri:DISCORD_REDIRECT_URI,response_type:\'token\',scope:DISCORD_SCOPE}});window.location.href=\'https://discord.com/api/oauth2/authorize?\'+p.toString();}}
        async function _discordFetchUser(t){{const r=await fetch(\'https://discord.com/api/users/@me\',{{headers:{{Authorization:\'Bearer \'+t}}}});if(!r.ok)throw new Error(\'Token invalide\');return r.json();}}
        function _discordAvatarUrl(u){{if(u.avatar)return\'https://cdn.discordapp.com/avatars/\'+u.id+\'/\'+u.avatar+\'.webp?size=80\';const i=u.discriminator!==\'0\'?parseInt(u.discriminator)%5:(parseInt(u.id)>>22)%6;return\'https://cdn.discordapp.com/embed/avatars/\'+i+\'.png\';}}
        function _discordShowUser(u){{const av=_discordAvatarUrl(u),dn=u.global_name||u.username;document.getElementById(\'discordLoginBtn\').style.display=\'none\';document.getElementById(\'discordSkeleton\').classList.remove(\'is-visible\');const pill=document.getElementById(\'discordUserPill\');document.getElementById(\'discordAvatar\').src=av;document.getElementById(\'discordUsername\').textContent=dn;pill.classList.add(\'is-visible\');document.getElementById(\'discordDropdownAvatar\').src=av;document.getElementById(\'discordDropdownName\').textContent=dn;document.getElementById(\'discordDropdownTag\').textContent=\'@\'+u.username;pill.onclick=e=>{{e.stopPropagation();pill.classList.toggle(\'dropdown-open\')}};document.addEventListener(\'click\',()=>pill.classList.remove(\'dropdown-open\'));}}
        function _discordLogout(){{localStorage.removeItem(DISCORD_TOKEN_KEY);localStorage.removeItem(DISCORD_USER_KEY);document.getElementById(\'discordUserPill\').classList.remove(\'is-visible\',\'dropdown-open\');document.getElementById(\'discordLoginBtn\').style.display=\'\';}}
        (async function(){{const sk=document.getElementById(\'discordSkeleton\'),lb=document.getElementById(\'discordLoginBtn\');const hash=window.location.hash;if(hash.includes(\'access_token=\')){{const p=new URLSearchParams(hash.slice(1)),t=p.get(\'access_token\'),ei=parseInt(p.get(\'expires_in\')||604800);history.replaceState(null,\'\',window.location.pathname+window.location.search);if(t){{sk.classList.add(\'is-visible\');try{{const u=await _discordFetchUser(t);localStorage.setItem(DISCORD_TOKEN_KEY,JSON.stringify({{token:t,expiresAt:Date.now()+ei*1000}}));localStorage.setItem(DISCORD_USER_KEY,JSON.stringify(u));_discordShowUser(u);}}catch(e){{sk.classList.remove(\'is-visible\');lb.style.display=\'\';}}return;}}}}
        try{{const s=JSON.parse(localStorage.getItem(DISCORD_TOKEN_KEY)||null),cu=JSON.parse(localStorage.getItem(DISCORD_USER_KEY)||null);if(cu){{_discordShowUser(cu);if(s&&s.expiresAt>Date.now()){{try{{const fu=await _discordFetchUser(s.token);localStorage.setItem(DISCORD_USER_KEY,JSON.stringify(fu));_discordShowUser(fu);}}catch(e){{}}}}return;}}}}catch(e){{}}
        lb.style.display=\'\';}})()\n    </script>
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
    # Filtre désactivé : on prend tout
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


def translate_content(entry: dict, image_names: list[str]) -> tuple[str, str, str, str]:
    img_info = ""
    if image_names:
        img_info = "\n\nImages disponibles dans le dossier img/ (utilise ces noms dans les balises <img>) :\n"
        img_info += "\n".join(f"  - img/{n}" for n in image_names)
        img_info += "\nLa première image (image-01.*) est le hero banner."
        img_info += "\nPour regrouper plusieurs images côte à côte, entoure-les d'un <div class=\"img-grid\">."

    soup = BeautifulSoup(entry["html"], "html.parser")
    imgs = soup.find_all("img")
    for i, img in enumerate(imgs):
        if i < len(image_names):
            img["src"] = f"img/{image_names[i]}"

    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    clean_html = str(soup)

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=MODEL,
        max_tokens=6000,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": (
                f"Titre original : {entry['title']}\n"
                f"Date originale : {entry['date']}\n"
                f"{img_info}\n\n"
                f"HTML du bulletin :\n{clean_html}"
            )
        }]
    )

    raw = "".join(b.text for b in msg.content if b.type == "text").strip()
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
        raw,
        flags=re.DOTALL
    )
    content = re.sub(r"^</div>", "", content.strip())
    if not content.endswith("</div>"):
        content += "</div>"
    if not content.startswith('<div class="bulletin-section">'):
        content = '<div class="bulletin-section">' + content

    return title_fr, subtitle_fr, date_fr, content


def build_page(
    number: str,
    title: str,
    subtitle: str,
    date_fr: str,
    date_iso: str,
    images: list[str],
    content: str,
) -> str:
    hero_img = images[0] if images else "image-01.jpg"
    og_image = hero_img

    try:
        dt = datetime.strptime(date_iso, "%Y-%m-%d")
        release_ts = dt.strftime("%Y-%m-%dT10:00:00Z")
    except Exception:
        release_ts = "2026-01-01T10:00:00Z"

    return HTML_TEMPLATE.format(
        NUMBER=number,
        TITLE=escape(title),
        SUBTITLE=escape(subtitle),
        DATE_FR=date_fr,
        DATE_ISO=date_iso,
        OG_IMAGE=og_image,
        HERO_IMG=hero_img,
        CONTENT=content,
        RELEASE_TS=release_ts,
    )


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
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

        state["seen"].append(entry["url"])
        save_state(state)
        print(f"  ✔ {folder.name}/bulletin-{number}.html ({len(saved_images)} images)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
