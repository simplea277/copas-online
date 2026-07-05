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
  state.lastTrick = null;
  state.lastTrickRevealed = false;
  state.error = null;
  state.myId = null;
  state.screen = 'home';
  state.dealAnim = null;
  state.drawAnim = null;
  state.pileCountOverride = null;
  state.pendingDrawAnimId = null;
  state.justDrawnCard = null;
  state.justDrawnCardId = null;
  state.justDrawnStage = null;
  state.justDrawnStageStartedAt = null;
  state.trickPileCount = 0;
  state.rulesOpen = false;
  state.soloStarting = false;
  render();
}

const savedSession = loadSession();

const state = {
  // home | create | join | lobby | game | reconnecting
  screen: savedSession ? 'reconnecting' : 'home',
  name: '',
  joinCode: '', // valeur de l'écran "Rejoindre" ; conservée en state (pas juste lue au submit)
                // car cliquer une suggestion de pseudo redéclenche un render() complet, qui
                // aurait sinon vidé ce champ faute de value= reflétant l'état.
  maxPlayersChoice: 3,
  soloStarting: false, // true pendant l'enchaînement room:create -> room:fillBots -> room:start du mode solo
  rulesOpen: false,   // overlay "Règles du jeu" affiché ou non ; superposé au reste, ne
                      // touche à aucun autre état (la partie continue derrière normalement)
  rulesTab: 3,        // 3 ou 4 : version affichée depuis l'accueil (où les deux sont
                      // consultables) ; ignoré en cours de partie, où hand.numPlayers
                      // choisit seul la version montrée

  room: null,           // dernier room:update reçu
  hand: null,           // dernier hand:update reçu
  myId: null,           // playerId stable (indépendant du socket.id courant)
  error: null,
  trickResult: null,    // { trick, winnerId, copasInTrick } affiché temporairement
  lastTrick: null,      // dernier pli résolu, consultable via le widget carte face cachée
  lastTrickRevealed: false, // le widget est-il actuellement retourné (cartes visibles) ?
  handOverInfo: null,   // payload de game:handOver, tant que l'overlay est affiché
  joining: false,
  dealAnim: null,       // { id, phase: 'cards'|'pile', phaseStarted, sequence } tant que l'animation de distribution joue
  drawAnim: null,       // { id, order, phaseStarted } tant que l'animation de pioche (fin de pli 1-3) joue
  pileCountOverride: null, // nombre de cartes affiché sur la pioche pendant la séquence
                           // trickResolved -> distribution (fige puis décompte carte par carte
                           // au lieu de refléter hand.drawPileCount, déjà décrémenté par le serveur
                           // dès la réception de hand:update) ; null = affiche l'état réel.
  pendingDrawAnimId: null, // id de la séquence de pioche qui possède actuellement
                           // pileCountOverride, posé dès game:trickResolved (avant même que
                           // startDrawAnim ne tourne, 1400ms plus tard). Si un pli s'enchaîne plus
                           // vite que la séquence précédente (~2,6s), la séquence précédente s'y
                           // compare à chaque étape et s'arrête proprement dès qu'elle ne
                           // correspond plus, au lieu de continuer à décrémenter le compte qui
                           // appartient déjà à la séquence suivante.
  justDrawnCard: null,  // carte que je viens de piocher (contenu réel, seulement chez moi)
  justDrawnCardId: null, // cardId() de justDrawnCard, pour la retrouver/comparer
  justDrawnStage: null, // 'ghost' (au-dessus de la main) -> 'settle' (dans la main, mise en évidence) -> null
  justDrawnStageStartedAt: null, // Date.now() du dernier changement de justDrawnStage, pour reprendre
                                 // l'animation CSS au bon endroit (animation-delay négatif) si un
                                 // render() intercurrent recrée l'élément en plein milieu de l'entrée.
  trickPileCount: 0, // nombre de plis accumulés dans le tas "plis joués" (voir
                     // renderLastTrickWidget) ; incrémenté seulement une fois l'animation
                     // d'envol du pli vers ce tas terminée (pas dès la résolution du pli),
                     // pour ne jamais faire grossir le tas avant que l'animation ne l'ait
                     // montré visuellement.
  handGeneration: 0, // incrémenté à chaque nouvelle manche (fresh deal) ; permet à une
                     // complétion tardive de l'animation d'envol du pli (voir
                     // runTrickPileAnim) de détecter qu'une nouvelle manche a démarré
                     // entre-temps et de ne pas faire grossir le tas déjà remis à zéro.
};

let dealAnimCounter = 0;

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Séquence complète de la distribution, comme une vraie donne : 10 tours,
// à chaque tour une carte pour chaque joueur en partant de celui après le
// donneur, le donneur se servant en dernier à chaque tour.
function computeDealSequence(hand) {
  const n = hand.numPlayers;
  const sequence = [];
  for (let round = 0; round < 10; round++) {
    for (let i = 1; i <= n; i++) sequence.push(hand.players[(hand.dealerIndex + i) % n]);
  }
  return sequence;
}

// Point d'entrée générique : lance l'étape en cours (`cards` ou `pile`) de
// l'animation de distribution. Purement cosmétique — si l'animation est
// périmée (une manche/étape plus récente est arrivée entre-temps), chaque
// étape se contente de ne rien faire au lieu de planter ou d'écraser l'état
// affiché.
function runDealPhase(animId, phase) {
  const dealAnim = state.dealAnim;
  if (!dealAnim || dealAnim.id !== animId || dealAnim.phase !== phase) return;
  if (phase === 'cards') runCardsPhase(animId);
  else if (phase === 'pile') runPilePhase(animId);
}

// Étape 1 : les cartes s'envolent une par une du donneur vers chaque joueur,
// dans l'ordre du jeu, jusqu'à ce que tout le monde (donneur compris) ait
// ses 10 cartes.
function runCardsPhase(animId) {
  const dealAnim = state.dealAnim;
  const hand = state.hand;
  const layer = document.getElementById('deal-anim-layer');
  const dealerId = hand && hand.players[hand.dealerIndex];
  const dealerEl = dealerId && document.querySelector(`[data-anchor="player-${dealerId}"]`);
  if (!dealAnim || !hand || !layer || !dealerEl) { advanceDealAnim(animId); return; }

  const dealerRect = dealerEl.getBoundingClientRect();
  const startX = dealerRect.left + dealerRect.width / 2 - 13;
  const startY = dealerRect.top + dealerRect.height / 2 - 18;

  const STAGGER = 85; // ~80-120ms entre chaque carte, ajusté après test visuel
  const FLIGHT = 320;

  dealAnim.sequence.forEach((pid, i) => {
    setTimeout(() => {
      if (!state.dealAnim || state.dealAnim.id !== animId || state.dealAnim.phase !== 'cards') return;
      const targetEl = document.querySelector(`[data-anchor="player-${pid}"]`);
      const currentLayer = document.getElementById('deal-anim-layer');
      if (!targetEl || !currentLayer) return;

      const targetRect = targetEl.getBoundingClientRect();
      const dx = (targetRect.left + targetRect.width / 2 - 13) - startX;
      const dy = (targetRect.top + targetRect.height / 2 - 18) - startY;

      const card = document.createElement('div');
      card.className = 'deal-card';
      card.style.left = `${startX}px`;
      card.style.top = `${startY}px`;
      currentLayer.appendChild(card);
      card.getBoundingClientRect(); // force le reflow avant de déclencher la transition
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${i % 2 === 0 ? -6 : 6}deg)`;
      card.style.opacity = '0';

      setTimeout(() => card.remove(), FLIGHT + 60);
    }, i * STAGGER);
  });

  const total = dealAnim.sequence.length * STAGGER + FLIGHT + 120;
  setTimeout(() => {
    if (!state.dealAnim || state.dealAnim.id !== animId || state.dealAnim.phase !== 'cards') return;
    advanceDealAnim(animId);
  }, total);
}

// Une fois les mains distribuées : à 3 joueurs, la pioche (le reste du
// paquet) passe à l'étape "pile" (dépôt animé au centre) ; sinon, terminé.
function advanceDealAnim(animId) {
  if (!state.dealAnim || state.dealAnim.id !== animId) return;
  const hand = state.hand;
  if (hand && hand.numPlayers === 3 && hand.drawPileCount > 0) {
    state.dealAnim.phase = 'pile';
    state.dealAnim.phaseStarted = false;
    render();
  } else {
    state.dealAnim = null;
    render();
  }
}

// Étape 2 (3 joueurs uniquement) : anime le dépôt des cartes restantes en un
// petit tas au centre de la table, façon pioche. Le tas lui-même (avec le
// compte à jour) est du HTML normal rendu par renderGame() dès que cette
// étape commence ; ces paquets volants ne sont qu'une décoration qui atterrit
// dessus.
function runPilePhase(animId) {
  const dealAnim = state.dealAnim;
  const hand = state.hand;
  const layer = document.getElementById('deal-anim-layer');
  const dealerId = hand && hand.players[hand.dealerIndex];
  const dealerEl = dealerId && document.querySelector(`[data-anchor="player-${dealerId}"]`);
  const pileEl = document.querySelector('[data-anchor="draw-pile"]');
  if (!dealAnim || !hand || !layer || !dealerEl || !pileEl) { finishDealAnim(animId); return; }

  const dealerRect = dealerEl.getBoundingClientRect();
  const startX = dealerRect.left + dealerRect.width / 2 - 15;
  const startY = dealerRect.top + dealerRect.height / 2 - 21;
  const pileRect = pileEl.getBoundingClientRect();
  const endX = pileRect.left + pileRect.width / 2 - 15;
  const endY = pileRect.top + pileRect.height / 2 - 21;

  const PACKETS = 4;
  const STAGGER = 90;
  const FLIGHT = 360;

  for (let i = 0; i < PACKETS; i++) {
    setTimeout(() => {
      if (!state.dealAnim || state.dealAnim.id !== animId || state.dealAnim.phase !== 'pile') return;
      const currentLayer = document.getElementById('deal-anim-layer');
      if (!currentLayer) return;

      const packet = document.createElement('div');
      packet.className = 'deal-packet';
      packet.style.left = `${startX}px`;
      packet.style.top = `${startY}px`;
      currentLayer.appendChild(packet);
      packet.getBoundingClientRect();
      packet.style.transform = `translate(${endX - startX}px, ${endY - startY}px) rotate(${i % 2 === 0 ? -10 : 10}deg)`;
      packet.style.opacity = '0';

      setTimeout(() => packet.remove(), FLIGHT + 60);
    }, i * STAGGER);
  }

  const total = PACKETS * STAGGER + FLIGHT + 150;
  setTimeout(() => {
    if (!state.dealAnim || state.dealAnim.id !== animId || state.dealAnim.phase !== 'pile') return;
    finishDealAnim(animId);
  }, total);
}

function finishDealAnim(animId) {
  if (!state.dealAnim || state.dealAnim.id !== animId) return;
  state.dealAnim = null;
  render();
}

// ---------------------------------------------------------------------------
// Animation de pioche — à chaque fin de pli des 3 premiers plis (3 joueurs),
// rejoue une petite version de l'envol de la distribution : les cartes
// piochées s'envolent de la pioche vers chaque joueur. Si j'ai pioché, ma
// carte apparaît en plus brièvement face visible au-dessus de ma main avant
// de s'y intégrer.
// ---------------------------------------------------------------------------

// payload : { drawOrder: [playerId, ...] | null, myDrawnCard: card | null }
// seqId : id alloué dès game:trickResolved (voir pendingDrawAnimId) — réutilisé
// ici plutôt que d'en générer un nouveau, pour qu'une séquence plus récente
// (pli suivant déjà résolu avant que celle-ci n'ait eu la chance de démarrer)
// soit détectable dès l'entrée dans cette fonction.
function startDrawAnim(payload, seqId) {
  if (!payload || !payload.drawOrder || payload.drawOrder.length === 0) return;
  if (seqId == null || state.pendingDrawAnimId !== seqId) {
    // Remplacée par un pli suivant avant même d'avoir démarré : rien à
    // rejouer, pileCountOverride appartient déjà à la séquence plus récente.
    return;
  }
  if (prefersReducedMotion()) {
    // Pas d'animation : l'état à jour suffit, mais il ne faut pas laisser le
    // compteur de pioche figé sur sa valeur d'avant-tirage (state.pileCountOverride,
    // posée dès game:trickResolved) puisque la séquence qui le décrémente et
    // le relâche ne va jamais tourner. Pareil pour ma carte piochée : encore
    // au stade "pending" (posé dès game:trickResolved, retirée de la main
    // sans rien afficher à la place) puisque cette fonction s'arrête ici
    // sans jamais démarrer le ghost — sans ce nettoyage elle resterait
    // cachée indéfiniment pour un utilisateur en mouvement réduit.
    state.pileCountOverride = null;
    state.pendingDrawAnimId = null;
    if (payload.myDrawnCard && state.justDrawnCardId === cardId(payload.myDrawnCard)) {
      state.justDrawnCard = null;
      state.justDrawnCardId = null;
      state.justDrawnStage = null;
      state.justDrawnStageStartedAt = null;
    }
    render();
    return;
  }

  const animId = seqId;
  state.drawAnim = { id: animId, order: payload.drawOrder, phaseStarted: false };

  if (payload.myDrawnCard) {
    const drawnId = cardId(payload.myDrawnCard);
    // justDrawnCard/justDrawnCardId/stade "pending" déjà posés dès
    // game:trickResolved (voir plus haut) pour retirer la carte de la main
    // sans délai ; on ne fait que démarrer ici la partie visuelle (ghost
    // flottant) de la séquence. Le garde-fou ci-dessous couvre le cas où un
    // pli suivant, résolu entre-temps (joueurs/bots rapides), a déjà
    // remplacé cette carte par la sienne — rien à démarrer alors, elle ne
    // nous appartient plus.
    if (state.justDrawnCardId === drawnId) {
      state.justDrawnStage = 'ghost';
      state.justDrawnStageStartedAt = Date.now();
    }

    setTimeout(() => {
      if (state.justDrawnCardId !== drawnId) return; // remplacée entre-temps par une pioche plus récente
      state.justDrawnStage = 'settle';
      state.justDrawnStageStartedAt = Date.now();
      render();
      setTimeout(() => {
        if (state.justDrawnCardId !== drawnId) return;
        state.justDrawnStage = null;
        state.justDrawnStageStartedAt = null;
        state.justDrawnCardId = null;
        state.justDrawnCard = null;
        render();
      }, 1100);
    }, 2200); // laisse le temps de bien voir la carte avant qu'elle rejoigne la main
  }

  render();
}

function runDrawAnimPhase(animId) {
  const drawAnim = state.drawAnim;
  const layer = document.getElementById('deal-anim-layer');
  const pileEl = document.querySelector('[data-anchor="draw-pile"]');
  if (!drawAnim || drawAnim.id !== animId || state.pendingDrawAnimId !== animId || !layer || !pileEl) { finishDrawAnim(animId); return; }

  const pileRect = pileEl.getBoundingClientRect();
  const startX = pileRect.left + pileRect.width / 2 - 13;
  const startY = pileRect.top + pileRect.height / 2 - 18;

  const STAGGER = 180;
  const FLIGHT = 512; // x1.6 par rapport à l'ancien 320ms, pour un trajet plus lisible

  drawAnim.order.forEach((pid, i) => {
    setTimeout(() => {
      // pendingDrawAnimId peut avoir été réassigné à un pli plus récent
      // depuis la programmation de ce setTimeout (voir game:trickResolved) :
      // s'arrêter proprement plutôt que de continuer à décrémenter/faire
      // voler des cartes pour une séquence qui n'est plus d'actualité.
      if (!state.drawAnim || state.drawAnim.id !== animId || state.pendingDrawAnimId !== animId) return;
      const targetEl = document.querySelector(`[data-anchor="player-${pid}"]`);
      const currentLayer = document.getElementById('deal-anim-layer');
      if (!targetEl || !currentLayer) return;

      const targetRect = targetEl.getBoundingClientRect();
      const dx = (targetRect.left + targetRect.width / 2 - 13) - startX;
      const dy = (targetRect.top + targetRect.height / 2 - 18) - startY;

      const card = document.createElement('div');
      card.className = 'deal-card';
      card.style.left = `${startX}px`;
      card.style.top = `${startY}px`;
      currentLayer.appendChild(card);
      card.getBoundingClientRect();
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${i % 2 === 0 ? -6 : 6}deg)`;
      card.style.opacity = '0';

      setTimeout(() => card.remove(), FLIGHT + 60);

      // Décompte du tas carte par carte, en phase avec le départ de chaque
      // carte (pas d'un coup à la fin). Mise à jour DOM directe plutôt qu'un
      // render() complet : un render() recrée #deal-anim-layer depuis zéro et
      // détruirait les cartes déjà en vol (ajoutées ici hors du cycle de
      // rendu). Le tas ne disparaît lui-même que plus tard, via le render()
      // final de finishDrawAnim, une fois toute la séquence (y compris le vol
      // de cette dernière carte) terminée.
      if (state.pileCountOverride != null) {
        state.pileCountOverride = Math.max(0, state.pileCountOverride - 1);
        const countEl = document.querySelector('.draw-pile-count');
        if (countEl) countEl.textContent = String(state.pileCountOverride);
      }
    }, i * STAGGER);
  });

  const total = drawAnim.order.length * STAGGER + FLIGHT + 150;
  setTimeout(() => {
    if (!state.drawAnim || state.drawAnim.id !== animId || state.pendingDrawAnimId !== animId) return;
    state.pileCountOverride = null;
    state.pendingDrawAnimId = null;
    finishDrawAnim(animId);
  }, total);
}

function finishDrawAnim(animId) {
  if (!state.drawAnim || state.drawAnim.id !== animId) return;
  state.drawAnim = null;
  render();
}

// ---------------------------------------------------------------------------
// Animation de fin de pli — les cartes du pli résolu s'envolent vers le tas
// "plis joués" (widget sur le bord droit, voir renderLastTrickWidget) au lieu
// de simplement disparaître. sourceRects vient de game:trickResolved (rects
// capturés juste avant que les cartes ne quittent .trick-slots).
//
// Contrairement à la pioche, il n'y a pas besoin d'id de séquence pour se
// protéger d'un chevauchement : trickPileCount n'est jamais qu'incrémenté de
// 1, jamais recalculé à partir d'un instantané — que plusieurs envols se
// chevauchent (plis enchaînés très vite) ne peut donc pas le corrompre.
// handGen protège seulement contre une complétion tardive qui tomberait
// après le début d'une nouvelle manche (trickPileCount déjà remis à zéro).
function runTrickPileAnim(sourceRects, handGen) {
  const bumpCount = () => {
    if (state.handGeneration !== handGen) return; // nouvelle manche entre-temps : ce pli n'y a plus sa place
    state.trickPileCount += 1;
    render();
  };

  if (prefersReducedMotion() || sourceRects.length === 0) { bumpCount(); return; }

  const layer = document.getElementById('deal-anim-layer');
  const pileEl = document.querySelector('[data-anchor="trick-pile"]');
  if (!layer || !pileEl) { bumpCount(); return; }

  const pileRect = pileEl.getBoundingClientRect();
  const targetX = pileRect.left + pileRect.width / 2 - 13;
  const targetY = pileRect.top + pileRect.height / 2 - 18;

  const STAGGER = 70;
  const FLIGHT = 420;

  sourceRects.forEach((rect, i) => {
    setTimeout(() => {
      const currentLayer = document.getElementById('deal-anim-layer');
      if (!currentLayer) return;

      const card = document.createElement('div');
      card.className = 'trick-fly-card';
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;
      card.style.width = `${rect.width}px`;
      card.style.height = `${rect.height}px`;
      currentLayer.appendChild(card);
      card.getBoundingClientRect();

      const dx = targetX - rect.left;
      const dy = targetY - rect.top;
      const rot = (i % 2 === 0 ? -1 : 1) * (12 + i * 7);
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(0.6)`;
      card.style.opacity = '0.5';

      setTimeout(() => card.remove(), FLIGHT + 60);
    }, i * STAGGER);
  });

  setTimeout(bumpCount, sourceRects.length * STAGGER + FLIGHT + 80);
}

function cardId(c) { return `${c.suit}-${c.rank}`; }

function renderCard(card, extraClass = '', extraStyle = '') {
  if (!card) return `<div class="pcard placeholder"></div>`;
  const sym = SUIT_SVG[card.suit];
  const label = RANK_LABEL[card.rank];
  const styleAttr = extraStyle ? ` style="${extraStyle}"` : '';
  return `<div class="pcard suit-${card.suit} ${extraClass}" data-card="${cardId(card)}"${styleAttr}>
    <div class="rank-top">${label}<br>${sym}</div>
    <div class="suit-icon">${sym}</div>
    <div class="rank-bottom">${label}<br>${sym}</div>
  </div>`;
}

// Pseudos suggérés sur les écrans "Créer"/"Rejoindre" : boutons rapides en
// plus du champ libre, pour éviter à un groupe d'amis habitué de retaper son
// prénom à chaque partie.
const SUGGESTED_NAMES = ['Alan', 'Romane', 'Mika', 'Capu'];

function renderNameSuggestions() {
  return `<div class="choice-row name-suggestions">
    ${SUGGESTED_NAMES.map((n) => `<button type="button" class="choice-btn ${state.name === n ? 'active' : ''}" data-name="${n}">${n}</button>`).join('')}
  </div>`;
}

function wireNameSuggestions() {
  // [data-name] (pas juste .choice-btn) pour ne pas être aussi capté par le
  // câblage des boutons "3/4 joueurs" (mêmes classes, data-n à la place).
  document.querySelectorAll('.choice-btn[data-name]').forEach((b) => {
    b.onclick = () => {
      state.name = b.dataset.name;
      render();
    };
  });
}

// ---------------------------------------------------------------------------
// Règles du jeu — contenu figé (voir README/demande utilisateur), mis en
// forme en HTML mais jamais reformulé. Accessible depuis l'accueil (intro +
// les deux versions, via onglets) et en cours de partie (intro + seulement
// la version correspondant à hand.numPlayers, dans une superposition qui ne
// touche à aucun autre état : la partie continue derrière normalement).
// ---------------------------------------------------------------------------

const RULES_INTRO_HTML = `
  <p><strong>Copas</strong> est un jeu de plis inspiré de la Sueca portugaise. Il n'y a pas
  d'atout : le but est simplement de ramasser <strong>le moins de cartes de copas
  possible</strong>.</p>
  <p>Le jeu se joue avec un jeu de cartes portugais à 4 enseignes : <strong>espadas</strong>
  (épées), <strong>ouros</strong> (deniers), <strong>copas</strong> (coupes) et <strong>paus</strong> (bâtons). Dans
  chaque enseigne, les cartes sont classées par force croissante :<br>
  2 · 3 · 4 · 5 · 6 · Valete · Dama · Rei · 7 · As</p>
  <p>Les règles diffèrent selon que vous jouez à 4 ou à 3 joueurs — choisissez la
  version qui correspond à votre partie.</p>
`;

const RULES_4P_HTML = `
  <h3>Mise en place</h3>
  <p>Le paquet complet de 40 cartes est distribué en entier : chaque joueur reçoit
  <strong>10 cartes</strong>. Il n'y a pas de pioche. Le donneur change à chaque manche
  (le rôle tourne vers le joueur suivant).</p>

  <h3>Déroulement d'un pli</h3>
  <p>Le joueur assis à la gauche du donneur commence le premier pli en jouant la
  carte de son choix. Chaque joueur suivant doit ensuite <strong>obligatoirement
  fournir la couleur demandée</strong> (celle jouée en premier) s'il en possède une
  en main. S'il n'en a pas, il peut jouer n'importe quelle carte, y compris
  une copa.</p>

  <h3>Qui remporte le pli ?</h3>
  <p>Le pli est remporté par la <strong>carte la plus forte de la couleur demandée</strong>.
  Les cartes des autres couleurs ne peuvent jamais gagner le pli, même si
  elles sont fortes dans leur propre enseigne — il n'y a pas d'atout. Le
  gagnant ramasse le pli (les copas qu'il contient s'ajoutent à son compteur
  de copas de la manche) et entame le pli suivant.</p>

  <h3>Fin de la manche</h3>
  <p>La manche se termine dès que les 10 cartes de copas ont toutes été jouées,
  même s'il reste des cartes en main : le reste des plis ne peut alors plus
  changer le score de la manche.</p>

  <h3>Calcul des points — la règle des points en suspens</h3>
  <ul>
    <li><strong>0 copa ramassée</strong> : aucun point.</li>
    <li><strong>1 à 9 copas ramassées</strong> : ce nombre s'ajoute au score.</li>
    <li><strong>Les 10 copas ramassées d'un coup</strong> : ces points ne sont <strong>pas</strong>
      immédiatement comptés. Ils restent <strong>en suspens</strong> jusqu'à la manche
      suivante :
      <ul>
        <li><strong>0 copa</strong> à la manche suivante → les points en suspens <strong>disparaissent</strong>.</li>
        <li><strong>1 à 9 copas</strong> à la manche suivante → les points en suspens deviennent
          <strong>définitifs</strong> et s'ajoutent aux copas de cette nouvelle manche.</li>
        <li><strong>Les 10 copas à nouveau</strong> → les points en suspens <strong>s'accumulent</strong>
          (20, puis potentiellement plus), et la même règle continue de s'appliquer.</li>
      </ul>
    </li>
  </ul>

  <h3>Fin de la partie</h3>
  <p>La partie s'arrête dès qu'un joueur atteint <strong>30 points définitifs</strong>. Le
  gagnant est celui qui a le score le plus bas à ce moment-là.</p>
`;

const RULES_3P_HTML = `
  <h3>Mise en place</h3>
  <p>Le 2 d'espadas est retiré du paquet (39 cartes restantes). Chaque joueur
  reçoit <strong>10 cartes</strong>, et les <strong>9 cartes restantes</strong> forment une pioche posée
  au centre de la table. Le donneur change à chaque manche.</p>

  <h3>Déroulement d'un pli</h3>
  <p>Le joueur assis à la gauche du donneur commence le premier pli.</p>
  <p><strong>Pendant les 3 premiers plis de la manche</strong> (tant qu'il reste de la
  pioche) :</p>
  <ul>
    <li><strong>Aucune obligation</strong> de suivre la couleur demandée — chacun joue la
      carte de son choix.</li>
    <li><strong>Interdiction de jouer une carte de copa</strong>, sauf si un joueur n'a
      vraiment que des copas en main.</li>
  </ul>
  <p>À la fin de chacun de ces 3 premiers plis, <strong>le gagnant du pli pioche en
  premier</strong>, puis chaque joueur pioche une carte à son tour dans le sens du
  jeu, de sorte que tout le monde retrouve 10 cartes en main. La pioche est
  ainsi épuisée après le 3ᵉ pli.</p>
  <p><strong>À partir du 4ᵉ pli</strong>, les règles redeviennent normales : obligation de
  fournir la couleur demandée si possible, et les copas peuvent être jouées
  librement.</p>

  <h3>Qui remporte le pli ?</h3>
  <p>Le pli est remporté par la <strong>carte la plus forte de la couleur demandée</strong>.
  Il n'y a pas d'atout : les autres enseignes ne peuvent jamais gagner le pli.
  Le gagnant ramasse le pli (les copas qu'il contient s'ajoutent à son
  compteur de copas de la manche) et entame le pli suivant.</p>

  <h3>Fin de la manche</h3>
  <p>La manche se termine dès que les 10 cartes de copas ont toutes été jouées,
  même s'il reste des cartes en main.</p>

  <h3>Calcul des points — la règle des points en suspens</h3>
  <ul>
    <li><strong>0 copa ramassée</strong> : aucun point.</li>
    <li><strong>1 à 9 copas ramassées</strong> : ce nombre s'ajoute au score.</li>
    <li><strong>Les 10 copas ramassées d'un coup</strong> : ces points restent <strong>en suspens</strong>
      jusqu'à la manche suivante :
      <ul>
        <li><strong>0 copa</strong> à la manche suivante → les points en suspens <strong>disparaissent</strong>.</li>
        <li><strong>1 à 9 copas</strong> à la manche suivante → les points en suspens deviennent
          <strong>définitifs</strong> et s'ajoutent aux copas de cette nouvelle manche.</li>
        <li><strong>Les 10 copas à nouveau</strong> → les points en suspens <strong>s'accumulent</strong>, et
          la même règle continue de s'appliquer.</li>
      </ul>
    </li>
  </ul>

  <h3>Fin de la partie</h3>
  <p>La partie s'arrête dès qu'un joueur atteint <strong>30 points définitifs</strong>. Le
  gagnant est celui qui a le score le plus bas à ce moment-là.</p>
`;

// context : 'home' (intro + onglets 3/4, choix via state.rulesTab) ou
// 'game' (intro + uniquement la version de hand.numPlayers, pas de choix).
function renderRulesOverlay(context) {
  if (!state.rulesOpen) return '';

  let versionsHtml;
  if (context === 'game' && state.hand) {
    const n = state.hand.numPlayers;
    versionsHtml = `
      <h2>Règles à ${n} joueurs</h2>
      ${n === 3 ? RULES_3P_HTML : RULES_4P_HTML}
    `;
  } else {
    versionsHtml = `
      <div class="choice-row">
        <button class="choice-btn ${state.rulesTab === 3 ? 'active' : ''}" id="btn-rules-tab-3">3 joueurs</button>
        <button class="choice-btn ${state.rulesTab === 4 ? 'active' : ''}" id="btn-rules-tab-4">4 joueurs</button>
      </div>
      <h2>Règles à ${state.rulesTab} joueurs</h2>
      ${state.rulesTab === 3 ? RULES_3P_HTML : RULES_4P_HTML}
    `;
  }

  return `<div class="overlay" id="rules-overlay">
    <div class="overlay-card rules-card">
      <button class="rules-close" id="btn-rules-close" title="Fermer" aria-label="Fermer">&times;</button>
      <h2>Règles du <span class="accent">jeu</span></h2>
      <div class="rules-content">
        ${RULES_INTRO_HTML}
        ${versionsHtml}
      </div>
    </div>
  </div>`;
}

function wireRulesOverlay() {
  const closeBtn = document.getElementById('btn-rules-close');
  if (!closeBtn) return;
  closeBtn.onclick = () => { state.rulesOpen = false; render(); };
  document.getElementById('rules-overlay').onclick = (e) => {
    if (e.target.id === 'rules-overlay') { state.rulesOpen = false; render(); }
  };
  const tab4 = document.getElementById('btn-rules-tab-4');
  const tab3 = document.getElementById('btn-rules-tab-3');
  if (tab4) tab4.onclick = () => { state.rulesTab = 4; render(); };
  if (tab3) tab3.onclick = () => { state.rulesTab = 3; render(); };
}

function playerName(id) {
  if (!state.room) return '?';
  const p = state.room.players.find((p) => p.id === id);
  return p ? p.name : '?';
}

function isBotPlayer(id) {
  if (!state.room) return false;
  return !!state.room.players.find((p) => p.id === id)?.isBot;
}

// Badge discret pour distinguer un bot d'un vrai joueur, dans le lobby comme
// en jeu (opponent chips, score chips).
function botBadge() {
  return `<span class="bot-badge" title="Bot">🤖</span>`;
}

function render() {
  if (state.screen === 'reconnecting') return renderReconnecting();
  if (state.screen === 'home') return renderHome();
  if (state.screen === 'create') return renderCreate();
  if (state.screen === 'join') return renderJoin();
  if (state.screen === 'solo') return renderSolo();
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
      <p class="lede">Entraîne-toi, et un jour, peut-être, tu pourras battre le grand maître de la Copas, Alan S. dit "L'Insubmersible".</p>
      ${errorBox()}
      <div class="card-panel">
        <button class="primary" id="btn-create">Créer une partie</button>
        <div class="divider">ou</div>
        <button class="secondary" id="btn-join">Rejoindre avec un code</button>
        <div class="divider">ou</div>
        <button class="secondary" id="btn-solo">Jouer contre l'ordinateur</button>
      </div>
      <button class="link-btn" id="btn-rules">Règles du jeu</button>
    </div>
    ${renderRulesOverlay('home')}`;
  document.getElementById('btn-create').onclick = () => { state.error = null; state.screen = 'create'; render(); };
  document.getElementById('btn-join').onclick = () => { state.error = null; state.screen = 'join'; render(); };
  document.getElementById('btn-solo').onclick = () => { state.error = null; state.screen = 'solo'; render(); };
  document.getElementById('btn-rules').onclick = () => { state.rulesOpen = true; render(); };
  wireRulesOverlay();
}

function renderCreate() {
  app.innerHTML = `
    <div class="screen" style="justify-content:center;">
      <h1>Créer une <span class="accent">partie</span></h1>
      ${errorBox()}
      <div class="card-panel">
        <label>Ton prénom</label>
        <input type="text" id="name-input" placeholder="Ex : Léa" value="${state.name}" maxlength="16" />
        ${renderNameSuggestions()}
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
  wireNameSuggestions();
  // [data-n] (pas juste .choice-btn) pour ne pas être aussi capté par le
  // câblage des suggestions de pseudo (mêmes classes, data-name à la place).
  document.querySelectorAll('.choice-btn[data-n]').forEach((b) => {
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
        ${renderNameSuggestions()}
        <label>Code du salon</label>
        <input type="text" id="code-input" class="code-input" placeholder="XXXX" maxlength="4" value="${state.joinCode}" />
        <button class="primary" id="btn-submit">Rejoindre</button>
        <button class="secondary" id="btn-back">Retour</button>
      </div>
    </div>`;
  document.getElementById('name-input').oninput = (e) => (state.name = e.target.value);
  document.getElementById('code-input').oninput = (e) => (state.joinCode = e.target.value);
  wireNameSuggestions();
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

// Mode solo : demande juste le nombre de joueurs (comme une création
// classique), puis enchaîne room:create -> room:fillBots -> room:start côté
// serveur sans code de salon ni attente. Le passage à l'écran de jeu se fait
// ensuite normalement via les room:update/hand:update diffusés par le
// serveur, exactement comme pour une partie classique une fois démarrée.
function renderSolo() {
  app.innerHTML = `
    <div class="screen" style="justify-content:center;">
      <h1>Jouer contre l'<span class="accent">ordinateur</span></h1>
      ${errorBox()}
      <div class="card-panel">
        <label>Nombre de joueurs</label>
        <div class="choice-row">
          <button class="choice-btn ${state.maxPlayersChoice === 3 ? 'active' : ''}" data-n="3">3 joueurs</button>
          <button class="choice-btn ${state.maxPlayersChoice === 4 ? 'active' : ''}" data-n="4">4 joueurs</button>
        </div>
        <button class="primary" id="btn-submit" ${state.soloStarting ? 'disabled' : ''}>${state.soloStarting ? 'Préparation…' : 'Commencer'}</button>
        <button class="secondary" id="btn-back" ${state.soloStarting ? 'disabled' : ''}>Retour</button>
      </div>
    </div>`;
  document.querySelectorAll('.choice-btn[data-n]').forEach((b) => {
    b.onclick = () => { state.maxPlayersChoice = Number(b.dataset.n); render(); };
  });
  document.getElementById('btn-back').onclick = () => { state.screen = 'home'; render(); };
  document.getElementById('btn-submit').onclick = () => {
    state.error = null;
    state.soloStarting = true;
    render();

    const soloName = state.name.trim() || 'Moi';
    socket.emit('room:create', { name: soloName, maxPlayers: state.maxPlayersChoice }, (res) => {
      if (!res.ok) { state.error = res.error; state.soloStarting = false; render(); return; }
      state.myId = res.playerId;
      state.room = res.room;
      saveSession({ code: res.room.code, sessionToken: res.sessionToken });

      socket.emit('room:fillBots', {}, (fillRes) => {
        if (!fillRes.ok) { state.error = fillRes.error; state.soloStarting = false; state.screen = 'lobby'; render(); return; }

        socket.emit('room:start', {}, (startRes) => {
          state.soloStarting = false;
          if (!startRes.ok) { state.error = startRes.error; state.screen = 'lobby'; render(); return; }
          // room:update/hand:update déjà diffusés par le serveur à ce stade ;
          // le prochain hand:update fera passer state.screen à 'game'.
        });
      });
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
      playerItems.push(`<li><span class="player-dot ${p.connected ? '' : 'offline'}"></span>${p.name}${isBotPlayer(p.id) ? botBadge() : ''}${p.id === state.myId ? ' (toi)' : ''}</li>`);
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
      ${isHost && !full ? `<button class="secondary" id="btn-fill-bots">Compléter avec des bots</button>` : ''}
      <button class="secondary" id="btn-leave-lobby">Quitter</button>
    </div>`;

  if (isHost && full) {
    document.getElementById('btn-start').onclick = () => {
      socket.emit('room:start', {}, (res) => {
        if (!res.ok) { state.error = res.error; render(); }
      });
    };
  }
  if (isHost && !full) {
    document.getElementById('btn-fill-bots').onclick = () => {
      socket.emit('room:fillBots', {}, (res) => {
        if (!res.ok) { state.error = res.error; render(); }
      });
    };
  }

  document.getElementById('btn-leave-lobby').onclick = () => leaveGame();
}

// Widget fixe sur le côté droit de l'écran : le tas des plis joués (cartes
// dos cachées empilées façon négligée), qui grossit au fil de la manche à
// mesure que chaque pli résolu s'y envole (voir runTrickPileAnim). Un clic
// affiche le dernier pli résolu (cartes réelles + gagnant), un second clic
// referme. N'existe pas tant qu'aucun pli n'a encore visuellement atterri
// dans le tas (trickPileCount toujours à 0 pendant l'envol du tout premier
// pli) — data-anchor="trick-pile" sert de cible à cette animation.
function renderLastTrickWidget() {
  if (state.trickPileCount <= 0) return '';

  if (!state.lastTrickRevealed) {
    const layers = Math.min(state.trickPileCount, 6);
    const stackCards = Array.from({ length: layers }).map(() => `<div class="pcard mini card-back trick-pile-card"></div>`).join('');
    return `<div class="last-trick-widget" id="last-trick-widget" data-anchor="trick-pile" title="Voir le dernier pli">
      <div class="trick-pile-stack">${stackCards}</div>
    </div>`;
  }

  const t = state.lastTrick;
  return `<div class="last-trick-widget revealed" id="last-trick-widget" data-anchor="trick-pile" title="Cacher le dernier pli">
    <div class="last-trick-label">Dernier pli — ${playerName(t.winnerId)}${t.copasInTrick > 0 ? ` (+${t.copasInTrick} ${SUIT_SVG.copas})` : ''}</div>
    <div class="last-trick-cards">${t.trick.map((e) => renderCard(e.card, 'mini')).join('')}</div>
  </div>`;
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
  const dealerId = hand.players[hand.dealerIndex];

  const dealerBadge = `<div class="dealer-badge" title="Donneur">D</div>`;

  const opponentsHtml = others.map((pid) => {
    const count = hand.handSizes[pid] ?? 0;
    const active = hand.turnPlayerId === pid;
    const miniCards = Array.from({ length: Math.min(count, 10) }).map(() => `<div class="mc"></div>`).join('');
    return `<div class="opponent ${active ? 'active-turn' : ''}" data-anchor="player-${pid}">
      ${pid === dealerId ? dealerBadge : ''}
      <div class="name">${playerName(pid)}${isBotPlayer(pid) ? botBadge() : ''}</div>
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

  // Pioche visible (3 joueurs uniquement) : un petit tas de dos de carte au
  // centre, avec le nombre de cartes restantes. Caché tant que la phase
  // "cards" de la distribution tourne encore (elle n'apparaît qu'une fois
  // que le donneur a fini de se servir), et disparaît proprement une fois
  // épuisée (drawPileCount === 0). pileCountOverride fige puis décompte
  // l'affichage carte par carte pendant toute la séquence trickResolved ->
  // distribution (voir game:trickResolved et runDrawAnimPhase) : sans ça, le
  // hand:update qui suit la résolution du pli arrive avec le compte déjà
  // décrémenté côté serveur et ferait sauter l'affichage avant l'animation.
  const cardsPhaseActive = !!(state.dealAnim && state.dealAnim.phase === 'cards');
  const displayedPileCount = state.pileCountOverride != null ? state.pileCountOverride : hand.drawPileCount;
  const showDrawPile = hand.numPlayers === 3 && displayedPileCount > 0 && !cardsPhaseActive;
  const drawPileHtml = showDrawPile
    ? `<div class="draw-pile" data-anchor="draw-pile" title="Pioche">
        <div class="pcard card-back draw-pile-card"></div>
        <div class="draw-pile-count">${displayedPileCount}</div>
      </div>`
    : '';
  const centerRowHtml = drawPileHtml ? `<div class="trick-row">${trickHtml}${drawPileHtml}</div>` : trickHtml;

  const specialBanner = hand.specialPhase
    ? `<div class="special-banner">Phase de pioche (plis 1-3) — <strong>pas d'obligation de suivre la couleur</strong>, <strong>copas interdites</strong>${hand.drawPileCount > 0 ? ` · ${hand.drawPileCount} cartes en pioche` : ''}</div>`
    : '';

  const scoreChips = hand.players.map((pid) => {
    const s = room.scores?.[pid] || { real: 0, suspended: 0 };
    return `<div class="score-chip ${pid === myId ? 'me' : ''}">
      ${pid === dealerId ? dealerBadge : ''}
      ${s.suspended > 0 ? `<div class="suspended-float">${s.suspended} en suspens</div>` : ''}
      <div class="name">${playerName(pid)}${isBotPlayer(pid) ? botBadge() : ''}</div>
      <div class="real">${s.real}</div>
    </div>`;
  }).join('');

  // Pendant l'étape "cards" de la distribution, ma main n'est pas encore
  // révélée : on affiche des dos de carte à la place, sans bloquer le reste
  // de la table. Une fois cette étape terminée (y compris pendant l'étape
  // "pile" qui suit à 3 joueurs), ma main est révélée et jouable normalement.
  const dealingInProgress = cardsPhaseActive;
  const playableIds = new Set((hand.playableCards || []).map(cardId));

  // Carte tout juste piochée (fin de pli 1-3) : dès game:trickResolved (voir
  // plus bas), le stade passe à "pending" — retirée de la main tout de suite,
  // sans encore rien afficher à la place. Ça évite qu'elle n'apparaisse
  // brièvement dans la main (mélangée aux autres) dès que hand:update arrive
  // (quasi immédiatement après trickResolved, avec la carte déjà dedans côté
  // serveur), avant même que l'animation de vol depuis la pioche ne
  // démarre 1400ms plus tard. Cette dernière fait alors passer le stade à
  // "ghost" (retirée de la liste normale, affichée à part au-dessus de la
  // main) ; au stade "settle", elle réapparaît dans la liste triée avec une
  // brève mise en évidence.
  //
  // render() régénère tout le innerHTML à chaque appel, y compris pendant
  // les 2,2s/1,1s des stades "ghost"/"settle" (un hand:update lié au tour
  // d'un autre joueur, par ex., peut très bien arriver et déclencher un
  // render() entre-temps). Un simple remount de l'élément relancerait son
  // animation CSS d'entrée depuis 0% à chaque fois ("repop" visuel). Pour
  // l'éviter, on ne rejoue l'animation que le temps qu'elle dure réellement
  // (GHOST/SETTLE_MS, à faire correspondre aux durées définies dans
  // style.css) : passé ce délai la carte est affichée directement dans son
  // état final, sans classe "entering" ; et si un remount survient en plein
  // milieu, un animation-delay négatif reprend l'animation à l'endroit où
  // elle en était plutôt que de la relancer depuis le début.
  const GHOST_ANIM_MS = 500;
  const SETTLE_ANIM_MS = 1000;
  const hiddenFromHand = (state.justDrawnStage === 'pending' || state.justDrawnStage === 'ghost') && state.justDrawnCardId;
  const ghostActive = state.justDrawnStage === 'ghost' && state.justDrawnCardId;
  const ghostElapsed = ghostActive ? Date.now() - (state.justDrawnStageStartedAt || Date.now()) : 0;
  const ghostEntering = ghostActive && ghostElapsed < GHOST_ANIM_MS;
  const settleElapsed = state.justDrawnStage === 'settle' ? Date.now() - (state.justDrawnStageStartedAt || Date.now()) : 0;
  const settleEntering = state.justDrawnStage === 'settle' && settleElapsed < SETTLE_ANIM_MS;

  const visibleMyHand = hiddenFromHand
    ? hand.myHand.filter((c) => cardId(c) !== state.justDrawnCardId)
    : hand.myHand;
  const justDrawnGhostHtml = ghostActive
    ? `<div class="just-drawn-ghost${ghostEntering ? ' entering' : ''}"${ghostEntering ? ` style="animation-delay:-${ghostElapsed}ms"` : ''}>${renderCard(state.justDrawnCard, 'just-drawn-card')}</div>`
    : '';

  const myHandHtml = dealingInProgress
    ? Array.from({ length: hand.myHand.length }).map(() => `<div class="pcard card-back"></div>`).join('')
    : sortHand(visibleMyHand).map((c) => {
        const isPlayable = myTurn && playableIds.has(cardId(c));
        const isJustDrawn = state.justDrawnStage === 'settle' && cardId(c) === state.justDrawnCardId;
        const cls = [isPlayable ? 'playable' : (myTurn ? 'unplayable' : ''), isJustDrawn ? 'just-drawn' : '', (isJustDrawn && settleEntering) ? 'entering' : '']
          .filter(Boolean).join(' ');
        const style = (isJustDrawn && settleEntering) ? `animation-delay:-${settleElapsed}ms` : '';
        return renderCard(c, cls, style);
      }).join('');

  app.innerHTML = `
    <button class="leave-btn" id="btn-leave">Quitter la partie</button>
    <button class="rules-btn" id="btn-rules-game">Règles</button>
    ${renderLastTrickWidget()}
    <div id="deal-anim-layer"></div>
    <div class="screen table-wrap">
      <div class="score-bar">${scoreChips}</div>
      <div class="opponents-row">${opponentsHtml}</div>
      <div class="center-area">
        ${specialBanner}
        ${centerRowHtml}
        <div class="status-line ${myTurn ? 'my-turn' : ''}">${statusText}</div>
      </div>
      <div class="my-hand-wrap" data-anchor="player-${myId}">
        ${justDrawnGhostHtml}
        <div class="my-hand ${dealingInProgress ? 'my-hand-pending' : ''}">${myHandHtml}</div>
      </div>
    </div>
    ${renderHandOverOverlay()}
    ${renderRulesOverlay('game')}
  `;

  document.getElementById('btn-leave').onclick = () => {
    if (confirm('Quitter la partie ? Tu ne pourras pas revenir dans cette manche.')) leaveGame();
  };
  document.getElementById('btn-rules-game').onclick = () => { state.rulesOpen = true; render(); };
  wireRulesOverlay();

  if (state.trickPileCount > 0) {
    document.getElementById('last-trick-widget').onclick = () => {
      state.lastTrickRevealed = !state.lastTrickRevealed;
      render();
    };
  }

  if (myTurn && !dealingInProgress) {
    document.querySelectorAll('.my-hand .pcard.playable').forEach((el) => {
      el.onclick = () => {
        const [suit, rank] = el.dataset.card.split('-');
        socket.emit('game:playCard', { card: { suit, rank } }, (res) => {
          if (!res.ok) { state.error = res.error; render(); }
        });
      };
    });
  }

  if (state.dealAnim && !state.dealAnim.phaseStarted) {
    state.dealAnim.phaseStarted = true;
    const animId = state.dealAnim.id;
    const phase = state.dealAnim.phase;
    requestAnimationFrame(() => runDealPhase(animId, phase));
  }

  if (state.drawAnim && !state.drawAnim.phaseStarted) {
    state.drawAnim.phaseStarted = true;
    const animId = state.drawAnim.id;
    requestAnimationFrame(() => runDrawAnimPhase(animId));
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
      ${info.earlyEnd ? `<div class="special-banner" style="margin-bottom:12px;">Toutes les <strong>copas</strong> ont été tirées — la manche s'arrête là, le reste des cartes ne change plus le score.</div>` : ''}
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
  } else if (!state.handOverInfo && !state.soloStarting) {
    // Ne bascule vers le lobby que si on n'est pas en train d'afficher le
    // résultat final d'une partie qui vient de se terminer (room.started
    // repasse à false à ce moment-là, mais l'overlay doit rester affiché),
    // ni en train d'enchaîner room:create -> room:fillBots -> room:start du
    // mode solo (room:update de l'étape fillBots arrive alors que started
    // est encore false, ce qui basculerait sinon brièvement vers le lobby).
    state.screen = 'lobby';
  }
  render();
});

socket.on('hand:update', (hand) => {
  if (state.screen === 'home') return;
  const prevHand = state.hand;
  state.hand = hand;
  if (hand) state.screen = 'game';

  // "Fresh deal" : personne n'a encore joué de carte dans cette manche. On ne
  // déclenche l'animation que sur la transition vers cet état (pas à chaque
  // hand:update qui s'y trouverait déjà), pour ne jouer l'envol des cartes
  // qu'une seule fois par manche.
  const isFreshDeal = !!hand && hand.tricksPlayed === 0 && hand.currentTrick.length === 0;
  const wasSamePendingDeal = isFreshDeal && prevHand
    && prevHand.tricksPlayed === 0 && prevHand.currentTrick.length === 0
    && prevHand.dealerIndex === hand.dealerIndex && prevHand.numPlayers === hand.numPlayers;

  if (isFreshDeal && !wasSamePendingDeal && !prefersReducedMotion()) {
    dealAnimCounter += 1;
    state.dealAnim = { id: dealAnimCounter, phase: 'cards', phaseStarted: false, sequence: computeDealSequence(hand) };
  } else if (!isFreshDeal && state.dealAnim) {
    // La partie a avancé (quelqu'un a déjà joué) pendant que l'animation
    // tournait encore : on l'interrompt proprement, l'état à jour prime.
    state.dealAnim = null;
  } else if (isFreshDeal && prefersReducedMotion()) {
    state.dealAnim = null; // pas d'animation : la main s'affiche tout de suite
  }

  if (isFreshDeal && !wasSamePendingDeal) {
    // Nouvelle manche : toute animation/mise en évidence de pioche de la
    // manche précédente n'a plus lieu d'être.
    state.drawAnim = null;
    state.pileCountOverride = null;
    state.pendingDrawAnimId = null;
    state.justDrawnCard = null;
    state.justDrawnCardId = null;
    state.justDrawnStage = null;
    state.justDrawnStageStartedAt = null;
    state.trickPileCount = 0;
    state.handGeneration += 1;
  }

  render();
});

socket.on('game:trickResolved', (payload) => {
  if (state.screen === 'home') return;

  // Capturé ICI, avant tout autre traitement : hand:update (qui suit tout de
  // suite, le serveur l'émettant juste après) arrive avec drawPileCount déjà
  // décrémenté par le tirage de ce pli. Si on ne fige pas l'affichage tout de
  // suite avec la valeur actuelle (encore correcte à ce stade précis), le
  // compteur/tas sauterait à sa valeur finale dès l'arrivée de hand:update,
  // bien avant que la séquence d'animation ne joue et ne le décrémente elle-
  // même carte par carte.
  //
  // pendingDrawAnimId est posé dès maintenant (pas seulement quand
  // startDrawAnim tourne, 1400ms plus tard) : si les joueurs enchaînent les
  // plis plus vite que la durée d'une séquence complète (~2,6s, arrive vite
  // avec des bots ou des joueurs rapides), un pli suivant peut se résoudre
  // avant que celui-ci n'ait fini d'animer. En réassignant l'id ici, tout de
  // suite, la séquence précédente (dont les setTimeout tournent encore) le
  // détecte au prochain tick et s'arrête proprement au lieu de continuer à
  // décrémenter un compteur qui ne lui appartient plus.
  let myDrawSeqId = null;
  if (payload?.drawOrder?.length && state.hand) {
    dealAnimCounter += 1;
    myDrawSeqId = dealAnimCounter;
    state.pendingDrawAnimId = myDrawSeqId;
    state.pileCountOverride = state.hand.drawPileCount;
  }

  // Même logique que pileCountOverride ci-dessus, pour ma carte piochée : si
  // j'ai pioché, la retire de la main dès MAINTENANT (stade "pending", rien
  // d'affiché à la place pour l'instant) plutôt que d'attendre startDrawAnim
  // 1400ms plus tard. Sans ça, hand:update (qui suit tout de suite, avec la
  // carte déjà dans myHand côté serveur) la ferait apparaître brièvement dans
  // la main, mélangée aux autres, avant même que l'animation de vol ne
  // démarre — un rendu parasite. startDrawAnim fera passer le stade à
  // "ghost" au bon moment pour démarrer la partie visuelle de la séquence.
  if (payload?.myDrawnCard) {
    state.justDrawnCard = payload.myDrawnCard;
    state.justDrawnCardId = cardId(payload.myDrawnCard);
    state.justDrawnStage = 'pending';
    state.justDrawnStageStartedAt = null;
  }

  state.trickResult = payload;
  state.lastTrick = payload; // consultable via le widget une fois l'animation terminée
  state.lastTrickRevealed = false; // nouveau pli = widget refermé, à retourner à nouveau pour le voir
  render();
  setTimeout(() => {
    // Capture les positions des cartes du pli résolu AVANT qu'elles ne
    // disparaissent du DOM : le render() juste après les retire de
    // .trick-slots (state.trickResult repasse à null), donc ces rects sont
    // le seul moyen de savoir d'où les cartes doivent s'envoler vers le tas.
    const sourceRects = Array.from(document.querySelectorAll('.trick-slots .pcard'))
      .map((el) => el.getBoundingClientRect());
    const handGenAtCapture = state.handGeneration;

    state.trickResult = null;
    // Fin des 3 premiers plis (3 joueurs) : si des cartes ont été piochées,
    // rejoue une petite distribution depuis la pioche vers chaque joueur.
    startDrawAnim(payload, myDrawSeqId);
    render();

    // Envole les cartes du pli résolu vers le tas "plis joués" (bord droit)
    // au lieu de les laisser simplement disparaître.
    runTrickPileAnim(sourceRects, handGenAtCapture);
  }, 1400);
});

socket.on('game:handOver', (payload) => {
  if (state.screen === 'home') return;
  state.handOverInfo = payload;
  state.lastTrick = null; // la manche suivante repart sans "dernier pli" de la précédente
  state.lastTrickRevealed = false;
  state.drawAnim = null;
  state.pileCountOverride = null;
  state.pendingDrawAnimId = null;
  state.justDrawnCard = null;
  state.justDrawnCardId = null;
  state.justDrawnStage = null;
  state.justDrawnStageStartedAt = null;
  state.trickPileCount = 0;
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
