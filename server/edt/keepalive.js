// ============================================================================
// Maintien en éveil du serveur (plan gratuit Render) + diagnostic de /ping.
//
// Contexte : Render endort un service gratuit après 15 minutes sans requête
// entrante. Endormi = plus de boucle de notifications push EDT (voir push.js).
// Jusqu'au 2026-11 on comptait UNIQUEMENT sur cron-job.org (appel de /ping
// toutes les 10 min) : quand ce service externe a cessé d'appeler le site,
// rien ne l'a remarqué et les notifications se sont arrêtées sans bruit.
//
// Ce module apporte deux choses :
// 1. Un auto-ping : le serveur appelle lui-même sa propre adresse publique
//    (RENDER_EXTERNAL_URL, fournie automatiquement par Render) toutes les
//    10 min. La requête ressort sur Internet et repasse par l'entrée de
//    Render, donc elle compte comme du trafic entrant. Tant que le process
//    tourne, il ne s'endort donc plus, même si cron-job.org tombe.
//    Limite : un serveur DÉJÀ endormi ne peut pas se réveiller tout seul —
//    cron-job.org reste utile en filet de sécurité pour le réveiller.
// 2. Un journal des derniers pings reçus (GET /ping/status, affiché aussi
//    dans les Réglages ⚙ de /edt/) pour voir d'un coup d'œil, depuis le
//    téléphone, si cron-job.org appelle bien le site et depuis quand le
//    serveur est allumé.
// ============================================================================

const express = require('express');

const SELF_PING_USER_AGENT = 'copas-online-keepalive';
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const SELF_PING_TIMEOUT_MS = 30 * 1000;
const MAX_RECENT_PINGS = 20;

const serverStartedAt = new Date();
const recentPings = []; // plus récent en premier : { at, source }
let lastSelfPing = null; // { at, ok, status, error }
let loopHandle = null;

// D'où vient un appel à /ping ? Basé sur le User-Agent (jamais stocké en
// entier, seulement la catégorie).
function classifyPingSource(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (ua.includes(SELF_PING_USER_AGENT)) return 'auto';
  if (ua.includes('cron-job.org')) return 'cron-job.org';
  return 'autre';
}

function recordPing(userAgent, now) {
  const source = classifyPingSource(userAgent);
  recentPings.unshift({ at: (now || new Date()).toISOString(), source });
  if (recentPings.length > MAX_RECENT_PINGS) recentPings.length = MAX_RECENT_PINGS;
  if (source !== 'auto') console.log(`[ping] reçu (${source})`);
  return source;
}

function lastPingFrom(source) {
  const found = recentPings.find((p) => p.source === source);
  return found ? found.at : null;
}

function getStatus(now) {
  now = now || new Date();
  return {
    serverStartedAt: serverStartedAt.toISOString(),
    uptimeSeconds: Math.round((now.getTime() - serverStartedAt.getTime()) / 1000),
    selfPingEnabled: !!loopHandle,
    lastSelfPing,
    lastCronJobPingAt: lastPingFrom('cron-job.org'),
    recentPings: recentPings.slice()
  };
}

function resolveBaseUrl(env) {
  const raw = (env.KEEPALIVE_URL || env.RENDER_EXTERNAL_URL || '').trim();
  return raw.replace(/\/+$/, '');
}

async function selfPing(baseUrl) {
  const at = new Date().toISOString();
  try {
    const res = await fetch(baseUrl + '/ping', {
      headers: { 'User-Agent': SELF_PING_USER_AGENT },
      signal: AbortSignal.timeout(SELF_PING_TIMEOUT_MS)
    });
    const wasOk = lastSelfPing && lastSelfPing.ok;
    lastSelfPing = { at, ok: res.ok, status: res.status, error: null };
    if (!res.ok) console.error(`[keepalive] Auto-ping : réponse HTTP ${res.status}`);
    else if (!wasOk) console.log('[keepalive] Auto-ping OK.');
  } catch (e) {
    lastSelfPing = { at, ok: false, status: null, error: e && e.message };
    console.error('[keepalive] Auto-ping en échec :', e && e.message);
  }
  return lastSelfPing;
}

function start(env) {
  env = env || process.env;
  if (loopHandle) return;
  const baseUrl = resolveBaseUrl(env);
  if (!baseUrl) {
    console.log('[keepalive] Ni RENDER_EXTERNAL_URL ni KEEPALIVE_URL : auto-ping désactivé (normal en local).');
    return;
  }
  const intervalMs = Number(env.KEEPALIVE_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  console.log(`[keepalive] Auto-ping de ${baseUrl}/ping toutes les ${Math.round(intervalMs / 1000)} s.`);
  loopHandle = setInterval(() => { selfPing(baseUrl); }, intervalMs);
  // unref : ce minuteur seul n'empêche pas le process de s'arrêter proprement.
  if (typeof loopHandle.unref === 'function') loopHandle.unref();
  // Premier auto-ping peu après le démarrage (le temps que le serveur écoute).
  const first = setTimeout(() => { selfPing(baseUrl); }, Math.min(15000, intervalMs));
  if (typeof first.unref === 'function') first.unref();
}

function stop() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

const router = express.Router();

// Réponse volontairement identique à l'ancienne route ("ok", 200) : c'est ce
// que cron-job.org attend.
router.get('/ping', (req, res) => {
  recordPing(req.get('user-agent'));
  res.status(200).send('ok');
});

router.get('/ping/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(getStatus());
});

module.exports = {
  router,
  start,
  stop,
  getStatus,
  // Exposés pour les tests (server/edt/keepalive.test.js).
  _classifyPingSource: classifyPingSource,
  _recordPing: recordPing,
  _resolveBaseUrl: resolveBaseUrl,
  _selfPing: selfPing,
  SELF_PING_USER_AGENT
};
