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

function encodeFirebaseKey(value) {
  return encodeURIComponent(value).replace(/\./g, '%2E');
}

async function handleAdminAction(env, input, idToken) {
  const { action } = input;
  if (action === 'saveContentEdits') {
    const edits = input.edits;
    if (!edits || typeof edits !== 'object' || Array.isArray(edits) || Object.keys(edits).length > 500) {
      throw new Error('Liste de modifications invalide.');
    }
    for (const [key, value] of Object.entries(edits)) {
      if (key.length > 1000 || typeof value !== 'string' || value.length > 30000) throw new Error('Modification invalide.');
    }
    await firebaseRequest(env, 'content_edits', idToken, 'PUT', edits);
    return;
  }
  if (action === 'resetContentEdits') {
    await firebaseRequest(env, 'content_edits', idToken, 'DELETE');
    return;
  }
  if (action === 'createCard') {
    const card = input.card;
    if (!card || typeof card.id !== 'string' || !/^cc_[a-zA-Z0-9_-]{1,80}$/.test(card.id) ||
        typeof card.title !== 'string' || card.title.length > 300 ||
        typeof card.sectionId !== 'string' || card.sectionId.length > 100 ||
        JSON.stringify(card).length > 90_000) throw new Error('Carte invalide.');
    await firebaseRequest(env, `custom_cards/${encodeFirebaseKey(card.id)}`, idToken, 'PUT', card);
    return;
  }
  if (action === 'deleteCard') {
    const cardId = input.cardId;
    if (typeof cardId !== 'string' || !/^cc_[a-zA-Z0-9_-]{1,80}$/.test(cardId)) throw new Error('Identifiant de carte invalide.');
    const cards = await firebaseRequest(env, 'custom_cards', idToken, 'GET');
    const entries = Object.entries(cards || {}).filter(([, card]) => card?.id === cardId);
    if (!entries.length) throw new Error('Carte introuvable.');
    await Promise.all(entries.map(([key]) => firebaseRequest(env, `custom_cards/${encodeFirebaseKey(key)}`, idToken, 'DELETE')));
    return;
  }
  if (action === 'deleteStaticCard') {
    const staticId = input.staticId;
    if (typeof staticId !== 'string' || staticId.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(staticId)) throw new Error('Identifiant de carte invalide.');
    const current = await firebaseRequest(env, 'deleted_static_ids', idToken, 'GET');
    const ids = Array.isArray(current) ? current : [];
    if (!ids.includes(staticId)) ids.push(staticId);
    await firebaseRequest(env, 'deleted_static_ids', idToken, 'PUT', ids);
    return;
  }
  throw new Error('Action admin inconnue.');
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

      const updateActions = new Set(['create', 'editField', 'delete']);
      const adminActions = new Set(['saveContentEdits', 'resetContentEdits', 'createCard', 'deleteCard', 'deleteStaticCard']);
      if (!updateActions.has(input.action) && !adminActions.has(input.action)) return json({ error: 'Action inconnue.' }, 400);
      const updateId = input.action === 'create' ? input.update?.id : input.updateId;
      if (updateActions.has(input.action) && (typeof updateId !== 'string' || !/^upd_[a-zA-Z0-9_-]{1,80}$/.test(updateId))) {
        return json({ error: 'Identifiant d’update invalide.' }, 400);
      }

      const idToken = await firebaseToken(env);
      if (adminActions.has(input.action)) {
        await handleAdminAction(env, input, idToken);
      } else if (input.action === 'create') {
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
