const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

initializeApp();

// IDs Discord autorisés à publier et gérer les mises à jour.
const ADMIN_DISCORD_IDS = new Set([
  '1503444854410317984', // fn_n0klip
  '775096691240992798',  // neolixx
]);

exports.discordAdminToken = onRequest({
  region: 'europe-west1',
  // The endpoint can be called from the hosted site and local previews; admin access
  // is enforced by Discord token verification and the server-side ID allowlist.
  cors: true,
  maxInstances: 3,
  timeoutSeconds: 15,
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const discordAccessToken = req.body?.discordAccessToken;
  if (typeof discordAccessToken !== 'string' || discordAccessToken.length < 10 || discordAccessToken.length > 4096) {
    return res.status(400).json({ error: 'Jeton Discord manquant ou invalide.' });
  }

  try {
    const discordResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${discordAccessToken}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!discordResponse.ok) {
      return res.status(401).json({ error: 'La connexion Discord a expiré. Reconnecte-toi.' });
    }

    const discordUser = await discordResponse.json();
    const discordId = String(discordUser.id || '');
    if (!ADMIN_DISCORD_IDS.has(discordId)) {
      return res.status(403).json({ error: 'Ce compte Discord ne peut pas publier de mises à jour.' });
    }

    const firebaseCustomToken = await getAuth().createCustomToken(discordId, {
      admin: true,
      discordAdmin: true,
    });

    return res.status(200).json({ firebaseCustomToken });
  } catch (error) {
    console.error('Échec de vérification Discord/Firebase admin:', error);
    return res.status(500).json({ error: 'Impossible de valider la connexion admin pour le moment.' });
  }
});
