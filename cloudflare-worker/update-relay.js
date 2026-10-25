const ADMIN_DISCORD_IDS = new Set([
  '1503444854410317984', // fn_n0klip
  '775096691240992798',  // neolixx
]);
const STATS_ADMIN_DISCORD_IDS = new Set([
  ...ADMIN_DISCORD_IDS,
  '965365062334308412', // bryanbg
]);

const MAX_REQUEST_BYTES = 3_500_000;
const MAX_SINGLE_FILE_BYTES = 2_000_000; // limite réelle Workers = 100 Mo ; marge confortable
const GITHUB_ALLOWED_PREFIXES = [
  /^\/?\d{3}\//,
  /^\/?index\.html$/,
  /^\/?archives\.html$/,
  /^\/?sources\.json$/,
];
const GITHUB_MAX_FILES = 30;
let cachedFirebaseAuth = { token: '', expiresAt: 0, pending: null };

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
  if (cachedFirebaseAuth.token && cachedFirebaseAuth.expiresAt > Date.now() + 60_000) return cachedFirebaseAuth.token;
  if (cachedFirebaseAuth.pending) return cachedFirebaseAuth.pending;
  cachedFirebaseAuth.pending = (async () => {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.FIREBASE_EDITOR_EMAIL, password: env.FIREBASE_EDITOR_PASSWORD, returnSecureToken: true }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.idToken || result.localId !== env.FIREBASE_EDITOR_UID) {
      throw new Error('Le compte technique Firebase du relais est mal configuré.');
    }
    cachedFirebaseAuth = {
      token: result.idToken,
      expiresAt: Date.now() + Math.max(60, Number(result.expiresIn) || 3600) * 1000,
      pending: null,
    };
    return result.idToken;
  })();
  try { return await cachedFirebaseAuth.pending; }
  finally { cachedFirebaseAuth.pending = null; }
}

async function firebaseIncrement(env, path, token) {
  return firebaseTransform(env, path, token, value => (Number(value) || 0) + 1);
}

async function firebaseTransform(env, path, token, transform) {
  const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
  const url = `${base}/${path}.json?auth=${encodeURIComponent(token)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    const value = await current.json().catch(() => null);
    if (!current.ok) throw new Error(value?.error || `Firebase a refusé la lecture (${current.status}).`);
    const etag = current.headers.get('ETag');
    const next = transform(value);
    const saved = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': etag || 'null_etag' },
      body: JSON.stringify(next),
    });
    if (saved.status === 412) continue;
    const result = await saved.json().catch(() => null);
    if (!saved.ok) throw new Error(result?.error || `Firebase a refusé l’écriture (${saved.status}).`);
    return next;
  }
  throw new Error('La statistique a changé trop souvent; réessaie.');
}

function encodeFirebaseKey(value) {
  return encodeURIComponent(value).replace(/\./g, '%2E');
}

function parisDay(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function discordUserFromToken(token) {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  if (!user || typeof user.id !== 'string' || !/^\d{5,30}$/.test(user.id) || typeof user.username !== 'string') return null;
  return user;
}

function discordAvatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=80`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}

async function discordDailyAccountHash(env, day, discordId) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.FIREBASE_EDITOR_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${day}:${discordId}`));
  return [...new Uint8Array(signature)].map(n => n.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

async function cleanLinkedDiscordVisits(env, token, discordId, visits) {
  const cutoff = Date.now() - 30 * 86400000;
  const recent = Object.entries(visits || {})
    .filter(([, visit]) => visit && Number(visit.t) >= cutoff)
    .sort((a, b) => Number(b[1].t) - Number(a[1].t))
    .slice(0, 100);
  const path = `site_stats/discord_auth/linked_visits/${encodeFirebaseKey(discordId)}`;
  if (recent.length) await firebaseRequest(env, path, token, 'PUT', Object.fromEntries(recent));
  else await firebaseRequest(env, path, token, 'DELETE');
  return recent.map(([, visit]) => visit);
}

async function handleAdminAction(env, input, idToken) {
  const { action } = input;
  if (action === 'getDiscordStats') {
    const profileId = input.profileId == null ? '' : String(input.profileId);
    if (profileId && !/^\d{5,30}$/.test(profileId)) throw new Error('Identifiant Discord invalide.');

    const now = Date.now();
    const today = parisDay(now);
    const profilesPath = 'site_stats/discord_auth/profiles';
    const profiles = await firebaseRequest(env, profilesPath, idToken, 'GET') || {};
    const retained = [];
    await Promise.all(Object.entries(profiles).map(async ([id, profile]) => {
      if (!profile || Number(profile.expiresAt) <= now) {
        await Promise.all([
          firebaseRequest(env, `${profilesPath}/${encodeFirebaseKey(id)}`, idToken, 'DELETE'),
          firebaseRequest(env, `site_stats/discord_auth/linked_visits/${encodeFirebaseKey(id)}`, idToken, 'DELETE'),
        ]);
        return;
      }
      retained.push({
        id,
        username: String(profile.username || 'Utilisateur Discord').slice(0, 80),
        avatar: String(profile.avatar || '').slice(0, 500),
        firstConnection: Number(profile.firstConnection) || 0,
        lastConnection: Number(profile.lastConnection) || 0,
        connections: Number(profile.connections) || 0,
        expiresAt: Number(profile.expiresAt) || 0,
        visitConsent: profile.visitConsent === true,
      });
    }));
    retained.sort((a, b) => b.lastConnection - a.lastConnection);

    let selected = null;
    let visits = [];
    if (profileId) {
      selected = retained.find(profile => profile.id === profileId) || null;
      if (selected && selected.visitConsent) {
        const rawVisits = await firebaseRequest(env, `site_stats/discord_auth/linked_visits/${encodeFirebaseKey(profileId)}`, idToken, 'GET');
        visits = await cleanLinkedDiscordVisits(env, idToken, profileId, rawVisits);
      } else if (selected) {
        await firebaseRequest(env, `site_stats/discord_auth/linked_visits/${encodeFirebaseKey(profileId)}`, idToken, 'DELETE');
      }
    }

    const dailyPath = `site_stats/discord_auth/daily/${today}`;
    const [totalConnections, todayConnections, todayAccounts] = await Promise.all([
      firebaseRequest(env, 'site_stats/discord_auth/metrics/totalConnections', idToken, 'GET'),
      firebaseRequest(env, `${dailyPath}/connections`, idToken, 'GET'),
      firebaseRequest(env, `${dailyPath}/accounts`, idToken, 'GET'),
    ]);
    const [dailyData, loginEvents] = await Promise.all([
      firebaseRequest(env, 'site_stats/discord_auth/daily', idToken, 'GET'),
      firebaseRequest(env, 'site_stats/discord_auth/login_events', idToken, 'GET'),
    ]);
    await Promise.all([
      ...Object.keys(dailyData || {}).filter(date => date < today).map(date =>
        firebaseRequest(env, `site_stats/discord_auth/daily/${encodeFirebaseKey(date)}`, idToken, 'DELETE')
      ),
      ...Object.entries(loginEvents || {}).filter(([, event]) => Number(event?.t) < now - 8 * 86400000).map(([hash]) =>
        firebaseRequest(env, `site_stats/discord_auth/login_events/${encodeFirebaseKey(hash)}`, idToken, 'DELETE')
      ),
    ]);
    return {
      metrics: {
        todayConnections: Number(todayConnections) || 0,
        todayAccounts: Object.keys(todayAccounts || {}).length,
        totalConnections: Number(totalConnections) || 0,
        retainedProfiles: retained.length,
      },
      profiles: retained.slice(0, 100),
      selected,
      visits,
      today,
    };
  }
  if (action === 'saveContentEdits') {
    const edits = input.edits;
    if (!edits || typeof edits !== 'object' || Array.isArray(edits) || Object.keys(edits).length > 500) {
      throw new Error('Liste de modifications invalide.');
    }
    for (const [key, value] of Object.entries(edits)) {
      if (key.length > 1000) throw new Error('Modification invalide.');
      // null = suppression de la clé (reset partiel)
      if (value === null) continue;
      if (typeof value !== 'string') throw new Error('Modification invalide.');
      // Les images (data:image compressées côté client) ont une limite plus haute
      const isImage = key.startsWith('img%3A%3A') || key.startsWith('img::') || value.startsWith('data:image/');
      const maxLen = isImage ? 350000 : 30000;
      if (value.length > maxLen) throw new Error('Modification invalide.');
    }
    // PATCH fusionne au lieu de remplacer tout le nœud → envoi delta uniquement
    await firebaseRequest(env, 'content_edits', idToken, 'PATCH', edits);
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
  if (action === 'sendPush') {
    // Envoie une notification push à tous les tokens enregistrés via FCM HTTP v1
    const { title, body, url } = input;
    if (!title || typeof title !== 'string' || title.length > 200) throw new Error('Titre invalide.');
    const tokens = await firebaseRequest(env, 'push_tokens', idToken, 'GET');
    if (!tokens || typeof tokens !== 'object') return; // aucun abonné
    const tokenList = Object.values(tokens).filter(t => typeof t === 'string' && t.length > 10);
    if (!tokenList.length) return;
    // FCM HTTP v1 nécessite un OAuth2 token → on utilise l'API legacy (HTTP v0) avec Server Key
    // La Server Key est stockée dans la variable d'env FCM_SERVER_KEY
    await Promise.allSettled(tokenList.map(token =>
      fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${env.FCM_SERVER_KEY}`,
        },
        body: JSON.stringify({
          to: token,
          notification: {
            title,
            body: body || 'Nouvelle information disponible !',
            icon: '/BloxNews-FR/icons/icon-192x192.png',
            badge: '/BloxNews-FR/icons/icon-96x96.png',
            click_action: url || 'https://bloxnewsfr.github.io/BloxNews-FR/',
          },
          data: { url: url || 'https://bloxnewsfr.github.io/BloxNews-FR/' },
          webpush: { headers: { Urgency: 'high' } },
        }),
      })
    ));
    return;
  }
  throw new Error('Action admin inconnue.');
}

function githubHeaders(env) {
  const token = String(env.GITHUB_TOKEN || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'bloxnews-relay',
  };
}

async function githubApi(env, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { ...githubHeaders(env), ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const status = response.status;
    if (status === 404) {
      throw new Error(
        `GitHub 404 sur ${path}. Vérifie : GITHUB_REPO="${env.GITHUB_REPO || '(vide)'}", ` +
        `branche="${env.GITHUB_BRANCH || 'main'}", et que le token a bien accès à ce dépôt ` +
        `(token fine-grained : Repository access = ce repo + Contents: Read and write).`
      );
    }
    if (status === 401) {
      throw new Error('GitHub 401 : GITHUB_TOKEN invalide ou expiré. Régénère-le.');
    }
    if (status === 403) {
      throw new Error(`GitHub 403 : le token n'a pas la permission d'écrire (Contents: Read and write).`);
    }
    throw new Error(result?.message || `GitHub a refusé l'opération (${status}).`);
  }
  return result;
}

function validateBulletinFiles(input) {
  const num = input.num;
  if (typeof num !== 'string' || !/^\d{3}$/.test(num) || num === '000') {
    throw new Error('Numéro de bulletin invalide.');
  }
  if (input.theme != null && !['halloween', 'valentine'].includes(input.theme)) {
    throw new Error('Thème invalide.');
  }
  const files = input.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > GITHUB_MAX_FILES) {
    throw new Error('Liste de fichiers invalide.');
  }
  const seen = new Set();
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new Error('Fichier invalide.');
    }
    const path = file.path.replace(/^\/+/, '');
    if (path.length > 200 || path.includes('..') || path.includes('//')) {
      throw new Error('Chemin de fichier invalide.');
    }
    if (!GITHUB_ALLOWED_PREFIXES.some((re) => re.test(path))) {
      throw new Error(`Chemin non autorisé : ${path}`);
    }
    if (file.encoding && !['utf-8', 'base64-dataurl'].includes(file.encoding)) {
      throw new Error('Encodage de fichier invalide.');
    }
    const maxContent = file.encoding === 'base64-dataurl' ? 1_800_000 : 400_000;
    if (file.content.length > maxContent) {
      throw new Error(`Fichier trop volumineux : ${path}`);
    }
    if (seen.has(path)) throw new Error(`Doublon de fichier : ${path}`);
    seen.add(path);
  }
  return { num, theme: input.theme || null, files };
}

async function createBulletinOnGitHub(env, payload) {
  const { files, theme } = payload;
  const branch = (env.GITHUB_BRANCH || 'main').trim();

  const repo = (env.GITHUB_REPO || '').trim();
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPO manquant ou invalide.');
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN manquant.');

  const ref = await githubApi(env, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await githubApi(env, `/repos/${repo}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  const treeEntries = [];
  for (const file of files) {
    const path = file.path.replace(/^\/+/, '');
    const isDataUrl = file.encoding === 'base64-dataurl';
    const content = isDataUrl
      ? file.content.replace(/^data:[^,]*,/, '')
      : file.content;
    const blob = await githubApi(env, `/repos/${repo}/git/blobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        encoding: isDataUrl ? 'base64' : 'utf-8',
      }),
    });
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const tree = await githubApi(env, `/repos/${repo}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  const message = theme
    ? `bulletin: publie #${payload.num} (theme ${theme})`
    : `bulletin: publie #${payload.num}`;
  const commit = await githubApi(env, `/repos/${repo}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommitSha] }),
  });

  await githubApi(env, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { commit: commit.sha, tree: tree.sha };
}

async function deleteBulletinOnGitHub(env, num) {
  const branch = (env.GITHUB_BRANCH || 'main').trim();
  const repo = (env.GITHUB_REPO || '').trim();
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPO manquant ou invalide.');
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN manquant.');

  const ref = await githubApi(env, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await githubApi(env, `/repos/${repo}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  // Liste le contenu du dossier NNN/
  const listing = await githubApi(env, `/repos/${repo}/contents/${num}?ref=${encodeURIComponent(branch)}`);
  if (!Array.isArray(listing)) throw new Error('Dossier du bulletin introuvable.');

  // Crée un arbre avec sha: null pour supprimer chaque fichier
  const treeEntries = listing.map(item => ({ path: item.path, mode: '100644', type: 'blob', sha: null }));
  const tree = await githubApi(env, `/repos/${repo}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  const commit = await githubApi(env, `/repos/${repo}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `bulletin: supprime #${num}`, tree: tree.sha, parents: [baseCommitSha] }),
  });

  await githubApi(env, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { commit: commit.sha };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

    let input;
    try {
      // Content-Length peut être absent (chunked) : on valide aussi après parse
      if (Number(request.headers.get('Content-Length') || 0) > MAX_REQUEST_BYTES) return json({ error: 'Requête trop volumineuse.' }, 413);
      input = await request.json();
    } catch {
      return json({ error: 'Requête JSON invalide.' }, 400);
    }

    // validation taille post-parse (Content-Length absent ou mensonger)
    try {
      const raw = JSON.stringify(input);
      if (raw.length > MAX_REQUEST_BYTES) return json({ error: 'Requête trop volumineuse.' }, 413);
    } catch { /* ignore */ }

    if (input?.action === 'statsDiscordLogin') {
      if (typeof input.discordAccessToken !== 'string' || input.discordAccessToken.length < 10 || input.discordAccessToken.length > 4096) {
        return json({ error: 'Données de connexion Discord invalides.' }, 400);
      }
      const loginEventTime = Number(String(input.eventId || '').split('_', 1)[0]);
      if (!/^\d{10,16}_[a-zA-Z0-9_-]{6,40}$/.test(String(input.eventId || '')) ||
          !Number.isFinite(loginEventTime) || Date.now() - loginEventTime > 10 * 60000 || loginEventTime - Date.now() > 60000) {
        return json({ error: 'Événement de connexion expiré ou invalide.' }, 400);
      }
      try {
        const user = await discordUserFromToken(input.discordAccessToken);
        if (!user) return json({ error: 'La connexion Discord a expiré. Reconnecte-toi.' }, 401);
        const token = await firebaseToken(env);
        const now = Date.now();
        const day = parisDay(now);
        const tokenHash = await sha256Hex(input.discordAccessToken);
        const eventPath = `site_stats/discord_auth/login_events/${tokenHash}`;
        if (await firebaseRequest(env, eventPath, token, 'GET')) {
          const current = await firebaseRequest(env, `site_stats/discord_auth/profiles/${encodeFirebaseKey(user.id)}`, token, 'GET');
          return json({ ok: true, duplicate: true, visitConsent: current?.visitConsent === true });
        }

        const profilePath = `site_stats/discord_auth/profiles/${encodeFirebaseKey(user.id)}`;
        const existingProfile = await firebaseRequest(env, profilePath, token, 'GET');
        if (existingProfile && Number(existingProfile.expiresAt) <= now) {
          await firebaseRequest(env, `site_stats/discord_auth/linked_visits/${encodeFirebaseKey(user.id)}`, token, 'DELETE');
        }
        const savedProfile = await firebaseTransform(env, profilePath, token, current => ({
          id: user.id,
          username: String(user.global_name || user.username).slice(0, 80),
          avatar: discordAvatarUrl(user),
          firstConnection: current && Number(current.expiresAt) > now ? Number(current.firstConnection) || now : now,
          lastConnection: now,
          connections: current && Number(current.expiresAt) > now ? (Number(current.connections) || 0) + 1 : 1,
          expiresAt: now + 180 * 86400000,
          visitConsent: !!(current && Number(current.expiresAt) > now && current.visitConsent === true),
        }));
        await firebaseIncrement(env, 'site_stats/discord_auth/metrics/totalConnections', token);
        await firebaseIncrement(env, `site_stats/discord_auth/daily/${day}/connections`, token);
        const accountHash = await discordDailyAccountHash(env, day, user.id);
        await firebaseRequest(env, `site_stats/discord_auth/daily/${day}/accounts/${accountHash}`, token, 'PUT', true);
        await firebaseRequest(env, eventPath, token, 'PUT', { t: now });

        const daily = await firebaseRequest(env, 'site_stats/discord_auth/daily', token, 'GET') || {};
        const expiryDay = parisDay(now - 2 * 86400000);
        await Promise.all(Object.keys(daily).filter(date => date < expiryDay).map(date =>
          firebaseRequest(env, `site_stats/discord_auth/daily/${encodeFirebaseKey(date)}`, token, 'DELETE')
        ));
        const oldEvents = await firebaseRequest(env, 'site_stats/discord_auth/login_events', token, 'GET') || {};
        const eventCutoff = now - 8 * 86400000;
        await Promise.all(Object.entries(oldEvents).filter(([, event]) => Number(event?.t) < eventCutoff).map(([hash]) =>
          firebaseRequest(env, `site_stats/discord_auth/login_events/${encodeFirebaseKey(hash)}`, token, 'DELETE')
        ));
        return json({ ok: true, visitConsent: savedProfile.visitConsent });
      } catch (error) {
        console.error('Discord login stats failure:', error);
        return json({ error: error?.message || 'La connexion n’a pas pu être enregistrée.' }, 502);
      }
    }

    if (input?.action === 'statsSetVisitConsent') {
      if (typeof input.discordAccessToken !== 'string' || input.discordAccessToken.length < 10 || input.discordAccessToken.length > 4096 ||
          typeof input.consent !== 'boolean') return json({ error: 'Choix de consentement invalide.' }, 400);
      try {
        const user = await discordUserFromToken(input.discordAccessToken);
        if (!user) return json({ error: 'Reconnecte-toi avec Discord pour modifier ce choix.' }, 401);
        const token = await firebaseToken(env);
        const now = Date.now();
        const profilePath = `site_stats/discord_auth/profiles/${encodeFirebaseKey(user.id)}`;
        await firebaseTransform(env, profilePath, token, current => ({
          id: user.id,
          username: String(user.global_name || user.username).slice(0, 80),
          avatar: discordAvatarUrl(user),
          firstConnection: Number(current?.firstConnection) || now,
          lastConnection: Number(current?.lastConnection) || now,
          connections: Number(current?.connections) || 0,
          expiresAt: Number(current?.expiresAt) || now + 180 * 86400000,
          visitConsent: input.consent,
        }));
        if (!input.consent) {
          await firebaseRequest(env, `site_stats/discord_auth/linked_visits/${encodeFirebaseKey(user.id)}`, token, 'DELETE');
        }
        return json({ ok: true, consent: input.consent });
      } catch (error) {
        console.error('Discord visit consent failure:', error);
        return json({ error: error?.message || 'Impossible d’enregistrer ce choix.' }, 502);
      }
    }

    if (input?.action === 'statsVisit' || input?.action === 'statsBulletinView' || input?.action === 'statsCardView') {
      if (input.action === 'statsVisit' && (
          typeof input.visitorId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(input.visitorId) ||
          (input.countPageview !== undefined && typeof input.countPageview !== 'boolean') ||
          (input.associateVisits !== undefined && typeof input.associateVisits !== 'boolean') ||
          (input.discordAccessToken !== undefined && (typeof input.discordAccessToken !== 'string' || input.discordAccessToken.length > 4096)) ||
          (input.page !== undefined && (typeof input.page !== 'string' || input.page.length > 300 || !input.page.startsWith('/') || input.page.startsWith('//') || input.page.includes('..'))))) {
        return json({ error: 'Données de visite invalides.' }, 400);
      }
      if (input.action === 'statsBulletinView' &&
          (typeof input.bulletinId !== 'string' || !/^(?:\d{3}|pvp1)$/.test(input.bulletinId) || input.bulletinId === '000')) {
        return json({ error: 'Identifiant de bulletin invalide.' }, 400);
      }
      if (input.action === 'statsCardView' &&
          (typeof input.cardId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(input.cardId) ||
           typeof input.title !== 'string' || input.title.length > 160)) {
        return json({ error: 'Données de vue de card invalides.' }, 400);
      }
      try {
        const idToken = await firebaseToken(env);
        if (input.action === 'statsVisit') {
          const visitorId = input.visitorId;
          const now = Date.now();
          const day = parisDay(now);
          let visitConsent = false;
          const visitorKey = `s:${visitorId}`;
          const logPath = `site_stats/visitors_log/${day}/${encodeFirebaseKey(visitorKey)}`;
          await firebaseRequest(env, logPath, idToken, 'PUT', { u: 'invité', a: '', t: now });
          if (input.countPageview !== false) await firebaseIncrement(env, 'site_stats/pageviews', idToken);

          if (input.associateVisits === true && typeof input.discordAccessToken === 'string' && input.discordAccessToken.length >= 10) {
            let user = null;
            try { user = await discordUserFromToken(input.discordAccessToken); } catch (_) {}
            if (user) {
              const profile = await firebaseRequest(env, `site_stats/discord_auth/profiles/${encodeFirebaseKey(user.id)}`, idToken, 'GET');
              if (profile?.visitConsent === true) {
                visitConsent = true;
                const visitsPath = `site_stats/discord_auth/linked_visits/${encodeFirebaseKey(user.id)}`;
                const visits = await firebaseRequest(env, visitsPath, idToken, 'GET') || {};
                const visitKey = `${now.toString(36)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
                visits[visitKey] = { t: now, p: input.page || '/' };
                await cleanLinkedDiscordVisits(env, idToken, user.id, visits);
                const currentConsent = await firebaseRequest(env, `site_stats/discord_auth/profiles/${encodeFirebaseKey(user.id)}/visitConsent`, idToken, 'GET');
                if (currentConsent !== true) {
                  visitConsent = false;
                  await firebaseRequest(env, `site_stats/discord_auth/linked_visits/${encodeFirebaseKey(user.id)}`, idToken, 'DELETE');
                }
              }
            }
          }
          return json({ ok: true, visitConsent });
        }

        if (input.action === 'statsBulletinView') {
          const bulletinId = input.bulletinId;
          await firebaseIncrement(env, `site_stats/bulletin_views/${encodeFirebaseKey(bulletinId)}`, idToken);
          return json({ ok: true });
        }

        const cardId = input.cardId;
        const title = input.title;
        await firebaseTransform(env, `site_stats/card_views/${encodeFirebaseKey(cardId)}`, idToken, value => ({
          n: ((value && Number(value.n)) || 0) + 1,
          t: title || cardId,
        }));
        return json({ ok: true });
      } catch (error) {
        console.error('Stats event relay failure:', error);
        return json({ error: error?.message || 'Le relais ne peut pas enregistrer cette statistique.' }, 502);
      }
    }

    // La présence est ouverte aux visiteurs, mais le relais ne permet que
    // l’écriture d’un nœud dans presence (aucun autre chemin Firebase).
    if (input?.action === 'statsPresence') {
      const sessionId = input.sessionId;
      if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{8,40}$/.test(sessionId)) {
        return json({ error: 'Identifiant de présence invalide.' }, 400);
      }
      const presence = input.presence;
      if (!presence || typeof presence !== 'object' || Array.isArray(presence) ||
          typeof presence.u !== 'string' || presence.u.length > 80 ||
          typeof presence.a !== 'string' || presence.a.length > 500 ||
          typeof presence.p !== 'string' || presence.p.length > 300 || !presence.p.startsWith('/') ||
          !Number.isFinite(presence.t) || Math.abs(Date.now() - presence.t) > 120000) {
        return json({ error: 'Données de présence invalides.' }, 400);
      }
      if (presence.a && !/^https:\/\/cdn\.discordapp\.com\/avatars\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.(webp|png|jpg|gif)(\?.*)?$/.test(presence.a)) {
        return json({ error: 'Avatar de présence invalide.' }, 400);
      }

      try {
        const idToken = await firebaseToken(env);
        const path = `site_stats/presence/${encodeFirebaseKey(sessionId)}`;
        await firebaseRequest(env, path, idToken, 'PUT', presence);
        return json({ ok: true });
      } catch (error) {
        console.error('Stats presence relay failure:', error);
        return json({ error: error?.message || 'Le relais ne peut pas enregistrer la présence.' }, 502);
      }
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
      const canManage = ADMIN_DISCORD_IDS.has(String(user.id));
      const canReadStats = input.action === 'getDiscordStats' && STATS_ADMIN_DISCORD_IDS.has(String(user.id));
      if (!canManage && !canReadStats) return json({ error: 'Ce compte Discord ne peut pas gérer les updates.' }, 403);

      const updateActions = new Set(['create', 'editField', 'delete']);
      const adminActions = new Set(['saveContentEdits', 'resetContentEdits', 'createCard', 'deleteCard', 'deleteStaticCard', 'sendPush', 'getDiscordStats']);
      const gitActions = new Set(['createBulletin', 'deleteBulletin', 'gitBase', 'gitBlob', 'gitCommit', 'gitCheck', 'gitDeleteCommit']);
      if (!updateActions.has(input.action) && !adminActions.has(input.action) && !gitActions.has(input.action)) {
        return json({ error: 'Action inconnue.' }, 400);
      }
      const updateId = input.action === 'create' ? input.update?.id : input.updateId;
      if (updateActions.has(input.action) && (typeof updateId !== 'string' || !/^upd_[a-zA-Z0-9_-]{1,80}$/.test(updateId))) {
        return json({ error: 'Identifiant d’update invalide.' }, 400);
      }

      if (gitActions.has(input.action)) {
        if (input.action === 'createBulletin') {
          const payload = validateBulletinFiles(input);
          const result = await createBulletinOnGitHub(env, payload);
          return json({ ok: true, commit: result.commit, num: payload.num });
        }
        if (input.action === 'deleteBulletin') {
          if (!env.DELETE_PASSWORD || input.password !== env.DELETE_PASSWORD) {
            return json({ error: 'Mot de passe incorrect.' }, 403);
          }
          const num = input.num;
          if (typeof num !== 'string' || !/^\d{3}$/.test(num) || num === '000') {
            return json({ error: 'Numéro de bulletin invalide.' }, 400);
          }
          const result = await deleteBulletinOnGitHub(env, num);
          return json({ ok: true, commit: result.commit, num });
        }
        if (input.action === 'gitCheck') {
          const repo = (env.GITHUB_REPO || '').trim();
          const branch = (env.GITHUB_BRANCH || 'main').trim();
          const token = String(env.GITHUB_TOKEN || '').trim();
          const result = {
            ok: true,
            hasToken: token.length > 0,
            tokenLength: token.length,
            tokenPrefix: token ? token.slice(0, 4) : '',
            repo: repo || '(vide)',
            branch,
            repoValid: /^[\w.-]+\/[\w.-]+$/.test(repo),
            deletePasswordSet: !!env.DELETE_PASSWORD,
            authTest: null,
          };
          if (token && result.repoValid) {
            try {
              const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: githubHeaders(env) });
              result.authTest = { status: res.status, ok: res.ok };
              if (!res.ok) {
                const body = await res.json().catch(() => null);
                result.authTest.message = body?.message || null;
              }
            } catch (e) {
              result.authTest = { error: e.message };
            }
          }
          return json(result);
        }
        if (input.action === 'gitBase') {
          // Étape 1 : récupère le SHA de base de la branche
          const branch = (env.GITHUB_BRANCH || 'main').trim();
          const repo = (env.GITHUB_REPO || '').trim();
          if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPO manquant ou invalide : "' + repo + '".');
          if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN manquant.');
          const ref = await githubApi(env, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
          const baseCommit = await githubApi(env, `/repos/${repo}/git/commits/${ref.object.sha}`);
          return json({ ok: true, baseCommitSha: ref.object.sha, baseTreeSha: baseCommit.tree.sha });
        }
        if (input.action === 'gitBlob') {
          // Étape 2 : crée un blob (un fichier à la fois, reste sous 100 Ko)
          const file = input.file;
          if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
            throw new Error('Fichier invalide.');
          }
          const path = file.path.replace(/^\/+/, '');
          if (path.length > 200 || path.includes('..') || !GITHUB_ALLOWED_PREFIXES.some(re => re.test(path))) {
            throw new Error('Chemin non autorisé : ' + path);
          }
          if (file.content.length > MAX_SINGLE_FILE_BYTES) {
            throw new Error('Fichier trop volumineux : ' + path);
          }
          const isDataUrl = file.encoding === 'base64-dataurl';
          const content = isDataUrl ? file.content.replace(/^data:[^,]*,/, '') : file.content;
          const repo = (env.GITHUB_REPO || '').trim();
          const blob = await githubApi(env, `/repos/${repo}/git/blobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, encoding: isDataUrl ? 'base64' : 'utf-8' }),
          });
          return json({ ok: true, sha: blob.sha, path });
        }
        if (input.action === 'gitDeleteCommit') {
          if (!env.DELETE_PASSWORD || input.password !== env.DELETE_PASSWORD) {
            return json({ error: 'Mot de passe incorrect.' }, 403);
          }
          const num = String(input.num || '');
          if (!/^\d{3}$/.test(num) || num === '000') {
            return json({ error: 'Numéro de bulletin invalide.' }, 400);
          }
          const { baseCommitSha, baseTreeSha, entries } = input;
          if (!baseCommitSha || !baseTreeSha) {
            return json({ error: 'Données de commit incomplètes.' }, 400);
          }
          const repo = (env.GITHUB_REPO || '').trim();
          const branch = (env.GITHUB_BRANCH || 'main').trim();
          const fullTree = await githubApi(env, `/repos/${repo}/git/trees/${baseTreeSha}?recursive=1`);
          const prefix = num + '/';
          const deletions = (fullTree.tree || [])
            .filter(t => t.type === 'blob' && t.path.startsWith(prefix))
            .map(t => ({ path: t.path, mode: '100644', type: 'blob', sha: null }));
          if (!deletions.length) {
            return json({ error: 'Bulletin #' + num + ' introuvable dans le dépôt.' }, 404);
          }
          const additions = (Array.isArray(entries) ? entries : []).map(e => ({
            path: String(e.path).replace(/^\/+/, ''),
            mode: '100644',
            type: 'blob',
            sha: e.sha,
          }));
          const tree = await githubApi(env, `/repos/${repo}/git/trees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_tree: baseTreeSha, tree: [...deletions, ...additions] }),
          });
          const commit = await githubApi(env, `/repos/${repo}/git/commits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `bulletin: supprime #${num}`, tree: tree.sha, parents: [baseCommitSha] }),
          });
          await githubApi(env, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: commit.sha, force: false }),
          });
          return json({ ok: true, commit: commit.sha, deleted: deletions.length });
        }
        if (input.action === 'gitCommit') {
          // Étape 3 : crée tree + commit à partir des SHAs collectés
          const { baseCommitSha, baseTreeSha, entries, message, theme, num } = input;
          if (!baseCommitSha || !baseTreeSha || !Array.isArray(entries) || !entries.length) {
            throw new Error('Données de commit incomplètes.');
          }
          const repo = (env.GITHUB_REPO || '').trim();
          const branch = (env.GITHUB_BRANCH || 'main').trim();
          const treeEntries = entries.map(e => ({
            path: String(e.path).replace(/^\/+/, ''),
            mode: '100644',
            type: 'blob',
            sha: e.sha,
          }));
          const tree = await githubApi(env, `/repos/${repo}/git/trees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
          });
          const msg = message || (theme ? `bulletin: publie #${num} (theme ${theme})` : `bulletin: publie #${num}`);
          const commit = await githubApi(env, `/repos/${repo}/git/commits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, tree: tree.sha, parents: [baseCommitSha] }),
          });
          await githubApi(env, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: commit.sha, force: false }),
          });
          return json({ ok: true, commit: commit.sha, tree: tree.sha });
        }
        return json({ error: 'Action Git inconnue.' }, 400);
      }

      // Enregistrement token push — accessible sans être admin
      if (input.action === 'registerPushToken') {
        const token = input.token;
        if (!token || typeof token !== 'string' || token.length < 10 || token.length > 512) {
          return json({ error: 'Token invalide.' }, 400);
        }
        const fbToken = await firebaseToken(env);
        const key = encodeFirebaseKey(token.slice(-40)); // clé Firebase = derniers 40 chars du token
        await firebaseRequest(env, `push_tokens/${key}`, fbToken, 'PUT', token);
        return json({ ok: true });
      }

      const idToken = await firebaseToken(env);
      if (adminActions.has(input.action)) {
        const result = await handleAdminAction(env, input, idToken);
        if (input.action === 'getDiscordStats') return json(result);
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
