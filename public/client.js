// ============================================================================
// Client "Copas" — vanilla JS, aucune dépendance de build.
// ============================================================================

const socket = io();
const app = document.getElementById('app');

const RANK_LABEL = { '2':'2','3':'3','4':'4','5':'5','6':'6', valete:'V', dama:'D', rei:'R', '7':'7', as:'A' };

// Ordre d'affichage de la main : copas, ouros, espadas, paus — puis du plus
// faible au plus fort dans chaque enseigne.
const SUIT_ORDER = { copas: 0, ouros: 1, espadas: 2, paus: 3 };
function sortHand(cards) {
  return [...cards].sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.strength - b.strength);
}

// Enseignes du jeu portugais (Sueca) : épées, coupes, deniers, bâtons.
// SVG simples et génériques, dessinés pour cette interface (aucune
// reproduction d'un jeu de cartes existant). "1em" + currentColor pour
// qu'elles s'intègrent dans le flux de texte comme le faisaient les
// symboles ♠♥♦♣ d'origine.
const SUIT_SVG = {
  espadas: `<svg class="suit-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
    <polygon points="12,1 15.2,15 8.8,15" />
    <rect x="7" y="15" width="10" height="2" rx="1" />
    <rect x="10.4" y="17" width="3.2" height="4" />
    <circle cx="12" cy="22" r="1.6" />
  </svg>`,
  copas: `<svg class="suit-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
    <path d="M6 3h12v8c0 4.4-3.3 7-6 7s-6-2.6-6-7V3z" />
    <rect x="11" y="18" width="2" height="3" />
    <rect x="8" y="21" width="8" height="2" rx="1" />
  </svg>`,
  ouros: `<svg class="suit-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5.4" fill="var(--ivory)" />
    <circle cx="12" cy="12" r="2" />
  </svg>`,
  paus: `<svg class="suit-svg" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
    <rect x="9" y="2" width="6" height="20" rx="3" />
    <circle cx="12" cy="7" r="1" fill="var(--ivory)" />
    <circle cx="12" cy="13" r="1" fill="var(--ivory)" />
  </svg>`,
};

const SESSION_KEY = 'copas:session';

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}
function saveSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) { /* stockage indisponible, tant pis */ }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) { /* rien à faire */ }
}

// Quitte définitivement la partie en cours : invalide la session côté
// serveur (le token ne pourra plus servir à reprendre cette partie),
// nettoie le stockage local, et ramène au choix créer/rejoindre.
function leaveGame() {
  socket.emit('room:leave', {});
  clearSession();
  state.room = null;
  state.hand = null;
  state.handOverInfo = null;
  state.trickResult = null;
  state.error = null;
  state.myId = null;
  state.screen = 'home';
  render();
}

const savedSession = loadSession();

const state = {
  // home | create | join | lobby | game | reconnecting
  screen: savedSession ? 'reconnecting' : 'home',
  name: '',
  maxPlayersChoice: 4,
  room: null,           // dernier room:update reçu
  hand: null,           // dernier hand:update reçu
  myId: null,           // playerId stable (indépendant du socket.id courant)
  error: null,
  trickResult: null,    // { trick, winnerId, copasInTrick } affiché temporairement
  handOverInfo: null,   // payload de game:handOver, tant que l'overlay est affiché
  joining: false,
};

function cardId(c) { return `${c.suit}-${c.rank}`; }

function renderCard(card, extraClass = '') {
  if (!card) return `<div class="pcard placeholder"></div>`;
  const sym = SUIT_SVG[card.suit];
  const label = RANK_LABEL[card.rank];
  return `<div class="pcard suit-${card.suit} ${extraClass}" data-card="${cardId(card)}">
    <div class="rank-top">${label}<br>${sym}</div>
    <div class="suit-icon">${sym}</div>
    <div class="rank-bottom">${label}<br>${sym}</div>
  </div>`;
}

function playerName(id) {
  if (!state.room) return '?';
  const p = state.room.players.find((p) => p.id === id);
  return p ? p.name : '?';
}

function render() {
  if (state.screen === 'reconnecting') return renderReconnecting();
  if (state.screen === 'home') return renderHome();
  if (state.screen === 'create') return renderCreate();
  if (state.screen === 'join') return renderJoin();
  if (state.screen === 'lobby') return renderLobby();
  if (state.screen === 'game') return renderGame();
}

function renderReconnecting() {
  app.innerHTML = `
    <div class="screen" style="justify-content:center;">
      <p class="lede">Reconnexion à la partie…</p>
    </div>`;
}

function errorBox() {
  return state.error ? `<div class="error-msg">${state.error}</div>` : '';
}

function renderHome() {
  app.innerHTML = `
    <div class="screen" style="justify-content:center;">
      <h1>Copas <span class="accent">Online</span></h1>
      <p class="lede">Ramasse le moins de copas possible</p>
      ${errorBox()}
      <div class="card-panel">
        <button class="primary" id="btn-create">Créer une partie</button>
        <div class="divider">ou</div>
        <button class="secondary" id="btn-join">Rejoindre avec un code</button>
      </div>
    </div>`;
  document.getElementById('btn-create').onclick = () => { state.error = null; state.screen = 'create'; render(); };
  document.getElementById('btn-join').onclick = () => { state.error = null; state.screen = 'join'; render(); };
}

function renderCreate() {
  app.innerHTML = `
    <div class="screen" style="justify-content:center;">
      <h1>Créer une <span class="accent">partie</span></h1>
      ${errorBox()}
      <div class="card-panel">
        <label>Ton prénom</label>
        <input type="text" id="name-input" placeholder="Ex : Léa" value="${state.name}" maxlength="16" />
        <label>Nombre de joueurs</label>
        <div class="choice-row">
          <button class="choice-btn ${state.maxPlayersChoice === 3 ? 'active' : ''}" data-n="3">3 joueurs</button>
          <button class="choice-btn ${state.maxPlayersChoice === 4 ? 'active' : ''}" data-n="4">4 joueurs</button>
        </div>
        <button class="primary" id="btn-submit">Créer le salon</button>
        <button class="secondary" id="btn-back">Retour</button>
      </div>
    </div>`;
  document.getElementById('name-input').oninput = (e) => (state.name = e.target.value);
  document.querySelectorAll('.choice-btn').forEach((b) => {
    b.onclick = () => { state.maxPlayersChoice = Number(b.dataset.n); render(); };
  });
  document.getElementById('btn-back').onclick = () => { state.screen = 'home'; render(); };
  document.getElementById('btn-submit').onclick = () => {
    if (!state.name.trim()) { state.error = 'Entre un prénom.'; render(); return; }
    state.error = null;
    socket.emit('room:create', { name: state.name, maxPlayers: state.maxPlayersChoice }, (res) => {
      if (!res.ok) { state.error = res.error; render(); return; }
      state.myId = res.playerId;
      state.room = res.room;
      saveSession({ code: res.room.code, sessionToken: res.sessionToken });
      state.screen = 'lobby';
      render();
    });
  };
}

function renderJoin() {
  app.innerHTML = `
    <div class="screen" style="justify-content:center;">
      <h1>Rejoindre une <span class="accent">partie</span></h1>
      ${errorBox()}
      <div class="card-panel">
        <label>Ton prénom</label>
        <input type="text" id="name-input" placeholder="Ex : Léa" value="${state.name}" maxlength="16" />
        <label>Code du salon</label>
        <input type="text" id="code-input" class="code-input" placeholder="XXXX" maxlength="4" />
        <button class="primary" id="btn-submit">Rejoindre</button>
        <button class="secondary" id="btn-back">Retour</button>
      </div>
    </div>`;
  document.getElementById('name-input').oninput = (e) => (state.name = e.target.value);
  document.getElementById('btn-back').onclick = () => { state.screen = 'home'; render(); };
  document.getElementById('btn-submit').onclick = () => {
    const code = document.getElementById('code-input').value.trim();
    if (!state.name.trim()) { state.error = 'Entre un prénom.'; render(); return; }
    if (!code) { state.error = 'Entre le code du salon.'; render(); return; }
    state.error = null;
    socket.emit('room:join', { name: state.name, code }, (res) => {
      if (!res.ok) { state.error = res.error; render(); return; }
      state.myId = res.playerId;
      state.room = res.room;
      saveSession({ code: res.room.code, sessionToken: res.sessionToken });
      state.screen = 'lobby';
      render();
    });
  };
}

function renderLobby() {
  const room = state.room;
  const isHost = room.players[0]?.id === state.myId;
  const full = room.players.length === room.maxPlayers;

  const playerItems = [];
  for (let i = 0; i < room.maxPlayers; i++) {
    const p = room.players[i];
    if (p) {
      playerItems.push(`<li><span class="player-dot ${p.connected ? '' : 'offline'}"></span>${p.name}${p.id === state.myId ? ' (toi)' : ''}</li>`);
    } else {
      playerItems.push(`<li class="empty">En attente d'un joueur…</li>`);
    }
  }

  app.innerHTML = `
    <div class="screen" style="justify-content:center;">
      <h1>Salle d'<span class="accent">attente</span></h1>
      ${errorBox()}
      <div class="card-panel room-code-display">
        <div class="code">${room.code}</div>
        <div class="hint">Partage ce code à tes ${room.maxPlayers - 1} amis</div>
      </div>
      <div class="card-panel">
        <label>Joueurs (${room.players.length}/${room.maxPlayers})</label>
        <ul class="player-list">${playerItems.join('')}</ul>
      </div>
      ${isHost
        ? `<button class="primary" id="btn-start" ${full ? '' : 'disabled'}>${full ? 'Démarrer la partie' : `En attente de ${room.maxPlayers - room.players.length} joueur(s)…`}</button>`
        : `<p class="lede">En attente que l'hôte démarre la partie…</p>`
      }
    </div>`;

  if (isHost && full) {
    document.getElementById('btn-start').onclick = () => {
      socket.emit('room:start', {}, (res) => {
        if (!res.ok) { state.error = res.error; render(); }
      });
    };
  }
}

function renderGame() {
  const hand = state.hand;
  const room = state.room;
  if (!hand || !room) {
    // La partie vient de se terminer (plus de main en cours) : on affiche
    // quand même le résultat final au lieu de rester bloqué sur "Chargement".
    if (state.handOverInfo) {
      app.innerHTML = renderHandOverOverlay();
      return;
    }
    app.innerHTML = `<div class="screen" style="justify-content:center;"><p class="lede">Chargement de la partie…</p></div>`;
    return;
  }

  const myId = state.myId;
  const others = hand.players.filter((p) => p !== myId);
  const myTurn = hand.turnPlayerId === myId && !state.handOverInfo;

  const opponentsHtml = others.map((pid) => {
    const count = hand.handSizes[pid] ?? 0;
    const active = hand.turnPlayerId === pid;
    const miniCards = Array.from({ length: Math.min(count, 10) }).map(() => `<div class="mc"></div>`).join('');
    return `<div class="opponent ${active ? 'active-turn' : ''}">
      <div class="name">${playerName(pid)}</div>
      <div class="mini-cards">${miniCards}</div>
      <div class="cardcount">${count} cartes</div>
    </div>`;
  }).join('');

  let trickHtml;
  let statusText;
  if (state.trickResult) {
    const slots = state.trickResult.trick.map((e) => renderCard(e.card)).join('');
    trickHtml = `<div class="trick-slots">${slots}</div>`;
    statusText = `${playerName(state.trickResult.winnerId)} remporte le pli` +
      (state.trickResult.copasInTrick > 0 ? ` (+${state.trickResult.copasInTrick} ${SUIT_SVG.copas})` : '');
  } else {
    const slots = hand.currentTrick.map((e) => renderCard(e.card)).join('') +
      Array.from({ length: hand.numPlayers - hand.currentTrick.length }).map(() => renderCard(null)).join('');
    trickHtml = `<div class="trick-slots">${slots}</div>`;
    statusText = myTurn ? 'À toi de jouer !' : `Au tour de ${playerName(hand.turnPlayerId)}…`;
  }

  const specialBanner = hand.specialPhase
    ? `<div class="special-banner">Phase de pioche (plis 1-3) — <strong>pas d'obligation de suivre la couleur</strong>, <strong>copas interdites</strong>${hand.drawPileCount > 0 ? ` · ${hand.drawPileCount} cartes en pioche` : ''}</div>`
    : '';

  const scoreChips = hand.players.map((pid) => {
    const s = room.scores?.[pid] || { real: 0, suspended: 0 };
    return `<div class="score-chip ${pid === myId ? 'me' : ''}">
      ${s.suspended > 0 ? `<div class="suspended-float">${s.suspended} en suspens</div>` : ''}
      <div class="name">${playerName(pid)}</div>
      <div class="real">${s.real}</div>
    </div>`;
  }).join('');

  const playableIds = new Set((hand.playableCards || []).map(cardId));
  const myHandHtml = sortHand(hand.myHand).map((c) => {
    const isPlayable = myTurn && playableIds.has(cardId(c));
    return renderCard(c, isPlayable ? 'playable' : (myTurn ? 'unplayable' : ''));
  }).join('');

  app.innerHTML = `
    <button class="leave-btn" id="btn-leave">Quitter la partie</button>
    <div class="screen table-wrap">
      <div class="score-bar">${scoreChips}</div>
      <div class="opponents-row">${opponentsHtml}</div>
      <div class="center-area">
        ${specialBanner}
        ${trickHtml}
        <div class="status-line ${myTurn ? 'my-turn' : ''}">${statusText}</div>
      </div>
      <div class="my-hand-wrap">
        <div class="my-hand">${myHandHtml}</div>
      </div>
    </div>
    ${renderHandOverOverlay()}
  `;

  document.getElementById('btn-leave').onclick = () => {
    if (confirm('Quitter la partie ? Tu ne pourras pas revenir dans cette manche.')) leaveGame();
  };

  if (myTurn) {
    document.querySelectorAll('.my-hand .pcard.playable').forEach((el) => {
      el.onclick = () => {
        const [suit, rank] = el.dataset.card.split('-');
        socket.emit('game:playCard', { card: { suit, rank } }, (res) => {
          if (!res.ok) { state.error = res.error; render(); }
        });
      };
    });
  }
}

function renderHandOverOverlay() {
  const info = state.handOverInfo;
  if (!info) return '';

  const rows = Object.entries(info.tricksWonCopas).map(([pid, copas]) => {
    const logEntry = info.scoringLog.find((l) => l.playerId === pid);
    let note = '';
    if (logEntry?.event === 'suspended_new') note = `→ ${logEntry.suspended} pts en suspens`;
    if (logEntry?.event === 'suspended_stacked') note = `→ cumulé à ${logEntry.suspended} pts en suspens`;
    if (logEntry?.event === 'suspended_cleared') note = `→ ${logEntry.cleared} pts en suspens effacés !`;
    if (logEntry?.event === 'suspended_realized') note = `→ +${logEntry.totalAdded} pts réels`;
    if (logEntry?.event === 'normal_add' && copas > 0) note = `→ +${copas} pts`;
    return `<div class="hand-summary-row"><span>${playerName(pid)} — ${copas} ${SUIT_SVG.copas}</span><span>${note}</span></div>`;
  }).join('');

  const isGameOver = !!info.gameOver;
  const finalRows = isGameOver ? Object.entries(info.scores)
    .sort((a, b) => a[1].real - b[1].real)
    .map(([pid, s], i) => `<div class="hand-summary-row"><span>${i + 1}. ${playerName(pid)}</span><span>${s.real} pts${info.gameOver.includes(pid) ? ' — atteint 30' : ''}</span></div>`)
    .join('') : '';

  return `<div class="overlay">
    <div class="overlay-card">
      <h2>${isGameOver ? 'Fin de la partie !' : 'Fin de la manche'}</h2>
      ${rows}
      ${isGameOver ? `<h3 style="margin-top:16px;">Classement final</h3>${finalRows}` : ''}
      <button class="primary" style="margin-top:16px;" id="btn-continue">${isGameOver ? "Retour à l'accueil" : 'Continuer'}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------

// Se déclenche à la connexion initiale ET à chaque reconnexion automatique
// de socket.io (coupure réseau) — dans les deux cas le socket.id a changé,
// donc il faut retrouver notre siège via le token de session persistant.
socket.on('connect', () => {
  const session = loadSession();
  if (!session) {
    if (state.screen === 'reconnecting') { state.screen = 'home'; render(); }
    return;
  }

  socket.emit('session:resume', { code: session.code, sessionToken: session.sessionToken }, (res) => {
    if (!res.ok) {
      clearSession();
      state.error = null;
      state.screen = 'home';
      render();
      return;
    }
    state.myId = res.playerId;
    state.room = res.room;
    if (res.hand) state.hand = res.hand;
    state.error = null;
    state.screen = res.room.started ? 'game' : 'lobby';
    render();
  });
});

// Ces quatre évènements concernent un salon/une partie déjà rejoints. Si on
// vient de quitter (state.screen === 'home'), on ignore tout évènement tardif
// émis avant que le serveur ait traité notre "room:leave" — sinon un
// room:update de l'ancien salon pourrait nous ramener dedans juste après
// qu'on en soit sorti.
socket.on('room:update', (room) => {
  if (state.screen === 'home') return;
  state.room = room;
  if (room.started) {
    if (state.screen !== 'game') state.screen = 'game';
  } else if (!state.handOverInfo) {
    // Ne bascule vers le lobby que si on n'est pas en train d'afficher le
    // résultat final d'une partie qui vient de se terminer (room.started
    // repasse à false à ce moment-là, mais l'overlay doit rester affiché).
    state.screen = 'lobby';
  }
  render();
});

socket.on('hand:update', (hand) => {
  if (state.screen === 'home') return;
  state.hand = hand;
  if (hand) state.screen = 'game';
  render();
});

socket.on('game:trickResolved', (payload) => {
  if (state.screen === 'home') return;
  state.trickResult = payload;
  render();
  setTimeout(() => {
    state.trickResult = null;
    render();
  }, 1400);
});

socket.on('game:handOver', (payload) => {
  if (state.screen === 'home') return;
  state.handOverInfo = payload;
  render();
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'btn-continue') {
    const wasGameOver = !!state.handOverInfo.gameOver;
    state.handOverInfo = null;
    if (wasGameOver) {
      leaveGame();
    } else {
      render();
    }
  }
});

render();
