import os
import time
import requests
from bs4 import BeautifulSoup
from deep_translator import GoogleTranslator

# --- CONFIGURATION ---
BLOG_URL = "https://gamerrobot.com/blogs/news"
BASE_URL = "https://gamerrobot.com"
INDEX_FILE = "index.html"
MEMORY_FILE = "dernier_article.txt" # Pour se souvenir du dernier article traité
CHECK_INTERVAL = 3600 # Vérifie toutes les 3600 secondes (1 heure)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def traduire(texte):
    """Traduit l'anglais vers le français."""
    if not texte.strip():
        return ""
    try:
        return GoogleTranslator(source='en', target='fr').translate(texte)
    except:
        return texte

def telecharger_image(url, dossier, nom_fichier):
    """Télécharge une image depuis le web."""
    if not os.path.exists(dossier):
        os.makedirs(dossier)
    
    chemin_complet = os.path.join(dossier, nom_fichier)
    try:
        reponse = requests.get(url, headers=HEADERS)
        with open(chemin_complet, 'wb') as f:
            f.write(reponse.content)
        return chemin_complet
    except:
        return ""

def mettre_a_jour_index(titre_fr, chemin_image, lien_page):
    """Injecte la nouvelle carte dans index.html"""
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        contenu = f.read()

    # Le code HTML de la nouvelle carte à ajouter
    nouvelle_carte = f"""
            <article class="news-card">
                <div class="news-card__image-wrapper">
                    <img src="{chemin_image}" class="news-card__image" alt="{titre_fr}">
                </div>
                <div class="news-card__content">
                    <div class="news-card__date">The Blox Bulletin - Nouveau !</div>
                    <h2 class="news-card__title">{titre_fr}</h2>
                    <a href="{lien_page}" class="news-card__button">Voir plus</a>
                </div>
            </article>
"""
    # On cherche le conteneur de la grille et on insère la carte juste après
    balise_cible = '<div class="news-grid">'
    if balise_cible in contenu:
        nouveau_contenu = contenu.replace(balise_cible, balise_cible + nouvelle_carte)
        with open(INDEX_FILE, 'w', encoding='utf-8') as f:
            f.write(nouveau_contenu)
        print("✅ index.html mis à jour avec succès !")
    else:
        print("❌ Impossible de trouver <div class=\"news-grid\"> dans index.html")

def generer_page_article(titre_fr, contenu_fr, chemin_image, nom_fichier):
    """Crée une nouvelle page HTML pour l'article traduit"""
    # Un modèle très basique basé sur ton design
    html_template = f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <title>{titre_fr} - Blox Fruits</title>
    <style>
        body {{ font-family: sans-serif; background: #f0f2f8; color: #111; padding: 40px; max-width: 800px; margin: auto; }}
        img {{ max-width: 100%; border-radius: 12px; }}
        .box {{ background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }}
    </style>
</head>
<body>
    <div class="box">
        <a href="index.html">← Retour</a>
        <h1>{titre_fr}</h1>
        <img src="{chemin_image}" alt="Miniature">
        <div style="margin-top: 20px;">
            {contenu_fr}
        </div>
    </div>
</body>
</html>"""

    with open(nom_fichier, 'w', encoding='utf-8') as f:
        f.write(html_template)

def verifier_nouveau_post():
    """Va sur le site officiel et cherche un nouvel article."""
    print("🔍 Vérification du site officiel...")
    try:
        reponse = requests.get(BLOG_URL, headers=HEADERS)
        soup = BeautifulSoup(reponse.text, 'html.parser')
        
        # Cherche le premier lien d'article (Shopify utilise souvent /blogs/news/titre-article)
        liens = soup.find_all('a', href=True)
        lien_article = None
        for a in liens:
            if '/blogs/news/' in a['href'] and a['href'] != '/blogs/news':
                lien_article = a['href']
                if not lien_article.startswith('http'):
                    lien_article = BASE_URL + lien_article
                break
        
        if not lien_article:
            print("Aucun article trouvé sur la page.")
            return

        # Vérifie si on a déjà traité cet article
        dernier_traite = ""
        if os.path.exists(MEMORY_FILE):
            with open(MEMORY_FILE, 'r') as f:
                dernier_traite = f.read().strip()

        if lien_article == dernier_traite:
            print("💤 Aucun nouvel article. Je me rendors.")
            return

        print(f"🚨 NOUVEL ARTICLE DÉTECTÉ : {lien_article}")
        
        # 1. Scraper la page de l'article
        page_article = requests.get(lien_article, headers=HEADERS)
        soup_article = BeautifulSoup(page_article.text, 'html.parser')
        
        # Récupération du titre (à ajuster selon la balise exacte de Gamer Robot, ex: h1)
        titre_element = soup_article.find('h1')
        titre_en = titre_element.text.strip() if titre_element else "Nouvel Article Blox Fruits"
        
        # Récupération de la première image
        img_element = soup_article.find('img')
        img_url = img_element['src'] if img_element else ""
        if img_url and img_url.startswith('//'):
            img_url = 'https:' + img_url

        # Récupération du texte (les paragraphes)
        paragraphes = soup_article.find_all('p')
        texte_en = "\n\n".join([p.text for p in paragraphes if p.text.strip() != ""])

        # 2. Traductions
        print("🌐 Traduction en cours...")
        titre_fr = traduire(titre_en)
        texte_fr = traduire(texte_en[:4000]) # Limite pour éviter les crashs de l'API gratuite
        
        # Remplacer les retours à la ligne par des balises <p> pour le HTML
        texte_html_fr = "".join([f"<p>{p}</p>" for p in texte_fr.split('\n\n')])

        # 3. Téléchargement de l'image
        chemin_image = ""
        if img_url:
            nom_img = lien_article.split('/')[-1] + ".jpg"
            chemin_image = telecharger_image(img_url, "./shared/auto_downloads", nom_img)

        # 4. Générer le fichier
        nom_page_html = lien_article.split('/')[-1] + ".html"
        generer_page_article(titre_fr, texte_html_fr, chemin_image, nom_page_html)

        # 5. Mettre à jour l'index
        mettre_a_jour_index(titre_fr, chemin_image, nom_page_html)

        # Sauvegarder qu'on a traité cet article
        with open(MEMORY_FILE, 'w') as f:
            f.write(lien_article)
            
        print("🎉 Terminé avec succès ! La page a été générée.")

    except Exception as e:
        print(f"⚠️ Erreur lors du scraping : {e}")

# --- BOUCLE PRINCIPALE ---
if __name__ == "__main__":
    print("🤖 Bot Leaks activé sur le Mac Mini ! Appuyez sur Ctrl+C pour l'arrêter.")
    while True:
        verifier_nouveau_post()
        time.sleep(CHECK_INTERVAL)