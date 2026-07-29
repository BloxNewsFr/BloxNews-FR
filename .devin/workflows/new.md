---
description: Create a new leak/update card with Firebase integration
---

# Workflow: /new - Créer une nouvelle card

## Étapes pour créer une nouvelle card

1. **Identifier le type de card à créer**
   - Déterminer si c'est un leak (news-card) ou une update (update-card)
   - Choisir la catégorie appropriée (fruit, vfx, gameplay, map, gui, message, updates)

2. **Ajouter la card dans le HTML**
   - Ouvrir `neo_bulletin.html`
   - Trouver la section `<section id="cat-[category]" class="category-section">` correspondante
   - Ajouter la card HTML dans la `<div class="news-grid">` de cette section
   - Utiliser la structure appropriée :
     - Pour un leak standard : `<article class="news-card">`
     - Pour une update : `<article class="update-card">`

3. **Structure HTML d'une news-card (leak)**
```html
<article class="news-card" data-date="2026-07-29" data-cc-id="unique-id">
    <div class="news-card__image-wrapper">
        <img src="./shared/blox_leaks/your-image.png" class="news-card__image" alt="Description" loading="lazy" decoding="async">
        <div class="news-card__badge">CATEGORY</div>
    </div>
    <div class="news-card__content">
        <div class="news-card__eyebrow">Subtitle</div>
        <div class="news-card__date"></div>
        <h2 class="news-card__title">Title</h2>
        <button class="news-card__button open-modal-btn" data-type="image" data-src="./shared/blox_leaks/your-image.png">Inspecter →</button>
    </div>
    <div class="news-card__bar"></div>
</article>
```

4. **Structure HTML d'une update-card**
```html
<article class="update-card" data-version="X.X.X" data-date="2026-07-29" onclick="openUpdateModal('X.X.X')">
    <div class="update-card__banner">
        <img src="./shared/background.png" alt="Update Banner" loading="lazy">
        <span class="update-card__status update-card__status--official">OFFICIAL</span>
    </div>
    <div class="update-card__body">
        <div class="update-card__header">
            <span class="update-card__version">vX.X.X</span>
            <span class="update-card__date">29 juil. 2026</span>
        </div>
        <h2 class="update-card__title">Update Title</h2>
        <p class="update-card__summary">Summary text...</p>
        <div class="update-card__linked-section">
            <div class="update-card__linked-label">Contenus inclus (X)</div>
            <div class="update-card__linked-grid">
                <!-- Miniatures des cards liées -->
            </div>
        </div>
        <div class="update-card__footer">
            <div class="update-card__stats">
                <span class="update-card__stat"><span class="update-card__stat-icon">👁️</span><span>0</span></span>
                <span class="update-card__stat"><span class="update-card__stat-icon">❤️</span><span>0</span></span>
                <span class="update-card__stat"><span class="update-card__stat-icon">💬</span><span>0</span></span>
            </div>
            <button class="update-card__btn">Voir les détails →</button>
        </div>
    </div>
</article>
```

5. **Ajouter les données dans UPDATE_DATA (si c'est une update)**
   - Trouver l'objet `UPDATE_DATA` dans le JavaScript (ligne ~7131)
   - Ajouter une nouvelle entrée avec la version comme clé :
```javascript
'X.X.X': {
    version: 'vX.X.X',
    date: '29 juil. 2026',
    title: 'Update Title',
    summary: `Summary text...`,
    status: 'OFFICIAL', // ou 'LEAK'
    banner: './shared/background.png',
    linkedCards: [
        { id: 'group-id', type: 'group', label: 'Label' }
    ],
    linked: ['🎮 Gameplay', '🃏 Cartes'],
    comments: '/updates/X.X.X',
    stats: { views: 0, likes: 0, comments: 0 }
}
```

6. **Configurer Firebase pour les commentaires**
   - Les commentaires sont automatiquement activés via le chemin `comments` dans les données
   - Le système utilise Firebase Realtime Database avec la référence `FB_REF`
   - Pour une update : le chemin est `/updates/X.X.X`
   - Pour une news-card : le chemin est basé sur le `data-cc-id`
   - Le système de commentaires inclut :
     - Filtrage de mots inappropriés (liste `_BAD_WORDS`)
     - Support des réactions (emojis)
     - Tri des commentaires (récents, populaires)
     - Pagination des commentaires

7. **Configurer le système de likes**
   - Les likes sont gérés globalement via `FB_DB.ref('post_likes')`
   - La clé est générée via `_plSlug()` : `category-title` en minuscules avec tirets
   - Le système utilise :
     - `localStorage` pour l'état "liké" par utilisateur (persistance locale)
     - Firebase pour le compteur global (synchronisé entre tous les utilisateurs)
     - La clé de stockage local : `blox_post_likes_v1`
   - Le bouton like doit avoir la classe `post-like-btn` et l'attribut `data-post-id`
   - Exemple : `<button class="post-like-btn" data-post-id="fruit-magnet">❤️ <span class="post-like-count">0</span></button>`

8. **Configurer le système de vues**
   - Les vues sont comptées automatiquement quand la card est ouverte
   - Ajouter un compteur de vues dans les stats de la card
   - Le compteur est incrémenté via Firebase quand le modal est ouvert
   - Pour implémenter le comptage des vues :
     - Ajouter une référence Firebase pour les vues : `FB_DB.ref('post_views')`
     - Incrémenter le compteur quand `openUpdateModal()` ou le modal de card est appelé
     - Stocker les vues dans `stats.views` dans UPDATE_DATA ou dans Firebase

9. **Tester la création**
   - Ouvrir la page dans le navigateur
   - Vérifier que la card s'affiche correctement
   - Tester l'ouverture du modal
   - Vérifier que les commentaires fonctionnent
   - Tester le système de likes
   - Vérifier le compteur de vues

## Notes importantes

- Chaque card doit avoir un `data-cc-id` unique pour le système de commentaires
- Les images doivent être placées dans `./shared/blox_leaks/`
- Le système de likes utilise localStorage pour l'état "liké" par utilisateur
- Les compteurs (likes, vues, commentaires) sont globaux et synchronisés via Firebase
- Le thème sombre est automatiquement appliqué selon les préférences utilisateur
