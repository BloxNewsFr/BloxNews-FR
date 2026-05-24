import os
import requests
from bs4 import BeautifulSoup
from deep_translator import GoogleTranslator
import schedule
import time

# ==========================================
# CONFIGURATION
# ==========================================
SITE_URL = "https://gamerrobot.com/blogs/news"
INDEX_FILE = "index.html"
DOSSIER_BASE = "/Users/Admin/Documents/Neolixx News/blox-bulletinfr"
LAST_ARTICLE_FILE = "dernier_article_lu.txt"

translator = GoogleTranslator(source='auto', target='fr')

def get_next_folder_number():
    """Cherche le dernier dossier (ex: 004) et crée le numéro suivant (ex: 005)"""
    folders = [f for f in os.listdir('.') if os.path.isdir(f) and f.isdigit()]
    if not folders:
        return "001"
    max_num = max([int(f) for f in folders])
    return f"{(max_num + 1):03d}"

def download_image(img_url, folder_path):
    """Télécharge l'image depuis le site officiel vers ton dossier local"""
    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
    
    # Nettoie l'URL de l'image
    if not img_url.startswith('http'):
        img_url = "https:" + img_url
        
    img_name = img_url.split("/")[-1].split("?")[0]
    img_path = os.path.join(folder_path, img_name)
    
    print(f"Téléchargement de l'image : {img_name}...")
    res = requests.get(img_url, stream=True)
    if res.status_code == 200:
        with open(img_path, 'wb') as f:
            for chunk in res:
                f.write(chunk)
        return img_path
    return ""

def update_index_html(title_fr, page_url, img_local_path):
    """Modifie ton fichier index.html pour ajouter la nouvelle Card tout en haut"""
    with open(INDEX_FILE, "r", encoding="utf-8") as f:
        html = f.read()
    
    # On crée le bloc HTML de ta carte
    new_card = f"""
            <article class="news-card">
                <div class="news-card__image-wrapper">
                    <img src="./{img_local_path}" class="news-card__image" alt="Nouveau Bulletin">
                </div>
                <div class="news-card__content">
                    <div class="news-card__date">NOUVEAU LEAK</div>
                    <h2 class="news-card__title">{title_fr}</h2>
                    <a href="./{page_url}" class="news-card__button">Voir plus</a>
                </div>
            </article>"""

    # On l'injecte juste après l'ouverture de la div news-grid
    if '<div class="news-grid">' in html:
        updated_html = html.replace('<div class="news-grid">', f'<div class="news-grid">\n{new_card}', 1)
        with open(INDEX_FILE, "w", encoding="utf-8") as f:
            f.write(updated_html)
        print("✅ index.html a été mis à jour avec succès !")
    else:
        print("❌ Erreur : Impossible de trouver <div class=\"news-grid\"> dans index.html")

def process_article(url):
    """Aspire le contenu de l'article, traduit et génère la page HTML"""
    headers = {'User-Agent': 'Mozilla/5.0'}
    res = requests.get(url, headers=headers)
    soup = BeautifulSoup(res.text, 'html.parser')
    
    # Extraction (Ces balises peuvent varier selon la structure du site Gamer Robot)
    # On cherche le titre (généralement h1) et le contenu de l'article
    title_en = soup.find('h1').text.strip() if soup.find('h1') else "Nouveau Bulletin"
    content_div = soup.find('article') or soup.find('div', class_='main-content')
    
    print(f"Traduction du titre: {title_en}")
    title_fr = translator.translate(title_en)
    
    # Récupérer l'image principale
    main_img_url = ""
    img_tag = content_div.find('img') if content_div else None
    if img_tag and img_tag.get('src'):
        main_img_url = img_tag['src']
    
    # Créer le nouveau dossier (ex: 005)
    issue_num = get_next_folder_number()
    folder_path = f"./{issue_num}"
    img_folder = os.path.join(folder_path, "img")
    os.makedirs(img_folder, exist_ok=True)
    
    # Télécharger l'image
    local_img_path = ""
    if main_img_url:
        local_img_path = download_image(main_img_url, img_folder)

    # Traduire les paragraphes
    paragraphs_fr = []
    if content_div:
        for p in content_div.find_all('p'):
            if p.text.strip():
                try:
                    p_fr = translator.translate(p.text.strip())
                    paragraphs_fr.append(f"<p>{p_fr}</p>")
                except:
                    paragraphs_fr.append(f"<p>{p.text.strip()}</p>") # Si erreur de trad, garde l'anglais

    content_html = "\n".join(paragraphs_fr)
    page_filename = f"{folder_path}/bulletin-{issue_num}.html"

    # Générer le fichier HTML de l'article (Modèle ultra-basique à adapter avec ton CSS)
    html_page = f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <title>{title_fr} - Blox Bulletin</title>
</head>
<body style="font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 20px;">
    <a href="../index.html">← Retour aux news</a>
    <h1 style="color: red;">{title_fr}</h1>
    <img src="./img/{os.path.basename(local_img_path)}" style="width: 100%; border-radius: 12px;">
    <div style="margin-top: 20px; line-height: 1.6;">
        {content_html}
    </div>
</body>
</html>"""

    with open(page_filename, "w", encoding="utf-8") as f:
        f.write(html_page)
    
    print(f"✅ Page créée : {page_filename}")
    
    # Mettre à jour l'accueil
    update_index_html(title_fr, page_filename, local_img_path)

def check_for_new_article():
    """Fonction principale : Vérifie si un nouvel article existe"""
    print("\n[BOT] Vérification des nouveautés sur le site officiel...")
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        res = requests.get(SITE_URL, headers=headers)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        # Chercher le lien du dernier article
        links = soup.find_all('a', href=True)
        latest_article_url = None
        for a in links:
            if '/blogs/news/' in a['href'] and a['href'] != '/blogs/news':
                latest_article_url = "https://gamerrobot.com" + a['href']
                break
                
        if not latest_article_url:
            print("[BOT] Aucun article trouvé sur la page.")
            return

        # Vérifier si on a déjà traité cet article
        if os.path.exists(LAST_ARTICLE_FILE):
            with open(LAST_ARTICLE_FILE, "r") as f:
                last_url = f.read().strip()
                if last_url == latest_article_url:
                    print("[BOT] Rien de nouveau. Je retourne dormir.")
                    return
        
        print(f"🚨 ALERTE NOUVEL ARTICLE : {latest_article_url}")
        process_article(latest_article_url)
        
        # Sauvegarder l'URL pour ne pas la refaire la prochaine fois
        with open(LAST_ARTICLE_FILE, "w") as f:
            f.write(latest_article_url)

    except Exception as e:
        print(f"[ERREUR] Le bot a planté : {e}")

# ==========================================
# LANCEMENT DU PROGRAMME (ROUTINE H24)
# ==========================================
print("🤖 Le Bot Blox News est en ligne sur ton Mac Mini !")
check_for_new_article() # Vérifie une fois au lancement

# Demande au bot de revérifier toutes les 2 heures
schedule.every(2).hours.do(check_for_new_article)

while True:
    schedule.run_pending()
    time.sleep(60) # Évite que le bot n'utilise 100% du CPU de ton Mac