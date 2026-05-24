import os
import time
import requests
from bs4 import BeautifulSoup
from deep_translator import GoogleTranslator

# --- CONFIGURATION INITIALE ---
BLOG_URL = "https://gamerrobot.com/blogs/news"
BASE_URL = "https://gamerrobot.com"
DOSSIER_BASE = "/Users/Admin/Documents/Neolixx News/blox-bulletinfr"
INDEX_FILE = os.path.join(DOSSIER_BASE, "index.html")
MEMORY_FILE = os.path.join(DOSSIER_BASE, "dernier_article.txt")
CHECK_INTERVAL = 3600 

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# --- FONCTIONS ---

def traduire(texte):
    try:
        return GoogleTranslator(source='en', target='fr').translate(texte)
    except:
        return texte

def telecharger_image(url, dossier_relatif, nom_fichier):
    # Chemin complet pour le téléchargement
    dossier_complet = os.path.join(DOSSIER_BASE, dossier_relatif)
    if not os.path.exists(dossier_complet):
        os.makedirs(dossier_complet)
    
    chemin_complet = os.path.join(dossier_complet, nom_fichier)
    try:
        reponse = requests.get(url, headers=HEADERS)
        with open(chemin_complet, 'wb') as f:
            f.write(reponse.content)
        # Retourne le chemin relatif pour le HTML
        return f"{dossier_relatif}/{nom_fichier}"
    except:
        return ""

def mettre_a_jour_index(titre_fr, chemin_image_relatif, lien_page_html):
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        contenu = f.read()

    nouvelle_carte = f"""
            <article class="news-card">
                <div class="news-card__image-wrapper">
                    <img src="{chemin_image_relatif}" class="news-card__image" alt="Nouveau Bulletin">
                </div>
                <div class="news-card__content">
                    <div class="news-card__date">The Blox Bulletin - Nouveau !</div>
                    <h2 class="news-card__title">{titre_fr}</h2>
                    <a href="{lien_page_html}" class="news-card__button">Voir plus</a>
                </div>
            </article>
"""
    balise_cible = '<div class="news-grid">'
    if balise_cible in contenu:
        nouveau_contenu = contenu.replace(balise_cible, f'{balise_cible}{nouvelle_carte}')
        with open(INDEX_FILE, 'w', encoding='utf-8') as f:
            f.write(nouveau_contenu)
        print("✅ index.html mis à jour !")
    else:
        print("❌ Grille <div class='news-grid'> introuvable.")

def generer_page_article(titre_fr, contenu_fr, chemin_image, nom_fichier):
    chemin_complet = os.path.join(DOSSIER_BASE, nom_fichier)
    html_template = f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <title>{titre_fr} - Blox Fruits</title>
</head>
<body>
    <div style="padding: 40px;">
        <a href="index.html">← Retour</a>
        <h1>{titre_fr}</h1>
        <img src="{chemin_image}" style="max-width: 500px;">
        <div>{contenu_fr}</div>
    </div>
</body>
</html>"""
    with open(chemin_complet, 'w', encoding='utf-8') as f:
        f.write(html_template)

def verifier_nouveau_post():
    print("🔍 Vérification du site officiel...")
    try:
        reponse = requests.get(BLOG_URL, headers=HEADERS)
        soup = BeautifulSoup(reponse.text, 'html.parser')
        liens = soup.find_all('a', href=True)
        
        lien_article = None
        for a in liens:
            if '/blogs/news/' in a['href'] and a['href'] != '/blogs/news':
                lien_article = BASE_URL + a['href']
                break
        
        if not lien_article: return

        if os.path.exists(MEMORY_FILE):
            with open(MEMORY_FILE, 'r') as f:
                if lien_article == f.read().strip(): return

        print(f"🚨 NOUVEL ARTICLE : {lien_article}")
        
        # Scraping simplifié
        page = requests.get(lien_article, headers=HEADERS)
        soup_a = BeautifulSoup(page.text, 'html.parser')
        
        titre = soup_a.find('h1').text.strip() if soup_a.find('h1') else "Nouveau"
        img = soup_a.find('img')['src'] if soup_a.find('img') else ""
        if img.startswith('//'): img = 'https:' + img
        
        texte = "\n\n".join([p.text for p in soup_a.find_all('p')])

        # Traitement
        t_fr = traduire(titre)
        c_fr = "".join([f"<p>{traduire(p)}</p>" for p in texte.split('\n\n') if p])
        
        img_rel = telecharger_image(img, "shared/auto_downloads", lien_article.split('/')[-1] + ".jpg")
        
        nom_html = lien_article.split('/')[-1] + ".html"
        generer_page_article(t_fr, c_fr, img_rel, nom_html)
        mettre_a_jour_index(t_fr, img_rel, nom_html)

        with open(MEMORY_FILE, 'w') as f: f.write(lien_article)
        print("🎉 Terminé !")

    except Exception as e:
        print(f"⚠️ Erreur : {e}")

if __name__ == "__main__":
    while True:
        verifier_nouveau_post()
        time.sleep(CHECK_INTERVAL)