#!/usr/bin/env python3
"""
fetch_bulletin.py - Blox Fruits FR auto-bulletin
Utilise Google Gemini (gratuit) pour traduire les bulletins.
Strategique : sonde les URLs previsibles des bulletins au lieu de scraper.
"""

import json
import os
import re
import sys
import time
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------
BLOG_BASE      = "https://gamerrobot.com/blogs/news/"
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MAX_NEW        = int(os.getenv("MAX_NEW_PER_RUN", "3"))
REPO_ROOT      = Path(__file__).resolve().parent
STATE          = REPO_ROOT / "sources.json"
INDEX          = REPO_ROOT / "index.html"
TIMEOUT        = 30

# Pattern des URLs de bulletins GamerRobot
BULLETIN_URL_PATTERNS = [
    "the-blox-bulletin-{num:03d}",
    "the-blox-bulletin-{num}",
    "blox-bulletin-{num:03d}",
    "blox-bulletin-{num}",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Cache-Control": "max-age=0",
}

# ---------------------------------------------------------------------------
# PROMPT
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """Tu es le redacteur principal du site BloxNewsFr, le media communautaire francais dedie a Blox Fruits (Roblox). Tu recois le contenu HTML brut d'un bulletin officiel en anglais publie par GamerRobot.

TA MISSION :
- Traduire fidelement le bulletin en francais, section par section, sans rien inventer.
- Adopter un ton dynamique, fluide et accrocheur, directement adresse aux joueurs.
- Utiliser le jargon communautaire francais de Blox Fruits.
- Ajouter a la fin de chaque section un encadre resume.

VOCABULAIRE OBLIGATOIRE (ne jamais traduire) :
Rework, Sneak peek, Teaser, Sea 1/2/3, Buff, Nerf, Stock, Dealer, Bounty, Honor, Stats, Build, Spam, Combo, Leak, Leaker, Race, Update, Fruit, Grinding, Farm, PvP, PvE

TON : tutoiement, enthousiaste mais clair, fidele a l'original.

FORMAT DE SORTIE STRICT :
Ligne 1 : "TITRE: <titre FR accrocheur max 80 caracteres>"
Ligne 2 : "SOUS_TITRE: <sous-titre FR court>"
Ligne 3 : "DATE_FR: <date en francais, ex: 31 Juillet 2026>"
Ensuite uniquement du HTML avec <h2>, <p>, <ul>, <li>, <strong>, <em>.
A la fin de chaque section : <div class="summary"><b>Resume :</b> [resume court]</div>
Pas de <html>, <body>, <h1>, pas de backticks Markdown."""

# ---------------------------------------------------------------------------
# TEMPLATE HTML
# ---------------------------------------------------------------------------
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Neo Bulletin #{NUMBER} - {TITLE}</title>
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Blox Fruits News">
    <meta property="og:title" content="Neo Bulletin #{NUMBER} - {TITLE}">
    <meta property="og:description" content="Bulletin #{NUMBER} - Toute l'actualite Blox Fruits.">
    <meta property="og:image" content="https://bloxnewsfr.github.io/BloxNews-FR/{NUMBER}/img/{OG_IMAGE}">
    <meta property="og:url" content="https://bloxnewsfr.github.io/BloxNews-FR/{NUMBER}/bulletin-{NUMBER}.html">
    <meta property="og:locale" content="fr_FR">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/png" href="../shared/favicon.png">
    <link rel="shortcut icon" href="../shared/bf_logo.png" type="image/png">
    <link href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&family=Inter:wght@300;400;500;600;700;900&display=swap" rel="stylesheet">
    <style>
        :root {{ --color-text: #333132; --color-primary: #ffda00; }}
        * {{ box-sizing: border-box; }}
        body {{ margin: 0; font-family: 'Inter', sans-serif; color: var(--color-text); background: #fff; min-height: 100vh; display: flex; flex-direction: column; }}
        .site-header {{ display: flex; align-items: center; justify-content: center; padding: 0 55px; position: sticky; top: 0; z-index: 1000; height: 72px; background: rgba(255,255,255,0.9); backdrop-filter: blur(50px); border-bottom: 1px solid rgba(0,0,0,0.1); }}
        .site-header__logo {{ position: absolute; left: 55px; }}
        .site-header__logo img {{ height: 42px; width: auto; display: block; }}
        .site-nav {{ display: flex; gap: 8px; padding: 0; margin: 0; list-style: none; }}
        .site-nav a {{ color: rgba(0,0,0,0.85); text-decoration: none; font-weight: 900; font-size: 17px; text-transform: uppercase; padding: 8px 16px; border-radius: 10px; transition: background 0.2s; }}
        .site-nav a:hover {{ background: var(--color-primary); color: #000; }}
        .site-header__icons {{ display: flex; gap: 12px; color: rgba(0,0,0,0.85); cursor: pointer; align-items: center; position: absolute; right: 55px; }}
        .main-content {{ flex: 1; display: flex; flex-direction: column; align-items: center; }}
        .bulletin-container {{ max-width: 1100px; margin: 40px auto; padding: 0 24px; width: 100%; }}
        .blue-banner {{ display: block; text-align: center; background: linear-gradient(135deg,#175ec2,#2980d4,#175ec2); color: #fff; padding: 16px 60px; font-size: 36px; text-transform: uppercase; letter-spacing: 3px; border-radius: 100px; font-weight: 900; margin-bottom: 20px; }}
        .hero-image-wrapper {{ width: 100%; margin-bottom: 6px; }}
        .hero-image {{ width: 100%; height: auto; display: block; border-radius: 20px; box-shadow: 0 8px 30px rgba(0,0,0,0.1); }}
        .publish-date {{ font-size: 12px; color: rgba(0,0,0,0.4); margin-bottom: 18px; }}
        .journal-header {{ text-align: center; margin-top: 30px; }}
        .journal-title {{ font-size: 38px; font-weight: bold; color: #111; margin: 0 0 10px; }}
        .journal-subtitle {{ font-style: italic; font-size: 18px; color: #555; margin: 0 0 25px; }}
        .journal-meta {{ font-weight: bold; font-size: 14px; color: #111; margin-bottom: 12px; text-transform: uppercase; }}
        .dashed-line {{ border-top: 1px dashed #ccc; margin: 20px 0 35px; }}
        .bulletin-section {{ margin-bottom: 40px; }}
        .bulletin-section h2 {{ border-bottom: 2px solid #111; padding-bottom: 5px; font-size: 22px; font-weight: 900; margin: 0 0 8px; color: #111; }}
        .bulletin-section p {{ font-size: 14.5px; line-height: 1.6; margin: 0 0 12px; }}
        .bulletin-section ul {{ padding-left: 20px; margin: 0 0 12px; }}
        .bulletin-section li {{ font-size: 14.5px; line-height: 1.6; margin-bottom: 6px; }}
        .bulletin-section img {{ width: 100%; height: auto; border-radius: 14px; margin: 16px 0; box-shadow: 0 4px 20px rgba(0,0,0,0.1); display: block; }}
        .summary {{ background: rgba(88,101,242,0.09); border-left: 4px solid #5865f2; padding: 12px 16px; margin-top: 15px; font-size: 13.5px; font-style: italic; color: #2c3e50; border-radius: 0 6px 6px 0; }}
        .social-share {{ display: flex; justify-content: center; gap: 12px; margin: 30px 0; flex-wrap: wrap; }}
        .social-share a {{ display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 100px; font-size: 13px; font-weight: 900; text-decoration: none; text-transform: uppercase; }}
        .social-share a.td {{ background: #5865F2; color: #fff; }}
        .social-share a.tt {{ background: linear-gradient(135deg,#1d56f2,#f21de4); color: #fff; }}
        .social-share a.ty {{ background: #ec1717; color: #fff; }}
        .back-button-container {{ text-align: center; margin: 40px 0 50px; }}
        .back-button {{ background: linear-gradient(135deg,#ffda00,#ffc200); color: #000; text-decoration: none; font-weight: 900; padding: 11px 24px; border-radius: 100px; font-size: 13px; text-transform: uppercase; display: inline-block; }}
        @media (max-width: 768px) {{ .blue-banner {{ font-size: 24px; padding: 12px 30px; }} .site-header {{ padding: 0 16px; }} .site-header__logo {{ left: 16px; }} .site-header__icons {{ right: 16px; }} .site-nav {{ display: none; }} }}
    </style>
</head>
<body>
    <header class="site-header">
        <div class="site-header__logo"><img src="../BF_news.png" alt="Blox Fruits"></div>
        <nav><ul class="site-nav">
            <li><a href="https://www.roblox.com/fr/games/2753915549/Blox-Fruits">Game</a></li>
            <li><a href="../index.html">News</a></li>
            <li><a href="../neo_bulletin.html">Leaks</a></li>
            <li><a href="../archives.html">Archives</a></li>
        </ul></nav>
    </header>
    <main class="main-content">
        <div class="bulletin-container">
            <div class="blue-banner">The Blox Bulletin #{NUMBER}</div>
            <div class="hero-image-wrapper">
                <img src="img/{HERO_IMG}" class="hero-image" alt="The Blox Bulletin {NUMBER}">
            </div>
            <div class="publish-date">{DATE_FR}</div>
            <div class="journal-header">
                <h1 class="journal-title">{TITLE}</h1>
                <p class="journal-subtitle">{SUBTITLE}</p>
                <div class="journal-meta">Numero : {NUMBER} | {DATE_FR}</div>
            </div>
            <div class="dashed-line"></div>
            {CONTENT}
            <div style="text-align:center;font-style:italic;background:#f8f8f8;border:1px solid #ddd;border-radius:12px;padding:24px;margin-bottom:30px">
                <p style="margin:0;font-size:15px"><em>Ceci conclut le Blox Bulletin #{NUMBER}. Restez connectes !</em></p>
            </div>
            <div class="social-share">
                <a href="https://discord.gg/a6S6eugPn" class="td">Discord</a>
                <a href="https://tiktok.com/@dc_neolixx" class="tt">TikTok</a>
                <a href="https://www.youtube.com/@Dc_neolixx" class="ty">Youtube</a>
            </div>
            <div class="back-button-container">
                <a href="../index.html#bulletin-{NUMBER}" class="back-button">&larr; Retour aux Actualites</a>
            </div>
        </div>
    </main>
</body>
</html>"""


# ---------------------------------------------------------------------------
# STATE
# ---------------------------------------------------------------------------
def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"seen": [], "last_bulletin_num": 24}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def next_folder_number() -> int:
    nums = [int(p.name) for p in REPO_ROOT.iterdir()
            if p.is_dir() and re.fullmatch(r"\d{3}", p.name)]
    return (max(nums) if nums else 0) + 1


# ---------------------------------------------------------------------------
# DETECTION DES NOUVEAUX BULLETINS
# ---------------------------------------------------------------------------
def probe_bulletin(num: int) -> dict | None:
    """Tente de charger le bulletin numero 'num' en testant les patterns d'URL connus.
    Retourne un dict avec url+html si trouve, None sinon.
    """
    for pattern in BULLETIN_URL_PATTERNS:
        slug = pattern.format(num=num)
        url = BLOG_BASE + slug
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
            # 200 = existe, 404 = n'existe pas encore
            if r.status_code == 200:
                # Verifie que c'est bien une page article (pas une redirect vers /blogs/news)
                final_url = r.url.rstrip("/")
                if final_url == "https://gamerrobot.com/blogs/news" or "/blogs/news" not in final_url:
                    print(f"  [probe] {url} -> redirect vers page principale, skip")
                    continue
                print(f"  [probe] TROUVE: {url} (status {r.status_code})")
                return {"url": url, "html_response": r, "slug": slug}
            elif r.status_code == 404:
                print(f"  [probe] {url} -> 404 (n'existe pas encore)")
            else:
                print(f"  [probe] {url} -> {r.status_code}")
        except Exception as exc:
            print(f"  [probe] {url} -> erreur: {exc}")
    return None


def fetch_entries(state: dict) -> list[dict]:
    """Cherche les bulletins suivant le dernier connu."""
    last = state.get("last_bulletin_num", 24)
    entries = []
    # Sonde les 3 prochains numeros possibles
    for num in range(last + 1, last + 4):
        print(f"[detect] sonde bulletin #{num:03d}...")
        result = probe_bulletin(num)
        if result is None:
            print(f"[detect] bulletin #{num:03d} pas encore disponible.")
            break  # si le num+1 n'existe pas, inutile de tester num+2
        # Parse le HTML
        soup = BeautifulSoup(result["html_response"].text, "html.parser")
        body = soup.select_one("article, .article-template, .rte, .article__body, main") or soup
        title_tag = soup.find("h1")
        time_tag = soup.find("time")
        title = title_tag.get_text(strip=True) if title_tag else f"Blox Bulletin #{num:03d}"
        date = (time_tag.get("datetime", "")[:10] if time_tag else "")
        entries.append({
            "num": num,
            "title": title,
            "url": result["url"],
            "date": date,
            "html": str(body),
        })
    return entries


# ---------------------------------------------------------------------------
# TRAITEMENT
# ---------------------------------------------------------------------------
def extract_images(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    images = []
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        if not src:
            continue
        full = urljoin(base_url, src)
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
            print(f"    image ignoree ({url}): {exc}")
    return saved


def call_gemini(prompt: str) -> str:
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}")
    payload = {
        "contents": [{"parts": [{"text": SYSTEM_PROMPT + "\n\n" + prompt}]}],
        "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.3},
    }
    r = requests.post(url, json=payload, timeout=120)
    r.raise_for_status()
    data = r.json()
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def translate_content(entry: dict, image_names: list[str]) -> tuple[str, str, str, str]:
    img_info = ""
    if image_names:
        img_info = "\n\nImages disponibles dans img/ :\n"
        img_info += "\n".join(f"  - img/{n}" for n in image_names)
        img_info += "\nLa premiere image est le hero banner."

    soup = BeautifulSoup(entry["html"], "html.parser")
    for i, img in enumerate(soup.find_all("img")):
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

    title_fr, subtitle_fr, date_fr = entry["title"], "", entry["date"]

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
        raw, flags=re.DOTALL,
    )
    content = re.sub(r"^</div>", "", content.strip())
    if not content.endswith("</div>"):
        content += "</div>"
    if not content.startswith('<div class="bulletin-section">'):
        content = '<div class="bulletin-section">' + content

    return title_fr, subtitle_fr, date_fr, content


def build_page(number, title, subtitle, date_fr, images, content):
    hero_img = images[0] if images else "image-01.jpg"
    return HTML_TEMPLATE.format(
        NUMBER=number, TITLE=escape(title), SUBTITLE=escape(subtitle),
        DATE_FR=date_fr, OG_IMAGE=hero_img,
        HERO_IMG=hero_img, CONTENT=content,
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
        print(f"  index.html : bulletin {number} deja present, skip.")
        return
    pattern = r'(\{ num: "[^"]+", img: "[^"]+", href: "[^"]+", date: "[^"]+" \},?\s*\n)(\s*\];)'
    matches = list(re.finditer(pattern, html))
    if not matches:
        print("  index.html : tableau bulletins non trouve, skip.")
        return
    insert_pos = matches[-1].end(1)
    html = html[:insert_pos] + new_line + "\n" + html[insert_pos:]
    INDEX.write_text(html, encoding="utf-8")
    print(f"  OK index.html mis a jour avec bulletin {number}")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def main() -> int:
    if not GEMINI_API_KEY:
        print("GEMINI_API_KEY manquante.")
        return 1

    state = load_state()
    last = state.get("last_bulletin_num", 24)
    print(f"[state] dernier bulletin connu: #{last:03d}, {len(state.get('seen', []))} URLs vues.")

    entries = fetch_entries(state)
    if not entries:
        print("Aucun nouveau bulletin detecte.")
        return 0

    for entry in entries[:MAX_NEW]:
        folder_num = f"{next_folder_number():03d}"
        print(f"-> New bulletin {folder_num}: {entry['title']}")

        folder = REPO_ROOT / folder_num
        saved_images = download_images(extract_images(entry["html"], entry["url"]), folder / "img")

        title_fr, subtitle_fr, date_fr, content = translate_content(entry, saved_images)
        page = build_page(folder_num, title_fr, subtitle_fr, date_fr, saved_images, content)
        (folder / f"bulletin-{folder_num}.html").write_text(page, encoding="utf-8")

        update_index(folder_num, entry["date"], saved_images)

        # Met a jour le state
        state.setdefault("seen", []).append(entry["url"])
        state["last_bulletin_num"] = entry["num"]
        save_state(state)
        print(f"  OK {folder.name}/bulletin-{folder_num}.html ({len(saved_images)} images)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
