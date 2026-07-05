const assert = require('assert');
const engine = require('./engine');
const { chooseBotCard } = require('./botAI');

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
test('Ouverture de pli : évite les copas si possible, joue bas dans sa couleur la plus fournie', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [
    card('copas', 'as'),      // seule couleur à éviter à l'ouverture
    card('ouros', '6'),
    card('ouros', '2'),
    card('paus', 'rei'),
  ];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  const choice = chooseBotCard(hand, 'A');
  assert.strictEqual(choice.suit, 'ouros', 'devrait jouer dans ouros (2 cartes) plutôt que paus (1 carte) ou copas');
  assert.strictEqual(choice.rank, '2', 'devrait jouer la plus basse carte de cette couleur');
});

test('Ouverture de pli : main 100% copas, forcé d\'en jouer une (la plus basse)', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [card('copas', 'as'), card('copas', '2'), card('copas', 'rei')];
  hand.turnIndex = 0;
  hand.currentTrick = [];

  const choice = chooseBotCard(hand, 'A');
  assert.strictEqual(choice.suit, 'copas');
  assert.strictEqual(choice.rank, '2');
});

test('Doit suivre, pli dangereux (copas dedans) : évite de gagner en jouant juste sous le gagnant actuel', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.B = [card('ouros', '6'), card('ouros', 'rei'), card('ouros', '2')];
  hand.currentTrick = [
    { playerId: 'A', card: card('ouros', 'dama') }, // gagnant actuel : dama (force 6)
    { playerId: 'D', card: card('copas', 'as') },    // copas dans le pli -> dangereux
  ];
  hand.turnIndex = 1;

  const choice = chooseBotCard(hand, 'B');
  // Sous "dama" (force 6) dans ouros, B a "6" (force 4) et "2" (force 0) ; "rei" (force 7) gagnerait.
  assert.strictEqual(choice.suit, 'ouros');
  assert.strictEqual(choice.rank, '6', 'doit jouer la plus haute carte qui reste sous le gagnant actuel');
});

test('Doit suivre, pli dangereux, forcé de gagner (aucune carte sous le gagnant) : joue la plus faible possible', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.B = [card('ouros', 'rei'), card('ouros', 'as')];
  hand.currentTrick = [
    { playerId: 'A', card: card('ouros', '2') },
    { playerId: 'D', card: card('copas', 'as') }, // dangereux
  ];
  hand.turnIndex = 1;

  const choice = chooseBotCard(hand, 'B');
  assert.strictEqual(choice.rank, 'rei', 'gagne quand même, mais avec la carte la plus faible des deux');
});

test('Doit suivre, pli sans danger (aucune copa) : peut jouer pour gagner', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.B = [card('ouros', '6'), card('ouros', 'rei'), card('ouros', '2')];
  hand.currentTrick = [
    { playerId: 'A', card: card('ouros', 'dama') }, // gagnant actuel, pas de copa dans le pli
  ];
  hand.turnIndex = 1;

  const choice = chooseBotCard(hand, 'B');
  assert.strictEqual(choice.rank, 'rei', 'seule carte qui gagne, aucun risque à le faire');
});

test('Doit suivre, pli sans danger, ne peut pas gagner : défausse la plus faible', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.B = [card('ouros', '6'), card('ouros', '2')];
  hand.currentTrick = [
    { playerId: 'A', card: card('ouros', 'as') }, // personne ne peut battre l'as
  ];
  hand.turnIndex = 1;

  const choice = chooseBotCard(hand, 'B');
  assert.strictEqual(choice.rank, '2', 'ne peut pas gagner, garde la carte forte pour plus tard');
});

test('Ne peut pas suivre (main libre) : défausse la copa la plus haute en priorité', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.B = [card('copas', 'rei'), card('copas', '3'), card('paus', '4')];
  hand.currentTrick = [{ playerId: 'A', card: card('ouros', '6') }];
  hand.turnIndex = 1;

  const choice = chooseBotCard(hand, 'B');
  assert.strictEqual(choice.suit, 'copas');
  assert.strictEqual(choice.rank, 'rei', 'se débarrasse de la copa la plus dangereuse (la plus haute)');
});

test('Ne peut pas suivre, aucune copa en main : défausse la carte la plus haute', () => {
  const players = ['A', 'B', 'C', 'D'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.B = [card('paus', '4'), card('paus', 'as')];
  hand.currentTrick = [{ playerId: 'A', card: card('ouros', '6') }];
  hand.turnIndex = 1;

  const choice = chooseBotCard(hand, 'B');
  assert.strictEqual(choice.rank, 'as');
});

test('Phase spéciale à 3 joueurs : le bot ne joue jamais une copa tant qu\'une autre carte est légale', () => {
  const players = ['A', 'B', 'C'];
  const hand = engine.dealNewHand(players, 0);
  hand.hands.A = [card('copas', 'as'), card('ouros', '2')];
  hand.turnIndex = 0;
  hand.currentTrick = [];
  assert.ok(engine.isSpecialThreePlayerPhase(hand));

  const choice = chooseBotCard(hand, 'A');
  assert.strictEqual(choice.suit, 'ouros', 'ne doit pas jouer copas alors qu\'une autre carte légale existe');
});

// ---------------------------------------------------------------------------
test('Simulation : un bot ne joue jamais un coup illégal sur des manches complètes (4 joueurs, x20)', () => {
  for (let i = 0; i < 20; i++) {
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
        `coup illégal choisi par le bot : ${JSON.stringify(choice)} (jouables: ${JSON.stringify(playable)})`
      );
      const res = engine.playCard(hand, currentId, choice);
      assert.ok(res.ok, res.error);
    }
    assert.ok(hand.finished, 'la manche doit se terminer normalement');
    const totalCopas = Object.values(hand.tricksWonCopas).reduce((a, b) => a + b, 0);
    assert.strictEqual(totalCopas, 10, 'les 10 copas doivent toutes être comptabilisées');
  }
});

test('Simulation : un bot ne joue jamais un coup illégal sur des manches complètes (3 joueurs, x20)', () => {
  for (let i = 0; i < 20; i++) {
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
        `coup illégal choisi par le bot : ${JSON.stringify(choice)} (jouables: ${JSON.stringify(playable)})`
      );
      const res = engine.playCard(hand, currentId, choice);
      assert.ok(res.ok, res.error);
    }
    assert.ok(hand.finished, 'la manche doit se terminer normalement');
    const totalCopas = Object.values(hand.tricksWonCopas).reduce((a, b) => a + b, 0);
    assert.strictEqual(totalCopas, 10, 'les 10 copas doivent toutes être comptabilisées');
  }
});

test('Simulation : un bot ne ramasse pas systématiquement toutes les copas (variance sur 30 manches)', () => {
  const copasCounts = [];
  for (let i = 0; i < 30; i++) {
    const players = ['A', 'B', 'C', 'D'];
    let hand = engine.dealNewHand(players, i % 4);
    let guard = 0;
    while (!hand.finished && guard < 200) {
      guard += 1;
      const currentId = hand.players[hand.turnIndex];
      const choice = chooseBotCard(hand, currentId);
      engine.playCard(hand, currentId, choice);
    }
    copasCounts.push(hand.tricksWonCopas.A);
  }
  const allSame = copasCounts.every((c) => c === copasCounts[0]);
  const anyTookAll10 = copasCounts.filter((c) => c === 10).length;
  assert.ok(!allSame, 'les copas ramassées par un même joueur devraient varier selon les mains distribuées');
  assert.ok(anyTookAll10 < copasCounts.length, 'ne devrait pas systématiquement ramasser les 10 copas');
});

console.log('\nTerminé.');
