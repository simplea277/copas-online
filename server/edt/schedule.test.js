// ============================================================================
// Tests unitaires de la logique horaire de la section EDT (schedule-core.js
// + schedule.js) : poste actuel/précédent/suivant, heure de Paris (avec
// heure d'été/hiver), jours de repos/off, calcul des évènements de
// notification. Même style de runner minimal que game/*.test.js (pas de
// framework de test externe).
// ============================================================================

const assert = require('assert');
const path = require('path');
const core = require(path.join(__dirname, '..', '..', 'public', 'edt', 'schedule-core.js'));
const schedule = require('./schedule');

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log('   ', e.message);
    process.exitCode = 1;
  }
}

// Construit l'instant UTC correspondant à une heure "civile" de Paris, en
// s'appuyant directement sur la fonction testée (parisWallTimeToInstant) —
// cohérent avec la façon dont push.js calcule ses cibles de notification.
function parisInstant(y, m, d, hour, minute) {
  return core.parisWallTimeToInstant(y, m, d, hour, minute);
}

// ---------------------------------------------------------------------------
// Heure de Paris / fuseau horaire
// ---------------------------------------------------------------------------

test('parisOffsetMinutesForDate : UTC+1 en janvier (hiver), UTC+2 en juillet (été)', () => {
  assert.strictEqual(core.parisOffsetMinutesForDate(2026, 1, 6), 60);
  assert.strictEqual(core.parisOffsetMinutesForDate(2026, 7, 14), 120);
});

test('parisWallTimeToInstant : 10h10 à Paris = 09h10 UTC en hiver, 08h10 UTC en été', () => {
  const winter = parisInstant(2026, 1, 6, 10, 10);
  assert.strictEqual(winter.toISOString(), '2026-01-06T09:10:00.000Z');

  const summer = parisInstant(2026, 7, 14, 10, 10);
  assert.strictEqual(summer.toISOString(), '2026-07-14T08:10:00.000Z');
});

test('parisParts : décompose correctement un instant UTC en heure de Paris (hiver)', () => {
  const instant = new Date('2026-01-06T09:10:00.000Z'); // mardi
  const parts = core.parisParts(instant);
  assert.strictEqual(parts.year, 2026);
  assert.strictEqual(parts.month, 1);
  assert.strictEqual(parts.day, 6);
  assert.strictEqual(parts.hour, 10);
  assert.strictEqual(parts.minute, 10);
  assert.strictEqual(parts.weekdayIndex, 2); // mardi
  assert.strictEqual(parts.dateStr, '2026-01-06');
});

// ---------------------------------------------------------------------------
// Poste actuel / précédent / suivant
// ---------------------------------------------------------------------------

test('getStatus : en plein poste (mardi 10h30, en été), donne le bon prev/current/next', () => {
  const now = parisInstant(2026, 7, 14, 10, 30); // mardi
  const status = schedule.getStatus(now);
  assert.strictEqual(status.state, 'in-shift');
  assert.strictEqual(status.dayLabel, 'Mardi');
  assert.strictEqual(status.current.label, 'Circulation');
  assert.strictEqual(status.current.start, '10:10');
  assert.strictEqual(status.current.end, '11:10');
  assert.strictEqual(status.prev.label, 'Grille');
  assert.strictEqual(status.next.label, 'Bureau');
  // Fin du poste à 11h10, on est à 10h30 -> 40 minutes restantes.
  assert.strictEqual(status.secondsRemaining, 40 * 60);
});

test('getStatus : juste à la frontière d\'un poste (mardi 09h55 pile) bascule sur le nouveau poste', () => {
  const now = parisInstant(2026, 7, 14, 9, 55);
  const status = schedule.getStatus(now);
  assert.strictEqual(status.current.label, 'Grille');
  assert.strictEqual(status.secondsRemaining, 15 * 60);
});

test('getStatus : avant le début de service (mardi 7h00) -> before-service avec le premier poste', () => {
  const now = parisInstant(2026, 7, 14, 7, 0);
  const status = schedule.getStatus(now);
  assert.strictEqual(status.state, 'before-service');
  assert.strictEqual(status.firstShift.label, 'Hall');
  assert.strictEqual(status.firstShift.start, '07:45');
});

test('getStatus : après la fin de service (mardi 18h00) -> after-service, prochain jour = mercredi', () => {
  const now = parisInstant(2026, 7, 14, 18, 0);
  const status = schedule.getStatus(now);
  assert.strictEqual(status.state, 'after-service');
  assert.strictEqual(status.nextWorkingDay.dayLabel, 'Mercredi');
});

test('getStatus : vendredi après le service saute le week-end -> prochain jour = mardi', () => {
  // 17 juillet 2026 est un vendredi.
  const now = parisInstant(2026, 7, 17, 17, 0);
  const status = schedule.getStatus(now);
  assert.strictEqual(status.state, 'after-service');
  assert.strictEqual(status.nextWorkingDay.dayLabel, 'Mardi');
  assert.strictEqual(status.nextWorkingDay.dateStr, '2026-07-21');
});

test('getStatus : lundi (repos) -> state "rest", prochain jour travaillé = mardi', () => {
  // 13 juillet 2026 est un lundi.
  const now = parisInstant(2026, 7, 13, 14, 0);
  const status = schedule.getStatus(now);
  assert.strictEqual(status.state, 'rest');
  assert.strictEqual(status.dayLabel, 'Lundi');
  assert.strictEqual(status.nextWorkingDay.dayLabel, 'Mardi');
});

test('getStatus : dimanche (repos) également', () => {
  // 12 juillet 2026 est un dimanche.
  const now = parisInstant(2026, 7, 12, 14, 0);
  const status = schedule.getStatus(now);
  assert.strictEqual(status.state, 'rest');
  assert.strictEqual(status.dayLabel, 'Dimanche');
});

// ---------------------------------------------------------------------------
// Jours off (vacances/fériés) — table temporaire injectée directement dans
// core.getStatus pour ne pas dépendre de OFF_PERIODS (vide en prod).
// ---------------------------------------------------------------------------

test('getStatus avec offPeriods : un mardi habituellement travaillé devient "off"', () => {
  const offPeriods = [{ start: '2026-07-13', end: '2026-07-17', label: 'Vacances test' }];
  const now = parisInstant(2026, 7, 14, 10, 30); // mardi, dans la période
  const status = core.getStatus(schedule.WEEKLY_SCHEDULE, offPeriods, now);
  assert.strictEqual(status.state, 'off');
  assert.strictEqual(status.offPeriod.label, 'Vacances test');
});

test('getStatus avec offPeriods : le prochain jour travaillé saute toute la période off', () => {
  const offPeriods = [{ start: '2026-07-13', end: '2026-07-17', label: 'Vacances test' }];
  const now = parisInstant(2026, 7, 14, 10, 30);
  const status = core.getStatus(schedule.WEEKLY_SCHEDULE, offPeriods, now);
  assert.strictEqual(status.nextWorkingDay.dateStr, '2026-07-21'); // mardi suivant
});

test('getStatus avec offPeriods : un jour juste hors de la période reste normal', () => {
  const offPeriods = [{ start: '2026-07-13', end: '2026-07-17', label: 'Vacances test' }];
  const now = parisInstant(2026, 7, 21, 10, 30); // mardi suivant, hors période
  const status = core.getStatus(schedule.WEEKLY_SCHEDULE, offPeriods, now);
  assert.strictEqual(status.state, 'in-shift');
});

// ---------------------------------------------------------------------------
// Évènements de notification
// ---------------------------------------------------------------------------

test('getNotificationEvents : un évènement par début de poste + un pour la fin de service', () => {
  const shifts = schedule.WEEKLY_SCHEDULE.friday;
  const events = core.getNotificationEvents(shifts);
  assert.strictEqual(events.length, shifts.length + 1);
  assert.strictEqual(events[0].type, 'shift-start');
  assert.strictEqual(events[0].time, shifts[0].start);
  const last = events[events.length - 1];
  assert.strictEqual(last.type, 'end-of-service');
  assert.strictEqual(last.time, shifts[shifts.length - 1].end);
});

test('messageForEvent : formats attendus (3 min / 30 s / fin de service)', () => {
  const event = { type: 'shift-start', time: '10:10', label: 'Circulation', shiftEnd: '11:10' };
  assert.strictEqual(core.messageForEvent(event, 'minus3'), 'Dans 3 min : CIRCULATION (10h10 – 11h10)');
  assert.strictEqual(core.messageForEvent(event, 'minus30s'), 'Dans 30 s : CIRCULATION');

  const endEvent = { type: 'end-of-service', time: '17:45' };
  assert.strictEqual(core.messageForEvent(endEvent, 'minus3'), 'Fin de service dans 3 min');
  assert.strictEqual(core.messageForEvent(endEvent, 'minus30s'), 'Fin de service dans 30 s');
});

test('formatHM : pas de zéro initial sur l\'heure', () => {
  assert.strictEqual(core.formatHM('07:45'), '7h45');
  assert.strictEqual(core.formatHM('17:45'), '17h45');
  assert.strictEqual(core.formatHM('09:30'), '9h30');
});

// ---------------------------------------------------------------------------
// Cohérence des données (grille contiguë, total = amplitude du service)
// ---------------------------------------------------------------------------

test('WEEKLY_SCHEDULE : chaque jour est une grille contiguë sans trou ni chevauchement', () => {
  for (const day of Object.keys(schedule.WEEKLY_SCHEDULE)) {
    const shifts = schedule.WEEKLY_SCHEDULE[day];
    for (let i = 1; i < shifts.length; i++) {
      assert.strictEqual(
        shifts[i - 1].end, shifts[i].start,
        `${day} : trou/chevauchement entre "${shifts[i - 1].label}" et "${shifts[i].label}"`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// push.js : la boucle ne doit jamais planter, même sans configuration/
// abonnement (cas par défaut en environnement de test, sans clés VAPID).
// ---------------------------------------------------------------------------

// Le runner `test()` ci-dessus ne gère que des fonctions synchrones ; comme
// c'est le seul cas asynchrone du fichier, on le traite à part plutôt que
// d'alourdir le runner pour un seul test.
(async () => {
  const name = 'push._tick : ne plante pas sans VAPID configuré ni abonnement';
  try {
    const push = require('./push');
    assert.strictEqual(push.isConfigured(), false, 'VAPID ne doit pas être configuré dans cet environnement de test');
    await push._tick(parisInstant(2026, 7, 14, 10, 9));
    console.log(`✅ ${name}`);
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log('   ', e.message);
    process.exitCode = 1;
  }
})();
