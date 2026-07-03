// ============================================================================
// Moteur du jeu "Copas" (variante Sueca portugaise, 3 ou 4 joueurs)
// Logique pure : aucune dépendance réseau/UI. Facile à tester isolément.
// ============================================================================

const SUITS = ['espadas', 'ouros', 'copas', 'paus'];
// Ordre de force croissant
const RANKS = ['2', '3', '4', '5', '6', 'valete', 'dama', 'rei', '7', 'as'];

function createDeck(numPlayers) {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      // À 3 joueurs, on retire le 2 d'espadas (39 cartes)
      if (numPlayers === 3 && suit === 'espadas' && rank === '2') continue;
      deck.push({ suit, rank, strength: RANKS.indexOf(rank) });
    }
  }
  return deck;
}

function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardId(card) {
  return `${card.suit}-${card.rank}`;
}

/**
 * Crée un nouvel état de manche (deal).
 * players: array d'IDs de joueurs, dans l'ordre du tour de table.
 * dealerIndex: index (dans players) du donneur pour cette manche.
 */
function dealNewHand(players, dealerIndex) {
  const numPlayers = players.length;
  const deck = shuffle(createDeck(numPlayers));

  const hands = {};
  players.forEach((p) => (hands[p] = []));

  let drawPile = [];

  // Distribution : 10 cartes chacun dans tous les cas
  for (let i = 0; i < 10; i++) {
    for (const p of players) {
      hands[p].push(deck.pop());
    }
  }

  if (numPlayers === 3) {
    drawPile = deck.splice(0, deck.length); // les 9 cartes restantes
  } else if (numPlayers !== 4) {
    throw new Error('Le jeu se joue à 3 ou 4 joueurs uniquement.');
  }

  const firstPlayerIndex = (dealerIndex + 1) % numPlayers;

  return {
    numPlayers,
    players,
    dealerIndex,
    hands,                 // { playerId: [card, ...] }
    drawPile,               // uniquement pour 3 joueurs (9 cartes au départ)
    tricksPlayed: 0,
    currentTrick: [],       // [{ playerId, card }]
    turnIndex: firstPlayerIndex,   // index dans `players` de celui qui doit jouer
    leaderIndex: firstPlayerIndex, // qui a ouvert le pli courant
    tricksWonCopas: Object.fromEntries(players.map((p) => [p, 0])),
    finished: false,
  };
}

/** Règle spéciale active pendant les 3 premiers plis à 3 joueurs (tant que pioche non vide) */
function isSpecialThreePlayerPhase(hand) {
  return hand.numPlayers === 3 && hand.tricksPlayed < 3;
}

/**
 * Retourne la liste des cartes jouables par un joueur donné, compte tenu
 * de la couleur demandée et des règles spéciales.
 */
function getPlayableCards(hand, playerId) {
  const playerHand = hand.hands[playerId];
  const special = isSpecialThreePlayerPhase(hand);
  const leadSuit = hand.currentTrick.length > 0 ? hand.currentTrick[0].card.suit : null;

  if (special) {
    // Pas d'obligation de suivre la couleur pendant cette phase,
    // ET interdiction de jouer/entamer par copas (sauf si on n'a que ça en main).
    const nonCopas = playerHand.filter((c) => c.suit !== 'copas');
    return nonCopas.length > 0 ? nonCopas : playerHand;
  }

  if (hand.currentTrick.length === 0) {
    // Le joueur ouvre le pli, règles normales : il joue ce qu'il veut
    return playerHand;
  }

  // Règle normale : obligation de fournir la couleur demandée si possible
  const sameSuit = playerHand.filter((c) => c.suit === leadSuit);
  return sameSuit.length > 0 ? sameSuit : playerHand;
}

/**
 * Joue une carte pour le joueur courant.
 * Retourne { ok: true, trickComplete, ... } ou { ok: false, error }.
 */
function playCard(hand, playerId, card) {
  if (hand.finished) return { ok: false, error: 'La manche est terminée.' };

  const currentPlayerId = hand.players[hand.turnIndex];
  if (currentPlayerId !== playerId) {
    return { ok: false, error: "Ce n'est pas ton tour." };
  }

  const playable = getPlayableCards(hand, playerId);
  const found = playable.find((c) => cardId(c) === cardId(card));
  if (!found) {
    return { ok: false, error: 'Carte non jouable (règle de couleur ou de copas non respectée).' };
  }

  const playerHand = hand.hands[playerId];
  const idx = playerHand.findIndex((c) => cardId(c) === cardId(found));
  playerHand.splice(idx, 1);

  hand.currentTrick.push({ playerId, card: found });

  const trickComplete = hand.currentTrick.length === hand.numPlayers;

  if (!trickComplete) {
    hand.turnIndex = (hand.turnIndex + 1) % hand.numPlayers;
    return { ok: true, trickComplete: false };
  }

  const result = resolveTrick(hand);
  return { ok: true, trickComplete: true, ...result };
}

function resolveTrick(hand) {
  const leadSuit = hand.currentTrick[0].card.suit;
  let winner = hand.currentTrick[0];
  for (const entry of hand.currentTrick) {
    if (entry.card.suit === leadSuit && entry.card.strength > winner.card.strength) {
      winner = entry;
    }
  }

  const copasInTrick = hand.currentTrick.filter((e) => e.card.suit === 'copas').length;
  hand.tricksWonCopas[winner.playerId] += copasInTrick;

  const winnerId = winner.playerId;
  const winnerIndex = hand.players.indexOf(winnerId);

  hand.tricksPlayed += 1;
  const finishedTrick = hand.currentTrick;
  hand.currentTrick = [];

  let drawnCards = null;

  // Pioche à 3 joueurs : pendant les 3 premiers plis, le gagnant pioche
  // en premier, puis chaque joueur pioche une carte dans l'ordre du jeu.
  if (hand.numPlayers === 3 && hand.tricksPlayed <= 3 && hand.drawPile.length > 0) {
    drawnCards = {};
    for (let i = 0; i < hand.numPlayers; i++) {
      const pIndex = (winnerIndex + i) % hand.numPlayers;
      const pId = hand.players[pIndex];
      const card = hand.drawPile.pop();
      hand.hands[pId].push(card);
      drawnCards[pId] = card;
    }
  }

  hand.leaderIndex = winnerIndex;
  hand.turnIndex = winnerIndex;

  const handOver = hand.tricksPlayed >= 10;
  if (handOver) hand.finished = true;

  return { trick: finishedTrick, winnerId, copasInTrick, drawnCards, handOver };
}

// ---------------------------------------------------------------------------
// Score global de la partie (au-delà d'une seule manche)
// ---------------------------------------------------------------------------

function createInitialScores(players) {
  const scores = {};
  players.forEach((p) => {
    scores[p] = { real: 0, suspended: 0 };
  });
  return scores;
}

/**
 * Applique le résultat d'une manche terminée (tricksWonCopas) au score global,
 * en gérant la mécanique des points "en suspens".
 * Retourne un journal des événements pour affichage côté client.
 */
function applyHandResultToScores(scores, tricksWonCopas, players) {
  const log = [];

  for (const playerId of players) {
    const copasWon = tricksWonCopas[playerId] || 0;
    const s = scores[playerId];

    if (copasWon === 10) {
      if (s.suspended > 0) {
        s.suspended += 10;
        log.push({ playerId, event: 'suspended_stacked', suspended: s.suspended });
      } else {
        s.suspended = 10;
        log.push({ playerId, event: 'suspended_new', suspended: s.suspended });
      }
    } else if (copasWon === 0) {
      if (s.suspended > 0) {
        log.push({ playerId, event: 'suspended_cleared', cleared: s.suspended });
        s.suspended = 0;
      }
    } else {
      if (s.suspended > 0) {
        const totalAdded = s.suspended + copasWon;
        s.real += totalAdded;
        log.push({ playerId, event: 'suspended_realized', suspended: s.suspended, copasWon, totalAdded });
        s.suspended = 0;
      } else {
        s.real += copasWon;
        log.push({ playerId, event: 'normal_add', copasWon });
      }
    }
  }

  return log;
}

function checkGameOver(scores, threshold = 30) {
  const losers = Object.entries(scores)
    .filter(([, s]) => s.real >= threshold)
    .map(([playerId]) => playerId);
  return losers.length > 0 ? losers : null;
}

module.exports = {
  SUITS,
  RANKS,
  createDeck,
  shuffle,
  cardId,
  dealNewHand,
  isSpecialThreePlayerPhase,
  getPlayableCards,
  playCard,
  resolveTrick,
  createInitialScores,
  applyHandResultToScores,
  checkGameOver,
};
