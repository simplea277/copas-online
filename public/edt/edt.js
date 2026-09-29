// ============================================================================
// Section EDT — client vanilla JS, même esprit que public/client.js du jeu
// (un `state` + une fonction `render()`), mais fichier entièrement séparé,
// sans aucune dépendance au code du jeu Copas.
// ============================================================================

(function () {
  'use strict';

  var core = window.EdtCore;

  var state = {
    tab: 'now',
    scheduleData: null, // { weeklySchedule, schoolTimetable, offPeriods }
    selectedWeekDay: null,
    notifPermission: (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported',
    subscriptionText: null
  };

  var WEEK_DAY_ORDER = ['tuesday', 'wednesday', 'thursday', 'friday'];

  // --- Petits utilitaires DOM -------------------------------------------------

  function $(id) { return document.getElementById(id); }

  function el(tag, className, children) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i] != null) node.appendChild(children[i]);
      }
    }
    return node;
  }

  function text(tag, className, str) {
    var node = el(tag, className);
    node.textContent = str;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // --- Chargement des données --------------------------------------------------

  function fetchSchedule() {
    return fetch('/edt/api/schedule')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        state.scheduleData = data;
        var now = new Date();
        var parts = core.parisParts(now);
        var todayKey = core.WEEKDAY_NAMES[parts.weekdayIndex];
        state.selectedWeekDay = WEEK_DAY_ORDER.indexOf(todayKey) !== -1 ? todayKey : 'tuesday';
        render();
      })
      .catch(function (e) {
        var header = $('header-day');
        if (header) header.textContent = 'Impossible de charger l\'emploi du temps';
        console.error('[edt] Échec du chargement de /edt/api/schedule :', e);
      });
  }

  function currentStatus() {
    if (!state.scheduleData) return null;
    return core.getStatus(state.scheduleData.weeklySchedule, state.scheduleData.offPeriods, new Date());
  }

  // --- En-tête (toujours visible) ----------------------------------------------

  function renderHeader() {
    var header = $('header-day');
    if (!header) return;
    var status = currentStatus();
    if (!status) { header.textContent = ''; return; }

    if (status.state === 'rest') {
      header.textContent = status.dayLabel + ' · Repos';
    } else if (status.state === 'off') {
      var label = (status.offPeriod && status.offPeriod.label) ? status.offPeriod.label : 'Repos';
      header.textContent = status.dayLabel + ' · ' + label;
    } else {
      var shifts = status.shifts;
      var first = shifts[0], last = shifts[shifts.length - 1];
      header.textContent = status.dayLabel + ' · ' + core.formatHM(first.start) + ' – ' + core.formatHM(last.end);
    }
  }

  // --- Vue "Maintenant" ----------------------------------------------------------

  function nextWorkingDayLine(nextWorkingDay) {
    if (!nextWorkingDay) return 'Aucun prochain jour travaillé trouvé.';
    var shifts = nextWorkingDay.shifts;
    var first = shifts[0], last = shifts[shifts.length - 1];
    var dateParts = nextWorkingDay.dateStr.split('-').map(Number);
    var longDate = core.formatDateLong(dateParts[0], dateParts[1], dateParts[2]);
    return 'Reprise ' + longDate + ' · ' + core.formatHM(first.start) + ' – ' + core.formatHM(last.end);
  }

  function formatCountdown(totalSeconds) {
    var s = Math.max(0, Math.round(totalSeconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(sec);
    return pad(m) + ':' + pad(sec);
  }

  function renderNowView() {
    var view = $('view-now');
    if (!view) return;
    var status = currentStatus();
    clear(view);
    if (!status) return;

    if (status.state === 'in-shift') {
      var card = el('div', 'now-card');

      var prevLine = el('div', 'now-adjacent');
      if (status.prev) {
        prevLine.appendChild(document.createTextNode(status.prev.label + ' '));
        prevLine.appendChild(text('span', 'adj-time', '(' + core.formatHM(status.prev.start) + ' – ' + core.formatHM(status.prev.end) + ')'));
      } else {
        prevLine.textContent = '—';
      }
      card.appendChild(prevLine);

      var currentLabel = text('div', 'now-current-label', status.current.label);
      currentLabel.style.background = core.colorForLabel(status.current.label) + '33';
      currentLabel.style.color = core.colorForLabel(status.current.label);
      card.appendChild(currentLabel);

      card.appendChild(text('div', 'now-current-time',
        core.formatHM(status.current.start) + ' – ' + core.formatHM(status.current.end)));

      var countdown = el('div', 'now-countdown', [
        document.createTextNode('Fin du poste dans'),
        text('strong', null, formatCountdown(status.secondsRemaining))
      ]);
      card.appendChild(countdown);

      var nextLine = el('div', 'now-adjacent');
      if (status.next) {
        nextLine.appendChild(document.createTextNode(status.next.label + ' '));
        nextLine.appendChild(text('span', 'adj-time', '(' + core.formatHM(status.next.start) + ' – ' + core.formatHM(status.next.end) + ')'));
      } else {
        nextLine.textContent = 'Dernier poste de la journée';
      }
      card.appendChild(nextLine);

      view.appendChild(card);
      return;
    }

    if (status.state === 'before-service') {
      var first = status.firstShift;
      var box = el('div', 'now-status-simple', [
        text('div', 'status-headline', 'Début de service à ' + core.formatHM(first.start)),
        text('div', 'status-detail', first.label + ' (' + core.formatHM(first.start) + ' – ' + core.formatHM(first.end) + ')')
      ]);
      view.appendChild(box);
      return;
    }

    if (status.state === 'after-service') {
      var box2 = el('div', 'now-status-simple', [
        text('div', 'status-headline', 'Fin de service'),
        text('div', 'status-detail', nextWorkingDayLine(status.nextWorkingDay))
      ]);
      view.appendChild(box2);
      return;
    }

    // rest | off
    var headline = status.state === 'off' && status.offPeriod ? status.offPeriod.label : 'Repos';
    var box3 = el('div', 'now-status-simple', [
      text('div', 'status-headline', headline),
      text('div', 'status-detail', nextWorkingDayLine(status.nextWorkingDay))
    ]);
    view.appendChild(box3);
  }

  // --- Liste de postes réutilisable (Journée / Semaine) ---------------------------

  function buildShiftList(shifts, currentShift) {
    var list = el('div', 'shift-list');
    for (var i = 0; i < shifts.length; i++) {
      var shift = shifts[i];
      var row = el('div', 'shift-row' + (shift === currentShift ? ' current' : ''));
      var dot = el('span', 'shift-dot');
      dot.style.background = core.colorForLabel(shift.label);
      row.appendChild(dot);
      row.appendChild(text('span', 'shift-time', core.formatHM(shift.start) + ' – ' + core.formatHM(shift.end)));
      row.appendChild(text('span', 'shift-label', shift.label));
      list.appendChild(row);
    }
    return list;
  }

  // --- Vue "Journée" (jour réel d'aujourd'hui) ---------------------------------

  function renderDayView() {
    var view = $('view-day');
    if (!view) return;
    clear(view);
    var status = currentStatus();
    if (!status) return;

    if (status.state === 'rest' || status.state === 'off') {
      var label = status.state === 'off' && status.offPeriod ? status.offPeriod.label : 'Repos';
      view.appendChild(text('div', 'day-header', status.dayLabel));
      view.appendChild(el('span', 'rest-badge', [document.createTextNode(label)]));
      if (status.state === 'off') {
        view.appendChild(text('div', 'day-subheader', nextWorkingDayLine(status.nextWorkingDay)));
      }
      return;
    }

    var shifts = status.shifts;
    var current = status.state === 'in-shift' ? status.current : null;
    view.appendChild(text('div', 'day-header', status.dayLabel));
    view.appendChild(text('div', 'day-subheader',
      core.formatHM(shifts[0].start) + ' – ' + core.formatHM(shifts[shifts.length - 1].end)));
    view.appendChild(buildShiftList(shifts, current));
  }

  // --- Vue "Semaine" -------------------------------------------------------------

  function renderWeekView() {
    var view = $('view-week');
    if (!view) return;
    clear(view);
    if (!state.scheduleData) return;

    var status = currentStatus();
    var todayKey = null;
    if (status && status.state !== 'rest' && status.state !== 'off') {
      // Retrouve la clé du jour courant pour la marquer visuellement.
      var now = new Date();
      var parts = core.parisParts(now);
      todayKey = core.WEEKDAY_NAMES[parts.weekdayIndex];
    }

    for (var i = 0; i < WEEK_DAY_ORDER.length; i++) {
      (function (dayKey) {
        var shifts = state.scheduleData.weeklySchedule[dayKey];
        var first = shifts[0], last = shifts[shifts.length - 1];
        var btn = el('button', 'week-day-btn' + (dayKey === state.selectedWeekDay ? ' active' : ''));
        btn.type = 'button';
        var labelSpan = document.createElement('span');
        labelSpan.textContent = core.DAY_LABELS[dayKey] + (dayKey === todayKey ? ' · aujourd\'hui' : '');
        btn.appendChild(labelSpan);
        btn.appendChild(text('span', 'week-day-hours', core.formatHM(first.start) + ' – ' + core.formatHM(last.end)));
        btn.addEventListener('click', function () {
          state.selectedWeekDay = dayKey;
          renderWeekView();
        });
        view.appendChild(btn);
      })(WEEK_DAY_ORDER[i]);
    }

    var selectedShifts = state.scheduleData.weeklySchedule[state.selectedWeekDay];
    var currentForSelected = (todayKey === state.selectedWeekDay && status && status.state === 'in-shift') ? status.current : null;
    view.appendChild(buildShiftList(selectedShifts, currentForSelected));
  }

  // --- Vue "Horaires lycée" -------------------------------------------------------

  function renderSchoolView() {
    var view = $('view-school');
    if (!view) return;
    if (view.dataset.rendered === '1') return; // statique, inutile de reconstruire chaque seconde
    clear(view);
    if (!state.scheduleData) return;

    var table = el('table', 'school-table');
    var thead = el('thead', null, [el('tr', null, [
      text('th', null, 'Créneau'),
      text('th', null, 'Cours'),
      text('th', null, 'Grille')
    ])]);
    table.appendChild(thead);

    var tbody = el('tbody');
    var rows = state.scheduleData.schoolTimetable;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      tbody.appendChild(el('tr', null, [
        text('td', null, r.slot),
        text('td', null, r.courseStart + ' – ' + r.courseEnd),
        text('td', null, r.grille)
      ]));
    }
    table.appendChild(tbody);
    view.appendChild(table);
    view.dataset.rendered = '1';
  }

  // --- Rendu global ------------------------------------------------------------

  function render() {
    renderHeader();
    renderNowView();
    if (state.tab === 'day') renderDayView();
    if (state.tab === 'week') renderWeekView();
    if (state.tab === 'school') renderSchoolView();
  }

  // --- Onglets -------------------------------------------------------------------

  function setupTabs() {
    var buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = btn.getAttribute('data-tab');
        buttons.forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.view').forEach(function (v) {
          v.hidden = v.getAttribute('data-view') !== state.tab;
        });
        render();
      });
    });
    // Active "Maintenant" par défaut.
    var firstBtn = document.querySelector('.tab-btn[data-tab="now"]');
    if (firstBtn) firstBtn.classList.add('active');
  }

  // --- Réglages (installation, notifications) -------------------------------------

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function updateNotifStatus(msg) {
    var elStatus = $('notif-status');
    if (elStatus) elStatus.textContent = msg;
  }

  function showSubscriptionJSON(subscription) {
    var section = $('subscription-section');
    var textarea = $('subscription-json');
    if (!section || !textarea) return;
    var json = JSON.stringify(subscription, null, 2);
    textarea.value = json;
    section.hidden = false;
    state.subscriptionText = json;
  }

  function sendSubscriptionToServer(subscription) {
    return fetch('/edt/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription })
    });
  }

  function registerServiceWorkerAndResendSubscription() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/edt/sw.js', { scope: '/edt/' })
      .then(function (reg) {
        if (!('pushManager' in reg)) return;
        return reg.pushManager.getSubscription();
      })
      .then(function (sub) {
        if (sub) {
          // Renvoie automatiquement l'abonnement existant à chaque ouverture
          // (le serveur peut l'avoir perdu suite à une veille/redémarrage).
          sendSubscriptionToServer(sub).catch(function () {});
        }
      })
      .catch(function (e) { console.error('[edt] Échec d\'enregistrement du service worker :', e); });
  }

  function enableNotifications() {
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      updateNotifStatus('Les notifications ne sont pas supportées sur ce navigateur.');
      return;
    }
    if (!isStandalone()) {
      updateNotifStatus('Ajoute d\'abord l\'app à l\'écran d\'accueil (voir ci-dessus), puis réessaie depuis là.');
      return;
    }

    Notification.requestPermission()
      .then(function (permission) {
        state.notifPermission = permission;
        if (permission !== 'granted') {
          updateNotifStatus('Permission refusée. Active les notifications pour Mon EDT dans les réglages iOS pour changer d\'avis.');
          return null;
        }
        return fetch('/edt/api/vapid-public-key').then(function (res) { return res.json(); });
      })
      .then(function (keyInfo) {
        if (!keyInfo) return null;
        if (!keyInfo.configured || !keyInfo.publicKey) {
          updateNotifStatus('Clé VAPID absente côté serveur — notifications indisponibles pour l\'instant.');
          return null;
        }
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyInfo.publicKey)
          });
        });
      })
      .then(function (subscription) {
        if (!subscription) return;
        var subJSON = subscription.toJSON();
        return sendSubscriptionToServer(subJSON).then(function () {
          updateNotifStatus('Notifications activées ✅');
          showSubscriptionJSON(subJSON);
        });
      })
      .catch(function (e) {
        console.error('[edt] Échec de l\'activation des notifications :', e);
        updateNotifStatus('Échec de l\'activation : ' + (e && e.message ? e.message : e));
      });
  }

  function testPush() {
    updateNotifStatus('Envoi de la notification test…');
    fetch('/edt/api/test-push', { method: 'POST' })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (result.ok && result.body.ok) {
          updateNotifStatus('Notification test envoyée ✅');
        } else {
          updateNotifStatus('Échec de l\'envoi (' + (result.body.reason || result.body.error || 'inconnu') + ').');
        }
      })
      .catch(function (e) {
        updateNotifStatus('Échec de l\'envoi : ' + e.message);
      });
  }

  function copySubscription() {
    if (!state.subscriptionText) return;
    var textarea = $('subscription-json');
    var done = function () {
      var btn = $('btn-copy-subscription');
      if (!btn) return;
      var original = btn.textContent;
      btn.textContent = 'Copié !';
      setTimeout(function () { btn.textContent = original; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.subscriptionText).then(done).catch(function () {
        textarea.select();
        document.execCommand('copy');
        done();
      });
    } else {
      textarea.select();
      document.execCommand('copy');
      done();
    }
  }

  function renderOffPeriodsList() {
    var list = $('off-periods-list');
    if (!list || !state.scheduleData) return;
    clear(list);

    var offPeriods = state.scheduleData.offPeriods || [];
    if (offPeriods.length === 0) {
      list.appendChild(text('div', 'off-periods-empty', 'Aucune période enregistrée.'));
      return;
    }

    var todayStr = core.parisParts(new Date()).dateStr;

    for (var i = 0; i < offPeriods.length; i++) {
      var period = offPeriods[i];
      var isCurrent = todayStr >= period.start && todayStr <= period.end;
      var row = el('div', 'off-period-row' + (isCurrent ? ' current' : ''));

      var labelSpan = document.createElement('span');
      labelSpan.className = 'off-period-label';
      labelSpan.textContent = period.label;
      if (isCurrent) {
        labelSpan.appendChild(text('span', 'off-period-now-badge', 'en cours'));
      }
      row.appendChild(labelSpan);

      var datesText = period.start === period.end
        ? core.formatDateStrShort(period.start)
        : 'du ' + core.formatDateStrShort(period.start) + ' au ' + core.formatDateStrShort(period.end);
      row.appendChild(text('span', 'off-period-dates', datesText));

      list.appendChild(row);
    }
  }

  function setupSettings() {
    var overlay = $('settings-overlay');
    $('btn-settings').addEventListener('click', function () {
      overlay.hidden = false;
      $('install-hint').hidden = isStandalone();
      updateNotifStatus(describeNotifPermission());
      renderOffPeriodsList();
    });
    $('btn-close-settings').addEventListener('click', function () { overlay.hidden = true; });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.hidden = true;
    });
    $('btn-enable-notifs').addEventListener('click', enableNotifications);
    $('btn-test-push').addEventListener('click', testPush);
    $('btn-copy-subscription').addEventListener('click', copySubscription);
  }

  function describeNotifPermission() {
    if (typeof Notification === 'undefined') return 'Notifications non supportées sur ce navigateur.';
    if (Notification.permission === 'granted') return 'Notifications autorisées sur cet appareil.';
    if (Notification.permission === 'denied') return 'Notifications refusées — à réactiver dans les réglages iOS.';
    return 'Notifications pas encore activées.';
  }

  // --- Démarrage -----------------------------------------------------------------

  function init() {
    setupTabs();
    setupSettings();
    registerServiceWorkerAndResendSubscription();
    fetchSchedule();
    setInterval(render, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
