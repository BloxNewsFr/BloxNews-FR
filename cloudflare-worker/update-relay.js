const ADMIN_DISCORD_IDS = new Set([
  '1503444854410317984', // fn_n0klip
  '775096691240992798',  // neolixx
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function firebaseRequest(env, path, token, method, body) {
  const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/${path}.json?auth=${encodeURIComponent(token)}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `Firebase a refusé l’opération (${response.status}).`);
  return result;
}

async function firebaseToken(env) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.FIREBASE_EDITOR_EMAIL, password: env.FIREBASE_EDITOR_PASSWORD, returnSecureToken: true }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.idToken || result.localId !== env.FIREBASE_EDITOR_UID) {
    throw new Error('Le compte technique Firebase du relais est mal configuré.');
  }
  return result.idToken;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

    let input;
    try {
      if (Number(request.headers.get('Content-Length') || 0) > 100_000) return json({ error: 'Requête trop volumineuse.' }, 413);
      input = await request.json();
    } catch {
      return json({ error: 'Requête JSON invalide.' }, 400);
    }

    const discordToken = input?.discordAccessToken;
    if (typeof discordToken !== 'string' || discordToken.length < 10 || discordToken.length > 4096) {
      return json({ error: 'Reconnecte-toi avec Discord.' }, 401);
    }

    try {
      const discordResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${discordToken}` },
      });
      if (!discordResponse.ok) return json({ error: 'La connexion Discord a expiré. Reconnecte-toi.' }, 401);
      const user = await discordResponse.json();
      if (!ADMIN_DISCORD_IDS.has(String(user.id))) return json({ error: 'Ce compte Discord ne peut pas gérer les updates.' }, 403);

      const updateId = input.action === 'create' ? input.update?.id : input.updateId;
      if (typeof updateId !== 'string' || !/^upd_[a-zA-Z0-9_-]{1,80}$/.test(updateId)) {
        return json({ error: 'Identifiant d’update invalide.' }, 400);
      }

      const idToken = await firebaseToken(env);
      if (input.action === 'create') {
        const update = input.update;
        if (!update || update.id !== updateId || typeof update.title !== 'string' || update.title.length > 300 || typeof update.fullDesc !== 'string' || update.fullDesc.length > 30000) {
          return json({ error: 'Contenu de l’update invalide.' }, 400);
        }
        await firebaseRequest(env, `updates/${encodeURIComponent(updateId)}`, idToken, 'PUT', update);
      } else if (input.action === 'editField') {
        const fields = new Set(['title', 'version', 'date', 'fullDesc']);
        if (!fields.has(input.field) || typeof input.value !== 'string' || input.value.length > 30000) {
          return json({ error: 'Champ ou contenu invalide.' }, 400);
        }
        await firebaseRequest(env, `updates/${encodeURIComponent(updateId)}/${input.field}`, idToken, 'PUT', input.value);
      } else if (input.action === 'delete') {
        await Promise.all([
          firebaseRequest(env, `updates/${encodeURIComponent(updateId)}`, idToken, 'DELETE'),
          firebaseRequest(env, `update_comments/${encodeURIComponent(updateId)}`, idToken, 'DELETE'),
        ]);
      } else {
        return json({ error: 'Action inconnue.' }, 400);
      }

      return json({ ok: true });
    } catch (error) {
      console.error('Update relay failure:', error);
      return json({ error: error?.message || 'Le relais ne peut pas joindre Firebase.' }, 502);
    }
  },
};
