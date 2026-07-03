// ============================================================================
// Serveur du jeu "Copas" — gère les salons (rooms), la connexion des joueurs
// et fait tourner le moteur de jeu (game/engine.js) en temps réel.
// ============================================================================

const path = require('path');
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
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
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
    io.to(p.id).emit('hand:update', handViewForPlayer(room, p.id));
  }
}

function broadcastRoomState(room) {
  io.to(room.code).emit('room:update', publicRoomState(room));
}

function startNewHand(room) {
  const playerIds = room.players.map((p) => p.id);
  room.currentHand = engine.dealNewHand(playerIds, room.dealerIndex);
}

function nextDealer(room) {
  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
}

// ----------------------------------------------------------------------------

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, maxPlayers }, callback) => {
    const code = makeRoomCode();
    const room = {
      code,
      players: [{ id: socket.id, name: name?.trim() || 'Joueur', connected: true }],
      maxPlayers: maxPlayers === 3 ? 3 : 4,
      started: false,
      dealerIndex: 0,
      scores: null,
      currentHand: null,
    };
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    callback?.({ ok: true, room: publicRoomState(room) });
    broadcastRoomState(room);
  });

  socket.on('room:join', ({ code, name }, callback) => {
    const room = rooms[(code || '').toUpperCase()];
    if (!room) return callback?.({ ok: false, error: 'Salon introuvable.' });
    if (room.started) return callback?.({ ok: false, error: 'La partie a déjà commencé.' });
    if (room.players.length >= room.maxPlayers) {
      return callback?.({ ok: false, error: 'Le salon est complet.' });
    }

    room.players.push({ id: socket.id, name: name?.trim() || 'Joueur', connected: true });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    callback?.({ ok: true, room: publicRoomState(room) });
    broadcastRoomState(room);
  });

  socket.on('room:start', (_, callback) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return callback?.({ ok: false, error: 'Salon introuvable.' });
    if (room.players.length !== room.maxPlayers) {
      return callback?.({ ok: false, error: `Il faut exactement ${room.maxPlayers} joueurs pour commencer.` });
    }

    room.started = true;
    room.scores = engine.createInitialScores(room.players.map((p) => p.id));
    room.dealerIndex = 0;
    startNewHand(room);

    callback?.({ ok: true });
    broadcastRoomState(room);
    broadcastHandState(room);
  });

  socket.on('game:playCard', ({ card }, callback) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.currentHand) return callback?.({ ok: false, error: 'Partie non démarrée.' });

    const result = engine.playCard(room.currentHand, socket.id, card);
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
        room.players.map((p) => p.id)
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
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (player) player.connected = false;
    broadcastRoomState(room);

    setTimeout(() => {
      const stillHere = room.players.some((p) => p.connected);
      if (!stillHere) delete rooms[room.code];
    }, 5 * 60 * 1000);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur "Copas" lancé sur le port ${PORT}`);
});
