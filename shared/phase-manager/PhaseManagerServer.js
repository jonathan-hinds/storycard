const { randomUUID } = require('crypto');

const PLAYER_STARTING_CARDS = 3;
const BOARD_SLOTS_PER_SIDE = 3;
const colorPool = [0x5f8dff, 0x8f6cff, 0x2dc6ad, 0xf28a65, 0xf1c965, 0xe76fb9, 0x4ecdc4, 0xff6b6b, 0xc7f464, 0xffa94d];

function randomCard(prefix, index) {
  const id = `${prefix}-${index + 1}-${Math.random().toString(36).slice(2, 7)}`;
  const color = colorPool[Math.floor(Math.random() * colorPool.length)];
  return { id, color };
}

class PhaseManagerServer {
  constructor() {
    this.waitingPlayerId = null;
    this.matches = new Map();
    this.playerToMatch = new Map();
  }

  createMatch(playerAId, playerBId) {
    const match = {
      id: `match-${randomUUID().slice(0, 8)}`,
      turnPlayerId: playerAId,
      players: {
        [playerAId]: {
          hand: Array.from({ length: PLAYER_STARTING_CARDS }, (_, index) => randomCard('a', index)),
          board: [],
        },
        [playerBId]: {
          hand: Array.from({ length: PLAYER_STARTING_CARDS }, (_, index) => randomCard('b', index)),
          board: [],
        },
      },
    };

    this.matches.set(match.id, match);
    this.playerToMatch.set(playerAId, match.id);
    this.playerToMatch.set(playerBId, match.id);
    return match;
  }

  getMatchByPlayer(playerId) {
    const matchId = this.playerToMatch.get(playerId);
    return matchId ? this.matches.get(matchId) : null;
  }

  getMatchView(match, playerId) {
    if (!match || !match.players[playerId]) return null;

    const opponentId = Object.keys(match.players).find((id) => id !== playerId);
    const playerState = match.players[playerId];
    const opponentState = match.players[opponentId];

    return {
      id: match.id,
      turn: match.turnPlayerId === playerId ? 'player' : 'opponent',
      isPlayerTurn: match.turnPlayerId === playerId,
      players: {
        player: {
          id: playerId,
          hand: playerState.hand,
          board: playerState.board,
        },
        opponent: {
          id: opponentId,
          handCount: opponentState.hand.length,
          board: opponentState.board,
        },
      },
    };
  }

  findMatch(playerId) {
    const existing = this.getMatchByPlayer(playerId);
    if (existing) {
      return { status: 'matched', match: this.getMatchView(existing, playerId) };
    }

    if (this.waitingPlayerId && this.waitingPlayerId !== playerId) {
      const match = this.createMatch(this.waitingPlayerId, playerId);
      this.waitingPlayerId = null;
      return { status: 'matched', match: this.getMatchView(match, playerId) };
    }

    this.waitingPlayerId = playerId;
    return { status: 'waiting' };
  }

  getMatchmakingStatus(playerId) {
    const existing = this.getMatchByPlayer(playerId);
    if (existing) {
      return { status: 'matched', match: this.getMatchView(existing, playerId) };
    }

    if (this.waitingPlayerId === playerId) {
      return { status: 'waiting' };
    }

    return { status: 'idle' };
  }

  syncAndEndTurn(matchId, playerId, playerState) {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error('Match not found');
    }

    if (!match.players[playerId]) {
      throw new Error('Player is not in this match');
    }

    if (match.turnPlayerId !== playerId) {
      throw new Error('It is not your turn');
    }

    const sanitizedHand = Array.isArray(playerState.hand)
      ? playerState.hand.map((card) => ({ id: card.id, color: card.color }))
      : [];
    const sanitizedBoard = Array.isArray(playerState.board)
      ? playerState.board.slice(0, BOARD_SLOTS_PER_SIDE).map((card) => ({ id: card.id, color: card.color }))
      : [];

    match.players[playerId] = {
      hand: sanitizedHand,
      board: sanitizedBoard,
    };

    const nextPlayerId = Object.keys(match.players).find((id) => id !== playerId);
    match.turnPlayerId = nextPlayerId;

    return this.getMatchView(match, playerId);
  }

  leave(playerId) {
    if (this.waitingPlayerId === playerId) {
      this.waitingPlayerId = null;
      return;
    }

    const match = this.getMatchByPlayer(playerId);
    if (!match) return;

    for (const id of Object.keys(match.players)) {
      this.playerToMatch.delete(id);
    }
    this.matches.delete(match.id);
  }
}

module.exports = {
  PhaseManagerServer,
};
