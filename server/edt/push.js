// ============================================================================
// Section "EDT" — notifications push (web-push / VAPID).
//
// Contrainte importante : le plan gratuit Render efface le système de
// fichiers et endort le serveur ; on ne peut donc PAS compter sur un fichier
// local pour retenir l'abonnement push entre deux redémarrages. Solution :
// - l'abonnement est gardé en mémoire pendant que le process tourne
//   (setSubscription/getSubscription), renvoyé automatiquement par le client
//   à chaque ouverture de la page (voir POST /edt/api/subscribe) ;
// - au démarrage, on relit un repli depuis la variable d'environnement
//   PUSH_SUBSCRIPTION (JSON), que l'utilisateur colle manuellement dans le
//   dashboard Render après avoir cliqué "Activer les notifications" (la page
//   affiche l'abonnement + un bouton "Copier" pour ça).
// ============================================================================

const webpush = require('web-push');
const schedule = require('./schedule');

const core = schedule.core;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@example.com';

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } catch (e) {
    console.error('[edt/push] Clés VAPID invalides :', e.message);
  }
} else {
  console.warn('[edt/push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY absentes de l\'environnement : notifications push désactivées.');
}

let subscription = null;

if (process.env.PUSH_SUBSCRIPTION) {
  try {
    subscription = JSON.parse(process.env.PUSH_SUBSCRIPTION);
    console.log('[edt/push] Abonnement chargé depuis la variable d\'environnement PUSH_SUBSCRIPTION.');
  } catch (e) {
    console.warn('[edt/push] PUSH_SUBSCRIPTION invalide (JSON non parsable) : ' + e.message);
  }
}

function setSubscription(sub) {
  subscription = sub || null;
}

function getSubscription() {
  return subscription;
}

function isConfigured() {
  return configured;
}

async function sendPush(payload) {
  if (!configured) return { ok: false, reason: 'not-configured' };
  if (!subscription) return { ok: false, reason: 'no-subscription' };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const statusCode = err && err.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      console.error(
        `[edt/push] Abonnement expiré/invalide (statut ${statusCode}) — ` +
        'il faudra le renouveler (bouton "Activer les notifications" dans /edt/).'
      );
      subscription = null;
    } else {
      console.error('[edt/push] Échec d\'envoi :', err && err.message);
    }
    return { ok: false, reason: 'send-error', statusCode: statusCode, error: err && err.message };
  }
}

async function sendTestPush() {
  return sendPush({
    title: 'Mon EDT',
    body: 'Notification de test — tout fonctionne ✅',
    tag: 'edt-test'
  });
}

// --- Boucle de planification --------------------------------------------------
//
// Toutes les CHECK_EVERY_MS (5s), on regarde en heure de Paris si aujourd'hui
// est un jour travaillé, et pour chaque début de poste (y compris le premier
// de la journée) + la fin de service, on envoie une notif 3 minutes avant et
// une autre 30 secondes avant. TOLERANCE_MS rattrape un tick manqué (réveil
// du serveur, redémarrage) si on est encore dans la minute qui suit l'instant
// visé ; au-delà, on considère l'occasion ratée et on ne l'envoie pas en
// retard. sentKeys mémorise ce qui a déjà été envoyé (clé = date + évènement
// + décalage) pour ne jamais doubler un envoi.

const sentKeys = new Set();
const TOLERANCE_MS = 60 * 1000;
const CHECK_EVERY_MS = 5000;
const NOTIFICATION_OFFSETS = [
  { kind: 'minus3', ms: 3 * 60 * 1000 },
  { kind: 'minus30s', ms: 30 * 1000 }
];

let loopHandle = null;

function pruneSentKeys(todayStr) {
  for (const key of sentKeys) {
    if (key.slice(0, todayStr.length) !== todayStr) sentKeys.delete(key);
  }
}

async function tick(now) {
  now = now || new Date();
  const parts = core.parisParts(now);
  pruneSentKeys(parts.dateStr);

  if (!subscription || !configured) return;

  const dayInfo = schedule.getDayInfo(parts.year, parts.month, parts.day);
  if (dayInfo.type !== 'work') return;

  const events = core.getNotificationEvents(dayInfo.shifts);
  for (const event of events) {
    const timeParts = event.time.split(':');
    const eventHour = Number(timeParts[0]);
    const eventMinute = Number(timeParts[1]);
    const eventInstant = core.parisWallTimeToInstant(parts.year, parts.month, parts.day, eventHour, eventMinute);

    for (const offset of NOTIFICATION_OFFSETS) {
      const targetInstant = new Date(eventInstant.getTime() - offset.ms);
      const key = parts.dateStr + '|' + event.type + '|' + event.time + '|' + offset.kind;
      if (sentKeys.has(key)) continue;

      const delta = now.getTime() - targetInstant.getTime();
      if (delta >= 0 && delta <= TOLERANCE_MS) {
        sentKeys.add(key);
        const body = core.messageForEvent(event, offset.kind);
        sendPush({ title: 'Mon EDT', body: body, tag: key }).catch((e) => {
          console.error('[edt/push] Erreur d\'envoi planifié :', e && e.message);
        });
      }
    }
  }
}

function start() {
  if (loopHandle) return;
  loopHandle = setInterval(() => {
    tick().catch((e) => console.error('[edt/push] Erreur dans la boucle de planification :', e));
  }, CHECK_EVERY_MS);
  if (typeof loopHandle.unref === 'function') loopHandle.unref();
}

function stop() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

module.exports = {
  VAPID_PUBLIC_KEY,
  setSubscription,
  getSubscription,
  isConfigured,
  sendPush,
  sendTestPush,
  start,
  stop,
  // Exposé uniquement pour les tests unitaires (server/edt/schedule.test.js).
  _tick: tick,
  _sentKeys: sentKeys
};
