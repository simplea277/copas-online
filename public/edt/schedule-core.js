// ============================================================================
// Logique pure de l'emploi du temps (EDT), partagée entre le serveur (Node,
// via require) et le client (navigateur, via <script src="/edt/schedule-
// core.js">) — module UMD volontairement sans dépendance externe : Intl.
// DateTimeFormat suffit pour un calcul fiable en heure de Paris (avec
// gestion automatique de l'heure d'été/hiver) des deux côtés.
//
// Toute la section "heure de Paris" repose sur un principe simple : la
// France métropolitaine est toujours en avance sur UTC (UTC+1 l'hiver,
// UTC+2 l'été, jamais UTC+0 ni négatif), donc échantillonner le décalage à
// midi UTC pour une date donnée est toujours sans ambiguïté de jour civil
// (contrairement à un échantillonnage près de minuit, qui pourrait tomber
// juste avant/après la transition heure d'été/hiver, laquelle a
// historiquement lieu vers 1h-3h heure locale).
// ============================================================================

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EdtCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TIME_ZONE = 'Europe/Paris';

  var WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var DAY_LABELS = {
    monday: 'Lundi', tuesday: 'Mardi', wednesday: 'Mercredi', thursday: 'Jeudi',
    friday: 'Vendredi', saturday: 'Samedi', sunday: 'Dimanche'
  };
  var WORK_DAYS = ['tuesday', 'wednesday', 'thursday', 'friday'];

  // Une couleur par type de poste, pour repérer d'un coup d'œil (demandé :
  // Grille en rouge, Pause en vert).
  var LABEL_COLORS = {
    'Grille': '#e5484d',
    'Pause': '#3dd68c',
    'Bureau': '#4f8ef7',
    'Circulation': '#a56de2',
    'Permanence': '#2bb8b0',
    'Rang': '#f2994a',
    'Hall': '#22b8cf',
    'Pointage': '#e0b029',
    'Pointage/cantine': '#c98a1f',
    'Cour': '#7fae4a',
    'Toilettes 4e': '#8791a3'
  };
  var DEFAULT_COLOR = '#8791a3';

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function colorForLabel(label) {
    return LABEL_COLORS[label] || DEFAULT_COLOR;
  }

  function timeStrToMinutes(hhmm) {
    var parts = hhmm.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  // "07:45" -> "7h45" (pas de zéro initial sur l'heure, cohérent avec les
  // exemples fournis, ex: "Mardi · 7h45 – 17h45").
  function formatHM(hhmm) {
    var parts = hhmm.split(':');
    var h = Number(parts[0]);
    return h + 'h' + parts[1];
  }

  // --- Dates civiles (indépendantes du fuseau horaire) -----------------------

  function dateKey(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  function weekdayIndexForDate(y, m, d) {
    // Le jour de la semaine d'une date civile ne dépend d'aucun fuseau
    // horaire : Date.UTC(...).getUTCDay() donne la bonne réponse quelle que
    // soit l'heure locale.
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=dimanche .. 6=samedi
  }

  function addDaysToDate(y, m, d, n) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
  }

  // --- Heure de Paris ----------------------------------------------------------

  var PARIS_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  });

  var PARIS_WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // Décompose un instant (objet Date) en ses composantes de calendrier/heure
  // *en heure de Paris*.
  function parisParts(date) {
    var parts = PARIS_PARTS_FORMATTER.formatToParts(date);
    var map = {};
    for (var i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
    var year = Number(map.year), month = Number(map.month), day = Number(map.day);
    var hour = Number(map.hour), minute = Number(map.minute), second = Number(map.second);
    return {
      year: year, month: month, day: day, hour: hour, minute: minute, second: second,
      weekdayIndex: PARIS_WEEKDAY_MAP[map.weekday],
      dateStr: dateKey(year, month, day),
      minutesSinceMidnight: hour * 60 + minute + second / 60
    };
  }

  var PARIS_OFFSET_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit'
  });

  // Décalage Paris/UTC (en minutes) pour une date civile donnée, toujours
  // 60 (hiver, UTC+1) ou 120 (été, UTC+2).
  function parisOffsetMinutesForDate(y, m, d) {
    var ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    var parts = PARIS_OFFSET_FORMATTER.formatToParts(ref);
    var map = {};
    for (var i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
    return Number(map.hour) * 60 + Number(map.minute) - 12 * 60;
  }

  // Convertit une heure "civile" de Paris (date + heure/minute locales) en
  // l'instant UTC correspondant (objet Date), en tenant compte de l'heure
  // d'été/hiver.
  function parisWallTimeToInstant(y, m, d, hour, minute) {
    var offsetMinutes = parisOffsetMinutesForDate(y, m, d);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + (hour * 60 + minute) * 60000 - offsetMinutes * 60000);
  }

  // --- Emploi du temps ---------------------------------------------------------

  function getShiftsForWeekday(weeklySchedule, weekdayIndex) {
    var key = WEEKDAY_NAMES[weekdayIndex];
    if (WORK_DAYS.indexOf(key) === -1) return null;
    return weeklySchedule[key] || null;
  }

  // offPeriods: [{start:'YYYY-MM-DD', end:'YYYY-MM-DD', label}], bornes incluses.
  function isOffDate(offPeriods, dateStr) {
    if (!offPeriods) return null;
    for (var i = 0; i < offPeriods.length; i++) {
      var p = offPeriods[i];
      if (dateStr >= p.start && dateStr <= p.end) return p;
    }
    return null;
  }

  function getDayInfo(weeklySchedule, offPeriods, y, m, d) {
    var weekdayIndex = weekdayIndexForDate(y, m, d);
    var dateStr = dateKey(y, m, d);
    var dayLabel = DAY_LABELS[WEEKDAY_NAMES[weekdayIndex]];
    var offPeriod = isOffDate(offPeriods, dateStr);
    if (offPeriod) {
      return { type: 'off', shifts: null, dateStr: dateStr, weekdayIndex: weekdayIndex, dayLabel: dayLabel, offPeriod: offPeriod };
    }
    var shifts = getShiftsForWeekday(weeklySchedule, weekdayIndex);
    if (!shifts) {
      return { type: 'rest', shifts: null, dateStr: dateStr, weekdayIndex: weekdayIndex, dayLabel: dayLabel };
    }
    return { type: 'work', shifts: shifts, dateStr: dateStr, weekdayIndex: weekdayIndex, dayLabel: dayLabel };
  }

  function findNextWorkingDay(weeklySchedule, offPeriods, fromY, fromM, fromD, maxDays) {
    maxDays = maxDays || 400;
    for (var n = 1; n <= maxDays; n++) {
      var d2 = addDaysToDate(fromY, fromM, fromD, n);
      var info = getDayInfo(weeklySchedule, offPeriods, d2.year, d2.month, d2.day);
      if (info.type === 'work') return info;
    }
    return null;
  }

  // État courant complet (poste précédent/actuel/suivant, ou jour de
  // repos/off avec le prochain jour travaillé), à partir d'un instant
  // (objet Date, typiquement `new Date()`).
  function getStatus(weeklySchedule, offPeriods, now) {
    var p = parisParts(now);
    var dayInfo = getDayInfo(weeklySchedule, offPeriods, p.year, p.month, p.day);

    if (dayInfo.type !== 'work') {
      var next = findNextWorkingDay(weeklySchedule, offPeriods, p.year, p.month, p.day);
      return {
        state: dayInfo.type, // 'rest' | 'off'
        dayLabel: dayInfo.dayLabel,
        dateStr: dayInfo.dateStr,
        offPeriod: dayInfo.offPeriod || null,
        nextWorkingDay: next
      };
    }

    var shifts = dayInfo.shifts;
    var first = shifts[0], last = shifts[shifts.length - 1];
    var nowMin = p.minutesSinceMidnight;

    if (nowMin < timeStrToMinutes(first.start)) {
      return {
        state: 'before-service', dayLabel: dayInfo.dayLabel, dateStr: dayInfo.dateStr,
        shifts: shifts, firstShift: first, lastShift: last
      };
    }

    if (nowMin >= timeStrToMinutes(last.end)) {
      var next2 = findNextWorkingDay(weeklySchedule, offPeriods, p.year, p.month, p.day);
      return {
        state: 'after-service', dayLabel: dayInfo.dayLabel, dateStr: dayInfo.dateStr,
        shifts: shifts, nextWorkingDay: next2
      };
    }

    var idx = -1;
    var i;
    for (i = 0; i < shifts.length; i++) {
      if (nowMin >= timeStrToMinutes(shifts[i].start) && nowMin < timeStrToMinutes(shifts[i].end)) { idx = i; break; }
    }
    if (idx === -1) {
      // Trou non couvert (ne devrait pas arriver, la grille est contiguë) :
      // on retombe sur le dernier poste déjà commencé.
      idx = 0;
      for (i = 0; i < shifts.length; i++) {
        if (timeStrToMinutes(shifts[i].start) <= nowMin) idx = i;
      }
    }

    var current = shifts[idx];
    var prev = idx > 0 ? shifts[idx - 1] : null;
    var nextShift = idx < shifts.length - 1 ? shifts[idx + 1] : null;
    var secondsRemaining = Math.max(0, Math.round((timeStrToMinutes(current.end) - nowMin) * 60));

    return {
      state: 'in-shift', dayLabel: dayInfo.dayLabel, dateStr: dayInfo.dateStr, shifts: shifts,
      prev: prev, current: current, next: nextShift, secondsRemaining: secondsRemaining,
      dayStart: first.start, dayEnd: last.end
    };
  }

  // --- Notifications -------------------------------------------------------------

  // Un évènement par prise de poste (y compris le premier de la journée) +
  // un évènement pour la fin de service.
  function getNotificationEvents(shifts) {
    var events = [];
    for (var i = 0; i < shifts.length; i++) {
      events.push({ type: 'shift-start', time: shifts[i].start, label: shifts[i].label, shiftEnd: shifts[i].end });
    }
    var last = shifts[shifts.length - 1];
    events.push({ type: 'end-of-service', time: last.end });
    return events;
  }

  // offsetKind: 'minus3' | 'minus30s'
  function messageForEvent(event, offsetKind) {
    if (event.type === 'end-of-service') {
      return offsetKind === 'minus3' ? 'Fin de service dans 3 min' : 'Fin de service dans 30 s';
    }
    var label = (event.label || '').toUpperCase();
    if (offsetKind === 'minus3') {
      return 'Dans 3 min : ' + label + ' (' + formatHM(event.time) + ' – ' + formatHM(event.shiftEnd) + ')';
    }
    return 'Dans 30 s : ' + label;
  }

  return {
    TIME_ZONE: TIME_ZONE,
    DAY_LABELS: DAY_LABELS,
    WORK_DAYS: WORK_DAYS,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    LABEL_COLORS: LABEL_COLORS,
    colorForLabel: colorForLabel,
    pad2: pad2,
    timeStrToMinutes: timeStrToMinutes,
    formatHM: formatHM,
    dateKey: dateKey,
    weekdayIndexForDate: weekdayIndexForDate,
    addDaysToDate: addDaysToDate,
    parisParts: parisParts,
    parisOffsetMinutesForDate: parisOffsetMinutesForDate,
    parisWallTimeToInstant: parisWallTimeToInstant,
    getShiftsForWeekday: getShiftsForWeekday,
    isOffDate: isOffDate,
    getDayInfo: getDayInfo,
    findNextWorkingDay: findNextWorkingDay,
    getStatus: getStatus,
    getNotificationEvents: getNotificationEvents,
    messageForEvent: messageForEvent
  };
});
