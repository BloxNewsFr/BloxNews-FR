const ADMIN_DISCORD_IDS = new Set([
  '1503444854410317984', // fn_n0klip
  '775096691240992798',  // neolixx
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
      if (!ADMIN_DISCORD_IDS.has(String(user.id))) return json({ error: 'Ce compte Discord ne peut pas gérer les updates.' }, 403);

      const updateActions = new Set(['create', 'editField', 'delete']);
      const adminActions = new Set(['saveContentEdits', 'resetContentEdits', 'createCard', 'deleteCard', 'deleteStaticCard', 'sendPush']);
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
