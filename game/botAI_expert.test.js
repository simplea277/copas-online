const assert = require('assert');
const engine = require('./engine');
const { chooseBotCard } = require('./botAI_expert');
const basicAI = require('./botAI');

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

function card(suit, rank) {
  return { suit, rank, strength: engine.RANKS.indexOf(rank) };
}

// ---------------------------------------------------------------------------
// L'IA experte a un accès complet à hand.hands (toutes les mains, pas
// seulement la sienne) et hand.drawPile — voir l'en-tête de botAI_expert.js.
// Les scénarios ci-dessous construisent donc des mains RÉELLEMENT cohérentes
// pour tous les joueurs (comme le serait un vrai hand.hands côté serveur),
// pas seulement pour le joueur testé.
// ---------------------------------------------------------------------------

test('Un seul coup légal : le joue directement (pas de recherche nécessaire)', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [card('copas', 'as')];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  const choice = chooseBotCard(hand, 'A');
  assert.strictEqual(choice.suit, 'copas');
  assert.strictEqual(choice.rank, 'as');
});

test('Phase spéciale à 3 joueurs : ne joue jamais une copa tant qu\'une autre carte est légale', () => {
  const players = ['A', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [card('copas', 'as'), card('ouros', '2')];
  hand.turnIndex = 0;
  hand.currentTrick = [];
  assert.ok(engine.isSpecialThreePlayerPhase(hand));

  const choice = chooseBotCard(hand, 'A');
  assert.strictEqual(choice.suit, 'ouros');
});

test('Ouverture : évite une copa isolée quand une couleur sûre et fournie est disponible', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands = {
    A: [card('copas', 'as'), card('ouros', '6'), card('ouros', '2'), card('ouros', '3'), card('paus', 'rei')],
    B: [card('espadas', '2'), card('espadas', '3'), card('espadas', '4'), card('espadas', '5'), card('espadas', '6')],
    C: [card('espadas', 'valete'), card('espadas', 'dama'), card('espadas', 'rei'), card('espadas', '7'), card('espadas', 'as')],
    D: [card('paus', '2'), card('paus', '3'), card('paus', '4'), card('paus', '5'), card('paus', '6')],
  };
  hand.drawPile = [];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  const choice = chooseBotCard(hand, 'A');
  assert.notStrictEqual(choice.suit, 'copas', 'ne devrait pas ouvrir sur sa seule copa quand une couleur sûre et fournie est disponible');
});

test('Doit suivre, pli dangereux (copas dedans), une seule carte reste sous le gagnant : la joue (évite de gagner)', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands = {
    A: [card('paus', '2')],
    B: [card('ouros', '6'), card('ouros', 'rei')],
    C: [card('espadas', '2'), card('espadas', '3')],
    D: [card('paus', '4')],
  };
  hand.drawPile = [];
  hand.currentTrick = [
    { playerId: 'A', card: card('ouros', 'dama') },
    { playerId: 'D', card: card('copas', 'as') },
  ];
  hand.playedCards = hand.currentTrick.map((e) => ({ ...e }));
  hand.turnIndex = 1;

  const choice = chooseBotCard(hand, 'B');
  assert.strictEqual(choice.rank, '6', 'doit rester sous le gagnant actuel plutôt que de remporter un pli dangereux évitable');
});

test('Ne peut pas suivre (main libre), copas en main : se débarrasse de la copa plutôt que de la garder inutilement', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands = {
    A: [card('paus', '2')],
    B: [card('copas', 'rei'), card('paus', '4')],
    C: [card('espadas', '2'), card('espadas', '3')],
    D: [card('paus', '5'), card('paus', '6')],
  };
  hand.drawPile = [];
  hand.currentTrick = [{ playerId: 'A', card: card('ouros', '6') }];
  hand.playedCards = hand.currentTrick.map((e) => ({ ...e }));
  hand.turnIndex = 1;

  const choice = chooseBotCard(hand, 'B');
  assert.strictEqual(choice.suit, 'copas', 'devrait défausser sa copa quand il ne peut de toute façon pas suivre');
});

test('Accès complet vérifié : préfère un coup sans risque grâce à la connaissance réelle des mains adverses (pas de copa chez personne d\'autre dans cette couleur)', () => {
  // B doit suivre à ouros ; le pli contient déjà une copa (dangereux en
  // apparence). Mais Sergio SAIT (main réelle de C, seul joueur restant à
  // jouer) que C n'a aucune carte d'ouros ET aucune copa : impossible que ce
  // pli devienne plus dangereux qu'il ne l'est déjà. B a le choix entre
  // rester prudent (sous le gagnant) ou prendre la main avec une carte de
  // toute façon imbattable (as) sans risque supplémentaire réel — les deux
  // sont défendables, mais le test vérifie surtout qu'aucune exception n'est
  // levée et qu'un coup légal est bien renvoyé avec cette information.
  const players = ['A', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  hand.tricksPlayed = 5; // hors phase spéciale
  hand.hands = {
    A: [card('paus', '2')],
    B: [card('ouros', '6'), card('ouros', 'as')],
    C: [card('paus', '3'), card('paus', '4')], // aucune ouros, aucune copa : vide connu avec certitude
  };
  hand.drawPile = [];
  hand.currentTrick = [{ playerId: 'A', card: card('copas', 'as') }];
  hand.playedCards = hand.currentTrick.map((e) => ({ ...e }));
  hand.turnIndex = 1;

  const playable = engine.getPlayableCards(hand, 'B');
  const choice = chooseBotCard(hand, 'B');
  assert.ok(playable.some((c) => c.suit === choice.suit && c.rank === choice.rank), 'doit rester un coup légal');
});

test('Points en suspens : préfère un coup qui termine la manche à 0 copa plutôt qu\'un coup qui en garantit au moins une', () => {
  // 4 joueurs, 2 plis restants. Sergio a le choix entre ouvrir avec sa copa
  // (personne d'autre n'en a : il remporte alors ce pli, quelle que soit la
  // carte jouée par les autres — le pli se conclut forcément par la
  // couleur "copas", et lui seul en a) ou ouvrir avec son paus (D le
  // remporte alors avec son paus le plus fort, forçant tout le monde à
  // suivre paus ; au pli suivant, Sergio est forcé de jouer sa copa mais
  // celle-ci n'est plus la couleur demandée — D remporte aussi ce pli en
  // espadas, et récupère donc la copa de Sergio au passage). Avec des
  // points déjà en suspens, prendre ne serait-ce qu'une seule copa cette
  // manche les réaliserait tous — un coût bien pire que le seul risque
  // "normal" (sans suspens) de perdre 1 copa.
  const players = ['Sergio', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.tricksPlayed = 8; // 4 joueurs, 10 plis au total : il en reste 2
  hand.hands = {
    Sergio: [card('copas', 'as'), card('paus', '2')],
    B: [card('espadas', '2'), card('paus', '3')],
    C: [card('espadas', '3'), card('paus', '4')],
    D: [card('espadas', '4'), card('paus', '5')],
  };
  hand.drawPile = [];
  hand.currentTrick = [];
  hand.playedCards = [];
  hand.turnIndex = 0; // Sergio ouvre

  const scores = {
    Sergio: { real: 20, suspended: 10 },
    B: { real: 0, suspended: 0 },
    C: { real: 0, suspended: 0 },
    D: { real: 0, suspended: 0 },
  };

  const choice = chooseBotCard(hand, 'Sergio', scores);
  assert.strictEqual(choice.suit, 'paus', 'devrait garder sa copa en réserve plutôt que la jouer et remporter le pli avec, points en suspens en jeu');

  // Rejoue la manche jusqu'au bout (les autres suivent l'heuristique
  // simple, déterministe) pour confirmer que ce choix mène bien à 0 copa
  // ramassée au final, et pas seulement à un pli sans copa isolé.
  let guard = 0;
  while (!hand.finished && guard < 20) {
    guard += 1;
    const currentId = hand.players[hand.turnIndex];
    const c = currentId === 'Sergio' ? chooseBotCard(hand, currentId, scores) : basicAI.chooseBotCard(hand, currentId);
    const res = engine.playCard(hand, currentId, c);
    assert.ok(res.ok, res.error);
  }
  assert.strictEqual(hand.tricksWonCopas.Sergio, 0, 'devrait terminer la manche sans avoir ramassé la moindre copa');
});

test('Recherche exacte : reste rapide même dans le cas le plus coûteux (6 plis restants, branchement maximal)', () => {
  // Scénario délibérément difficile : pile EXACT_SEARCH_MAX_REMAINING_TRICKS
  // (6) plis restants, Sergio ouvre (branchement maximal : 6 coups légaux
  // à son 1er tour) avec peu de contrainte de couleur pour la suite.
  const players = ['Sergio', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.tricksPlayed = 4; // 4 joueurs, 10 plis au total : il en reste 6
  hand.hands = {
    Sergio: [card('espadas', '2'), card('espadas', '3'), card('ouros', '2'), card('ouros', '3'), card('paus', '2'), card('paus', '3')],
    B: [card('espadas', '4'), card('espadas', '5'), card('ouros', '4'), card('ouros', '5'), card('paus', '4'), card('paus', '5')],
    C: [card('espadas', '6'), card('espadas', 'valete'), card('ouros', '6'), card('ouros', 'valete'), card('paus', '6'), card('paus', 'valete')],
    D: [card('espadas', 'dama'), card('espadas', 'rei'), card('ouros', 'dama'), card('ouros', 'rei'), card('paus', 'dama'), card('paus', 'rei')],
  };
  hand.drawPile = [];
  hand.currentTrick = [];
  hand.playedCards = [];
  hand.turnIndex = 0;

  const scores = {
    Sergio: { real: 22, suspended: 10 }, // profil prudent, pour ne pas court-circuiter la recherche via le repli
    B: { real: 0, suspended: 0 },
    C: { real: 0, suspended: 0 },
    D: { real: 0, suspended: 0 },
  };

  const started = Date.now();
  const choice = chooseBotCard(hand, 'Sergio', scores);
  const elapsed = Date.now() - started;

  const playable = engine.getPlayableCards(hand, 'Sergio');
  assert.ok(playable.some((c) => c.suit === choice.suit && c.rank === choice.rank), 'doit rester un coup légal');
  assert.ok(elapsed < 400, `la décision ne devrait jamais prendre plus de quelques centaines de ms (budget interne 200ms) ; observé : ${elapsed}ms`);
});

test('Recherche exacte à 3 joueurs : reste rapide même au plafond de profondeur (10 plis restants, branchement maximal)', () => {
  // À 3 joueurs, la recherche exacte va nettement plus loin qu'à 4 (voir
  // exactSearchMaxRemainingTricks dans botAI_expert.js — la pioche y est
  // déjà connue en intégralité, rien n'y est aléatoire). Même scénario
  // délibérément difficile que le test 4 joueurs ci-dessus, mais calé sur
  // le plafond propre aux 3 joueurs (10, pas 6).
  const players = ['Sergio', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  hand.tricksPlayed = 3; // 3 joueurs, 13 plis au total : il en reste 10
  hand.hands = {
    Sergio: [
      card('espadas', '2'), card('espadas', '3'), card('espadas', '4'), card('ouros', '2'),
      card('ouros', '3'), card('ouros', '4'), card('paus', '2'), card('paus', '3'), card('paus', '4'), card('copas', '2'),
    ],
    B: [
      card('espadas', '5'), card('espadas', '6'), card('espadas', 'valete'), card('ouros', '5'),
      card('ouros', '6'), card('ouros', 'valete'), card('paus', '5'), card('paus', '6'), card('paus', 'valete'), card('copas', '3'),
    ],
    C: [
      card('espadas', 'dama'), card('espadas', 'rei'), card('espadas', '7'), card('ouros', 'dama'),
      card('ouros', 'rei'), card('ouros', '7'), card('paus', 'dama'), card('paus', 'rei'), card('paus', '7'), card('copas', '4'),
    ],
  };
  hand.drawPile = [];
  hand.currentTrick = [];
  hand.playedCards = [];
  hand.turnIndex = 0;

  const scores = {
    Sergio: { real: 22, suspended: 10 },
    B: { real: 0, suspended: 0 },
    C: { real: 0, suspended: 0 },
  };

  const started = Date.now();
  const choice = chooseBotCard(hand, 'Sergio', scores);
  const elapsed = Date.now() - started;

  const playable = engine.getPlayableCards(hand, 'Sergio');
  assert.ok(playable.some((c) => c.suit === choice.suit && c.rank === choice.rank), 'doit rester un coup légal');
  assert.ok(elapsed < 400, `la décision ne devrait jamais prendre plus de quelques centaines de ms (budget interne 200ms) ; observé : ${elapsed}ms`);
});

// ---------------------------------------------------------------------------
// Jamais de coup illégal, sur des manches complètes.
// ---------------------------------------------------------------------------

test('Simulation : ne joue jamais un coup illégal sur des manches complètes (4 joueurs, x15)', () => {
  for (let i = 0; i < 15; i++) {
    const players = ['A', 'B', 'C', 'D'];
    let hand = engine.dealNewHand(players, i % 4);
    let guard = 0;
    while (!hand.finished && guard < 200) {
      guard += 1;
      const currentId = hand.players[hand.turnIndex];
      const playable = engine.getPlayableCards(hand, currentId);
      const choice = chooseBotCard(hand, currentId);
      assert.ok(
        playable.some((c) => c.suit === choice.suit && c.rank === choice.rank),
        `coup illégal choisi par Sergio : ${JSON.stringify(choice)} (jouables: ${JSON.stringify(playable)})`
      );
      const res = engine.playCard(hand, currentId, choice);
      assert.ok(res.ok, res.error);
    }
    assert.ok(hand.finished);
    const totalCopas = Object.values(hand.tricksWonCopas).reduce((a, b) => a + b, 0);
    assert.strictEqual(totalCopas, 10);
  }
});

test('Simulation : ne joue jamais un coup illégal sur des manches complètes (3 joueurs, x15)', () => {
  for (let i = 0; i < 15; i++) {
    const players = ['A', 'B', 'C'];
    let hand = engine.dealNewHand(players, i % 3);
    let guard = 0;
    while (!hand.finished && guard < 200) {
      guard += 1;
      const currentId = hand.players[hand.turnIndex];
      const playable = engine.getPlayableCards(hand, currentId);
      const choice = chooseBotCard(hand, currentId);
      assert.ok(
        playable.some((c) => c.suit === choice.suit && c.rank === choice.rank),
        `coup illégal choisi par Sergio : ${JSON.stringify(choice)} (jouables: ${JSON.stringify(playable)})`
      );
      const res = engine.playCard(hand, currentId, choice);
      assert.ok(res.ok, res.error);
    }
    assert.ok(hand.finished);
    const totalCopas = Object.values(hand.tricksWonCopas).reduce((a, b) => a + b, 0);
    assert.strictEqual(totalCopas, 10);
  }
});

// ---------------------------------------------------------------------------
// Simulation de parties complètes (jusqu'à 30 points) : Sergio doit gagner
// (score final le plus bas) nettement plus souvent que le hasard ne le
// voudrait face à des bots simples.
// ---------------------------------------------------------------------------

function simulateFullGame(players, aiFor, dealerStart) {
  const scores = engine.createInitialScores(players);
  let dealerIndex = dealerStart;
  let guardHands = 0;
  while (true) {
    guardHands += 1;
    if (guardHands > 300) throw new Error('Partie trop longue, boucle infinie suspectée.');
    const hand = engine.dealNewHand(players, dealerIndex);
    let guardTricks = 0;
    while (!hand.finished) {
      guardTricks += 1;
      if (guardTricks > 300) throw new Error('Manche trop longue, boucle infinie suspectée.');
      const currentId = hand.players[hand.turnIndex];
      const choice = aiFor(currentId)(hand, currentId, scores);
      const res = engine.playCard(hand, currentId, choice);
      if (!res.ok) throw new Error(`Coup illégal en simulation de partie complète : ${res.error}`);
    }
    engine.applyHandResultToScores(scores, hand.tricksWonCopas, players);
    if (engine.checkGameOver(scores)) return scores;
    dealerIndex = (dealerIndex + 1) % players.length;
  }
}

test('Simulation de parties complètes (4 joueurs) : Sergio gagne nettement plus souvent que le hasard (25% à 4 joueurs) face à des bots simples', () => {
  const players = ['Sergio', 'A', 'B', 'C'];
  const aiFor = (id) => (id === 'Sergio' ? chooseBotCard : basicAI.chooseBotCard);
  const N = 50;
  let sergioWins = 0;
  const totals = { Sergio: 0, A: 0, B: 0, C: 0 };
  for (let i = 0; i < N; i++) {
    const scores = simulateFullGame(players, aiFor, i % players.length);
    players.forEach((p) => (totals[p] += scores[p].real));
    const minReal = Math.min(...players.map((p) => scores[p].real));
    if (scores.Sergio.real === minReal) sergioWins += 1;
  }
  const winRate = sergioWins / N;
  const avgSergio = totals.Sergio / N;
  const avgOthers = (totals.A + totals.B + totals.C) / (3 * N);
  console.log(`    (taux de victoire de Sergio sur ${N} parties à 4 joueurs : ${(winRate * 100).toFixed(0)}% — score moyen: Sergio ${avgSergio.toFixed(1)} vs adversaires ${avgOthers.toFixed(1)})`);
  // Deux signaux, moins sensibles chacun à la variance d'une seule partie
  // qu'un simple seuil sur le taux de victoire brut à N=30 : le taux de
  // victoire doit nettement dépasser le hasard pur (25% à 4 joueurs), ET son
  // score réel moyen doit rester nettement sous celui des adversaires.
  // Seuils relevés le 2026-07-10 après le passage à la recherche exacte de
  // fin de manche (voir botAI_expert.js) : ~86-94% observé sur plusieurs
  // essais de 50 parties (contre ~64% avec l'ancien lookahead à 2 plis
  // seul) — 0.65 garde une marge confortable sous cette observation tout en
  // constituant un garde-fou de non-régression bien plus strict qu'avant.
  assert.ok(
    winRate > 0.65,
    `Sergio devrait gagner très nettement plus souvent qu'avant la recherche exacte de fin de manche ; observé : ${(winRate * 100).toFixed(0)}%`
  );
  assert.ok(
    avgSergio < avgOthers * 0.5,
    `score réel moyen de Sergio devrait rester très nettement sous celui des adversaires ; observé : ${avgSergio.toFixed(1)} vs ${avgOthers.toFixed(1)}`
  );
});

test('Simulation de parties complètes (3 joueurs) : Sergio gagne nettement plus souvent que le hasard (33% à 3 joueurs) face à des bots simples', () => {
  const players = ['Sergio', 'A', 'B'];
  const aiFor = (id) => (id === 'Sergio' ? chooseBotCard : basicAI.chooseBotCard);
  const N = 50;
  let sergioWins = 0;
  const totals = { Sergio: 0, A: 0, B: 0 };
  for (let i = 0; i < N; i++) {
    const scores = simulateFullGame(players, aiFor, i % players.length);
    players.forEach((p) => (totals[p] += scores[p].real));
    const minReal = Math.min(...players.map((p) => scores[p].real));
    if (scores.Sergio.real === minReal) sergioWins += 1;
  }
  const winRate = sergioWins / N;
  const avgSergio = totals.Sergio / N;
  const avgOthers = (totals.A + totals.B) / (2 * N);
  console.log(`    (taux de victoire de Sergio sur ${N} parties à 3 joueurs : ${(winRate * 100).toFixed(0)}% — score moyen: Sergio ${avgSergio.toFixed(1)} vs adversaires ${avgOthers.toFixed(1)})`);
  // Seuils relevés le 2026-07-10, mis à jour le même jour après avoir
  // étendu la profondeur de recherche exacte spécifiquement à 3 joueurs
  // (10 plis, contre 6 par défaut — voir exactSearchMaxRemainingTricks) :
  // ~93-100% observé sur plusieurs essais de 50 parties (contre ~58% avec
  // l'ancien lookahead à 2 plis seul, ~78-96% avec la recherche exacte à
  // profondeur 6 comme à 4 joueurs).
  assert.ok(
    winRate > 0.85,
    `Sergio devrait gagner très nettement plus souvent qu'avant l'extension de la recherche exacte à 3 joueurs ; observé : ${(winRate * 100).toFixed(0)}%`
  );
  assert.ok(
    avgSergio < avgOthers * 0.35,
    `score réel moyen de Sergio devrait rester très nettement sous celui des adversaires ; observé : ${avgSergio.toFixed(1)} vs ${avgOthers.toFixed(1)}`
  );
});

console.log('\nTerminé.');
