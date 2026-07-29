---
description: Delete an existing leak/update card with Firebase cleanup
---

# Workflow: /delete - Supprimer une card

## Étapes pour supprimer une card

1. **Identifier la card à supprimer**
   - Trouver la card dans `neo_bulletin.html`
   - Noter son `data-cc-id` (pour les news-cards) ou sa version (pour les update-cards)
   - Noter la catégorie dans laquelle elle se trouve

2. **Supprimer la card du HTML**
   - Ouvrir `neo_bulletin.html`
   - Localiser la section `<section id="cat-[category]" class="category-section">`
   - Trouver la card à supprimer dans la `<div class="news-grid">`
   - Supprimer l'élément `<article>` complet de la card

3. **Nettoyer UPDATE_DATA (si c'est une update)**
   - Trouver l'objet `UPDATE_DATA` dans le JavaScript (ligne ~7131)
   - Supprimer l'entrée correspondante à la version
   - Exemple : supprimer `'X.X.X': { ... }` de l'objet

4. **Nettoyer les données Firebase (commentaires)**
   - Les commentaires sont stockés dans Firebase sous le chemin spécifié dans `comments`
   - Pour une update : `/updates/X.X.X`
   - Pour une news-card : le chemin est basé sur le `data-cc-id`
   - **Note** : La suppression des données Firebase nécessite un accès admin via la console Firebase

5. **Nettoyer les données Firebase (likes)**
   - Les likes sont stockés globalement sous `post_likes`
   - La clé est générée à partir du slug de la card
   - Pour supprimer les likes d'une card spécifique :
     - Identifier le slug (généralement `category-title` format)
     - Supprimer l'entrée correspondante dans Firebase

6. **Nettoyer les données Firebase (vues)**
   - Les vues sont stockées dans les stats de la card
   - Si les vues sont gérées via Firebase, supprimer l'entrée correspondante

7. **Vérifier les références croisées**
   - Si la card était liée à une update (dans `linkedCards`), la supprimer de cette liste
   - Vérifier si la card fait partie d'un `GROUP_DATA`
   - Si oui, la supprimer du tableau `items` correspondant

8. **Tester la suppression**
   - Ouvrir la page dans le navigateur
   - Vérifier que la card n'apparaît plus
   - Vérifier que la grille s'adapte correctement
   - Tester que les autres cards fonctionnent toujours

## Structure des données à nettoyer

### Pour une news-card (leak)
```html
<!-- À supprimer du HTML -->
<article class="news-card" data-date="2026-07-29" data-cc-id="unique-id">
    <!-- contenu de la card -->
</article>
```

### Pour une update-card
```html
<!-- À supprimer du HTML -->
<article class="update-card" data-version="X.X.X" data-date="2026-07-29">
    <!-- contenu de la card -->
</article>

<!-- À supprimer de UPDATE_DATA -->
'X.X.X': {
    version: 'vX.X.X',
    date: '29 juil. 2026',
    title: 'Update Title',
    // ... autres propriétés
}
```

### Pour une card dans GROUP_DATA
```javascript
// À supprimer du tableau items
GROUP_DATA['group-id'].items = GROUP_DATA['group-id'].items.filter(
    item => item.src !== './shared/blox_leaks/your-image.png'
);
```

## Nettoyage Firebase via Console

Pour supprimer les données Firebase :

1. Aller dans la [Firebase Console](https://console.firebase.google.com/)
2. Sélectionner le projet
3. Aller dans "Realtime Database"
4. Naviguer vers le chemin correspondant :
   - Commentaires : `/updates/X.X.X` ou `/comments/[card-id]`
   - Likes : `/post_likes/[slug]`
5. Supprimer les nœuds correspondants

## Notes importantes

- Toujours faire une sauvegarde avant de supprimer
- Vérifier qu'aucune autre card ne référence la card supprimée
- Le système de commentaires utilise Firebase, donc la suppression HTML ne supprime pas les commentaires
- Les likes sont globaux, donc ils doivent être nettoyés séparément
- Après suppression, vérifier que la page se charge sans erreurs JavaScript
