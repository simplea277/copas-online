// ============================================================================
// Section "EDT" (chantier séparé, sans rapport avec le jeu Copas Online) —
// source de vérité des données de l'emploi du temps d'Alan (AED), servie au
// client via GET /edt/api/schedule (voir routes.js).
//
// La logique de calcul (poste courant/précédent/suivant, jours de repos,
// notifications...) est entièrement dans public/edt/schedule-core.js,
// partagée telle quelle avec le client — ce fichier-ci ne contient que les
// données et de petits raccourcis qui les lient à cette logique.
// ============================================================================

const path = require('path');
const core = require(path.join(__dirname, '..', '..', 'public', 'edt', 'schedule-core.js'));

// Postes travaillés, mardi à vendredi. Lundi/samedi/dimanche = repos (pas de
// clé dans cet objet -> core.getShiftsForWeekday renvoie null pour ces jours).
const WEEKLY_SCHEDULE = {
  tuesday: [
    { start: '07:45', end: '08:00', label: 'Hall' },
    { start: '08:00', end: '08:50', label: 'Bureau' },
    { start: '08:50', end: '09:55', label: 'Circulation' },
    { start: '09:55', end: '10:10', label: 'Grille' },
    { start: '10:10', end: '11:10', label: 'Circulation' },
    { start: '11:10', end: '11:30', label: 'Bureau' },
    { start: '11:30', end: '12:15', label: 'Circulation' },
    { start: '12:15', end: '12:45', label: 'Rang' },
    { start: '12:45', end: '13:15', label: 'Pause' },
    { start: '13:15', end: '14:10', label: 'Circulation' },
    { start: '14:10', end: '15:05', label: 'Permanence' },
    { start: '15:05', end: '15:20', label: 'Grille' },
    { start: '15:20', end: '16:15', label: 'Circulation' },
    { start: '16:15', end: '16:20', label: 'Grille' },
    { start: '16:20', end: '17:20', label: 'Bureau' },
    { start: '17:20', end: '17:45', label: 'Circulation' }
  ],
  wednesday: [
    { start: '07:45', end: '08:00', label: 'Bureau' },
    { start: '08:00', end: '08:50', label: 'Circulation' },
    { start: '08:50', end: '09:00', label: 'Bureau' },
    { start: '09:00', end: '11:00', label: 'Circulation' },
    { start: '11:00', end: '11:10', label: 'Grille' },
    { start: '11:10', end: '11:30', label: 'Permanence' },
    { start: '11:30', end: '12:15', label: 'Circulation' },
    { start: '12:15', end: '12:45', label: 'Pointage/cantine' },
    { start: '12:45', end: '13:00', label: 'Rang' },
    { start: '13:00', end: '13:15', label: 'Grille' },
    { start: '13:15', end: '13:45', label: 'Pause' },
    { start: '13:45', end: '14:00', label: 'Permanence' },
    { start: '14:00', end: '15:05', label: 'Bureau' },
    { start: '15:05', end: '15:20', label: 'Cour' },
    { start: '15:20', end: '16:20', label: 'Circulation' },
    { start: '16:20', end: '17:10', label: 'Bureau' },
    { start: '17:10', end: '17:20', label: 'Grille' },
    { start: '17:20', end: '17:45', label: 'Circulation' }
  ],
  thursday: [
    { start: '09:30', end: '10:10', label: 'Circulation' },
    { start: '10:10', end: '11:00', label: 'Permanence' },
    { start: '11:00', end: '11:30', label: 'Circulation' },
    { start: '11:30', end: '12:15', label: 'Pointage' },
    { start: '12:15', end: '12:45', label: 'Pause' },
    { start: '12:45', end: '13:00', label: 'Pointage/cantine' },
    { start: '13:00', end: '13:15', label: 'Circulation' },
    { start: '13:15', end: '13:45', label: 'Permanence' },
    { start: '13:45', end: '14:00', label: 'Bureau' },
    { start: '14:00', end: '14:10', label: 'Grille' },
    { start: '14:10', end: '15:05', label: 'Bureau' },
    { start: '15:05', end: '15:20', label: 'Circulation' },
    { start: '15:20', end: '16:20', label: 'Bureau' },
    { start: '16:20', end: '17:20', label: 'Circulation' },
    { start: '17:20', end: '18:15', label: 'Bureau' },
    { start: '18:15', end: '18:30', label: 'Grille' }
  ],
  friday: [
    { start: '09:30', end: '09:55', label: 'Bureau' },
    { start: '09:55', end: '10:10', label: 'Circulation' },
    { start: '10:10', end: '11:00', label: 'Permanence' },
    { start: '11:00', end: '11:10', label: 'Grille' },
    { start: '11:10', end: '11:30', label: 'Permanence' },
    { start: '11:30', end: '12:00', label: 'Pause' },
    { start: '12:00', end: '13:00', label: 'Rang' },
    { start: '13:00', end: '13:15', label: 'Grille' },
    { start: '13:15', end: '14:00', label: 'Permanence' },
    { start: '14:00', end: '14:10', label: 'Hall' },
    { start: '14:10', end: '15:05', label: 'Bureau' },
    { start: '15:05', end: '15:20', label: 'Toilettes 4e' },
    { start: '15:20', end: '16:30', label: 'Bureau' }
  ]
};

// Écran de référence "Horaires lycée" (3b) — purement informatif, ne sert
// jamais au calcul du poste courant.
const SCHOOL_TIMETABLE = [
  { slot: 'M1', courseStart: '8h00', courseEnd: '8h55', grille: '7h45 à 8h00' },
  { slot: 'M2', courseStart: '9h00', courseEnd: '9h55', grille: '8h50 à 9h00' },
  { slot: 'Récréation', courseStart: '9h55', courseEnd: '10h10', grille: '9h55 à 10h10' },
  { slot: 'M3', courseStart: '10h10', courseEnd: '11h05', grille: '11h00 à 11h10' },
  { slot: 'M4', courseStart: '11h10', courseEnd: '12h05', grille: '12h05 à 12h15' },
  { slot: 'R1 (pause méridienne 11h30-14h00)', courseStart: '12h10', courseEnd: '13h05', grille: '13h00 à 13h10' },
  { slot: 'R2 (pause méridienne)', courseStart: '13h10', courseEnd: '14h05', grille: '13h00 à 13h10' },
  { slot: 'S1', courseStart: '14h10', courseEnd: '15h05', grille: '14h00 à 14h10' },
  { slot: 'Récréation', courseStart: '15h05', courseEnd: '15h20', grille: '15h05 à 15h20' },
  { slot: 'S2', courseStart: '15h20', courseEnd: '16h15', grille: '16h10 à 16h20' },
  { slot: 'S3', courseStart: '16h20', courseEnd: '17h15', grille: '17h10 à 17h20' },
  { slot: 'S4', courseStart: '17h20', courseEnd: '18h15', grille: '18h15 à 18h20' }
];

// Périodes sans travail (vacances, jours fériés) — vide pour l'instant, à
// remplir manuellement plus tard.
// Format : { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', label: 'Vacances de la Toussaint' }
// Bornes incluses. Pendant ces périodes : aucune notification, l'app affiche
// "Repos" (comme un jour de repos hebdomadaire).
const OFF_PERIODS = [];

function getStatus(now) {
  return core.getStatus(WEEKLY_SCHEDULE, OFF_PERIODS, now || new Date());
}

function getDayInfo(y, m, d) {
  return core.getDayInfo(WEEKLY_SCHEDULE, OFF_PERIODS, y, m, d);
}

function getScheduleData() {
  return { weeklySchedule: WEEKLY_SCHEDULE, schoolTimetable: SCHOOL_TIMETABLE, offPeriods: OFF_PERIODS };
}

module.exports = {
  core,
  WEEKLY_SCHEDULE,
  SCHOOL_TIMETABLE,
  OFF_PERIODS,
  getStatus,
  getDayInfo,
  getScheduleData
};
