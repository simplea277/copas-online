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
const VAPID_SUBJECT_RAW = process.env.VAPID_SUBJECT || '';

// web-push exige un "subject" au format mailto:... ou https://... (sinon
// setVapidDetails lève une exception) — un piège rencontré en pratique :
// la variable d'environnement collée sur Render contenait juste l'adresse
// e-mail ("tardiswho08@gmail.com"), sans le préfixe "mailto:", ce qui
// faisait échouer silencieusement toute la configuration VAPID (`configured`
// restait `false`) alors que les deux clés elles-mêmes étaient correctes.
// On normalise ici en filet de sécurité plutôt que de dépendre uniquement
// d'une valeur bien formée côté Render.
function normalizeVapidSubject(raw) {
  if (!raw) return 'mailto:contact@example.com';
  if (raw.startsWith('mailto:') || raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return 'mailto:' + raw;
}

const VAPID_SUBJECT = normalizeVapidSubject(VAPID_SUBJECT_RAW);

// Log de démarrage : présence de chaque variable uniquement, jamais leur
// valeur (clés/abonnement = secrets).
console.log(
  '[edt/push] Variables au démarrage — ' +
  `VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY ? 'présente' : 'ABSENTE'}, ` +
  `VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY ? 'présente' : 'ABSENTE'}, ` +
  `VAPID_SUBJECT: ${VAPID_SUBJECT_RAW ? 'présente' : 'absente (repli par défaut utilisé)'}` +
  (VAPID_SUBJECT_RAW && VAPID_SUBJECT !== VAPID_SUBJECT_RAW ? ' (normalisée : préfixe "mailto:" ajouté automatiquement)' : '') + ', ' +
  `PUSH_SUBSCRIPTION: ${process.env.PUSH_SUBSCRIPTION ? 'présente' : 'absente'}`
);

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
    console.log('[edt/push] Configuration VAPID OK — notifications push activées.');
  } catch (e) {
    console.error('[edt/push] Clés/sujet VAPID invalides :', e.message);
  }
} else {
  console.warn('[edt/push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY absentes de l\'environnement : notifications push désactivées.');
}

// Validation de forme d'un abonnement push. Piège rencontré en pratique le
// 2026-09-29 : un endpoint collé sur Render sans son préfixe "https://"
// (probablement tronqué en chemin lors d'un copier/coller) faisait échouer
// l'envoi bien plus tard, au moment de l'appel à web-push, avec une erreur
// peu explicite ("VAPID audience is not a url. null//null") — on valide
// donc la forme dès la lecture (démarrage ET /edt/api/subscribe) pour
// détecter ce genre de corruption immédiatement plutôt qu'à l'usage.
function isValidSubscription(sub) {
  return !!sub && typeof sub === 'object' &&
    typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) &&
    !!sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
}

let subscription = null;

if (process.env.PUSH_SUBSCRIPTION) {
  try {
    const parsed = JSON.parse(process.env.PUSH_SUBSCRIPTION);
    if (isValidSubscription(parsed)) {
      subscription = parsed;
      console.log('[edt/push] Abonnement chargé depuis la variable d\'environnement PUSH_SUBSCRIPTION.');
    } else {
      console.error(
        '[edt/push] PUSH_SUBSCRIPTION présente mais de forme invalide (endpoint absent/pas en https, ' +
        'ou clés p256dh/auth manquantes) — ignorée. Vérifie qu\'elle commence bien par ' +
        '"{\\"endpoint\\":\\"https://..." (piège déjà rencontré : "https://" tronqué au collage).'
      );
    }
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
  isValidSubscription,
  setSubscription,
  getSubscription,
  isConfigured,
  sendPush,
  sendTestPush,
  start,
  stop,
  // Exposé uniquement pour les tests unitaires (server/edt/schedule.test.js).
  _tick: tick,
  _sentKeys: sentKeys,
  _normalizeVapidSubject: normalizeVapidSubject
};
