const { randomUUID } = require('crypto');
const { DEFAULT_MESH_COLOR, normalizeCatalogCardDesign } = require('../../cards-catalog/catalogCardDesign');

const DEFAULT_CARD_MESH_COLOR = 0x000000;

const DEFAULT_OPTIONS = {
  deckSizePerPlayer: 10,
  startingHandSize: 3,
  maxHandSize: 7,
  boardSlotsPerSide: 3,
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
        selectedAbilityIndex: 0,
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
        selectedAbilityIndex: 0,
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
        const resolvedAttack = {
          ...this.resolveCommitAttackStep(match, attackerId, attack),
          attackerId,
          attackerSide,
        };

        const executionState = match.commitExecutionByAttackId?.get(attack.id);
        if (executionState && executionState.executed === false) {
          continue;
        }

        commitAttacks.push(resolvedAttack);
      }
    }

    const activeSpellResolution = match.activeSpellResolution
      ? {
        ...match.activeSpellResolution,
        casterSide: match.activeSpellResolution.casterId === playerId ? 'player' : 'opponent',
      }
      : null;

    if (activeSpellResolution?.targetSide) {
      const viewerIsCaster = activeSpellResolution.casterId === playerId;
      if (!viewerIsCaster) {
        activeSpellResolution.targetSide = activeSpellResolution.targetSide === 'player' ? 'opponent' : 'player';
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
        activeSpellResolution,
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
    match.commitExecutionByAttackId = new Map();
    match.commitAnimationCompletedPlayers = new Set();
    match.activeSpellResolution = null;
    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      if (!playerState) return;
      playerState.board = playerState.board.map((card) => ({
        ...card,
        attackCommitted: false,
        targetSlotIndex: null,
        targetSide: null,
        selectedAbilityIndex: 0,
      }));
    });
    this.applyDecisionPhaseStartDraw(match);
  }


  getAttackAbilityForCard(card, selectedAbilityIndex = 0) {
    const catalogCard = card?.catalogCard || {};
    const abilities = [catalogCard.ability1, catalogCard.ability2].filter(Boolean);
    if (!abilities.length) return null;
    if (Number.isInteger(selectedAbilityIndex) && selectedAbilityIndex >= 0 && selectedAbilityIndex < abilities.length) {
      return abilities[selectedAbilityIndex];
    }
    return abilities[0];
  }

  resolveAttackValue({ ability, attackId, commitRollsByAttackId }) {
    if (!ability || ability.valueSourceType === 'none') return 0;
    if (ability.valueSourceType === 'fixed') {
      const fixedValue = Number(ability.valueSourceFixed);
      return Number.isFinite(fixedValue) ? Math.max(0, Math.floor(fixedValue)) : 0;
    }

    const rollType = ability.valueSourceStat === 'efct' ? 'damage' : (ability.valueSourceStat || 'damage');
    const rollEntry = commitRollsByAttackId.get(`${attackId}:${rollType}`);
    const outcome = Number(rollEntry?.roll?.outcome);
    return Number.isFinite(outcome) ? Math.max(0, Math.floor(outcome)) : 0;
  }

  resolveAbilityValue({ ability, rollValue = null }) {
    if (!ability || ability.valueSourceType === 'none') return 0;
    if (ability.valueSourceType === 'fixed') {
      const fixedValue = Number(ability.valueSourceFixed);
      return Number.isFinite(fixedValue) ? Math.max(0, Math.floor(fixedValue)) : 0;
    }

    const outcome = Number(rollValue);
    return Number.isFinite(outcome) ? Math.max(0, Math.floor(outcome)) : 0;
  }

  applyResolvedAbilityEffect({ match, casterId, targetSide, targetSlotIndex, effectId, resolvedValue }) {
    if (!match || !casterId) return { executed: false, reason: 'caster_missing' };
    if (effectId !== 'damage_enemy' && effectId !== 'heal_target') {
      return { executed: true, reason: 'no_effect' };
    }

    const hasDamage = effectId === 'damage_enemy' && resolvedValue > 0;
    const hasHealing = effectId === 'heal_target' && resolvedValue > 0;
    if (!hasDamage && !hasHealing) {
      return { executed: true, reason: 'no_value' };
    }
    if (!Number.isInteger(targetSlotIndex)) {
      return { executed: false, reason: 'target_missing' };
    }

    const defenderId = targetSide === 'player'
      ? casterId
      : match.players.find((id) => id !== casterId);
    if (!defenderId) {
      return { executed: false, reason: 'target_missing' };
    }

    const defenderState = match.cardsByPlayer.get(defenderId);
    const defenderCard = defenderState?.board?.find((card) => card.slotIndex === targetSlotIndex);
    if (!defenderCard?.catalogCard) {
      return { executed: false, reason: 'target_missing' };
    }

    const currentHealth = Number(defenderCard.catalogCard.health);
    if (!Number.isFinite(currentHealth)) {
      return { executed: false, reason: 'target_invalid' };
    }

    const nextHealth = hasDamage
      ? currentHealth - resolvedValue
      : currentHealth + resolvedValue;
    defenderCard.catalogCard.health = nextHealth;

    if (nextHealth < 0) {
      defenderState.board = defenderState.board.filter((card) => card !== defenderCard);
    }

    return { executed: true };
  }

  resolveCommitAttackStep(match, attackerId, attack) {
    const attackerState = match.cardsByPlayer.get(attackerId);
    const attackerCard = attackerState?.board?.find((card) => card.slotIndex === attack.attackerSlotIndex) || null;
    const ability = this.getAttackAbilityForCard(attackerCard, attack.selectedAbilityIndex);
    const resolvedValue = this.resolveAttackValue({
      ability,
      attackId: attack.id,
      commitRollsByAttackId: match.commitRollsByAttackId,
    });

    return {
      ...attack,
      effectId: ability?.effectId || 'none',
      resolvedValue,
      resolvedDamage: ability?.effectId === 'damage_enemy' ? resolvedValue : 0,
      resolvedHealing: ability?.effectId === 'heal_target' ? resolvedValue : 0,
    };
  }

  applyCommitEffects(match) {
    const commitExecutionByAttackId = new Map();

    for (const attackerId of match.players) {
      const attacks = match.pendingCommitAttacksByPlayer.get(attackerId) || [];
      for (const attack of attacks) {
        const attackerState = match.cardsByPlayer.get(attackerId);
        const attackerCard = attackerState?.board?.find((card) => card.slotIndex === attack.attackerSlotIndex) || null;
        if (!attackerCard?.catalogCard) {
          commitExecutionByAttackId.set(attack.id, { executed: false, reason: 'attacker_missing' });
          continue;
        }

        const resolvedAttack = this.resolveCommitAttackStep(match, attackerId, attack);
        const executionResult = this.applyResolvedAbilityEffect({
          match,
          casterId: attackerId,
          targetSide: attack.targetSide,
          targetSlotIndex: attack.targetSlotIndex,
          effectId: resolvedAttack.effectId,
          resolvedValue: resolvedAttack.resolvedValue,
        });
        commitExecutionByAttackId.set(attack.id, executionResult);
      }
    }

    match.commitExecutionByAttackId = commitExecutionByAttackId;
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
          selectedAbilityIndex: Number.isInteger(card.selectedAbilityIndex) ? card.selectedAbilityIndex : 0,
        })) || [];
      pendingAttacks.set(playerId, attacks);
    });
    match.pendingCommitAttacksByPlayer = pendingAttacks;
    match.commitRollsByAttackId = new Map();
    match.commitExecutionByAttackId = new Map();
    match.commitCompletedPlayers = new Set();
    match.commitAnimationCompletedPlayers = new Set();
    match.commitAllRolledAt = null;
    match.phaseEndsAt = null;
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
      this.applyCommitEffects(match);
      match.commitAllRolledAt = Date.now();
    }

    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }


  completeCommitAnimations(payload) {
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
      return { error: 'cannot complete commit animations outside commit phase', statusCode: 409 };
    }

    if (!Number.isFinite(match.commitAllRolledAt)) {
      return { error: 'all commit rolls are not complete yet', statusCode: 409 };
    }

    match.commitAnimationCompletedPlayers.add(playerId);
    if (match.commitAnimationCompletedPlayers.size === match.players.length) {
      this.advanceMatchToDecisionPhase(match);
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
    const discard = Array.isArray(payload.discard) ? payload.discard : [];

    if (board.length > this.options.boardSlotsPerSide) {
      return { error: `board is limited to ${this.options.boardSlotsPerSide} cards` };
    }

    if (hand.length > this.options.maxHandSize) {
      return { error: `hand is limited to ${this.options.maxHandSize} cards` };
    }

    const visibleCards = [...playerState.hand, ...playerState.board, ...(Array.isArray(playerState.discard) ? playerState.discard : [])];
    const knownCards = new Map(visibleCards.map((card) => [card.id, card]));
    const merged = [...hand, ...board, ...discard];
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
      if (knownCard?.catalogCard?.cardKind === 'Spell') {
        return { error: `spell card ${knownCard.id} cannot be placed on the board` };
      }
      const cardWasAlreadyOnBoard = previousBoardIds.has(boardCard.id);
      normalizedBoard.push({
        ...knownCard,
        slotIndex: boardCard.slotIndex,
        summonedTurn: cardWasAlreadyOnBoard ? knownCard.summonedTurn : currentTurnNumber,
        attackCommitted: false,
        targetSlotIndex: null,
        targetSide: null,
        selectedAbilityIndex: 0,
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
      if (attack.selectedAbilityIndex != null && !Number.isInteger(attack.selectedAbilityIndex)) {
        return { error: 'selectedAbilityIndex must be an integer when provided' };
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
      attackerCard.selectedAbilityIndex = Number.isInteger(attack.selectedAbilityIndex) ? attack.selectedAbilityIndex : 0;
      seenAttackerSlots.add(attack.attackerSlotIndex);
    }

    return {
      hand: hand.map((card) => knownCards.get(card.id)),
      board: normalizedBoard,
      discard: discard.map((card) => knownCards.get(card.id)),
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
          discard: [],
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
        commitExecutionByAttackId: new Map(),
        commitCompletedPlayers: new Set(),
        commitAnimationCompletedPlayers: new Set(),
        commitAllRolledAt: null,
        activeSpellResolution: null,
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

    const activeSpell = match.activeSpellResolution;
    if (activeSpell && activeSpell.completedAt == null) {
      return { error: 'cannot ready while a spell is resolving', statusCode: 409 };
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
    playerState.discard = validated.discard;
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

    const activeSpell = match.activeSpellResolution;
    if (activeSpell && activeSpell.completedAt == null && activeSpell.casterId !== playerId) {
      return { error: 'cannot sync state while opponent spell is resolving', statusCode: 409 };
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
    playerState.discard = validated.discard;

    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }

  startSpellResolution(payload) {
    const { playerId, cardId, selectedAbilityIndex, targetSlotIndex, targetSide, rollType, dieSides } = payload || {};
    const status = this.phaseMatchmakingState.get(playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      return { error: 'player is not in an active match', statusCode: 409 };
    }

    const match = this.phaseMatches.get(status.matchId);
    if (!match) {
      return { error: 'active match not found', statusCode: 409 };
    }

    if (match.phase !== 1) {
      return { error: 'cannot cast spells outside decision phase', statusCode: 409 };
    }

    const existing = match.activeSpellResolution;
    if (existing && existing.completedAt == null) {
      return { error: 'another spell is currently resolving', statusCode: 409 };
    }

    const playerState = match.cardsByPlayer.get(playerId);
    const handCard = playerState?.hand?.find((card) => card.id === cardId);
    if (!handCard || handCard?.catalogCard?.cardKind !== 'Spell') {
      return { error: 'spell card is not available in player hand', statusCode: 400 };
    }

    const parsedDieSides = Number.parseInt(dieSides, 10);
    const spellId = `spell-${randomUUID().slice(0, 8)}`;
    match.activeSpellResolution = {
      id: spellId,
      casterId: playerId,
      cardId,
      cardSnapshot: {
        id: handCard.id,
        color: handCard.color,
        catalogCard: handCard.catalogCard || null,
      },
      selectedAbilityIndex: Number.isInteger(selectedAbilityIndex) ? selectedAbilityIndex : 0,
      targetSlotIndex: Number.isInteger(targetSlotIndex) ? targetSlotIndex : null,
      targetSide: targetSide === 'player' || targetSide === 'opponent' ? targetSide : null,
      rollType: typeof rollType === 'string' && rollType ? rollType : 'damage',
      dieSides: Number.isFinite(parsedDieSides) ? Math.max(2, parsedDieSides) : 6,
      rollOutcome: null,
      rollData: null,
      effectId: 'none',
      resolvedValue: 0,
      resolvedDamage: 0,
      resolvedHealing: 0,
      startedAt: Date.now(),
      completedAt: null,
    };

    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }

  submitSpellRoll(payload) {
    const { playerId, spellId, rollOutcome, rollData } = payload || {};
    const status = this.phaseMatchmakingState.get(playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      return { error: 'player is not in an active match', statusCode: 409 };
    }

    const match = this.phaseMatches.get(status.matchId);
    const active = match?.activeSpellResolution;
    if (!match || !active || active.completedAt != null) {
      return { error: 'no active spell to roll', statusCode: 409 };
    }
    if (active.id !== spellId) {
      return { error: 'spell id does not match active spell', statusCode: 409 };
    }
    if (active.casterId !== playerId) {
      return { error: 'only the caster may roll this spell', statusCode: 403 };
    }

    const parsedOutcome = Number.parseInt(rollOutcome, 10);
    if (!Number.isFinite(parsedOutcome) || parsedOutcome < 1) {
      return { error: 'rollOutcome must be a positive integer', statusCode: 400 };
    }

    active.rollOutcome = parsedOutcome;
    if (rollData && typeof rollData === 'object') {
      const roll = rollData.roll && typeof rollData.roll === 'object' ? rollData.roll : null;
      const sides = Number.parseInt(rollData.sides, 10);
      active.rollData = {
        roll,
        sides: Number.isFinite(sides) ? Math.max(2, sides) : active.dieSides,
      };
    } else {
      active.rollData = null;
    }
    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }

  completeSpellResolution(payload) {
    const { playerId, spellId } = payload || {};
    const status = this.phaseMatchmakingState.get(playerId);
    if (!status || status.status !== 'matched' || !status.matchId) {
      return { error: 'player is not in an active match', statusCode: 409 };
    }

    const match = this.phaseMatches.get(status.matchId);
    const active = match?.activeSpellResolution;
    if (!match || !active || active.completedAt != null) {
      return { error: 'no active spell to complete', statusCode: 409 };
    }
    if (active.id !== spellId) {
      return { error: 'spell id does not match active spell', statusCode: 409 };
    }
    if (active.casterId !== playerId) {
      return { error: 'only the caster may complete this spell', statusCode: 403 };
    }

    const spellCard = active.cardSnapshot?.catalogCard || null;
    const spellAbility = this.getAttackAbilityForCard({ catalogCard: spellCard }, active.selectedAbilityIndex);
    const resolvedValue = this.resolveAbilityValue({
      ability: spellAbility,
      rollValue: active.rollOutcome,
    });
    const effectId = spellAbility?.effectId || 'none';
    const executionResult = this.applyResolvedAbilityEffect({
      match,
      casterId: playerId,
      targetSide: active.targetSide,
      targetSlotIndex: active.targetSlotIndex,
      effectId,
      resolvedValue,
    });

    active.effectId = effectId;
    active.resolvedValue = resolvedValue;
    active.resolvedDamage = effectId === 'damage_enemy' && executionResult.executed !== false ? resolvedValue : 0;
    active.resolvedHealing = effectId === 'heal_target' && executionResult.executed !== false ? resolvedValue : 0;

    active.completedAt = Date.now();
    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }
}

module.exports = { PhaseManagerServer };
