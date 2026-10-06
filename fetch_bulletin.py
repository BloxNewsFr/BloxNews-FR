#!/usr/bin/env python3
import json, os, re, sys, time
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

BLOG_BASE      = "https://gamerrobot.com/blogs/news/"
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MAX_NEW        = int(os.getenv("MAX_NEW_PER_RUN", "3"))
REPO_ROOT      = Path(__file__).resolve().parent
STATE          = REPO_ROOT / "sources.json"
INDEX          = REPO_ROOT / "index.html"
TIMEOUT        = 30

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
    <title>Neo Bulletin #{NUMBER} - {TITLE}</title>
    <meta property="og:title" content="Neo Bulletin #{NUMBER} - {TITLE}">
    <meta property="og:image" content="https://bloxnewsfr.github.io/BloxNews-FR/{NUMBER}/img/{OG_IMAGE}">
    <meta property="og:url" content="https://bloxnewsfr.github.io/BloxNews-FR/{NUMBER}/bulletin-{NUMBER}.html">
    <link rel="icon" type="image/png" href="../shared/bf_logo.png">
    <link href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&family=Inter:wght@300;400;500;600;700;900&display=swap" rel="stylesheet">
    <style>
        :root {{ --primary: #ffda00; }}
        * {{ box-sizing: border-box; }}
        body {{ margin:0; font-family:'Inter',sans-serif; color:#333; background:#fff; }}
        .site-header {{ display:flex; align-items:center; justify-content:center; padding:0 55px; position:sticky; top:0; z-index:1000; height:72px; background:rgba(255,255,255,0.9); backdrop-filter:blur(50px); border-bottom:1px solid rgba(0,0,0,0.1); }}
        .site-header__logo {{ position:absolute; left:55px; }}
        .site-header__logo img {{ height:42px; }}
        .site-nav {{ display:flex; gap:8px; list-style:none; margin:0; padding:0; }}
        .site-nav a {{ color:rgba(0,0,0,0.85); text-decoration:none; font-weight:900; font-size:17px; text-transform:uppercase; padding:8px 16px; border-radius:10px; }}
        .site-nav a:hover {{ background:var(--primary); }}
        .bulletin-container {{ max-width:1100px; margin:40px auto; padding:0 24px; }}
        .blue-banner {{ display:block; text-align:center; background:linear-gradient(135deg,#175ec2,#2980d4); color:#fff; padding:16px 60px; font-size:36px; text-transform:uppercase; letter-spacing:3px; border-radius:100px; font-weight:900; margin-bottom:20px; }}
        .hero-image {{ width:100%; height:auto; border-radius:20px; margin-bottom:6px; }}
        .publish-date {{ font-size:12px; color:rgba(0,0,0,0.4); margin-bottom:18px; }}
        .journal-title {{ font-size:38px; font-weight:bold; text-align:center; margin:30px 0 10px; }}
        .journal-subtitle {{ font-style:italic; font-size:18px; color:#555; text-align:center; }}
        .dashed-line {{ border-top:1px dashed #ccc; margin:20px 0 35px; }}
        .bulletin-section {{ margin-bottom:40px; }}
        .bulletin-section h2 {{ border-bottom:2px solid #111; padding-bottom:5px; font-size:22px; font-weight:900; }}
        .bulletin-section p,.bulletin-section li {{ font-size:14.5px; line-height:1.6; }}
        .bulletin-section img {{ width:100%; border-radius:14px; margin:16px 0; }}
        .summary {{ background:rgba(88,101,242,0.09); border-left:4px solid #5865f2; padding:12px 16px; margin-top:15px; font-size:13.5px; font-style:italic; border-radius:0 6px 6px 0; }}
        .social-share {{ display:flex; justify-content:center; gap:12px; margin:30px 0; }}
        .social-share a {{ padding:10px 18px; border-radius:100px; font-size:13px; font-weight:900; text-decoration:none; color:#fff; text-transform:uppercase; }}
        .td {{ background:#5865F2; }} .tt {{ background:linear-gradient(135deg,#1d56f2,#f21de4); }} .ty {{ background:#ec1717; }}
        .back-button {{ background:linear-gradient(135deg,#ffda00,#ffc200); color:#000; text-decoration:none; font-weight:900; padding:11px 24px; border-radius:100px; font-size:13px; text-transform:uppercase; display:inline-block; margin:40px auto; display:block; text-align:center; width:fit-content; }}
        @media(max-width:768px) {{ .blue-banner {{ font-size:24px; padding:12px 30px; }} .site-nav {{ display:none; }} }}
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
    <main>
        <div class="bulletin-container">
            <div class="blue-banner">The Blox Bulletin #{NUMBER}</div>
            <img src="img/{HERO_IMG}" class="hero-image" alt="Bulletin {NUMBER}">
            <div class="publish-date">{DATE_FR}</div>
            <h1 class="journal-title">{TITLE}</h1>
            <p class="journal-subtitle">{SUBTITLE}</p>
            <div class="dashed-line"></div>
            {CONTENT}
            <div style="text-align:center;font-style:italic;background:#f8f8f8;border:1px solid #ddd;border-radius:12px;padding:24px;margin-bottom:30px">
                <p><em>Ceci conclut le Blox Bulletin #{NUMBER}. Restez connectes !</em></p>
            </div>
            <div class="social-share">
                <a href="https://discord.gg/a6S6eugPn" class="td">Discord</a>
                <a href="https://tiktok.com/@dc_neolixx" class="tt">TikTok</a>
                <a href="https://www.youtube.com/@Dc_neolixx" class="ty">Youtube</a>
            </div>
            <a href="../index.html#bulletin-{NUMBER}" class="back-button">&larr; Retour aux Actualites</a>
        </div>
    </main>
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
    # Essaie v1 puis v1beta
    for api_version in ["v1", "v1beta"]:
        url = f"https://generativelanguage.googleapis.com/{api_version}/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        payload = {
            "contents": [{"parts": [{"text": SYSTEM_PROMPT + "\n\n" + prompt}]}],
            "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.3},
        }
        r = requests.post(url, json=payload, timeout=120)
        if r.status_code == 200:
            return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        print(f"  [gemini] {api_version} -> {r.status_code}: {r.text[:200]}")
    r.raise_for_status()


def translate_content(entry, image_names):
    soup = BeautifulSoup(entry["html"], "html.parser")
    for i, img in enumerate(soup.find_all("img")):
        if i < len(image_names):
            img["src"] = f"img/{image_names[i]}"
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    img_info = ""
    if image_names:
        img_info = f"\nImages : {', '.join('img/'+n for n in image_names)}. La premiere est le hero."

    prompt = f"Titre: {entry['title']}\nDate: {entry['date']}{img_info}\n\nHTML:\n{str(soup)}"
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

    content = re.sub(r"(<h2[^>]*>.*?</h2>)", r'</div><div class="bulletin-section">\1', raw, flags=re.DOTALL)
    content = re.sub(r"^</div>", "", content.strip())
    if not content.endswith("</div>"):
        content += "</div>"
    if not content.startswith('<div class="bulletin-section">'):
        content = '<div class="bulletin-section">' + content

    return title_fr, subtitle_fr, date_fr, content


def update_index(number, date_iso, images):
    if not INDEX.exists():
        return
    hero_img = images[0] if images else "image-01.jpg"
    new_line = f'            {{ num: "{number}", img: "./{number}/img/{hero_img}", href: "./{number}/bulletin-{number}.html", date: "{date_iso}" }},'
    html = INDEX.read_text(encoding="utf-8")
    if f'./{number}/bulletin-{number}.html' in html:
        return
    pattern = r'(\{ num: "[^"]+", img: "[^"]+", href: "[^"]+", date: "[^"]+" \},?\s*\n)(\s*\];)'
    matches = list(re.finditer(pattern, html))
    if not matches:
        print("  index.html: tableau non trouve")
        return
    pos = matches[-1].end(1)
    html = html[:pos] + new_line + "\n" + html[pos:]
    INDEX.write_text(html, encoding="utf-8")
    print(f"  OK index.html mis a jour")


def main():
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

        hero = saved_images[0] if saved_images else "image-01.jpg"
        page = HTML_TEMPLATE.format(
            NUMBER=folder_num, TITLE=escape(title_fr), SUBTITLE=escape(subtitle_fr),
            DATE_FR=date_fr, OG_IMAGE=hero, HERO_IMG=hero, CONTENT=content,
        )
        (folder / f"bulletin-{folder_num}.html").write_text(page, encoding="utf-8")
        update_index(folder_num, entry["date"], saved_images)

        state.setdefault("seen", []).append(entry["url"])
        state["last_bulletin_num"] = entry["num"]
        save_state(state)
        print(f"  OK {folder_num}/bulletin-{folder_num}.html ({len(saved_images)} images)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
