#!/usr/bin/env python3
"""
fetch_bulletin.py
Détecte les nouveaux bulletins Blox Fruits sur GamerRobot, les traduit/résume
en français via l'API Anthropic, télécharge les images et génère
NNN/bulletin-NNN.html dans le dépôt.

Usage :
    python fetch_bulletin.py          # publie les nouveaux bulletins
    python fetch_bulletin.py --init   # marque les bulletins actuels comme "déjà vus"
                                      # (à lancer UNE fois au tout début)
"""

import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from html import escape
from pathlib import Path
from urllib.parse import urljoin, urlparse

import anthropic
import requests
from bs4 import BeautifulSoup

# ----------------------------------------------------------------------------
# CONFIGURATION
# ----------------------------------------------------------------------------
BLOG_URL = "https://gamerrobot.com/blogs/news"
FEED_URL = BLOG_URL + ".atom"          # Le blog est sous Shopify : flux Atom dispo
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
MAX_NEW_PER_RUN = int(os.getenv("MAX_NEW_PER_RUN", "3"))
REPO_ROOT = Path(__file__).resolve().parent
STATE_FILE = REPO_ROOT / "sources.json"  # mémorise les URLs déjà publiées
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BloxBulletinBot/1.0)"}
TIMEOUT = 30

# Mots-clés pour ne garder que les bulletins Blox Fruits (vide = tout garder)
KEYWORDS = ["blox fruits", "blox fruit"]

# ----------------------------------------------------------------------------
# TEMPLATE HTML  --> ADAPTE-LE à la structure exacte de tes pages existantes
# Variables : {title} {number} {date} {source_url} {hero} {content} {gallery}
# ----------------------------------------------------------------------------
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bulletin #{number} – {title}</title>
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <header>
    <a href="../index.html">&larr; Retour aux bulletins</a>
  </header>
  <main class="bulletin">
    <h1>{title}</h1>
    <p class="date">Publié le {date}</p>
    {hero}
    <article>
{content}
    </article>
    {gallery}
    <p class="source">Source officielle :
      <a href="{source_url}" target="_blank" rel="noopener">GamerRobot</a>
    </p>
  </main>
</body>
</html>
"""

SYSTEM_PROMPT = """Tu es le rédacteur d'un site communautaire français dédié à Blox Fruits (Roblox).
Tu reçois le texte d'un bulletin officiel en anglais. Tu le traduis ET le résumes en français
avec un ton dynamique, enthousiaste et adapté aux joueurs (tutoiement, vocabulaire de la
communauté). Garde en anglais les noms propres du jeu (fruits, îles, boss, items) sauf s'il
existe un usage français établi. Ne rien inventer : reste fidèle aux infos du texte.

FORMAT DE SORTIE STRICT :
- Ligne 1 : "TITRE: <titre français accrocheur>"
- Ensuite uniquement du HTML propre, en utilisant seulement <h2>, <p>, <ul>, <li>, <strong>.
- Pas de <html>, <body>, <h1>, pas de balises de code Markdown, pas de commentaires."""


# ----------------------------------------------------------------------------
# OUTILS
# ----------------------------------------------------------------------------
def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"seen": []}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def next_folder_number() -> int:
    nums = [int(p.name) for p in REPO_ROOT.iterdir() if p.is_dir() and re.fullmatch(r"\d{3}", p.name)]
    return (max(nums) if nums else 0) + 1


def fetch_entries() -> list[dict]:
    """Retourne les articles du blog (du plus récent au plus ancien)."""
    entries = fetch_from_atom()
    if entries:
        return entries
    print("Flux Atom indisponible, bascule sur le scraping HTML.")
    return fetch_from_html()


def fetch_from_atom() -> list[dict]:
    try:
        r = requests.get(FEED_URL, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        ns = {"a": "http://www.w3.org/2005/Atom"}
        root = ET.fromstring(r.content)
        out = []
        for e in root.findall("a:entry", ns):
            link = None
            for l in e.findall("a:link", ns):
                if l.get("rel", "alternate") == "alternate":
                    link = l.get("href")
                    break
            content = e.findtext("a:content", default="", namespaces=ns) or e.findtext(
                "a:summary", default="", namespaces=ns
            )
            out.append(
                {
                    "title": (e.findtext("a:title", default="", namespaces=ns) or "").strip(),
                    "url": link,
                    "date": (e.findtext("a:published", default="", namespaces=ns) or "")[:10],
                    "html": content,
                }
            )
        return [x for x in out if x["url"]]
    except Exception as exc:  # noqa: BLE001
        print(f"[atom] erreur : {exc}")
        return []


def fetch_from_html() -> list[dict]:
    r = requests.get(BLOG_URL, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    links, seen = [], set()
    for a in soup.select("a[href*='/blogs/news/']"):
        href = urljoin(BLOG_URL, a["href"]).split("?")[0]
        if href.rstrip("/") == BLOG_URL.rstrip("/") or href in seen:
            continue
        seen.add(href)
        links.append(href)
    out = []
    for url in links:
        pr = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        pr.raise_for_status()
        ps = BeautifulSoup(pr.text, "html.parser")
        body = ps.select_one("article, .article-template, .rte, main") or ps
        title_tag = ps.find("h1")
        time_tag = ps.find("time")
        out.append(
            {
                "title": title_tag.get_text(strip=True) if title_tag else url,
                "url": url,
                "date": (time_tag.get("datetime", "")[:10] if time_tag else ""),
                "html": str(body),
            }
        )
    return out


def is_relevant(entry: dict) -> bool:
    if not KEYWORDS:
        return True
    haystack = (entry["title"] + " " + BeautifulSoup(entry["html"], "html.parser").get_text()).lower()
    return any(k in haystack for k in KEYWORDS)


def extract_text_and_images(entry: dict) -> tuple[str, list[str]]:
    soup = BeautifulSoup(entry["html"], "html.parser")
    images = []
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src")
        if not src:
            continue
        full = urljoin(entry["url"], src)
        if full.startswith("//"):
            full = "https:" + full
        if full not in images:
            images.append(full)
    for tag in soup(["script", "style", "img", "svg"]):
        tag.decompose()
    text = soup.get_text("\n", strip=True)
    return text, images


def translate(title: str, text: str) -> tuple[str, str]:
    client = anthropic.Anthropic()  # lit ANTHROPIC_API_KEY dans l'environnement
    msg = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Titre original : {title}\n\nTexte du bulletin :\n{text}",
            }
        ],
    )
    out = "".join(b.text for b in msg.content if b.type == "text").strip()
    out = re.sub(r"^```(?:html)?\s*|\s*```$", "", out, flags=re.MULTILINE).strip()
    m = re.match(r"TITRE:\s*(.+)", out)
    fr_title = m.group(1).strip() if m else title
    html_body = out[m.end():].strip() if m else out
    return fr_title, html_body


def download_images(urls: list[str], img_dir: Path) -> list[str]:
    img_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for i, url in enumerate(urls, start=1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            ext = Path(urlparse(url).path).suffix.lower()
            if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
                ext = ".jpg"
            name = f"image-{i:02d}{ext}"
            (img_dir / name).write_bytes(r.content)
            saved.append(name)
        except Exception as exc:  # noqa: BLE001
            print(f"  image ignorée ({url}) : {exc}")
    return saved


def build_page(number: str, title: str, date: str, source_url: str, content: str, images: list[str]) -> str:
    hero = f'<img class="hero" src="img/{images[0]}" alt="{escape(title)}">' if images else ""
    rest = images[1:]
    gallery = ""
    if rest:
        figs = "\n".join(f'      <img src="img/{n}" alt="Image {i}">' for i, n in enumerate(rest, start=2))
        gallery = f'<section class="gallery">\n{figs}\n    </section>'
    indented = "\n".join("      " + line for line in content.splitlines())
    return HTML_TEMPLATE.format(
        title=escape(title),
        number=number,
        date=date or "—",
        source_url=source_url,
        hero=hero,
        content=indented,
        gallery=gallery,
    )


# ----------------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------------
def main() -> int:
    init_mode = "--init" in sys.argv
    state = load_state()
    entries = fetch_entries()
    if not entries:
        print("Aucun article récupéré.")
        return 1

    if init_mode:
        state["seen"] = sorted({*state["seen"], *(e["url"] for e in entries)})
        save_state(state)
        print(f"{len(entries)} articles marqués comme déjà vus. Lance maintenant le script normalement.")
        return 0

    new = [e for e in entries if e["url"] not in state["seen"] and is_relevant(e)]
    if not new:
        print("Aucun nouveau bulletin.")
        return 0

    # Du plus ancien au plus récent, pour garder une numérotation chronologique
    new = list(reversed(new))[:MAX_NEW_PER_RUN]

    for entry in new:
        number = f"{next_folder_number():03d}"
        print(f"→ Nouveau bulletin {number} : {entry['title']}")
        text, image_urls = extract_text_and_images(entry)
        fr_title, content = translate(entry["title"], text)

        folder = REPO_ROOT / number
        saved = download_images(image_urls, folder / "img")
        page = build_page(number, fr_title, entry["date"], entry["url"], content, saved)
        (folder / f"bulletin-{number}.html").write_text(page, encoding="utf-8")

        state["seen"].append(entry["url"])
        save_state(state)  # sauvegarde après chaque article
        print(f"  ✔ {folder.name}/bulletin-{number}.html créé ({len(saved)} image(s))")

    return 0


if __name__ == "__main__":
    sys.exit(main())
