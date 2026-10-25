# Relais de publication des updates

Ce Worker est le relais gratuit entre le site et Firebase. Il vérifie l’identité Discord côté serveur et n’accepte que les deux identifiants autorisés dans `update-relay.js`. Les modifications du site, la création/suppression des cards et les updates passent par lui; les contrôles visibles dans le navigateur ne servent qu’à l’interface.

## Mise en place

1. Dans Firebase Authentication, active le fournisseur **E-mail/Mot de passe** et crée un compte technique dédié au Worker. Ne réutilise pas ton compte personnel. Note son UID dans la fiche du compte.
2. Dans Cloudflare, crée un Worker nommé `blox-update-relay` et colle le contenu de `update-relay.js` dans son éditeur, puis déploie-le.
3. Dans **Settings → Variables and Secrets**, ajoute comme secrets `FIREBASE_API_KEY`, `FIREBASE_DATABASE_URL`, `FIREBASE_EDITOR_EMAIL`, `FIREBASE_EDITOR_PASSWORD` et `FIREBASE_EDITOR_UID`. Les valeurs Firebase sont celles de la configuration déjà présente dans `neo_bulletin.html`; l’UID vient de la fiche du compte technique.
4. Pour l’action `createBulletin` (création de bulletins depuis la page d’accueil), ajoute aussi :
   - `GITHUB_TOKEN` : PAT (classic) avec le scope `repo` sur `BloxNewsFr/BloxNews-FR`
   - `GITHUB_REPO` : `BloxNewsFr/BloxNews-FR`
   - `GITHUB_BRANCH` (optionnel) : `main` par défaut
   Le Worker crée blobs + tree + commit via l’API Git Data de GitHub et met à jour la branche. Seuls les chemins `NNN/…`, `index.html`, `archives.html` et `sources.json` sont acceptés.
5. Pour l’action `deleteBulletin` (suppression d’un bulletin), ajoute aussi le secret `DELETE_PASSWORD` : le mot de passe demandé dans l’UI de suppression. Sans ce secret, la suppression est refusée.
6. Le Worker est déployé à `https://blox-update-relay.c9yz5m8pw6.workers.dev`; cette adresse est déjà renseignée dans `UPDATE_RELAY_ENDPOINT` de `neo_bulletin.html` et dans `shared/bulletin-creator.js`. Publie le site après la configuration.
6. Dans les règles Realtime Database, réserve les écritures des branches protégées à l’UID Firebase du compte technique. Remplace les branches `updates`, `content_edits`, `custom_cards` et `deleted_static_ids` par celles-ci, en remplaçant la valeur par cet UID :

```json
"updates": {
  ".read": true,
  "$updateId": {
    ".write": "auth != null && auth.uid === 'UID_FIREBASE_DU_COMPTE_TECHNIQUE'"
  }
},
"content_edits": {
  ".read": true,
  ".write": "auth != null && auth.uid === 'UID_FIREBASE_DU_COMPTE_TECHNIQUE'"
},
"custom_cards": {
  ".read": true,
  ".write": "auth != null && auth.uid === 'UID_FIREBASE_DU_COMPTE_TECHNIQUE'"
},
"deleted_static_ids": {
  ".read": true,
  ".write": "auth != null && auth.uid === 'UID_FIREBASE_DU_COMPTE_TECHNIQUE'"
}
```

Ces branches ne doivent pas hériter d’un `.write` plus permissif défini sur la racine ou sur un parent : une autorisation d’écriture à un niveau supérieur s’applique aussi aux enfants. Ne mets pas `.write: true`. Les autres branches sont distinctes et gardent leurs règles actuelles; cette modification ne transforme pas les permissions de modération des commentaires en permissions serveur.

Le compte technique ne doit servir qu’au Worker. Son mot de passe reste dans les secrets Cloudflare, jamais dans les fichiers du site. L’API key Firebase est déjà visible dans le code client; elle n’est pas un mot de passe.

## Statistiques visiteurs et lectures

Les pages `index.html`, `neo_bulletin.html` et les pages de lecture des bulletins utilisent le Worker pour les statistiques (`statsPresence`, `statsVisit`, `statsBulletinView`, `statsCardView`). Il vérifie les champs, limite les écritures à `site_stats`, et vérifie le jeton Discord auprès de Discord avant d’enregistrer un profil. Les invités restent comptés sans profil Discord. Le compte technique utilise les permissions déjà définies sur `site_stats`; aucune règle Firebase supplémentaire n’est nécessaire. Les entrées de présence sans heartbeat depuis trois minutes sont ignorées. Les visiteurs par jour sont calculés à partir des profils journaliers uniques dans `visitors_log`.

Ces actions sont accessibles aux visiteurs pour permettre la collecte publique. Configure une règle de limitation de débit Cloudflare pour le Worker afin de réduire les requêtes abusives. Ne rends pas `site_stats` publiquement inscriptible dans les règles Firebase. Déploie `update-relay.js` dans Cloudflare après toute mise à jour de ces fonctionnalités.
