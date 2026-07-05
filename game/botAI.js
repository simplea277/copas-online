// ============================================================================
// Décision de jeu des bots — heuristique simple, aucun réseau/état global.
// N'utilise que engine.getPlayableCards (jamais un coup illégal) : respecte
// donc automatiquement l'obligation de couleur, la phase spéciale à 3
// joueurs (pas d'obligation, copas interdites sauf main 100% copas), etc.
// ============================================================================

const { getPlayableCards } = require('./engine');

function highestCard(cards) {
  return cards.reduce((best, c) => (c.strength > best.strength ? c : best), cards[0]);
}
function lowestCard(cards) {
  return cards.reduce((best, c) => (c.strength < best.strength ? c : best), cards[0]);
}

function countBySuit(cards) {
  const counts = {};
  for (const c of cards) counts[c.suit] = (counts[c.suit] || 0) + 1;
  return counts;
}

/**
 * Choisit une carte à jouer pour un bot, parmi les coups légaux uniquement.
 */
function chooseBotCard(hand, playerId) {
  const playable = getPlayableCards(hand, playerId);
  if (playable.length === 1) return playable[0];

  const opening = hand.currentTrick.length === 0;

  if (opening) {
    // Ouvre le pli : privilégie une carte sûre (pas une copa si possible),
    // plutôt basse, dans la couleur où il a le plus de cartes en main (garde
    // les couleurs courtes intactes pour plus tard).
    const nonCopas = playable.filter((c) => c.suit !== 'copas');
    const pool = nonCopas.length > 0 ? nonCopas : playable;
    const suitCounts = countBySuit(hand.hands[playerId]);
    let bestSuit = pool[0].suit;
    let bestCount = -1;
    for (const c of pool) {
      const cnt = suitCounts[c.suit] || 0;
      if (cnt > bestCount) { bestCount = cnt; bestSuit = c.suit; }
    }
    return lowestCard(pool.filter((c) => c.suit === bestSuit));
  }

  const leadSuit = hand.currentTrick[0].card.suit;
  const hasLeadSuit = playable.some((c) => c.suit === leadSuit);

  if (!hasLeadSuit) {
    // Main libre (ne peut pas suivre) : se débarrasse en priorité de ses
    // copas les plus dangereuses (les plus hautes), sur un pli qu'il ne peut
    // de toute façon pas gagner.
    const copasInHand = playable.filter((c) => c.suit === 'copas');
    return copasInHand.length > 0 ? highestCard(copasInHand) : highestCard(playable);
  }

  // Doit suivre la couleur demandée.
  const sameSuitCards = playable.filter((c) => c.suit === leadSuit);
  const currentWinner = hand.currentTrick.reduce(
    (best, e) => (e.card.suit === leadSuit && e.card.strength > best.card.strength ? e : best),
    hand.currentTrick[0]
  );
  const trickHasCopas = hand.currentTrick.some((e) => e.card.suit === 'copas');
  const belowWinner = sameSuitCards.filter((c) => c.strength < currentWinner.card.strength);
  const aboveWinner = sameSuitCards.filter((c) => c.strength > currentWinner.card.strength);

  if (trickHasCopas) {
    // Pli dangereux : évite de gagner si possible, en se débarrassant de la
    // carte la plus haute qui reste sous la carte gagnante actuelle.
    if (belowWinner.length > 0) return highestCard(belowWinner);
    // Forcé de gagner (toutes ses cartes de la couleur dépassent le
    // gagnant actuel) : autant le faire avec la plus faible d'entre elles.
    return lowestCard(sameSuitCards);
  }

  // Pli sans danger (aucune copa) : gagner ne coûte rien, autant le faire
  // s'il le peut ; sinon défausse la plus faible, garde les fortes pour plus tard.
  if (aboveWinner.length > 0) return highestCard(aboveWinner);
  return lowestCard(sameSuitCards);
}

module.exports = { chooseBotCard };
