# Relais de publication des updates

Ce Worker est le relais gratuit entre le site et Firebase. Il vérifie l’identité Discord côté serveur et n’accepte que les deux identifiants autorisés dans `update-relay.js`.

## Mise en place

1. Dans Firebase Authentication, active le fournisseur **E-mail/Mot de passe** et crée un compte technique dédié au Worker. Ne réutilise pas ton compte personnel. Note son UID dans la fiche du compte.
2. Dans Cloudflare, crée un Worker nommé `blox-update-relay` et colle le contenu de `update-relay.js` dans son éditeur, puis déploie-le.
3. Dans **Settings → Variables and Secrets**, ajoute comme secrets `FIREBASE_API_KEY`, `FIREBASE_DATABASE_URL`, `FIREBASE_EDITOR_EMAIL`, `FIREBASE_EDITOR_PASSWORD` et `FIREBASE_EDITOR_UID`. Les valeurs Firebase sont celles de la configuration déjà présente dans `neo_bulletin.html`; l’UID vient de la fiche du compte technique.
4. Le Worker est déployé à `https://blox-update-relay.c9yz5m8pw6.workers.dev`; cette adresse est déjà renseignée dans `UPDATE_RELAY_ENDPOINT` de `neo_bulletin.html`. Publie le site après la configuration.
5. Dans les règles Realtime Database, remplace entièrement le bloc `updates` actuel par celui-ci, en remplaçant la valeur par l’UID Firebase du compte technique :

```json
"updates": {
  ".read": true,
  "$updateId": {
    ".write": "auth != null && auth.uid === 'UID_FIREBASE_DU_COMPTE_TECHNIQUE'"
  }
}
```

Ne garde pas une ancienne règle `.write` au niveau de `updates` : les droits accordés sur un parent s’appliquent aussi à tous ses enfants. Garde les autres branches telles quelles et ne mets pas `.write: true`. Cette règle laisse les autres clients lire les updates et réserve leur écriture au compte technique du Worker.

Le compte technique ne doit servir qu’au Worker. Son mot de passe reste dans les secrets Cloudflare, jamais dans les fichiers du site. L’API key Firebase est déjà visible dans le code client; elle n’est pas un mot de passe.
