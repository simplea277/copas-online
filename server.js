// ============================================================================
// Serveur du jeu "Copas" — gère les salons (rooms), la connexion des joueurs
// et fait tourner le moteur de jeu (game/engine.js) en temps réel.
// ============================================================================

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const engine = require('./game/engine');
const botAI = require('./game/botAI');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
// État en mémoire de toutes les parties en cours.
// rooms: { [roomCode]: RoomState }
//
// Chaque joueur a deux identifiants distincts :
// - playerId : identité stable du siège (utilisée comme clé dans le moteur de
//   jeu — mains, scores — et diffusée à tous). Ne change jamais.
// - socketId : id de la connexion socket.io *actuelle*, qui change à chaque
//   reconnexion (rafraîchissement de page, coupure réseau...).
// sessionToken est un secret connu uniquement du joueur concerné, utilisé pour
// prouver son identité lors d'une reconnexion (voir "session:resume").
// ----------------------------------------------------------------------------
const rooms = {};

// Bots : des joueurs comme les autres dans room.players (isBot: true), sans
// socket réel (socketId/sessionToken null) — jamais de destinataire pour un
// emit direct, jamais de session à reprendre. Noms à thème (rangs des
// cartes), pour rester clairement distincts des pseudos suggérés côté client
// (Alan, Romane, Mika, Capu).
const BOT_NAMES = ['Bot Rei', 'Bot Dama', 'Bot Valete', 'Bot Ás'];
let botCounter = 0;

function makeBot() {
  botCounter += 1;
  return {
    playerId: `bot-${botCounter}`,
    socketId: null,
    sessionToken: null,
    name: BOT_NAMES[(botCounter - 1) % BOT_NAMES.length],
    connected: true,
    isBot: true,
  };
}

function hasAnyHuman(room) {
  return room.players.some((p) => !p.isBot);
}

// ----------------------------------------------------------------------------
// Estimation du temps d'animation cliente, pour ne jamais faire jouer un bot
// pendant qu'une animation connue (distribution, vol d'une carte posée,
// résolution de pli...) est encore visible à l'écran des joueurs humains.
// Le serveur ne connaît pas le DOM : ces constantes DOIVENT rester
// approximativement synchronisées avec les durées réelles définies côté
// client (public/client.js — STAGGER/FLIGHT/TRICK_ARRIVE_MS/etc.), mais une
// estimation raisonnable suffit, l'objectif étant juste d'éviter qu'un coup
// de bot ne démarre pendant qu'une animation en cours n'est pas terminée.
// ----------------------------------------------------------------------------
const DEAL_CARD_STAGGER_MS = 85;   // client.js: runCardsPhase STAGGER
const DEAL_CARD_FLIGHT_MS = 320;   // client.js: runCardsPhase FLIGHT
const DEAL_PILE_PACKETS = 4;       // client.js: runPilePhase PACKETS
const DEAL_PILE_STAGGER_MS = 90;   // client.js: runPilePhase STAGGER
const DEAL_PILE_FLIGHT_MS = 360;   // client.js: runPilePhase FLIGHT
const TRICK_ARRIVE_MS = 650;       // client.js: TRICK_ARRIVE_MS (vol d'une carte posée)
const TRICK_RESULT_DISPLAY_MS = 1400; // client.js: showResolvedTrick, délai avant flyResolvedTrickToPile
const TRICK_PILE_STAGGER_MS = 70;  // client.js: runTrickPileAnim STAGGER
const TRICK_PILE_FLIGHT_MS = 420;  // client.js: runTrickPileAnim FLIGHT
const DRAW_ANIM_STAGGER_MS = 180;  // client.js: runDrawAnimPhase STAGGER
const DRAW_ANIM_FLIGHT_MS = 512;   // client.js: runDrawAnimPhase FLIGHT

/** Durée estimée de l'animation de distribution d'une nouvelle manche. */
function dealAnimDurationMs(numPlayers, drawPileCount) {
  const cardsPhase = numPlayers * 10 * DEAL_CARD_STAGGER_MS + DEAL_CARD_FLIGHT_MS + 120;
  const pilePhase = (numPlayers === 3 && drawPileCount > 0)
    ? DEAL_PILE_PACKETS * DEAL_PILE_STAGGER_MS + DEAL_PILE_FLIGHT_MS + 150
    : 0;
  return cardsPhase + pilePhase;
}

/**
 * Durée estimée de la séquence déclenchée par la résolution d'un pli : vol
 * de la dernière carte, affichage du pli résolu, puis (en parallèle) envol
 * vers le tas des plis joués et éventuelle mini-distribution de pioche.
 */
function trickResolveAnimDurationMs(trickCardCount, drawnCount) {
  const pileFly = trickCardCount * TRICK_PILE_STAGGER_MS + TRICK_PILE_FLIGHT_MS + 80;
  const drawAnim = drawnCount > 0 ? (drawnCount * DRAW_ANIM_STAGGER_MS + DRAW_ANIM_FLIGHT_MS + 150) : 0;
  return TRICK_ARRIVE_MS + TRICK_RESULT_DISPLAY_MS + Math.max(pileFly, drawAnim);
}

/**
 * Repousse room.animationBusyUntil d'au moins durationMs à partir de
 * maintenant, sans jamais le faire reculer (plusieurs animations qui se
 * chevauchent gardent la plus tardive des deux échéances).
 */
function markAnimationBusy(room, durationMs) {
  room.animationBusyUntil = Math.max(room.animationBusyUntil || 0, Date.now() + durationMs);
}

/**
 * Délai de "réflexion" avant qu'un bot ne joue, une fois les animations en
 * cours terminées : plus court quand un seul coup est possible (rien à
 * choisir), plus long quand il a plusieurs options.
 */
function botThinkDelayMs(playableCount) {
  if (playableCount <= 1) return 900 + Math.floor(Math.random() * 500); // 900-1400ms
  const optionsBonus = Math.min(300, (playableCount - 1) * 60);
  return 1500 + Math.floor(Math.random() * 1200) + optionsBonus; // ~1500-3000ms
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function publicRoomState(room) {
  return {
    code: room.code,
    players: room.players.map((p) => ({ id: p.playerId, name: p.name, connected: p.connected, isBot: !!p.isBot })),
    maxPlayers: room.maxPlayers,
    started: room.started,
    scores: room.scores || null,
  };
}

/** Vue de l'état de la manche visible par un joueur donné (sa main est cachée aux autres) */
function handViewForPlayer(room, playerId) {
  const hand = room.currentHand;
  if (!hand) return null;

  return {
    numPlayers: hand.numPlayers,
    players: hand.players,
    dealerIndex: hand.dealerIndex,
    myHand: hand.hands[playerId] || [],
    handSizes: Object.fromEntries(hand.players.map((p) => [p, hand.hands[p].length])),
    drawPileCount: hand.drawPile.length,
    tricksPlayed: hand.tricksPlayed,
    currentTrick: hand.currentTrick,
    turnPlayerId: hand.players[hand.turnIndex],
    specialPhase: engine.isSpecialThreePlayerPhase(hand),
    tricksWonCopas: hand.tricksWonCopas,
    finished: hand.finished,
    playableCards: hand.players[hand.turnIndex] === playerId
      ? engine.getPlayableCards(hand, playerId)
      : [],
  };
}

function broadcastHandState(room) {
  // Rien à diffuser une fois la partie terminée (currentHand vidé) : un
  // hand:update à null écraserait côté client l'écran de résultat final
  // qu'on vient d'envoyer via game:handOver.
  if (!room.currentHand) return;
  for (const p of room.players) {
    if (p.isBot || !p.connected) continue;
    io.to(p.socketId).emit('hand:update', handViewForPlayer(room, p.playerId));
  }
}

function broadcastRoomState(room) {
  io.to(room.code).emit('room:update', publicRoomState(room));
}

function startNewHand(room) {
  const playerIds = room.players.map((p) => p.playerId);
  room.currentHand = engine.dealNewHand(playerIds, room.dealerIndex);
  markAnimationBusy(room, dealAnimDurationMs(room.currentHand.numPlayers, room.currentHand.drawPile.length));
}

function nextDealer(room) {
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
}

function isBotTurn(room) {
  if (!room.currentHand || room.currentHand.finished) return false;
  const currentId = room.currentHand.players[room.currentHand.turnIndex];
  const player = room.players.find((p) => p.playerId === currentId);
  return !!player?.isBot;
}

// Programme le coup automatique d'un bot après un délai en deux temps :
// d'abord le temps qu'il reste avant la fin estimée des animations en cours
// côté client (room.animationBusyUntil, pour ne jamais faire jouer le bot
// pendant qu'une distribution/pose de carte/résolution de pli est encore
// visible à l'écran), puis un temps de "réflexion" (botThinkDelayMs, plus
// court s'il n'a qu'un seul coup possible). Rejoue la même vérification
// juste avant d'agir : le salon peut avoir disparu (tout le monde parti) ou
// la manche avoir changé entre-temps (un humain a peut-être déjà rejoué,
// improbable mais pas impossible selon l'ordre d'arrivée des événements).
// Chaîne naturellement d'un bot au suivant : handleCardPlay rappelle cette
// fonction après chaque coup, humain ou bot.
function scheduleBotTurnIfNeeded(room) {
  if (!isBotTurn(room)) return;

  const botId = room.currentHand.players[room.currentHand.turnIndex];
  const playableCount = engine.getPlayableCards(room.currentHand, botId).length;
  const animWait = Math.max(0, (room.animationBusyUntil || 0) - Date.now());
  const delay = animWait + botThinkDelayMs(playableCount);

  setTimeout(() => {
    try {
      const currentRoom = rooms[room.code];
      if (!currentRoom || currentRoom !== room || !isBotTurn(currentRoom)) return;

      const currentBotId = currentRoom.currentHand.players[currentRoom.currentHand.turnIndex];
      const card = botAI.chooseBotCard(currentRoom.currentHand, currentBotId);
      handleCardPlay(currentRoom, currentBotId, card);
    } catch (err) {
      console.error('[bot] erreur inattendue:', err);
    }
  }, delay);
}

/**
 * Applique un coup (humain ou bot) et gère toutes les conséquences réseau
 * (résolution de pli, fin de manche/partie, coup automatique du bot suivant
 * si besoin). Factorisé pour être appelé aussi bien depuis le handler
 * socket game:playCard que depuis scheduleBotTurnIfNeeded.
 */
function handleCardPlay(room, playerId, card) {
  const result = engine.playCard(room.currentHand, playerId, card);
  if (!result.ok) return result;

  if (result.trickComplete) {
    // Émis par joueur (pas de broadcast room-wide) : le contenu réel d'une
    // carte piochée ne doit être visible que par celui qui l'a piochée.
    // Les autres joueurs reçoivent seulement l'ordre des tirages (qui a
    // pioché, dans quel ordre) pour rejouer l'animation, sans le contenu.
    const drawOrder = result.drawnCards ? Object.keys(result.drawnCards) : null;
    for (const p of room.players) {
      if (p.isBot || !p.connected) continue;
      io.to(p.socketId).emit('game:trickResolved', {
        trick: result.trick,
        winnerId: result.winnerId,
        copasInTrick: result.copasInTrick,
        drawOrder,
        myDrawnCard: result.drawnCards ? (result.drawnCards[p.playerId] || null) : null,
      });
    }
    markAnimationBusy(room, trickResolveAnimDurationMs(result.trick.length, drawOrder ? drawOrder.length : 0));
  } else {
    // Carte posée qui ne conclut pas le pli : les autres clients l'animent
    // en vol depuis la main du joueur jusqu'à son emplacement (voir
    // TRICK_ARRIVE_MS côté client).
    markAnimationBusy(room, TRICK_ARRIVE_MS);
  }

  if (result.handOver) {
    const log = engine.applyHandResultToScores(
      room.scores,
      room.currentHand.tricksWonCopas,
      room.players.map((p) => p.playerId)
    );
    const gameOverLosers = engine.checkGameOver(room.scores);

    io.to(room.code).emit('game:handOver', {
      tricksWonCopas: room.currentHand.tricksWonCopas,
      scoringLog: log,
      scores: room.scores,
      gameOver: gameOverLosers,
      earlyEnd: !!result.earlyEnd,
    });

    if (gameOverLosers) {
      room.started = false;
      room.currentHand = null;
    } else {
      nextDealer(room);
      startNewHand(room);
    }
    broadcastRoomState(room);
  }

  broadcastHandState(room);
  scheduleBotTurnIfNeeded(room);
  return result;
}

function isValidCard(card) {
  return !!card && typeof card === 'object'
    && engine.SUITS.includes(card.suit)
    && engine.RANKS.includes(card.rank);
}

/**
 * Enveloppe un gestionnaire socket.io pour qu'une exception inattendue
 * (bug du moteur, payload malformé...) ne fasse jamais planter tout le
 * process Node — ce qui déconnecterait tous les joueurs de toutes les
 * parties en cours. On logue l'erreur et on répond proprement au client.
 */
function withErrorHandling(eventName, handler) {
  return (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    try {
      handler(...args);
    } catch (err) {
      console.error(`[socket:${eventName}] erreur inattendue:`, err);
      if (callback) {
        try {
          callback({ ok: false, error: 'Erreur interne du serveur. Réessaie.' });
        } catch (_) {
          // le callback lui-même est cassé, on ne peut rien faire de plus
        }
      }
    }
  };
}

// ----------------------------------------------------------------------------

io.on('connection', (socket) => {
  socket.on('room:create', withErrorHandling('room:create', (payload, callback) => {
    const { name, maxPlayers } = payload || {};
    if (typeof name !== 'string' || !name.trim()) {
      return callback?.({ ok: false, error: 'Prénom invalide.' });
    }

    const code = makeRoomCode();
    const playerId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const room = {
      code,
      players: [{
        playerId,
        socketId: socket.id,
        sessionToken,
        name: name.trim().slice(0, 32),
        connected: true,
      }],
      maxPlayers: maxPlayers === 3 ? 3 : 4,
      started: false,
      dealerIndex: 0,
      scores: null,
      currentHand: null,
      animationBusyUntil: 0,
    };
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    callback?.({ ok: true, room: publicRoomState(room), playerId, sessionToken });
    broadcastRoomState(room);
  }));

  socket.on('room:join', withErrorHandling('room:join', (payload, callback) => {
    const { name, code } = payload || {};
    if (typeof name !== 'string' || !name.trim()) {
      return callback?.({ ok: false, error: 'Prénom invalide.' });
    }
    if (typeof code !== 'string' || !code.trim()) {
      return callback?.({ ok: false, error: 'Code de salon invalide.' });
    }

    const room = rooms[code.trim().toUpperCase()];
    if (!room) return callback?.({ ok: false, error: 'Salon introuvable.' });
    if (room.started) return callback?.({ ok: false, error: 'La partie a déjà commencé.' });
    if (room.players.length >= room.maxPlayers) {
      return callback?.({ ok: false, error: 'Le salon est complet.' });
    }

    const playerId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    room.players.push({
      playerId,
      socketId: socket.id,
      sessionToken,
      name: name.trim().slice(0, 32),
      connected: true,
    });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    callback?.({ ok: true, room: publicRoomState(room), playerId, sessionToken });
    broadcastRoomState(room);
  }));

  // Complète les places vides du salon avec des bots (host uniquement, avant
  // le début de la partie). Utilisé aussi bien pour "compléter avec des
  // bots" depuis le lobby que pour le mode solo (créer + compléter + démarrer
  // enchaînés côté client).
  socket.on('room:fillBots', withErrorHandling('room:fillBots', (_, callback) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return callback?.({ ok: false, error: 'Salon introuvable.' });
    if (room.started) return callback?.({ ok: false, error: 'La partie a déjà commencé.' });
    const isHost = room.players[0]?.playerId === socket.data.playerId;
    if (!isHost) return callback?.({ ok: false, error: "Seul l'hôte peut ajouter des bots." });

    while (room.players.length < room.maxPlayers) {
      room.players.push(makeBot());
    }

    callback?.({ ok: true, room: publicRoomState(room) });
    broadcastRoomState(room);
  }));

  // Permet à un joueur de retrouver son siège (main, score, place dans le
  // salon) après un rafraîchissement de page ou une coupure réseau, tant que
  // le salon existe encore côté serveur.
  socket.on('session:resume', withErrorHandling('session:resume', (payload, callback) => {
    const { code, sessionToken } = payload || {};
    if (typeof code !== 'string' || typeof sessionToken !== 'string') {
      return callback?.({ ok: false, error: 'Session invalide.' });
    }

    const room = rooms[code.trim().toUpperCase()];
    if (!room) return callback?.({ ok: false, error: 'Salon introuvable ou expiré.' });

    const player = room.players.find((p) => p.sessionToken === sessionToken);
    if (!player) return callback?.({ ok: false, error: 'Session introuvable ou expirée.' });

    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = player.playerId;

    callback?.({
      ok: true,
      room: publicRoomState(room),
      playerId: player.playerId,
      sessionToken: player.sessionToken,
      hand: room.currentHand ? handViewForPlayer(room, player.playerId) : null,
    });
    broadcastRoomState(room);
    if (room.currentHand) broadcastHandState(room);
  }));

  // Un joueur quitte volontairement le salon (bouton "Quitter la partie").
  // On invalide sa place immédiatement : son sessionToken n'existe plus dans
  // le salon, donc un futur "session:resume" avec ce token échouera proprement.
  socket.on('room:leave', withErrorHandling('room:leave', (_, callback) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return callback?.({ ok: true });

    const idx = room.players.findIndex((p) => p.playerId === socket.data.playerId);
    if (idx !== -1) room.players.splice(idx, 1);

    socket.leave(room.code);
    socket.data.roomCode = null;
    socket.data.playerId = null;

    if (!hasAnyHuman(room)) {
      delete rooms[room.code];
    } else {
      broadcastRoomState(room);
      if (room.currentHand) broadcastHandState(room);
    }

    callback?.({ ok: true });
  }));

  socket.on('room:start', withErrorHandling('room:start', (_, callback) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return callback?.({ ok: false, error: 'Salon introuvable.' });
    if (room.players.length !== room.maxPlayers) {
      return callback?.({ ok: false, error: `Il faut exactement ${room.maxPlayers} joueurs pour commencer.` });
    }

    room.started = true;
    room.scores = engine.createInitialScores(room.players.map((p) => p.playerId));
    room.dealerIndex = 0;
    startNewHand(room);

    callback?.({ ok: true });
    broadcastRoomState(room);
    broadcastHandState(room);
    scheduleBotTurnIfNeeded(room); // le premier joueur à jouer peut déjà être un bot
  }));

  socket.on('game:playCard', withErrorHandling('game:playCard', (payload, callback) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.currentHand) return callback?.({ ok: false, error: 'Partie non démarrée.' });

    const card = payload?.card;
    if (!isValidCard(card)) {
      return callback?.({ ok: false, error: 'Carte invalide.' });
    }

    const result = handleCardPlay(room, socket.data.playerId, card);
    callback?.(result.ok ? { ok: true } : { ok: false, error: result.error });
  }));

  socket.on('disconnect', withErrorHandling('disconnect', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (player) player.connected = false;
    broadcastRoomState(room);

    setTimeout(() => {
      const stillHere = room.players.some((p) => !p.isBot && p.connected);
      if (!stillHere) delete rooms[room.code];
    }, 5 * 60 * 1000);
  }));
});

// Filet de sécurité en dernier recours : si quelque chose échappe malgré
// tout aux try/catch des gestionnaires (ex: code appelé de façon async hors
// d'un handler), on logue au lieu de laisser tout le processus planter.
process.on('uncaughtException', (err) => {
  console.error('Exception non interceptée:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Rejet de promesse non géré:', err);
});

server.listen(PORT, () => {
  console.log(`Serveur "Copas" lancé sur le port ${PORT}`);
});
