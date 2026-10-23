# Relais de publication des updates

Ce Worker est le relais gratuit entre le site et Firebase. Il vérifie l’identité Discord côté serveur et n’accepte que les deux identifiants autorisés dans `update-relay.js`. Les modifications du site, la création/suppression des cards et les updates passent par lui; les contrôles visibles dans le navigateur ne servent qu’à l’interface.

## Mise en place

1. Dans Firebase Authentication, active le fournisseur **E-mail/Mot de passe** et crée un compte technique dédié au Worker. Ne réutilise pas ton compte personnel. Note son UID dans la fiche du compte.
2. Dans Cloudflare, crée un Worker nommé `blox-update-relay` et colle le contenu de `update-relay.js` dans son éditeur, puis déploie-le.
3. Dans **Settings → Variables and Secrets**, ajoute comme secrets `FIREBASE_API_KEY`, `FIREBASE_DATABASE_URL`, `FIREBASE_EDITOR_EMAIL`, `FIREBASE_EDITOR_PASSWORD` et `FIREBASE_EDITOR_UID`. Les valeurs Firebase sont celles de la configuration déjà présente dans `neo_bulletin.html`; l’UID vient de la fiche du compte technique.
4. Le Worker est déployé à `https://blox-update-relay.c9yz5m8pw6.workers.dev`; cette adresse est déjà renseignée dans `UPDATE_RELAY_ENDPOINT` de `neo_bulletin.html`. Publie le site après la configuration.
5. Dans les règles Realtime Database, réserve les écritures des branches protégées à l’UID Firebase du compte technique. Remplace les branches `updates`, `content_edits`, `custom_cards` et `deleted_static_ids` par celles-ci, en remplaçant la valeur par cet UID :

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
