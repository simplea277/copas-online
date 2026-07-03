const assert = require('assert');
const engine = require('./engine');

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

// ---------------------------------------------------------------------------
test('Deck de 40 cartes à 4 joueurs, 39 à 3 joueurs (sans le 2 d\'espadas)', () => {
  assert.strictEqual(engine.createDeck(4).length, 40);
  const deck3 = engine.createDeck(3);
  assert.strictEqual(deck3.length, 39);
  assert.ok(!deck3.some((c) => c.suit === 'espadas' && c.rank === '2'));
});

test('Distribution à 4 joueurs : 10 cartes chacun, pas de pioche', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  players.forEach((p) => assert.strictEqual(hand.hands[p].length, 10));
  assert.strictEqual(hand.drawPile.length, 0);
});

test('Distribution à 3 joueurs : 10 cartes chacun + pioche de 9', () => {
  const players = ['A', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  players.forEach((p) => assert.strictEqual(hand.hands[p].length, 10));
  assert.strictEqual(hand.drawPile.length, 9);
});

test('Premier joueur = à gauche du donneur', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 1); // donneur = B (index 1)
  assert.strictEqual(hand.turnIndex, 2); // C doit commencer
});

// ---------------------------------------------------------------------------
test('4 joueurs : obligation de suivre la couleur', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  // On force artificiellement les mains pour un test déterministe
  hand.hands.A = [{ suit: 'ouros', rank: 'as', strength: 9 }, { suit: 'paus', rank: '2', strength: 0 }];
  hand.hands.B = [{ suit: 'ouros', rank: '2', strength: 0 }, { suit: 'paus', rank: '3', strength: 1 }];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  let res = engine.playCard(hand, 'A', { suit: 'ouros', rank: 'as' });
  assert.ok(res.ok);

  // B doit suivre à ouros, il en a un -> jouer paus doit être refusé
  const playable = engine.getPlayableCards(hand, 'B');
  assert.strictEqual(playable.length, 1);
  assert.strictEqual(playable[0].suit, 'ouros');

  const bad = engine.playCard(hand, 'B', { suit: 'paus', rank: '3' });
  assert.strictEqual(bad.ok, false);
});

test('Le gagnant du pli est la plus forte carte de la couleur demandée', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [{ suit: 'ouros', rank: '2', strength: 0 }];
  hand.hands.B = [{ suit: 'paus', rank: 'as', strength: 9 }]; // ne suit pas -> ne peut pas gagner
  hand.hands.C = [{ suit: 'ouros', rank: 'as', strength: 9 }]; // suit et plus fort -> gagne
  hand.hands.D = [{ suit: 'ouros', rank: '7', strength: 8 }];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  engine.playCard(hand, 'A', hand.hands.A[0]);
  engine.playCard(hand, 'B', { suit: 'paus', rank: 'as' });
  engine.playCard(hand, 'C', { suit: 'ouros', rank: 'as' });
  const final = engine.playCard(hand, 'D', { suit: 'ouros', rank: '7' });

  assert.strictEqual(final.winnerId, 'C');
});

test('3 joueurs, phase spéciale (3 premiers plis) : interdiction de copas', () => {
  const players = ['A', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [{ suit: 'copas', rank: 'as', strength: 9 }, { suit: 'paus', rank: '2', strength: 0 }];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  const playable = engine.getPlayableCards(hand, 'A');
  assert.ok(!playable.some((c) => c.suit === 'copas'), 'copas ne doit pas être jouable');

  const res = engine.playCard(hand, 'A', { suit: 'copas', rank: 'as' });
  assert.strictEqual(res.ok, false);
});

test('3 joueurs, phase spéciale : pas d\'obligation de couleur', () => {
  const players = ['A', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [{ suit: 'ouros', rank: 'as', strength: 9 }];
  hand.hands.B = [{ suit: 'paus', rank: '2', strength: 0 }, { suit: 'ouros', rank: '2', strength: 0 }];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  engine.playCard(hand, 'A', hand.hands.A[0]);
  // B a de l'ouros en main mais devrait pouvoir jouer paus quand même (pas d'obligation)
  const res = engine.playCard(hand, 'B', { suit: 'paus', rank: '2' });
  assert.strictEqual(res.ok, true);
});

test('3 joueurs : pioche après chaque pli des 3 premiers, gagnant pioche en 1er', () => {
  const players = ['A', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [{ suit: 'ouros', rank: '2', strength: 0 }];
  hand.hands.B = [{ suit: 'ouros', rank: '3', strength: 1 }];
  hand.hands.C = [{ suit: 'ouros', rank: 'as', strength: 9 }]; // C gagne
  hand.drawPile = [
    { suit: 'paus', rank: '2', strength: 0 },
    { suit: 'paus', rank: '3', strength: 1 },
    { suit: 'paus', rank: '4', strength: 2 },
  ];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  engine.playCard(hand, 'A', hand.hands.A[0]);
  engine.playCard(hand, 'B', hand.hands.B[0]);
  const res = engine.playCard(hand, 'C', { suit: 'ouros', rank: 'as' });

  assert.strictEqual(res.winnerId, 'C');
  // C pioche en premier (dernière carte de la pile), puis A, puis B
  assert.strictEqual(hand.hands.C.length, 1);
  assert.strictEqual(hand.hands.A.length, 1);
  assert.strictEqual(hand.hands.B.length, 1);
  assert.strictEqual(hand.drawPile.length, 0);
  assert.strictEqual(hand.turnIndex, hand.players.indexOf('C')); // le gagnant relance
});

test('3 joueurs : après le 3e pli, plus de restriction (couleur obligatoire, copas autorisées)', () => {
  const players = ['A', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  hand.tricksPlayed = 3;
  hand.drawPile = [];
  hand.hands.A = [{ suit: 'copas', rank: 'as', strength: 9 }];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  const playable = engine.getPlayableCards(hand, 'A');
  assert.ok(playable.some((c) => c.suit === 'copas'), 'copas doit être jouable après la phase spéciale');
});

function playFullHand(players, dealerIndex = 0) {
  const hand = engine.dealNewHand(players, dealerIndex);
  let guard = 0;
  while (!hand.finished) {
    const playerId = hand.players[hand.turnIndex];
    const playable = engine.getPlayableCards(hand, playerId);
    const res = engine.playCard(hand, playerId, playable[0]);
    assert.ok(res.ok, res.error);
    guard += 1;
    if (guard > 1000) throw new Error('Boucle infinie suspectée dans la simulation.');
  }
  return hand;
}

test('Simulation complète d\'une manche à 3 joueurs : toutes les mains vidées, 13 plis, 10 copas au total', () => {
  const players = ['A', 'B', 'C'];
  const hand = playFullHand(players);
  players.forEach((p) => assert.strictEqual(hand.hands[p].length, 0));
  assert.strictEqual(hand.drawPile.length, 0);
  assert.strictEqual(hand.tricksPlayed, 13); // 39 cartes / 3 joueurs
  const totalCopas = Object.values(hand.tricksWonCopas).reduce((a, b) => a + b, 0);
  assert.strictEqual(totalCopas, 10);
});

test('Simulation complète d\'une manche à 4 joueurs : toutes les mains vidées, 10 plis, 10 copas au total', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = playFullHand(players);
  players.forEach((p) => assert.strictEqual(hand.hands[p].length, 0));
  assert.strictEqual(hand.tricksPlayed, 10); // 40 cartes / 4 joueurs
  const totalCopas = Object.values(hand.tricksWonCopas).reduce((a, b) => a + b, 0);
  assert.strictEqual(totalCopas, 10);
});

// ---------------------------------------------------------------------------
test('Score : 0 copa ramassée ne change rien si pas de suspens', () => {
  const scores = engine.createInitialScores(['A', 'B']);
  engine.applyHandResultToScores(scores, { A: 0, B: 3 }, ['A', 'B']);
  assert.strictEqual(scores.A.real, 0);
  assert.strictEqual(scores.A.suspended, 0);
  assert.strictEqual(scores.B.real, 3);
});

test('Score : prendre les 10 copas met 10 points en suspens (pas réels)', () => {
  const scores = engine.createInitialScores(['A']);
  engine.applyHandResultToScores(scores, { A: 10 }, ['A']);
  assert.strictEqual(scores.A.real, 0);
  assert.strictEqual(scores.A.suspended, 10);
});

test('Score : 0 copa après un 10 en suspens efface le suspens', () => {
  const scores = engine.createInitialScores(['A']);
  scores.A.suspended = 10;
  engine.applyHandResultToScores(scores, { A: 0 }, ['A']);
  assert.strictEqual(scores.A.real, 0);
  assert.strictEqual(scores.A.suspended, 0);
});

test('Score : 1-9 copas après un 10 en suspens réalise le suspens + ajoute les copas', () => {
  const scores = engine.createInitialScores(['A']);
  scores.A.suspended = 10;
  engine.applyHandResultToScores(scores, { A: 4 }, ['A']);
  assert.strictEqual(scores.A.real, 14);
  assert.strictEqual(scores.A.suspended, 0);
});

test('Score : reprendre 10 après un 10 en suspens cumule à 20 en suspens', () => {
  const scores = engine.createInitialScores(['A']);
  scores.A.suspended = 10;
  engine.applyHandResultToScores(scores, { A: 10 }, ['A']);
  assert.strictEqual(scores.A.real, 0);
  assert.strictEqual(scores.A.suspended, 20);
});

test('Score : fin de partie déclenchée à 30 points réels', () => {
  const scores = engine.createInitialScores(['A', 'B']);
  scores.A.real = 30;
  const over = engine.checkGameOver(scores);
  assert.deepStrictEqual(over, ['A']);
});

test('Score : pas de fin de partie en dessous de 30', () => {
  const scores = engine.createInitialScores(['A', 'B']);
  scores.A.real = 29;
  assert.strictEqual(engine.checkGameOver(scores), null);
});

console.log('\nTerminé.');
