#!/usr/bin/env python3
import json, os, re, sys, time
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

BLOG_BASE      = "https://gamerrobot.com/blogs/news/"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MAX_NEW        = int(os.getenv("MAX_NEW_PER_RUN", "3"))
REPO_ROOT      = Path(__file__).resolve().parent
STATE          = REPO_ROOT / "sources.json"
INDEX          = REPO_ROOT / "index.html"
ARCHIVES       = REPO_ROOT / "archives.html"
TIMEOUT        = 30

# Modeles par ordre de preference
GEMINI_MODELS = [
    os.getenv("GEMINI_MODEL", "gemini-1.5-flash-latest"),
    "gemini-3.8-flash",
    "gemini-2.5-flash-lite",
    "gemini-1.5-flash",
]

BULLETIN_PATTERNS = [
    "the-blox-bulletin-{num:03d}",
    "the-blox-bulletin-{num}",
    "blox-bulletin-{num:03d}",
    "blox-bulletin-{num}",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

SYSTEM_PROMPT = """Tu es le redacteur principal de BloxNewsFr, media communautaire francais dedie a Blox Fruits (Roblox).
Traduis fidelement ce bulletin officiel en francais, section par section, sans rien inventer.
Ton : dynamique, tutoiement, vocabulaire communautaire Blox Fruits.
Ne jamais traduire : Rework, Sneak peek, Sea 1/2/3, Buff, Nerf, Bounty, Honor, Build, Combo, Fruit, Farm, PvP.

FORMAT STRICT :
Ligne 1 : TITRE: <titre FR max 80 car>
Ligne 2 : SOUS_TITRE: <sous-titre court>
Ligne 3 : DATE_FR: <date en francais>
Ensuite : HTML avec <h2><p><ul><li><strong><em> uniquement.
Apres chaque section : <div class="summary"><b>Resume :</b> texte</div>
Pas de <html><body><h1>, pas de backticks."""

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Le Bulletin Blox #{NUMBER} – Blox Fruits</title>
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Blox Fruits News">
    <meta property="og:title" content="Le Bulletin Blox #{NUMBER} – Blox Fruits">
    <meta property="og:description" content="Bulletin #{NUMBER} – Toute l'actualité Blox Fruits : mises à jour, événements et news officielles du jeu Roblox Blox Fruits.">
    <meta property="og:image" content="https://bloxnewsfr.github.io/BloxNews-FR/{NUMBER}/img/{OG_IMAGE}">
    <meta property="og:url" content="https://bloxnewsfr.github.io/BloxNews-FR/{NUMBER}/bulletin-{NUMBER}.html">
    <meta property="og:locale" content="fr_FR">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/png" href="../shared/favicon.png">
    <link rel="shortcut icon" href="../shared/bf_logo.png" type="image/png">
    <link href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&family=Inter:wght@300;400;500;600;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0">
    <link rel="stylesheet" href="../shared/bulletin-default.css">
    <link rel="stylesheet" href="../shared/bulletin-lightbox.css">
    <link rel="stylesheet" href="../astuces/astuces.css">
    <link rel="stylesheet" href="../shared/bulletin-engagement.css">
</head>
<body>

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
            <span class="material-symbols-outlined mobile-menu-btn" id="menuToggle">menu</span>
        </div>
    </header>

    <div class="mobile-nav-backdrop" id="mobileNavBackdrop"></div>
    <nav class="mobile-nav-dropdown" id="mobileNav" aria-hidden="true">
        <div class="mnav-header">
            <span class="mnav-header__title">Menu</span>
            <button class="mnav-close" id="mobileNavClose" aria-label="Fermer le menu"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="mnav-links">
            <a href="https://www.roblox.com/fr/games/2753915549/Blox-Fruits" class="mnav-link"><span class="material-symbols-outlined mnav-link__icon">sports_esports</span> Jouer</a>
            <a href="../index.html" class="mnav-link nav-news active"><span class="material-symbols-outlined mnav-link__icon">newspaper</span> News</a>
            <a href="../neo_bulletin.html" class="mnav-link nav-leaks"><span class="material-symbols-outlined mnav-link__icon">key</span> Leaks</a>
            <a href="../archives.html" class="mnav-link"><span class="material-symbols-outlined mnav-link__icon">inventory_2</span> Archive</a>
        </div>
    </nav>

    <main class="bulletin-container">
        <div class="blue-banner">The Blox Bulletin #{NUMBER}</div>
        <div class="hero-image-wrapper">
            <img src="img/{HERO_IMG}" class="hero-image" alt="Bulletin {NUMBER}">
        </div>
        <div class="journal-header">
            <h1 class="journal-title">The Blox Bulletin</h1>
            <p class="journal-subtitle">{SUBTITLE}</p>
            <div class="journal-meta">Numéro : {NUMBER} | {DATE_FR}</div>
        </div>
        <div class="dashed-line"></div>
        {CONTENT}
        <div class="social-share">
            <a href="https://discord.gg/a6S6eugPn" class="td"><img src="../shared/discord.png" class="discord-icon" alt="Discord"> Discord</a>
            <a href="https://tiktok.com/@dc_neolixx" class="tt"><img src="../shared/tiktok.png" class="tiktok-icon" alt="TikTok"> TikTok</a>
            <a href="https://www.youtube.com/@Dc_neolixx" class="ty"><img src="../shared/youtube.png" class="youtube-icon" alt="Youtube"> Youtube</a>
        </div>
        <section class="bulletin-engagement" id="bulletinEngagement" aria-label="Navigation et commentaires du bulletin {NUMBER}" data-max="{NUMBER}">
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
            <a href="../index.html#bulletin-{NUMBER}" class="back-button">← Retour aux Actualités</a>
        </div>
    </main>

<script>
    const menuBtn = document.getElementById('menuToggle');
    const mobileNav = document.getElementById('mobileNav');
    const mobileNavBackdrop = document.getElementById('mobileNavBackdrop');
    const mobileNavClose = document.getElementById('mobileNavClose');
    function openMobileNav() {{
        mobileNav.classList.add('is-open');
        mobileNavBackdrop?.classList.add('is-open');
        menuBtn.textContent = 'close';
        document.body.style.overflow = 'hidden';
    }}
    function closeMobileNav() {{
        mobileNav.classList.remove('is-open');
        mobileNavBackdrop?.classList.remove('is-open');
        menuBtn.textContent = 'menu';
        document.body.style.overflow = '';
    }}
    if (menuBtn && mobileNav) {{
        menuBtn.addEventListener('click', () => mobileNav.classList.contains('is-open') ? closeMobileNav() : openMobileNav());
        mobileNavBackdrop?.addEventListener('click', closeMobileNav);
        mobileNavClose?.addEventListener('click', closeMobileNav);
        document.addEventListener('keydown', e => {{ if (e.key === 'Escape') closeMobileNav(); }});
        mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMobileNav));
    }}
    function toggleDarkMode() {{
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        localStorage.setItem('blox_dark_mode', isDark);
        document.getElementById('darkModeToggle').textContent = isDark ? 'light_mode' : 'dark_mode';
    }}
    (function() {{
        const dark = localStorage.getItem('blox_dark_mode') === 'true' || localStorage.getItem('blox_theme') === 'dark';
        if (dark) {{
            document.body.classList.add('dark-mode');
            document.documentElement.setAttribute('data-theme', 'dark');
            const el = document.getElementById('darkModeToggle');
            if (el) el.textContent = 'light_mode';
        }}
    }})();
</script>
    <script src="../shared/bulletin-lightbox.js"></script>
    <script src="../astuces/astuces.js"></script>
    <script src="../shared/bulletin-engagement.js"></script>
    <script src="../shared/bulletin-editor.js"></script>
</body>
</html>"""


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"seen": [], "last_bulletin_num": 24}

def save_state(state):
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")

def next_folder_number():
    nums = [int(p.name) for p in REPO_ROOT.iterdir() if p.is_dir() and re.fullmatch(r"\d{3}", p.name)]
    return (max(nums) if nums else 0) + 1


def probe_bulletin(num):
    for pattern in BULLETIN_PATTERNS:
        url = BLOG_BASE + pattern.format(num=num)
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
            if r.status_code == 200 and "/blogs/news/" in r.url and r.url.rstrip("/") != "https://gamerrobot.com/blogs/news":
                print(f"  [probe] TROUVE: {url}")
                return {"url": url, "response": r}
            elif r.status_code == 404:
                print(f"  [probe] {url} -> 404")
        except Exception as e:
            print(f"  [probe] {url} -> erreur: {e}")
    return None


def fetch_entries(state):
    last = state.get("last_bulletin_num", 24)
    entries = []
    for num in range(last + 1, last + 4):
        print(f"[detect] sonde bulletin #{num:03d}...")
        result = probe_bulletin(num)
        if result is None:
            break
        soup = BeautifulSoup(result["response"].text, "html.parser")
        body = soup.select_one("article, .article-template, .rte, .article__body, main") or soup
        title_tag = soup.find("h1")
        time_tag = soup.find("time")
        entries.append({
            "num": num,
            "title": title_tag.get_text(strip=True) if title_tag else f"Blox Bulletin #{num:03d}",
            "url": result["url"],
            "date": (time_tag.get("datetime", "")[:10] if time_tag else ""),
            "html": str(body),
        })
    return entries


def extract_images(html, base_url):
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


def download_images(urls, img_dir):
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
        except Exception as e:
            print(f"    image ignoree: {e}")
    return saved


def call_gemini(prompt):
    """Essaie chaque modele avec retry sur 503."""
    for model in GEMINI_MODELS:
        for api_ver in ["v1beta", "v1"]:
            url = f"https://generativelanguage.googleapis.com/{api_ver}/models/{model}:generateContent?key={GEMINI_API_KEY}"
            payload = {
                "contents": [{"parts": [{"text": SYSTEM_PROMPT + "\n\n" + prompt}]}],
                "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.3},
            }
            for attempt in range(3):
                r = requests.post(url, json=payload, timeout=120)
                if r.status_code == 200:
                    print(f"  [gemini] OK avec {model} ({api_ver})")
                    return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
                elif r.status_code == 503:
                    wait = 10 * (attempt + 1)
                    print(f"  [gemini] {model} {api_ver} -> 503, retry dans {wait}s...")
                    time.sleep(wait)
                else:
                    print(f"  [gemini] {model} {api_ver} -> {r.status_code}: {r.text[:100]}")
                    break  # pas la peine de retry sur 404/400
    raise RuntimeError("Tous les modeles Gemini ont echoue.")


def translate_content(entry, image_names):
    soup = BeautifulSoup(entry["html"], "html.parser")
    for i, img in enumerate(soup.find_all("img")):
        if i < len(image_names):
            img["src"] = f"img/{image_names[i]}"
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    img_info = f"\nImages : {', '.join('img/'+n for n in image_names)}. La premiere est le hero." if image_names else ""
    prompt = f"Titre: {entry['title']}\nDate: {entry['date']}{img_info}\n\nHTML:\n{str(soup)}"

    raw = call_gemini(prompt)
    raw = re.sub(r"^```(?:html)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()

    title_fr, subtitle_fr, date_fr = entry["title"], "", entry["date"]
    m = re.match(r"TITRE:\s*(.+)", raw)
    if m:
        title_fr = m.group(1).strip(); raw = raw[m.end():].strip()
    m = re.match(r"SOUS_TITRE:\s*(.+)", raw)
    if m:
        subtitle_fr = m.group(1).strip(); raw = raw[m.end():].strip()
    m = re.match(r"DATE_FR:\s*(.+)", raw)
    if m:
        date_fr = m.group(1).strip(); raw = raw[m.end():].strip()

    content = re.sub(r"(<h2[^>]*>.*?</h2>)", r'</div><div class="bulletin-section">\1', raw, flags=re.DOTALL)
    content = re.sub(r"^</div>", "", content.strip())
    if not content.endswith("</div>"): content += "</div>"
    if not content.startswith('<div class="bulletin-section">'): content = '<div class="bulletin-section">' + content

    return title_fr, subtitle_fr, date_fr, content


def update_index(number, date_iso, images):
    if not INDEX.exists(): return
    hero_img = images[0] if images else "image-01.jpg"
    new_line = f'            {{ num: "{number}", img: "./{number}/img/{hero_img}", href: "./{number}/bulletin-{number}.html", date: "{date_iso}" }},'
    html = INDEX.read_text(encoding="utf-8")
    if f'./{number}/bulletin-{number}.html' in html: return
    pattern = r'(\{ num: "[^"]+", img: "[^"]+", href: "[^"]+", date: "[^"]+" \},?\s*\n)(\s*\];)'
    matches = list(re.finditer(pattern, html))
    if not matches:
        print("  index.html: tableau non trouve"); return
    pos = matches[-1].end(1)
    INDEX.write_text(html[:pos] + new_line + "\n" + html[pos:], encoding="utf-8")
    print(f"  OK index.html mis a jour")


def update_archives(number, images):
    if not ARCHIVES.exists(): return
    hero_img = images[0] if images else "image-01.jpg"
    new_line = f'            {{ num: "{number}", img: "./{number}/img/{hero_img}", href: "./{number}/bulletin-{number}.html" }},'
    html = ARCHIVES.read_text(encoding="utf-8")
    if f'./{number}/bulletin-{number}.html' in html: return
    pattern = r'(\{ num: "[^"]+", img: "[^"]+", href: "[^"]+" \},?\s*\n)(\s*\];)'
    matches = list(re.finditer(pattern, html))
    if not matches:
        print("  archives.html: tableau non trouve"); return
    pos = matches[-1].end(1)
    ARCHIVES.write_text(html[:pos] + new_line + "\n" + html[pos:], encoding="utf-8")
    print(f"  OK archives.html mis a jour")


def patch_previous_pagination(number):
    """Pose data-max sur le bulletin precedent pour la pagination."""
    try:
        n = int(number)
    except ValueError:
        return
    if n <= 1:
        return
    prev = f"{n - 1:03d}"
    path = REPO_ROOT / prev / f"bulletin-{prev}.html"
    if not path.exists():
        return
    html = path.read_text(encoding="utf-8")
    if re.search(rf'bulletinEngagement[^>]*data-max="{number}"', html):
        return
    new_html, count = re.subn(
        r'(<section class="bulletin-engagement"[^>]*?)(\s*data-max="\d+")?(\s*id="bulletinEngagement")',
        rf'\1 data-max="{number}"\3',
        html,
        count=1,
    )
    if count:
        path.write_text(new_html, encoding="utf-8")
        print(f"  OK pagination {prev} -> data-max={number}")


def main():
    if not GEMINI_API_KEY:
        print("GEMINI_API_KEY manquante."); return 1

    state = load_state()
    last = state.get("last_bulletin_num", 24)
    print(f"[state] dernier bulletin connu: #{last:03d}, {len(state.get('seen', []))} URLs vues.")

    entries = fetch_entries(state)
    if not entries:
        print("Aucun nouveau bulletin detecte."); return 0

    for entry in entries[:MAX_NEW]:
        folder_num = f"{next_folder_number():03d}"
        print(f"-> New bulletin {folder_num}: {entry['title']}")
        folder = REPO_ROOT / folder_num
        saved_images = download_images(extract_images(entry["html"], entry["url"]), folder / "img")
        title_fr, subtitle_fr, date_fr, content = translate_content(entry, saved_images)
        hero = saved_images[0] if saved_images else "image-01.jpg"
        page = HTML_TEMPLATE.format(
            NUMBER=folder_num, TITLE=escape(title_fr), SUBTITLE=escape(subtitle_fr),
            DATE_FR=date_fr, OG_IMAGE=hero, HERO_IMG=hero, CONTENT=content,
        )
        (folder / f"bulletin-{folder_num}.html").write_text(page, encoding="utf-8")
        update_index(folder_num, entry["date"], saved_images)
        update_archives(folder_num, saved_images)
        patch_previous_pagination(folder_num)
        state.setdefault("seen", []).append(entry["url"])
        state["last_bulletin_num"] = entry["num"]
        save_state(state)
        print(f"  OK {folder_num}/bulletin-{folder_num}.html ({len(saved_images)} images)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
