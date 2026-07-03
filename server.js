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
    players: room.players.map((p) => ({ id: p.playerId, name: p.name, connected: p.connected })),
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
  for (const p of room.players) {
    if (!p.connected) continue;
    io.to(p.socketId).emit('hand:update', handViewForPlayer(room, p.playerId));
  }
}

function broadcastRoomState(room) {
  io.to(room.code).emit('room:update', publicRoomState(room));
}

function startNewHand(room) {
  const playerIds = room.players.map((p) => p.playerId);
  room.currentHand = engine.dealNewHand(playerIds, room.dealerIndex);
}

function nextDealer(room) {
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
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
  }));

  socket.on('game:playCard', withErrorHandling('game:playCard', (payload, callback) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.currentHand) return callback?.({ ok: false, error: 'Partie non démarrée.' });

    const card = payload?.card;
    if (!isValidCard(card)) {
      return callback?.({ ok: false, error: 'Carte invalide.' });
    }

    const result = engine.playCard(room.currentHand, socket.data.playerId, card);
    if (!result.ok) return callback?.({ ok: false, error: result.error });

    callback?.({ ok: true });

    if (result.trickComplete) {
      io.to(room.code).emit('game:trickResolved', {
        trick: result.trick,
        winnerId: result.winnerId,
        copasInTrick: result.copasInTrick,
      });
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
  }));

  socket.on('disconnect', withErrorHandling('disconnect', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (player) player.connected = false;
    broadcastRoomState(room);

    setTimeout(() => {
      const stillHere = room.players.some((p) => p.connected);
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
