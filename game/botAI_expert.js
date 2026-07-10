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
// 2026-07-10 (v2) : remplace le lookahead à 2 plis (qui restait l'unique
// méthode jusqu'ici) par une recherche EXACTE en fin de manche (minimax à
// un seul agent branchant + élagage + mémoïsation, voir plus bas), utilisée
// dès qu'il ne reste plus qu'une poignée de plis à jouer. Le lookahead à 2
// plis d'origine est conservé tel quel comme repli : à la fois pour les
// décisions prises tôt dans la manche (où une recherche exacte jusqu'au
// bout serait bien trop coûteuse) et comme filet de sécurité si jamais la
// recherche exacte dépasse son budget de temps.
// ============================================================================

const { getPlayableCards, playCard, cardId, TOTAL_COPAS } = require('./engine');
const { chooseBotCard: chooseBasicBotCard } = require('./botAI');

// ---------------------------------------------------------------------------
// Recherche exacte de fin de manche
// ---------------------------------------------------------------------------
//
// Principe : un vrai minimax adversarial à N joueurs (où chaque adversaire
// chercherait lui aussi à optimiser SON propre score) serait bien trop
// coûteux à explorer pour rester rapide. On modélise donc les autres
// joueurs comme suivant une politique FIXE et connue (l'heuristique simple
// de game/botAI.js — déjà utilisée pour la même raison dans l'ancien
// lookahead à 2 plis) : à leur tour, un seul coup possible est exploré (le
// leur, déterministe), aucun branchement. Seuls les tours de Sergio
// branchent réellement sur tous ses coups légaux. L'arbre à explorer se
// réduit ainsi à UNE SEULE décision (celle de Sergio, répétée à chacun de
// ses tours), ce qui le rend calculable exactement jusqu'à la fin de la
// manche sur un horizon de quelques plis.
//
// Élagage : à chaque nœud, un minorant (`nodeLowerBound`) du coût encore
// atteignable à partir de cet état est comparé au meilleur coût déjà connu
// ailleurs dans l'arbre (`incumbentBound`, la version de ce chantier de
// l'alpha d'un alpha-bêta classique) ; si le minorant l'égale ou le
// dépasse déjà, ce nœud est coupé sans être développé — sa valeur renvoyée
// (le minorant lui-même) n'est alors PAS mémoïsée, puisque ce n'est qu'une
// approximation basse, jamais le coût exact de ce nœud (mémoïser une valeur
// inexacte casserait la validité de la table de transposition pour un futur
// appel avec un incumbentBound plus généreux).
//
// Mémoïsation : les nœuds pleinement développés (jamais coupés) sont mis en
// cache par une clé canonique de l'état simulé (mains restantes, pioche,
// pli en cours, copas déjà ramassées, joueur au trait) — utile surtout en
// fin de manche où plusieurs enchaînements de coups différents peuvent
// reconverger vers un même état.

const SEARCH_TIMEOUT = Symbol('sergio-search-timeout');

// "5-6 derniers plis" (cf. demande) : au-delà, la recherche exacte devient
// trop coûteuse pour rester instantanée — on se replie alors sur le
// lookahead à 2 plis pour les décisions prises plus tôt dans la manche.
//
// Profondeur plus généreuse à 3 joueurs (10, contre 6 à 4 joueurs) pour
// deux raisons distinctes :
//  1. Une manche à 3 joueurs compte 13 plis (pas 10) à cause de la pioche —
//     à profondeur ABSOLUE égale, une même valeur couvrirait une part plus
//     petite de la manche qu'à 4 joueurs.
//  2. La pioche restante (hand.drawPile) est déjà connue de Sergio en
//     intégralité, contenu ET ordre de tirage (voir l'en-tête du fichier) :
//     rien n'y est caché ni aléatoire une fois la manche distribuée,
//     contrairement à ce qu'on pourrait supposer d'une "pioche". La
//     recherche exacte peut donc s'y risquer nettement plus loin sans
//     perdre en fiabilité que si l'avenir dépendait d'un vrai tirage
//     inconnu.
// Mesuré empiriquement (voir botAI_expert.test.js) : 10 reste très
// largement dans le budget de temps (EXACT_SEARCH_TIME_BUDGET_MS), avec une
// marge confortable avant les premiers dépassements observés (aux
// alentours de 11-12 sur les scénarios les plus coûteux testés).
const EXACT_SEARCH_MAX_REMAINING_TRICKS_3P = 10;
const EXACT_SEARCH_MAX_REMAINING_TRICKS_DEFAULT = 6;

function exactSearchMaxRemainingTricks(numPlayers) {
  return numPlayers === 3 ? EXACT_SEARCH_MAX_REMAINING_TRICKS_3P : EXACT_SEARCH_MAX_REMAINING_TRICKS_DEFAULT;
}

// Budget de temps dur pour la recherche exacte : Node.js est mono-thread,
// ce calcul bloque donc tout le serveur (toutes les parties en cours,
// tous les sockets) pendant qu'il tourne — rester à quelques centaines de
// millisecondes MAXIMUM est important, pas juste une préférence de
// confort. Dépassé, la recherche s'interrompt proprement (SEARCH_TIMEOUT)
// et chooseBotCard se replie automatiquement sur le lookahead à 2 plis.
const EXACT_SEARCH_TIME_BUDGET_MS = 200;

// Poids heuristique appliqué aux points en suspens qu'un dénouement
// laisserait derrière Sergio (voir evaluateFinalCost) : ni 0 (les points en
// suspens ne sont pas gratuits, ils explosent au moindre risque futur), ni
// 1 (ils ne sont pas non plus déjà perdus — une manche à 0 copa suffit à
// les effacer entièrement). 0.5 fait qu'un ramassage complet des 10 copas
// (qui n'ajoute rien au score réel immédiat, seulement aux points en
// suspens, voir engine.applyHandResultToScores) reste toujours préféré à
// réaliser plus de 5 copas normalement — cohérent avec la stratégie
// attendue : mieux vaut "tout ramasser" qu'en laisser fuiter quelques-unes
// une fois que la casse est de toute façon difficile à éviter. Valeur
// choisie empiriquement (voir botAI_expert.test.js pour la mesure du taux
// de victoire résultant) ; à retoucher si des parties réelles montrent un
// comportement trop timoré ou trop joueur.
const SUSPENDED_RISK_WEIGHT = 0.5;

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
 * Estimation du nombre de plis qu'il reste à jouer jusqu'à la fin de la
 * manche (pli en cours inclus), à partir du nombre de cartes pas encore
 * jouées (dans les mains + la pioche restante). Sert uniquement à décider
 * si la recherche exacte est envisageable (voir EXACT_SEARCH_MAX_REMAINING_
 * TRICKS) : une approximation suffit, inutile d'être exact au pli près.
 */
function estimateRemainingTricks(hand) {
  const cardsNotYetPlayed = hand.players.reduce((sum, p) => sum + hand.hands[p].length, 0)
    + hand.drawPile.length + hand.currentTrick.length;
  return Math.ceil(cardsNotYetPlayed / hand.numPlayers);
}

/**
 * Coût final d'un dénouement de manche pour Sergio, en tenant compte de ses
 * points EN SUSPENS avant cette manche (suspendedBefore) — reproduit
 * exactement la mécanique de engine.applyHandResultToScores pour un seul
 * joueur (voir ce fichier) : 0 copa efface tout suspens existant (coût 0,
 * activement recherché s'il y a un suspens à effacer) ; 1-9 copas réalise
 * tout suspens existant EN PLUS de ces copas (coût direct = suspendedBefore
 * + copasWon, potentiellement très élevé) ; 10 copas d'un coup n'ajoute
 * rien au score réel immédiat, seulement au suspens (coût pondéré par
 * SUSPENDED_RISK_WEIGHT plutôt que compté plein pot, voir plus haut).
 */
function evaluateFinalCost(suspendedBefore, copasWon) {
  let realDelta;
  let newSuspended;
  if (copasWon === TOTAL_COPAS) {
    newSuspended = suspendedBefore > 0 ? suspendedBefore + TOTAL_COPAS : TOTAL_COPAS;
    realDelta = 0;
  } else if (copasWon === 0) {
    newSuspended = 0;
    realDelta = 0;
  } else if (suspendedBefore > 0) {
    realDelta = suspendedBefore + copasWon;
    newSuspended = 0;
  } else {
    realDelta = copasWon;
    newSuspended = 0;
  }
  return realDelta + SUSPENDED_RISK_WEIGHT * newSuspended;
}

/**
 * Minorant valide du coût encore atteignable par Sergio à partir de cet
 * état simulé. Dès qu'un adversaire a déjà ramassé au moins une copa dans
 * cette manche simulée, Sergio ne peut plus jamais atteindre les 10 copas
 * (le "balayage complet" qui fait tout le sel de evaluateFinalCost) : le
 * reste de la manche ne peut alors plus que MAINTENIR ou AUGMENTER son coût
 * final par rapport à s'arrêter ici (evaluateFinalCost est strictement
 * croissant sur le reste de la plage 0-9 une fois 10 hors de portée), ce
 * qui rend evaluateFinalCost(ses copas actuelles) un minorant valide. Si en
 * revanche personne d'autre n'a encore pris de copa, le balayage complet
 * reste théoriquement possible (et moins coûteux que réaliser 6-9 copas
 * normalement) : seul 0 (le minimum global de evaluateFinalCost) reste un
 * minorant sûr dans ce cas.
 */
function nodeLowerBound(sim, sergioId, suspendedBefore) {
  let copasLostToOthers = 0;
  for (const p of sim.players) {
    if (p !== sergioId) copasLostToOthers += sim.tricksWonCopas[p];
  }
  if (copasLostToOthers > 0) {
    return evaluateFinalCost(suspendedBefore, sim.tricksWonCopas[sergioId]);
  }
  return 0;
}

/** Clé canonique d'un état simulé, pour la table de transposition. */
function canonicalStateKey(sim) {
  const handsPart = sim.players.map((p) => sim.hands[p].map(cardId).sort().join(',')).join('|');
  const drawPart = sim.drawPile.map(cardId).sort().join(',');
  const trickPart = sim.currentTrick.map((e) => `${e.playerId}:${cardId(e.card)}`).join(',');
  const copasPart = sim.players.map((p) => sim.tricksWonCopas[p]).join(',');
  return `${sim.turnIndex}|${sim.tricksPlayed}|${handsPart}|${drawPart}|${trickPart}|${copasPart}`;
}

/**
 * Ordonne les coups candidats de Sergio pour tenter d'abord celui que
 * l'heuristique simple aurait choisi : un bon coup trouvé tôt donne un
 * meilleur incumbent plus vite, donc un élagage plus efficace pour le reste
 * de la recherche (l'ordre n'affecte jamais la CORRECTION du résultat,
 * seulement la vitesse).
 */
function orderCandidatesForSearch(sim, sergioId, playable) {
  const hinted = chooseBasicBotCard(sim, sergioId);
  const hintedId = cardId(hinted);
  const rest = playable.filter((c) => cardId(c) !== hintedId);
  return [hinted, ...rest];
}

/**
 * Cœur de la recherche exacte. Retourne { cost, card } — card n'a de sens
 * qu'aux nœuds où c'est le tour de Sergio (c'est la seule chose que
 * l'appelant de haut niveau lit réellement, voir tryExactEndgameSearch).
 * Lève SEARCH_TIMEOUT (jamais une vraie exception JS) si le budget de temps
 * est dépassé en cours de route, pour que l'appelant puisse se replier
 * proprement sur le lookahead à 2 plis sans laisser un calcul à moitié fait
 * influencer le choix.
 */
function search(sim, sergioId, suspendedBefore, incumbentBound, deadline, memo) {
  if (Date.now() > deadline) throw SEARCH_TIMEOUT;

  if (sim.finished) {
    return { cost: evaluateFinalCost(suspendedBefore, sim.tricksWonCopas[sergioId]) };
  }

  const lb = nodeLowerBound(sim, sergioId, suspendedBefore);
  if (lb >= incumbentBound) return { cost: lb }; // coupé : valeur approchée, jamais mémoïsée (voir en-tête)

  const key = canonicalStateKey(sim);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const currentId = sim.players[sim.turnIndex];
  let out;

  if (currentId === sergioId) {
    const playable = getPlayableCards(sim, sergioId);
    const ordered = orderCandidatesForSearch(sim, sergioId, playable);
    let best = Infinity;
    let bestCard = ordered[0];
    for (const c of ordered) {
      if (best <= lb) break; // optimum de ce nœud déjà prouvé atteint, inutile de tester le reste
      const child = cloneHandForSimulation(sim);
      playCard(child, sergioId, c);
      const { cost } = search(child, sergioId, suspendedBefore, Math.min(best, incumbentBound), deadline, memo);
      if (cost < best) { best = cost; bestCard = c; }
    }
    out = { cost: best, card: bestCard };
  } else {
    // Politique fixe et déterministe pour les autres joueurs : un seul coup
    // possible à explorer, aucun branchement (voir en-tête de section).
    const c = chooseBasicBotCard(sim, currentId);
    playCard(sim, currentId, c);
    out = search(sim, sergioId, suspendedBefore, incumbentBound, deadline, memo);
  }

  memo.set(key, out);
  return out;
}

/**
 * Tente une recherche exacte jusqu'à la fin de la manche. Retourne la carte
 * choisie, ou null si le budget de temps a été dépassé (repli sur le
 * lookahead à 2 plis dans ce cas, voir chooseBotCard).
 */
function tryExactEndgameSearch(hand, playerId, suspendedBefore) {
  const deadline = Date.now() + EXACT_SEARCH_TIME_BUDGET_MS;
  const memo = new Map();
  const sim = cloneHandForSimulation(hand);
  try {
    const { card } = search(sim, playerId, suspendedBefore, Infinity, deadline, memo);
    return card || null;
  } catch (e) {
    if (e === SEARCH_TIMEOUT) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Repli : lookahead à 2 plis (comportement d'origine, inchangé)
// ---------------------------------------------------------------------------
//
// Utilisé pour les décisions prises tôt dans la manche (recherche exacte
// jusqu'au bout hors de portée, voir exactSearchMaxRemainingTricks) et
// comme filet de sécurité si la recherche exacte dépasse son budget de
// temps. Pour chaque coup légal, simule jusqu'à LOOKAHEAD_TRICKS plis
// complets supplémentaires avec l'heuristique simple pour tous les joueurs
// (Sergio y compris, pour ses propres coups suivants dans cette fenêtre),
// et retient le coup qui minimise les copas que Sergio récolte sur cette
// fenêtre. Volontairement borné à 2 plis plutôt qu'une simulation jusqu'à
// la fin de la manche : au-delà, prédire le comportement d'un joueur humain
// via une heuristique fixe devient de moins en moins fiable, alors qu'à
// aussi court terme l'éventail des coups "raisonnables" reste étroit quel
// que soit le joueur en face.

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

function evaluateCandidate(hand, playerId, candidateCard) {
  const sim = cloneHandForSimulation(hand);

  playCard(sim, playerId, candidateCard);

  let cost = 0;
  let tricksResolved = 0;
  let guard = 0;

  while (!sim.finished && tricksResolved < LOOKAHEAD_TRICKS && guard < 60) {
    guard += 1;
    const tricksPlayedBefore = sim.tricksPlayed;
    const currentId = sim.players[sim.turnIndex];
    const copasBeforePlay = sim.tricksWonCopas[playerId];
    playCard(sim, currentId, chooseBasicBotCard(sim, currentId));

    if (sim.tricksPlayed > tricksPlayedBefore) {
      const copasThisTrick = sim.tricksWonCopas[playerId] - copasBeforePlay;
      const weight = tricksResolved === 0 ? 1 : SECOND_TRICK_WEIGHT;
      cost += copasThisTrick * weight;
      tricksResolved += 1;
    }
  }

  return cost;
}

function chooseByLookaheadHeuristic(hand, playerId, scores) {
  const playable = getPlayableCards(hand, playerId);
  const risk = computeRiskProfile(playerId, scores);

  let bestCard = playable[0];
  let bestCost = Infinity;
  for (const candidate of playable) {
    const cost = evaluateCandidate(hand, playerId, candidate);
    const weighted = risk.cautious ? cost * 1.5 : cost;
    if (weighted < bestCost) {
      bestCost = weighted;
      bestCard = candidate;
    }
  }
  return bestCard;
}

// ---------------------------------------------------------------------------

/**
 * Choisit une carte à jouer pour Sergio, parmi les coups légaux uniquement.
 * scores (optionnel) = room.scores côté serveur, pour connaître ses points
 * en suspens actuels et adapter l'évaluation en conséquence (voir
 * evaluateFinalCost).
 */
function chooseBotCard(hand, playerId, scores) {
  const playable = getPlayableCards(hand, playerId);
  if (playable.length === 1) return playable[0];

  const suspendedBefore = (scores && scores[playerId] && scores[playerId].suspended) || 0;

  if (estimateRemainingTricks(hand) <= exactSearchMaxRemainingTricks(hand.numPlayers)) {
    const exactChoice = tryExactEndgameSearch(hand, playerId, suspendedBefore);
    if (exactChoice) return exactChoice;
    // Budget de temps dépassé : repli ci-dessous.
  }

  return chooseByLookaheadHeuristic(hand, playerId, scores);
}

module.exports = { chooseBotCard };
