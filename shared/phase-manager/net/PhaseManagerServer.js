const { randomUUID } = require('crypto');
const { DEFAULT_MESH_COLOR, normalizeCatalogCardDesign } = require('../../cards-catalog/catalogCardDesign');

const DEFAULT_CARD_MESH_COLOR = 0x000000;

const DEFAULT_OPTIONS = {
  deckSizePerPlayer: 10,
  startingHandSize: 3,
  maxHandSize: 7,
  boardSlotsPerSide: 3,
  commitInterAttackDelayMs: 740,
  commitAttackAnimationDurationMs: 760,
  commitSettleBufferMs: 80,
  commitPostRollObserveMs: 5000,
};

class PhaseManagerServer {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      catalogProvider: typeof options.catalogProvider === 'function' ? options.catalogProvider : async () => [],
      ...options,
    };
    this.phaseQueue = [];
    this.phaseMatchmakingState = new Map();
    this.phaseMatches = new Map();
  }

  getQueuePosition(playerId) {
    const index = this.phaseQueue.indexOf(playerId);
    return index === -1 ? null : index + 1;
  }

  removeFromQueue(playerId) {
    const index = this.phaseQueue.indexOf(playerId);
    if (index !== -1) {
      this.phaseQueue.splice(index, 1);
    }
  }

  clearPlayerMatchmakingState(playerId) {
    this.removeFromQueue(playerId);
    const current = this.phaseMatchmakingState.get(playerId);
    if (!current) return;

    if (current.status === 'matched' && current.matchId) {
      const match = this.phaseMatches.get(current.matchId);
      if (match) {
        this.phaseMatches.delete(current.matchId);
        const otherPlayerId = match.players.find((id) => id !== playerId);
        if (otherPlayerId) {
          this.phaseMatchmakingState.set(otherPlayerId, { status: 'idle' });
        }
      }
    }

    this.phaseMatchmakingState.set(playerId, { status: 'idle' });
  }

  colorFromHexString(hexColor, fallbackColor = DEFAULT_CARD_MESH_COLOR) {
    if (typeof hexColor !== 'string') return fallbackColor;
    const normalized = hexColor.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return fallbackColor;
    return Number.parseInt(normalized.slice(1), 16);
  }

  buildDeckFromCatalog(playerId, catalogCards = []) {
    if (!Array.isArray(catalogCards) || catalogCards.length === 0) {
      return Array.from({ length: this.options.deckSizePerPlayer }, (_, index) => ({
        id: `${playerId}-card-${index + 1}`,
        color: DEFAULT_CARD_MESH_COLOR,
        catalogCard: normalizeCatalogCardDesign({
          name: `Test Card ${index + 1}`,
          type: 'Unknown',
          damage: 'D6',
          health: 10,
          speed: 'D6',
          defense: 'D6',
          ability1: {
            cost: '1',
            name: 'Prototype Strike',
            description: 'Placeholder ability.',
          },
          meshColor: DEFAULT_MESH_COLOR,
        }),
        summonedTurn: null,
        attackCommitted: false,
        targetSlotIndex: null,
        targetSide: null,
      }));
    }

    return Array.from({ length: this.options.deckSizePerPlayer }, (_, index) => {
      const randomCard = catalogCards[Math.floor(Math.random() * catalogCards.length)] || {};
      const normalizedCard = normalizeCatalogCardDesign(randomCard);
      return {
        id: `${playerId}-card-${index + 1}`,
        color: this.colorFromHexString(normalizedCard.meshColor),
        catalogCard: normalizedCard,
        summonedTurn: null,
        attackCommitted: false,
        targetSlotIndex: null,
        targetSide: null,
      };
    });
  }

  serializeMatchForPlayer(match, playerId) {
    const opponentId = match.players.find((id) => id !== playerId) || null;
    const playerState = match.cardsByPlayer.get(playerId);
    const opponentState = opponentId ? match.cardsByPlayer.get(opponentId) : null;

    if (!playerState || !opponentState || !opponentId) {
      return null;
    }

    const serializeBoard = (boardCards) => boardCards.map((card) => ({
      ...card,
      canAttack: Number.isInteger(card.summonedTurn) && card.summonedTurn < match.turnNumber,
    }));

    const commitAttacks = [];
    for (const attackerId of match.players) {
      const attackerSide = attackerId === playerId ? 'player' : 'opponent';
      const attacks = match.pendingCommitAttacksByPlayer.get(attackerId) || [];
      for (const attack of attacks) {
        commitAttacks.push({
          ...attack,
          attackerId,
          attackerSide,
        });
      }
    }

    return {
      id: match.id,
      turnNumber: match.turnNumber,
      phase: match.phase,
      youAreReady: match.readyPlayers.has(playerId),
      opponentIsReady: opponentId ? match.readyPlayers.has(opponentId) : false,
      players: {
        player: {
          hand: [...playerState.hand],
          board: serializeBoard(playerState.board),
          deckCount: playerState.deck.length,
        },
        opponent: {
          hand: [...opponentState.hand],
          board: serializeBoard(opponentState.board),
          deckCount: opponentState.deck.length,
        },
      },
      meta: {
        drawnCardIds: [...(match.lastDrawnCardsByPlayer.get(playerId) || [])],
        phaseStartedAt: match.phaseStartedAt,
        commitAllRolledAt: match.commitAllRolledAt || null,
        commitAttacks,
        commitRolls: Array.from(match.commitRollsByAttackId?.values() || []).map((rollEntry) => ({
          ...rollEntry,
          attackerSide: rollEntry.attackerId === playerId ? 'player' : 'opponent',
        })),
      },
    };
  }

  drawCardAtStartOfDecisionPhase(playerState) {
    if (!playerState || !playerState.deck.length || playerState.hand.length >= this.options.maxHandSize) {
      return [];
    }

    const drawnCard = playerState.deck.shift();
    playerState.hand.push(drawnCard);
    return [drawnCard.id];
  }

  applyDecisionPhaseStartDraw(match) {
    const drawnCardsByPlayer = new Map();

    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      const drawnCardIds = this.drawCardAtStartOfDecisionPhase(playerState);
      drawnCardsByPlayer.set(playerId, drawnCardIds);
    });

    match.lastDrawnCardsByPlayer = drawnCardsByPlayer;
  }

  advanceMatchToDecisionPhase(match) {
    match.turnNumber += 1;
    match.phase = 1;
    match.phaseStartedAt = Date.now();
    match.phaseEndsAt = null;
    match.readyPlayers.clear();
    match.pendingCommitAttacksByPlayer = new Map();
    match.commitRollsByAttackId = new Map();
    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      if (!playerState) return;
      playerState.board = playerState.board.map((card) => ({
        ...card,
        attackCommitted: false,
        targetSlotIndex: null,
        targetSide: null,
      }));
    });
    this.applyDecisionPhaseStartDraw(match);
  }

  resolveCommitPhase(match) {
    match.phase = 2;
    match.phaseStartedAt = Date.now();
    const pendingAttacks = new Map();
    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      const attacks = playerState?.board
        ?.filter((card) => card.attackCommitted === true && Number.isInteger(card.slotIndex))
        .map((card) => ({
          id: `${playerId}:${card.slotIndex}:${card.targetSide || 'none'}:${Number.isInteger(card.targetSlotIndex) ? card.targetSlotIndex : 'none'}`,
          attackerSlotIndex: card.slotIndex,
          targetSlotIndex: Number.isInteger(card.targetSlotIndex) ? card.targetSlotIndex : null,
          targetSide: card.targetSide || null,
        })) || [];
      pendingAttacks.set(playerId, attacks);
    });
    match.pendingCommitAttacksByPlayer = pendingAttacks;
    match.commitRollsByAttackId = new Map();
    match.commitCompletedPlayers = new Set();
    match.commitAllRolledAt = null;
    match.phaseEndsAt = null;
  }

  getCommitPhaseAnimationDurationMs(match) {
    const commitAttackCount = Array
      .from(match.pendingCommitAttacksByPlayer.values())
      .reduce((sum, attacks) => sum + (Array.isArray(attacks) ? attacks.length : 0), 0);

    if (commitAttackCount <= 0) {
      return this.options.commitSettleBufferMs;
    }

    return ((commitAttackCount - 1) * this.options.commitInterAttackDelayMs)
      + this.options.commitAttackAnimationDurationMs
      + this.options.commitSettleBufferMs;
  }

  completeCommitRolls(payload) {
    const { playerId } = payload;
    const status = this.phaseMatchmakingState.get(playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      return { error: 'player is not in an active match', statusCode: 409 };
    }

    const match = this.phaseMatches.get(status.matchId);
    if (!match) {
      return { error: 'active match not found', statusCode: 409 };
    }

    if (match.phase !== 2) {
      return { error: 'cannot complete commit rolls outside commit phase', statusCode: 409 };
    }

    match.commitCompletedPlayers.add(playerId);
    if (match.commitCompletedPlayers.size === match.players.length && !match.commitAllRolledAt) {
      match.commitAllRolledAt = Date.now();
      match.phaseEndsAt = match.commitAllRolledAt
        + this.options.commitPostRollObserveMs
        + this.getCommitPhaseAnimationDurationMs(match);
    }

    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }


  submitCommitRoll(payload) {
    const { playerId, attackId, rollType, sides, roll } = payload;
    const status = this.phaseMatchmakingState.get(playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      return { error: 'player is not in an active match', statusCode: 409 };
    }

    const match = this.phaseMatches.get(status.matchId);
    if (!match) {
      return { error: 'active match not found', statusCode: 409 };
    }

    if (match.phase !== 2) {
      return { error: 'cannot submit commit rolls outside commit phase', statusCode: 409 };
    }

    if (typeof attackId !== 'string' || !attackId.trim()) {
      return { error: 'attackId is required', statusCode: 400 };
    }

    const playerAttacks = match.pendingCommitAttacksByPlayer.get(playerId) || [];
    const isPlayersAttack = playerAttacks.some((attack) => attack.id === attackId);
    if (!isPlayersAttack) {
      return { error: 'you may only roll your own attacks', statusCode: 403 };
    }

    if (!roll || typeof roll !== 'object' || !Array.isArray(roll.frames) || !Number.isFinite(roll.outcome)) {
      return { error: 'a roll payload with frames and outcome is required', statusCode: 400 };
    }

    const normalizedRollType = typeof rollType === 'string' && rollType.trim() ? rollType.trim() : 'damage';
    const commitRollKey = `${attackId}:${normalizedRollType}`;

    match.commitRollsByAttackId.set(commitRollKey, {
      attackId,
      attackerId: playerId,
      rollType: normalizedRollType,
      sides: Number.isFinite(sides) ? sides : null,
      roll,
      submittedAt: Date.now(),
    });

    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }

  readyPlayerInMatch(match, playerId) {
    match.readyPlayers.add(playerId);

    const allPlayersReady = match.players.every((id) => match.readyPlayers.has(id));
    if (!allPlayersReady) return;

    this.resolveCommitPhase(match);
  }

  validatePhaseTurnPayload(payload, playerState, currentTurnNumber) {
    const hand = Array.isArray(payload.hand) ? payload.hand : [];
    const board = Array.isArray(payload.board) ? payload.board : [];

    if (board.length > this.options.boardSlotsPerSide) {
      return { error: `board is limited to ${this.options.boardSlotsPerSide} cards` };
    }

    if (hand.length > this.options.maxHandSize) {
      return { error: `hand is limited to ${this.options.maxHandSize} cards` };
    }

    const visibleCards = [...playerState.hand, ...playerState.board];
    const knownCards = new Map(visibleCards.map((card) => [card.id, card]));
    const merged = [...hand, ...board];
    const uniqueIds = new Set(merged.map((card) => card.id));
    if (merged.length !== uniqueIds.size) {
      return { error: 'hand and board must not contain duplicate cards' };
    }

    if (uniqueIds.size !== knownCards.size) {
      return { error: `expected exactly ${knownCards.size} cards between hand and board` };
    }
    for (const cardId of uniqueIds) {
      if (!knownCards.has(cardId)) {
        return { error: `unknown card submitted: ${cardId}` };
      }
    }

    const previousBoardIds = new Set(playerState.board.map((card) => card.id));
    const usedBoardSlots = new Set();
    const normalizedBoard = [];
    for (const boardCard of board) {
      if (!Number.isInteger(boardCard.slotIndex)) {
        return { error: 'board card entries must include an integer slotIndex' };
      }
      if (boardCard.slotIndex < 0 || boardCard.slotIndex >= this.options.boardSlotsPerSide) {
        return { error: `board slotIndex must be between 0 and ${this.options.boardSlotsPerSide - 1}` };
      }
      if (usedBoardSlots.has(boardCard.slotIndex)) {
        return { error: 'board card slotIndex values must be unique' };
      }
      usedBoardSlots.add(boardCard.slotIndex);
      const knownCard = knownCards.get(boardCard.id);
      const cardWasAlreadyOnBoard = previousBoardIds.has(boardCard.id);
      normalizedBoard.push({
        ...knownCard,
        slotIndex: boardCard.slotIndex,
        summonedTurn: cardWasAlreadyOnBoard ? knownCard.summonedTurn : currentTurnNumber,
        attackCommitted: false,
        targetSlotIndex: null,
        targetSide: null,
      });
    }

    const attacks = Array.isArray(payload.attacks) ? payload.attacks : [];
    const seenAttackerSlots = new Set();
    for (const attack of attacks) {
      if (!Number.isInteger(attack.attackerSlotIndex)) {
        return { error: 'attacks must include integer attackerSlotIndex' };
      }
      if (attack.attackerSlotIndex < 0 || attack.attackerSlotIndex >= this.options.boardSlotsPerSide) {
        return { error: `attackerSlotIndex must be between 0 and ${this.options.boardSlotsPerSide - 1}` };
      }
      if (attack.targetSlotIndex != null && !Number.isInteger(attack.targetSlotIndex)) {
        return { error: 'targetSlotIndex must be an integer when provided' };
      }
      if (Number.isInteger(attack.targetSlotIndex) && (attack.targetSlotIndex < 0 || attack.targetSlotIndex >= this.options.boardSlotsPerSide)) {
        return { error: `targetSlotIndex must be between 0 and ${this.options.boardSlotsPerSide - 1}` };
      }
      if (attack.targetSide != null && attack.targetSide !== 'player' && attack.targetSide !== 'opponent') {
        return { error: "targetSide must be either 'player' or 'opponent' when provided" };
      }
      if (seenAttackerSlots.has(attack.attackerSlotIndex)) {
        return { error: 'a board slot may only commit one attack per turn' };
      }
      const attackerCard = normalizedBoard.find((card) => card.slotIndex === attack.attackerSlotIndex);
      if (!attackerCard) {
        return { error: `no attacker card found in slot ${attack.attackerSlotIndex}` };
      }
      if (!Number.isInteger(attackerCard.summonedTurn) || attackerCard.summonedTurn >= currentTurnNumber) {
        return { error: `card in slot ${attack.attackerSlotIndex} has summoning sickness` };
      }
      attackerCard.attackCommitted = true;
      attackerCard.targetSlotIndex = Number.isInteger(attack.targetSlotIndex) ? attack.targetSlotIndex : null;
      attackerCard.targetSide = attack.targetSide || null;
      seenAttackerSlots.add(attack.attackerSlotIndex);
    }

    return {
      hand: hand.map((card) => knownCards.get(card.id)),
      board: normalizedBoard,
    };
  }

  getPlayerPhaseStatus(playerId) {
    const status = this.phaseMatchmakingState.get(playerId) || { status: 'idle' };
    if (status.status === 'searching') {
      return {
        status: 'searching',
        queueCount: this.phaseQueue.length,
        queuePosition: this.getQueuePosition(playerId),
      };
    }

    if (status.status === 'matched' && status.matchId) {
      const match = this.phaseMatches.get(status.matchId);
      if (!match) {
        this.phaseMatchmakingState.set(playerId, { status: 'idle' });
        return { status: 'idle', queueCount: this.phaseQueue.length };
      }
      if (match.phase === 2 && Number.isFinite(match.phaseEndsAt) && Date.now() >= match.phaseEndsAt) {
        this.advanceMatchToDecisionPhase(match);
      }

      const opponentId = match.players.find((id) => id !== playerId) || null;
      return {
        status: 'matched',
        matchId: match.id,
        opponentId,
        queueCount: this.phaseQueue.length,
        matchState: this.serializeMatchForPlayer(match, playerId),
      };
    }

    return { status: 'idle', queueCount: this.phaseQueue.length };
  }

  async findMatch(playerId) {
    const existing = this.getPlayerPhaseStatus(playerId);
    if (existing.status === 'matched' || existing.status === 'searching') {
      return existing;
    }

    const opponentId = this.phaseQueue.shift();
    if (opponentId && opponentId !== playerId) {
      const matchId = `match-${randomUUID().slice(0, 8)}`;
      const players = [opponentId, playerId];
      const cardsByPlayer = new Map();
      let catalogCards = [];

      try {
        const loadedCards = await this.options.catalogProvider();
        catalogCards = Array.isArray(loadedCards) ? loadedCards : [];
      } catch (error) {
        catalogCards = [];
      }

      players.forEach((id) => {
        const cards = this.buildDeckFromCatalog(id, catalogCards);
        cardsByPlayer.set(id, {
          allCards: cards,
          hand: cards.slice(0, this.options.startingHandSize),
          board: [],
          deck: cards.slice(this.options.startingHandSize),
        });
      });

      const match = {
        id: matchId,
        players,
        cardsByPlayer,
        turnNumber: 1,
        phase: 1,
        phaseStartedAt: Date.now(),
        phaseEndsAt: null,
        readyPlayers: new Set(),
        lastDrawnCardsByPlayer: new Map(),
        pendingCommitAttacksByPlayer: new Map(),
        commitRollsByAttackId: new Map(),
        commitCompletedPlayers: new Set(),
        commitAllRolledAt: null,
        createdAt: Date.now(),
      };
      this.phaseMatches.set(matchId, match);
      this.phaseMatchmakingState.set(opponentId, { status: 'matched', matchId });
      this.phaseMatchmakingState.set(playerId, { status: 'matched', matchId });
      return this.getPlayerPhaseStatus(playerId);
    }

    this.phaseQueue.push(playerId);
    this.phaseMatchmakingState.set(playerId, { status: 'searching' });
    return this.getPlayerPhaseStatus(playerId);
  }

  reset(playerId) {
    this.clearPlayerMatchmakingState(playerId);
    return { status: 'idle', queueCount: this.phaseQueue.length };
  }

  readyUp(payload) {
    const { playerId } = payload;
    const status = this.phaseMatchmakingState.get(playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      return { error: 'player is not in an active match', statusCode: 409 };
    }

    const match = this.phaseMatches.get(status.matchId);
    if (!match) {
      return { error: 'active match not found', statusCode: 409 };
    }

    if (match.phase !== 1) {
      return { error: 'cannot ready up outside decision phase', statusCode: 409 };
    }

    if (match.readyPlayers.has(playerId)) {
      return { error: 'player is already readied up for this phase', statusCode: 409 };
    }

    const playerState = match.cardsByPlayer.get(playerId);
    if (!playerState) {
      return { error: 'player state not found in active match', statusCode: 409 };
    }

    const validated = this.validatePhaseTurnPayload(payload, playerState, match.turnNumber);
    if (validated.error) {
      return { error: validated.error, statusCode: 400 };
    }

    playerState.hand = validated.hand;
    playerState.board = validated.board;
    this.readyPlayerInMatch(match, playerId);
    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }

  syncState(payload) {
    const { playerId } = payload;
    const status = this.phaseMatchmakingState.get(playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      return { error: 'player is not in an active match', statusCode: 409 };
    }

    const match = this.phaseMatches.get(status.matchId);
    if (!match) {
      return { error: 'active match not found', statusCode: 409 };
    }

    if (match.phase !== 1) {
      return { error: 'cannot sync state outside decision phase', statusCode: 409 };
    }

    if (match.readyPlayers.has(playerId)) {
      return { error: 'cannot sync state after you are readied up', statusCode: 409 };
    }

    const playerState = match.cardsByPlayer.get(playerId);
    if (!playerState) {
      return { error: 'player state not found in active match', statusCode: 409 };
    }

    const validated = this.validatePhaseTurnPayload(payload, playerState, match.turnNumber);
    if (validated.error) {
      return { error: validated.error, statusCode: 400 };
    }

    playerState.hand = validated.hand;
    playerState.board = validated.board;

    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }
}

module.exports = { PhaseManagerServer };
