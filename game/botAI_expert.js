// ============================================================================
// IA "experte" réservée au bot Sergio (voir server.js, makeBot : expert:
// true si le nom est "Bot Sergio").
//
// Choix assumé : Sergio est un boss quasi imbattable, il "voit" toute la
// partie. `hand` (1er paramètre) est TOUJOURS l'état serveur complet de la
// manche (room.currentHand), qui contient déjà réellement hand.hands[id]
// pour CHAQUE joueur (pas seulement le sien) et hand.drawPile au complet
// (contenu réel de la pioche à 3 joueurs) — ce n'est QUE la vue envoyée à
// chaque client (voir handViewForPlayer dans server.js, seule barrière de
// filtrage : ne renvoie que myHand pour le joueur concerné + handSizes des
// autres, jamais leur contenu, jamais drawPile au-delà de son compte) qui
// est restreinte. Cette fonction ne renvoie qu'UN SEUL coup choisi (une
// carte), exactement comme n'importe quel autre joueur — aucune des
// informations complètes qu'elle a consultées pour décider ne transite par
// un événement socket, donc rien ne fuite vers un client, humain ou bot,
// tant que cette fonction n'est appelée QUE côté serveur avec le véritable
// room.currentHand (jamais avec une vue filtrée type handViewForPlayer).
//
// Avec cette connaissance complète, plus besoin de déduire/deviner quoi que
// ce soit (une première version de ce fichier essayait de reconstruire les
// cartes encore possibles par déduction + tirages aléatoires — inutile ici
// puisque la vérité est déjà disponible en mémoire). La décision se fait
// par une recherche courte et volontairement simple : pour chaque coup
// légal (toujours via engine.getPlayableCards, donc jamais un coup
// illégal), on simule la suite du jeu sur une fenêtre de 2 plis avec les
// VRAIES cartes des autres joueurs, ceux-ci jouant selon l'heuristique
// simple (game/botAI.js — un choix raisonnable pour des bots, et une
// approximation correcte pour un joueur humain sur un horizon aussi court),
// et on retient le coup qui minimise les copas que Sergio récolte sur cette
// fenêtre. Volontairement borné à 2 plis plutôt qu'une simulation jusqu'à
// la fin de la manche : au-delà, prédire le comportement d'un joueur humain
// via une heuristique fixe devient de moins en moins fiable, alors qu'à
// aussi court terme l'éventail des coups "raisonnables" reste étroit quel
// que soit le joueur en face.
// ============================================================================

const { getPlayableCards, playCard } = require('./engine');
const { chooseBotCard: chooseBasicBotCard } = require('./botAI');

// Nombre de plis simulés à l'avance pour chaque coup candidat. Le 2e pli
// pèse moins que le 1er dans le coût final (voir evaluateCandidate) : plus
// on regarde loin, moins la prédiction (heuristique simple pour les autres
// joueurs) reste fiable pour un adversaire humain.
const LOOKAHEAD_TRICKS = 2;
const SECOND_TRICK_WEIGHT = 0.5;

/**
 * suspended > 0 = points "en suspens" (voir engine.applyHandResultToScores) :
 * une bombe qui explose au moindre pli de copas suivant. Combiné à un score
 * réel déjà élevé, ça justifie un mode prudent qui pondère plus lourdement
 * tout pli dangereux dans la fenêtre observée plutôt que de s'en remettre
 * à la seule moyenne. scores peut être absent (tests/simulations hors
 * contexte de partie) : le profil reste alors neutre.
 */
function computeRiskProfile(playerId, scores) {
  if (!scores || !scores[playerId]) return { cautious: false };
  const mine = scores[playerId];
  return { cautious: mine.suspended > 0 && mine.real >= 20 };
}

/** Copie légère d'une main pour simulation (jamais de mutation de l'originale). */
function cloneHandForSimulation(hand) {
  const hands = {};
  for (const p of hand.players) hands[p] = [...hand.hands[p]];
  return {
    numPlayers: hand.numPlayers,
    players: hand.players,
    dealerIndex: hand.dealerIndex,
    hands,
    drawPile: [...hand.drawPile],
    tricksPlayed: hand.tricksPlayed,
    currentTrick: hand.currentTrick.map((e) => ({ ...e })),
    playedCards: hand.playedCards.map((e) => ({ ...e })),
    turnIndex: hand.turnIndex,
    leaderIndex: hand.leaderIndex,
    tricksWonCopas: { ...hand.tricksWonCopas },
    finished: hand.finished,
  };
}

/**
 * Joue candidateCard pour playerId dans une copie de la VRAIE manche (mains
 * réelles de tout le monde, pioche réelle — voir l'en-tête du fichier),
 * puis simule jusqu'à LOOKAHEAD_TRICKS plis complets supplémentaires avec
 * l'heuristique simple pour tous les joueurs (Sergio y compris, pour ses
 * propres coups suivants dans cette fenêtre). Retourne un coût pondéré :
 * copas gagnées par Sergio au 1er pli de la fenêtre + la moitié de celles
 * du 2e.
 */
function evaluateCandidate(hand, playerId, candidateCard) {
  const sim = cloneHandForSimulation(hand);
  const copasBefore = sim.tricksWonCopas[playerId];

  playCard(sim, playerId, candidateCard);

  let cost = 0;
  let lastTrickCopas = 0;
  let tricksResolved = 0;
  let guard = 0;

  while (!sim.finished && tricksResolved < LOOKAHEAD_TRICKS && guard < 60) {
    guard += 1;
    const tricksPlayedBefore = sim.tricksPlayed;
    const currentId = sim.players[sim.turnIndex];
    const copasBeforePlay = sim.tricksWonCopas[playerId];
    playCard(sim, currentId, chooseBasicBotCard(sim, currentId));

    if (sim.tricksPlayed > tricksPlayedBefore) {
      // Un pli vient de se conclure : comptabilise les copas que Sergio y a
      // gagnées, pondérées selon que c'est le 1er ou le 2e pli de la fenêtre.
      const copasThisTrick = sim.tricksWonCopas[playerId] - copasBeforePlay;
      const weight = tricksResolved === 0 ? 1 : SECOND_TRICK_WEIGHT;
      cost += copasThisTrick * weight;
      tricksResolved += 1;
    }
  }

  return cost;
}

/**
 * Choisit une carte à jouer pour Sergio, parmi les coups légaux uniquement.
 * scores (optionnel) = room.scores côté serveur, pour adapter la prudence
 * à l'état de la partie.
 */
function chooseBotCard(hand, playerId, scores) {
  const playable = getPlayableCards(hand, playerId);
  if (playable.length === 1) return playable[0];

  const risk = computeRiskProfile(playerId, scores);

  let bestCard = playable[0];
  let bestCost = Infinity;
  for (const candidate of playable) {
    const cost = evaluateCandidate(hand, playerId, candidate);
    // Profil prudent : une copa dans la fenêtre pèse plus lourd (évite plus
    // agressivement tout risque plutôt que de s'en remettre au même calcul
    // que d'habitude), pertinent surtout pour départager des coups à coût
    // autrement égal.
    const weighted = risk.cautious ? cost * 1.5 : cost;
    if (weighted < bestCost) {
      bestCost = weighted;
      bestCard = candidate;
    }
  }
  return bestCard;
}

module.exports = { chooseBotCard };
