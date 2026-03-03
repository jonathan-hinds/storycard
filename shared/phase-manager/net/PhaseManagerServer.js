const { randomUUID } = require('crypto');
const { DEFAULT_MESH_COLOR, normalizeCatalogCardDesign } = require('../../cards-catalog/catalogCardDesign');

const DEFAULT_CARD_MESH_COLOR = 0x000000;

const DEFAULT_OPTIONS = {
  deckSizePerPlayer: 10,
  startingHandSize: 3,
  maxHandSize: 7,
  boardSlotsPerSide: 3,
};

const MAX_UPKEEP = 10;
const TYPE_ADVANTAGE_MULTIPLIER = 1.5;
const TYPE_ADVANTAGE_BY_ATTACKER = {
  Fire: 'Nature',
  Nature: 'Arcane',
  Arcane: 'Water',
  Water: 'Fire',
};

const DOT_HANDLERS = {
  poison: {
    apply(card, durationTurns) {
      const currentTurns = Number.isInteger(card.poisonTurnsRemaining) ? card.poisonTurnsRemaining : 0;
      const currentStacks = Number.isInteger(card.poisonStacks) ? card.poisonStacks : 0;
      if (currentTurns > 0) {
        card.poisonTurnsRemaining = currentTurns + 1;
        card.poisonStacks = Math.max(1, currentStacks + 1);
        return;
      }
      card.poisonTurnsRemaining = durationTurns;
      card.poisonStacks = 1;
    },
    tick(card) {
      const turnsRemaining = Number.isInteger(card.poisonTurnsRemaining) ? card.poisonTurnsRemaining : 0;
      if (turnsRemaining < 1) {
        card.poisonTurnsRemaining = 0;
        card.poisonStacks = 0;
        return 0;
      }

      card.poisonTurnsRemaining = Math.max(0, turnsRemaining - 1);
      if (card.poisonTurnsRemaining < 1) {
        card.poisonStacks = 0;
      } else {
        card.poisonStacks = Number.isInteger(card.poisonStacks) ? Math.max(1, card.poisonStacks) : 1;
      }
      return 1;
    },
  },
  fire: {
    apply(card, durationTurns) {
      const currentTurns = Number.isInteger(card.fireTurnsRemaining) ? card.fireTurnsRemaining : 0;
      const currentStacks = Number.isInteger(card.fireStacks) ? card.fireStacks : 0;
      if (currentTurns > 0) {
        card.fireStacks = Math.max(1, currentStacks + 1);
        return;
      }

      card.fireTurnsRemaining = durationTurns;
      card.fireStacks = 1;
    },
    tick(card) {
      const turnsRemaining = Number.isInteger(card.fireTurnsRemaining) ? card.fireTurnsRemaining : 0;
      if (turnsRemaining < 1) {
        card.fireTurnsRemaining = 0;
        card.fireStacks = 0;
        return 0;
      }

      const fireStacks = Number.isInteger(card.fireStacks) ? Math.max(1, card.fireStacks) : 1;
      card.fireTurnsRemaining = Math.max(0, turnsRemaining - 1);
      if (card.fireTurnsRemaining < 1) {
        card.fireStacks = 0;
      } else {
        card.fireStacks = fireStacks;
      }
      return fireStacks;
    },
  },
  frostbite: {
    apply(card, durationTurns) {
      const currentTurns = Number.isInteger(card.frostbiteTurnsRemaining) ? card.frostbiteTurnsRemaining : 0;
      const currentStacks = Number.isInteger(card.frostbiteStacks) ? card.frostbiteStacks : 0;
      if (currentTurns > 0) {
        card.frostbiteStacks = Math.max(1, currentStacks + 1);
        return;
      }

      card.frostbiteTurnsRemaining = durationTurns;
      card.frostbiteStacks = 1;
    },
    tick(card) {
      const turnsRemaining = Number.isInteger(card.frostbiteTurnsRemaining) ? card.frostbiteTurnsRemaining : 0;
      if (turnsRemaining < 1) {
        card.frostbiteTurnsRemaining = 0;
        card.frostbiteStacks = 0;
        return 0;
      }

      const frostbiteStacks = Number.isInteger(card.frostbiteStacks) ? Math.max(1, card.frostbiteStacks) : 1;
      card.frostbiteTurnsRemaining = Math.max(0, turnsRemaining - 1);
      if (card.frostbiteTurnsRemaining < 1) {
        card.frostbiteStacks = 0;
      } else {
        card.frostbiteStacks = frostbiteStacks;
      }
      return 0;
    },
  },
};

const DISRUPTION_ROLL_STATS = Object.freeze(['damage', 'speed', 'defense']);

function normalizeDisruptionTargetStat(stat) {
  const normalized = typeof stat === 'string' ? stat.trim().toLowerCase() : '';
  if (normalized === 'damage' || normalized === 'dmg' || normalized === 'efct') return 'damage';
  if (normalized === 'speed' || normalized === 'spd') return 'speed';
  if (normalized === 'defense' || normalized === 'def') return 'defense';
  return 'damage';
}

function createEmptyDisruptionDebuffs() {
  return {
    damage: 0,
    speed: 0,
    defense: 0,
  };
}

function normalizeRollOutcome(outcome) {
  return Number.isFinite(outcome) ? Math.max(0, Math.floor(outcome)) : null;
}

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
    const index = this.phaseQueue.findIndex((entry) => entry.playerId === playerId);
    return index === -1 ? null : index + 1;
  }

  removeFromQueue(playerId) {
    const index = this.phaseQueue.findIndex((entry) => entry.playerId === playerId);
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

  normalizeBoardTargetSlotIndex(targetSlotIndex, targetSide) {
    if (!Number.isInteger(targetSlotIndex)) return null;
    const boardSlotsPerSide = this.options.boardSlotsPerSide;
    if (targetSlotIndex < 0) return null;
    if (targetSlotIndex < boardSlotsPerSide) return targetSlotIndex;
    if (targetSide === 'player' && targetSlotIndex < boardSlotsPerSide * 2) {
      return targetSlotIndex - boardSlotsPerSide;
    }
    return null;
  }


  getActiveTauntCardsForDefender(match, defenderId) {
    const defenderState = match?.cardsByPlayer?.get(defenderId);
    if (!defenderState?.board) return [];
    return defenderState.board
      .filter((card) => Number.isInteger(card?.tauntTurnsRemaining) && card.tauntTurnsRemaining > 0)
      .sort((a, b) => {
        const aHealth = Number(a?.catalogCard?.health);
        const bHealth = Number(b?.catalogCard?.health);
        const normalizedAHealth = Number.isFinite(aHealth) ? aHealth : 0;
        const normalizedBHealth = Number.isFinite(bHealth) ? bHealth : 0;
        if (normalizedBHealth !== normalizedAHealth) return normalizedBHealth - normalizedAHealth;
        return a.slotIndex - b.slotIndex;
      });
  }

  forceAttacksToTauntTarget(match, attackerId) {
    if (!match || !attackerId) return;
    const defenderId = match.players.find((id) => id !== attackerId);
    if (!defenderId) return;
    const tauntCards = this.getActiveTauntCardsForDefender(match, defenderId);
    if (!tauntCards.length) return;

    const forcedTargetSlotIndex = tauntCards[0].slotIndex;
    const attackerState = match.cardsByPlayer.get(attackerId);
    for (const card of attackerState?.board || []) {
      if (card?.targetSide !== 'opponent' || !Number.isInteger(card?.targetSlotIndex)) continue;
      if (card.targetSlotIndex === forcedTargetSlotIndex) continue;
      card.targetSlotIndex = forcedTargetSlotIndex;
    }
  }

  resolveAttackTargetForTaunt(match, attackerId, attack) {
    if (!attack || attack.targetSide !== 'opponent' || !Number.isInteger(attack.targetSlotIndex)) {
      return attack;
    }
    const defenderId = match.players.find((id) => id !== attackerId);
    if (!defenderId) return attack;
    const tauntCards = this.getActiveTauntCardsForDefender(match, defenderId);
    if (!tauntCards.length) return attack;
    const selectedIsTaunt = tauntCards.some((card) => card.slotIndex === attack.targetSlotIndex);
    if (selectedIsTaunt) return attack;
    return {
      ...attack,
      originalTargetSlotIndex: attack.targetSlotIndex,
      originalTargetSide: attack.targetSide,
      targetSlotIndex: tauntCards[0].slotIndex,
      targetSide: 'opponent',
      redirectedByTaunt: true,
    };
  }

  buildDeckFromCatalog(playerId, catalogCards = [], preferredDeckCardIds = []) {
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
        tauntTurnsRemaining: 0,
        silenceTurnsRemaining: 0,
        poisonTurnsRemaining: 0,
        poisonStacks: 0,
        fireTurnsRemaining: 0,
        fireStacks: 0,
        frostbiteTurnsRemaining: 0,
        frostbiteStacks: 0,
        disruptionDebuffTurnsRemaining: 0,
        disruptionDebuffs: createEmptyDisruptionDebuffs(),
      }));
    }

    const cardPool = catalogCards
      .map((catalogCard) => normalizeCatalogCardDesign(catalogCard))
      .filter((catalogCard) => catalogCard && typeof catalogCard === 'object');
    const cardById = new Map(cardPool.map((catalogCard) => [String(catalogCard.id || ''), catalogCard]));

    const preferredCards = preferredDeckCardIds
      .map((cardId) => cardById.get(cardId))
      .filter(Boolean);

    const deckCards = [];
    preferredCards.slice(0, this.options.deckSizePerPlayer).forEach((catalogCard) => {
      deckCards.push(catalogCard);
    });

    while (deckCards.length < this.options.deckSizePerPlayer) {
      const randomCard = cardPool[Math.floor(Math.random() * cardPool.length)] || {};
      deckCards.push(randomCard);
    }

    return deckCards.map((normalizedCard, index) => {
      const cardInstance = normalizeCatalogCardDesign(normalizedCard);
      return {
        id: `${playerId}-card-${index + 1}`,
        color: this.colorFromHexString(cardInstance.meshColor),
        catalogCard: cardInstance,
        summonedTurn: null,
        attackCommitted: false,
        targetSlotIndex: null,
        targetSide: null,
        selectedAbilityIndex: 0,
        tauntTurnsRemaining: 0,
        silenceTurnsRemaining: 0,
        poisonTurnsRemaining: 0,
        poisonStacks: 0,
        fireTurnsRemaining: 0,
        fireStacks: 0,
        frostbiteTurnsRemaining: 0,
        frostbiteStacks: 0,
        disruptionDebuffTurnsRemaining: 0,
        disruptionDebuffs: createEmptyDisruptionDebuffs(),
      };
    });
  }

  shuffleCards(cards = []) {
    const shuffled = [...cards];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const current = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = current;
    }
    return shuffled;
  }

  buildOpeningZones(deckCards = []) {
    const shuffledDeck = this.shuffleCards(deckCards);
    const openingHandSize = Math.min(this.options.startingHandSize, shuffledDeck.length);
    const hand = shuffledDeck.slice(0, openingHandSize);
    const deck = shuffledDeck.slice(openingHandSize);
    const handHasCreature = hand.some((card) => card?.catalogCard?.cardKind === 'Creature');

    if (!handHasCreature) {
      const creatureIndexInDeck = deck.findIndex((card) => card?.catalogCard?.cardKind === 'Creature');
      if (creatureIndexInDeck !== -1 && hand.length) {
        const [creatureCard] = deck.splice(creatureIndexInDeck, 1);
        const displacedCard = hand[0];
        hand[0] = creatureCard;
        deck.unshift(displacedCard);
      }
    }

    return { hand, deck };
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
    const pendingAttackById = new Map();
    for (const attackerId of match?.players || []) {
      for (const attack of match.pendingCommitAttacksByPlayer?.get(attackerId) || []) {
        pendingAttackById.set(attack.id, { attackerId, attack });
      }
    }

    const orderedEntries = Array.isArray(match.executedCommitAttackIds) && match.executedCommitAttackIds.length
      ? match.executedCommitAttackIds
        .map((attackId) => pendingAttackById.get(attackId))
        .filter(Boolean)
      : this.getOrderedCommitAttacks(match).map((entry) => ({ attackerId: entry.attackerId, attack: entry.attack }));

    const defaultOrderedByAttackId = new Map(this.getOrderedCommitAttacks(match).map((entry) => [entry.attack.id, entry]));

    for (const { attackerId, attack } of orderedEntries) {
      const attackerSide = attackerId === playerId ? 'player' : 'opponent';
      const resolvedAttack = {
        ...this.resolveCommitAttackStep(match, attackerId, attack),
        attackerId,
        attackerSide,
      };

      const executionState = match.commitExecutionByAttackId?.get(attack.id);
      if (executionState && executionState.executed === false) {
        continue;
      }

      const defaultOrdered = defaultOrderedByAttackId.get(attack.id);
      resolvedAttack.speedOutcome = Number.isFinite(executionState?.speedOutcome)
        ? executionState.speedOutcome
        : (Number.isFinite(defaultOrdered?.speedOutcome) ? defaultOrdered.speedOutcome : 0);
      resolvedAttack.adjustedSpeedOutcome = Number.isFinite(executionState?.adjustedSpeedOutcome)
        ? executionState.adjustedSpeedOutcome
        : (Number.isFinite(defaultOrdered?.adjustedSpeedOutcome) ? defaultOrdered.adjustedSpeedOutcome : 0);
      resolvedAttack.frostbiteStacks = Number.isFinite(executionState?.frostbiteStacks)
        ? executionState.frostbiteStacks
        : (Number.isFinite(defaultOrdered?.frostbiteStacks) ? defaultOrdered.frostbiteStacks : 0);

      const adjustedRollOutcomes = {};
      DISRUPTION_ROLL_STATS.forEach((rollType) => {
        const rollEntry = match.commitRollsByAttackId?.get(`${attack.id}:${rollType}`);
        const currentOutcome = normalizeRollOutcome(Number(rollEntry?.roll?.outcome));
        const originalOutcome = Number.isFinite(rollEntry?.originalOutcome)
          ? normalizeRollOutcome(rollEntry.originalOutcome)
          : currentOutcome;
        if (!Number.isFinite(currentOutcome) || !Number.isFinite(originalOutcome)) return;
        if (currentOutcome !== originalOutcome || Number.isFinite(rollEntry?.disruptionAmount)) {
          adjustedRollOutcomes[rollType] = currentOutcome;
        }
      });
      resolvedAttack.adjustedRollOutcomes = Object.keys(adjustedRollOutcomes).length ? adjustedRollOutcomes : null;

      const disruptionRollEntry = DISRUPTION_ROLL_STATS
        .map((rollType) => match.commitRollsByAttackId?.get(`${attack.id}:${rollType}`))
        .find((rollEntry) => Number.isFinite(rollEntry?.disruptionAmount) && typeof rollEntry?.disruptionTargetStat === 'string');
      resolvedAttack.disruptionTargetStat = typeof disruptionRollEntry?.disruptionTargetStat === 'string'
        ? disruptionRollEntry.disruptionTargetStat
        : null;
      resolvedAttack.disruptionAdjustedOutcome = Number.isFinite(disruptionRollEntry?.roll?.outcome)
        ? Math.max(0, Math.floor(disruptionRollEntry.roll.outcome))
        : null;

      if (executionState) {
        resolvedAttack.resolvedLifeStealHealing = Number.isFinite(executionState.lifeStealHealing)
          ? executionState.lifeStealHealing
          : resolvedAttack.resolvedLifeStealHealing;
        resolvedAttack.lifeStealNetHealing = Number.isFinite(executionState.lifeStealNetHealing)
          ? executionState.lifeStealNetHealing
          : 0;
        resolvedAttack.retaliationDamage = Number.isFinite(executionState.retaliationDamage)
          ? executionState.retaliationDamage
          : 0;
        resolvedAttack.retaliationBlockedByDefense = Number.isFinite(executionState.retaliationBlockedByDefense)
          ? executionState.retaliationBlockedByDefense
          : 0;
        resolvedAttack.retaliationAppliedDamage = Number.isFinite(executionState.retaliationAppliedDamage)
          ? executionState.retaliationAppliedDamage
          : 0;
        resolvedAttack.attackDefense = Number.isFinite(executionState.attackDefense)
          ? executionState.attackDefense
          : 0;
        resolvedAttack.defenseRemaining = Number.isFinite(executionState.defenseRemaining)
          ? executionState.defenseRemaining
          : 0;
        resolvedAttack.disruptionTargetStat = typeof executionState.disruptionTargetStat === 'string'
          ? executionState.disruptionTargetStat
          : null;
        resolvedAttack.disruptionAdjustedOutcome = Number.isFinite(executionState.disruptionAdjustedOutcome)
          ? executionState.disruptionAdjustedOutcome
          : null;
      }

      commitAttacks.push(resolvedAttack);
    }

    const activeSpellResolution = match.activeSpellResolution
      ? {
        ...match.activeSpellResolution,
        casterSide: match.activeSpellResolution.casterId === playerId ? 'player' : 'opponent',
      }
      : null;

    if (activeSpellResolution) {
      const viewerIsCaster = activeSpellResolution.casterId === playerId;
      if (!viewerIsCaster && activeSpellResolution.targetSide) {
        activeSpellResolution.targetSide = activeSpellResolution.targetSide === 'player' ? 'opponent' : 'player';
      }
      if (!viewerIsCaster && (activeSpellResolution.lifeStealHealingTargetSide === 'player' || activeSpellResolution.lifeStealHealingTargetSide === 'opponent')) {
        activeSpellResolution.lifeStealHealingTargetSide = activeSpellResolution.lifeStealHealingTargetSide === 'player' ? 'opponent' : 'player';
      }
    }

    return {
      id: match.id,
      turnNumber: match.turnNumber,
      upkeep: match.upkeep,
      upkeepTotal: MAX_UPKEEP,
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
        dotDamageEvents: (Array.isArray(match.lastDotDamageEvents) ? match.lastDotDamageEvents : []).map((event) => ({
          ...event,
          side: event.playerId === playerId ? 'player' : 'opponent',
        })),
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

  applyDamageOverTimeAtPhaseChange(match) {
    if (!match?.cardsByPlayer) return [];
    const events = [];

    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      if (!playerState?.board?.length) return;

      playerState.board.forEach((card) => {
        const appliedDebuffs = [];
        let totalDamage = 0;

        Object.entries(DOT_HANDLERS).forEach(([dotId, dotHandler]) => {
          const dotDamage = dotHandler.tick(card);
          if (dotDamage < 1) return;
          appliedDebuffs.push(dotId);
          totalDamage += dotDamage;
        });

        if (totalDamage < 1) return;

        const currentHealth = Number(card?.catalogCard?.health);
        if (!Number.isFinite(currentHealth)) return;
        const nextHealth = currentHealth - totalDamage;
        card.catalogCard.health = nextHealth;
        events.push({
          playerId,
          cardId: card.id,
          slotIndex: Number.isInteger(card.slotIndex) ? card.slotIndex : null,
          damage: totalDamage,
          appliedDebuffs,
          resultingHealth: nextHealth,
        });
      });
    });

    return events;
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
    match.upkeep = Math.min(MAX_UPKEEP, match.upkeep + 1);
    match.phase = 1;
    match.phaseStartedAt = Date.now();
    match.phaseEndsAt = null;
    match.readyPlayers.clear();
    match.pendingCommitAttacksByPlayer = new Map();
    match.commitRollsByAttackId = new Map();
    match.commitExecutionByAttackId = new Map();
    match.executedCommitAttackIds = [];
    match.commitAnimationCompletedPlayers = new Set();
    match.activeSpellResolution = null;
    match.lastDotDamageEvents = this.applyDamageOverTimeAtPhaseChange(match);
    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      if (!playerState) return;
      playerState.board = playerState.board.map((card) => ({
        ...card,
        retaliationBonus: 0,
        attackCommitted: false,
        targetSlotIndex: null,
        targetSide: null,
        selectedAbilityIndex: 0,
        tauntTurnsRemaining: Math.max(0, (Number.isInteger(card.tauntTurnsRemaining) ? card.tauntTurnsRemaining : 0) - 1),
        silenceTurnsRemaining: Math.max(0, (Number.isInteger(card.silenceTurnsRemaining) ? card.silenceTurnsRemaining : 0) - 1),
        poisonTurnsRemaining: Number.isInteger(card.poisonTurnsRemaining) ? card.poisonTurnsRemaining : 0,
        poisonStacks: Number.isInteger(card.poisonStacks) ? card.poisonStacks : 0,
        fireTurnsRemaining: Number.isInteger(card.fireTurnsRemaining) ? card.fireTurnsRemaining : 0,
        fireStacks: Number.isInteger(card.fireStacks) ? card.fireStacks : 0,
        frostbiteTurnsRemaining: Number.isInteger(card.frostbiteTurnsRemaining) ? card.frostbiteTurnsRemaining : 0,
        frostbiteStacks: Number.isInteger(card.frostbiteStacks) ? card.frostbiteStacks : 0,
        disruptionDebuffTurnsRemaining: Math.max(0, (Number.isInteger(card.disruptionDebuffTurnsRemaining) ? card.disruptionDebuffTurnsRemaining : 0) - 1),
        disruptionDebuffs: createEmptyDisruptionDebuffs(),
      }));
    });
    this.applyDecisionPhaseStartDraw(match);
  }


  applySpellDisruptionDebuff({ match, casterId, targetSide, targetSlotIndex, enemyValueSourceStat, resolvedValue }) {
    if (!match || !casterId || targetSide !== 'opponent' || !Number.isInteger(targetSlotIndex)) {
      return { executed: false, reason: 'target_missing' };
    }
    const disruptionTargetStat = normalizeDisruptionTargetStat(enemyValueSourceStat);
    const normalizedValue = Number.isFinite(resolvedValue)
      ? Math.max(0, Math.floor(resolvedValue))
      : 0;
    if (normalizedValue < 1) {
      return { executed: false, reason: 'no_value' };
    }

    const defenderId = match.players.find((id) => id !== casterId);
    if (!defenderId) return { executed: false, reason: 'target_missing' };
    const defenderState = match.cardsByPlayer.get(defenderId);
    const defenderCard = defenderState?.board?.find((card) => card.slotIndex === targetSlotIndex) || null;
    if (!defenderCard) return { executed: false, reason: 'target_missing' };

    const existingDebuffs = defenderCard.disruptionDebuffs && typeof defenderCard.disruptionDebuffs === 'object'
      ? defenderCard.disruptionDebuffs
      : createEmptyDisruptionDebuffs();
    const nextDebuffs = {
      ...createEmptyDisruptionDebuffs(),
      ...existingDebuffs,
    };
    const currentStatDebuff = Number(nextDebuffs[disruptionTargetStat]);
    nextDebuffs[disruptionTargetStat] = (Number.isFinite(currentStatDebuff) ? Math.max(0, Math.floor(currentStatDebuff)) : 0) + normalizedValue;

    defenderCard.disruptionDebuffTurnsRemaining = 1;
    defenderCard.disruptionDebuffs = nextDebuffs;
    return {
      executed: true,
      reason: 'spell_disruption_debuff_applied',
      appliedValue: normalizedValue,
      disruptionTargetStat,
      disruptionAdjustedOutcome: null,
    };
  }

  applySpellDisruptionDebuffToCommitRoll({ match, attackerId, attackId, rollType }) {
    if (!match?.cardsByPlayer || !match?.pendingCommitAttacksByPlayer || !match?.commitRollsByAttackId) return;
    if (!attackerId || typeof attackId !== 'string' || typeof rollType !== 'string') return;

    const normalizedRollType = normalizeDisruptionTargetStat(rollType);
    const rollEntry = match.commitRollsByAttackId.get(`${attackId}:${normalizedRollType}`);
    if (!rollEntry?.roll || rollEntry.disruptionSource === 'spell') return;

    const attack = (match.pendingCommitAttacksByPlayer.get(attackerId) || [])
      .find((entry) => entry?.id === attackId);
    if (!attack || !Number.isInteger(attack.attackerSlotIndex)) return;

    const attackerState = match.cardsByPlayer.get(attackerId);
    const attackerCard = attackerState?.board?.find((card) => card.slotIndex === attack.attackerSlotIndex) || null;
    if (!attackerCard) return;

    const turnsRemaining = Number.isInteger(attackerCard.disruptionDebuffTurnsRemaining)
      ? attackerCard.disruptionDebuffTurnsRemaining
      : 0;
    if (turnsRemaining < 1) return;

    const disruptionDebuffs = attackerCard.disruptionDebuffs && typeof attackerCard.disruptionDebuffs === 'object'
      ? attackerCard.disruptionDebuffs
      : null;
    if (!disruptionDebuffs) return;

    const debuffValue = Number(disruptionDebuffs[normalizedRollType]);
    const normalizedDebuffValue = Number.isFinite(debuffValue)
      ? Math.max(0, Math.floor(debuffValue))
      : 0;
    if (normalizedDebuffValue < 1) return;

    this.applyCommitRollPenalty({
      match,
      attackId,
      rollType: normalizedRollType,
      penaltyValue: normalizedDebuffValue,
      source: 'spell',
      targetStat: normalizedRollType,
    });
  }

  applyPendingSpellDisruptionDebuffsToCommitRolls(match) {
    if (!match?.cardsByPlayer || !match?.pendingCommitAttacksByPlayer || !match?.commitRollsByAttackId) return;

    for (const playerId of match.players || []) {
      const playerState = match.cardsByPlayer.get(playerId);
      if (!playerState) continue;
      for (const card of playerState.board || []) {
        const turnsRemaining = Number.isInteger(card?.disruptionDebuffTurnsRemaining) ? card.disruptionDebuffTurnsRemaining : 0;
        if (turnsRemaining < 1) continue;
        const disruptionDebuffs = card?.disruptionDebuffs && typeof card.disruptionDebuffs === 'object'
          ? card.disruptionDebuffs
          : null;
        if (!disruptionDebuffs) continue;

        const attack = this.findPendingAttackBySlot(match, playerId, card.slotIndex);
        if (!attack?.id) continue;

        DISRUPTION_ROLL_STATS.forEach((rollStat) => {
          const debuffValue = Number(disruptionDebuffs[rollStat]);
          const normalizedDebuffValue = Number.isFinite(debuffValue)
            ? Math.max(0, Math.floor(debuffValue))
            : 0;
          if (normalizedDebuffValue < 1) return;

          const existingRollEntry = match.commitRollsByAttackId.get(`${attack.id}:${rollStat}`);
          if (existingRollEntry?.disruptionSource === 'spell') return;

          this.applyCommitRollPenalty({
            match,
            attackId: attack.id,
            rollType: rollStat,
            penaltyValue: normalizedDebuffValue,
            source: 'spell',
            targetStat: rollStat,
          });
        });
      }
    }
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
    const outcome = normalizeRollOutcome(Number(rollEntry?.roll?.outcome));
    return Number.isFinite(outcome) ? outcome : 0;
  }

  applyCommitRollPenalty({ match, attackId, rollType, penaltyValue, source = null, targetStat = null }) {
    if (!match?.commitRollsByAttackId || typeof attackId !== 'string' || typeof rollType !== 'string') return null;
    const normalizedPenalty = normalizeRollOutcome(Number(penaltyValue));
    if (!Number.isFinite(normalizedPenalty) || normalizedPenalty < 1) return null;

    const rollEntry = match.commitRollsByAttackId.get(`${attackId}:${rollType}`);
    const currentOutcome = normalizeRollOutcome(Number(rollEntry?.roll?.outcome));
    if (!rollEntry?.roll || !Number.isFinite(currentOutcome)) return null;

    if (!Number.isFinite(rollEntry.originalOutcome)) {
      rollEntry.originalOutcome = currentOutcome;
    }

    const adjustedOutcome = Math.max(0, currentOutcome - normalizedPenalty);
    rollEntry.roll = { ...rollEntry.roll, outcome: adjustedOutcome };
    rollEntry.disruptionAmount = normalizedPenalty;
    rollEntry.disruptionTargetStat = targetStat || rollType;
    if (typeof source === 'string' && source) {
      rollEntry.disruptionSource = source;
    }
    return adjustedOutcome;
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

  findPendingAttackBySlot(match, attackerId, slotIndex) {
    if (!match || !attackerId || !Number.isInteger(slotIndex)) return null;
    const attacks = match.pendingCommitAttacksByPlayer?.get(attackerId) || [];
    return attacks.find((attack) => attack?.attackerSlotIndex === slotIndex) || null;
  }

  normalizeCardType(cardType) {
    return typeof cardType === 'string' ? cardType.trim() : '';
  }


  resolveBuffTarget({ match, casterId, attack, buffTarget }) {
    if (!match || !casterId) return { targetPlayerId: null, targetSlotIndex: null };
    if (buffTarget === 'self') {
      return {
        targetPlayerId: casterId,
        targetSlotIndex: Number.isInteger(attack?.attackerSlotIndex) ? attack.attackerSlotIndex : null,
      };
    }
    if (buffTarget === 'friendly') {
      if (attack?.targetSide === 'player' && Number.isInteger(attack?.targetSlotIndex)) {
        return { targetPlayerId: casterId, targetSlotIndex: attack.targetSlotIndex };
      }
      return { targetPlayerId: null, targetSlotIndex: null };
    }
    if (buffTarget === 'enemy') {
      if (attack?.targetSide === 'opponent' && Number.isInteger(attack?.targetSlotIndex)) {
        const enemyPlayerId = match.players.find((id) => id !== casterId) || null;
        return { targetPlayerId: enemyPlayerId, targetSlotIndex: attack.targetSlotIndex };
      }
      return { targetPlayerId: null, targetSlotIndex: null };
    }
    return { targetPlayerId: null, targetSlotIndex: null };
  }

  applyResolvedAbilityBuff({ match, casterId, attack, buffId, buffTarget, durationTurns }) {
    if (!match || !casterId) return { executed: false, reason: 'caster_missing' };
    if (buffId !== 'taunt' && buffId !== 'silence' && buffId !== 'poison' && buffId !== 'fire' && buffId !== 'frostbite') {
      return { executed: true, reason: 'no_buff' };
    }
    const normalizedDuration = Number.isInteger(durationTurns) ? Math.max(0, durationTurns) : 0;
    if (normalizedDuration < 1) return { executed: false, reason: 'invalid_duration' };

    const { targetPlayerId, targetSlotIndex } = this.resolveBuffTarget({ match, casterId, attack, buffTarget });
    if (!targetPlayerId || !Number.isInteger(targetSlotIndex)) {
      return { executed: false, reason: 'target_missing' };
    }

    const targetState = match.cardsByPlayer.get(targetPlayerId);
    const targetCard = targetState?.board?.find((card) => card.slotIndex === targetSlotIndex) || null;
    if (!targetCard) {
      return { executed: false, reason: 'target_missing' };
    }

    if (buffId === 'taunt') {
      targetCard.tauntTurnsRemaining = normalizedDuration;
      const opposingPlayerId = match.players.find((id) => id !== targetPlayerId);
      this.forceAttacksToTauntTarget(match, opposingPlayerId);
      return { executed: true, reason: 'taunt_applied' };
    }

    if (buffId === 'silence') {
      targetCard.silenceTurnsRemaining = normalizedDuration;
      return { executed: true, reason: 'silence_applied' };
    }

    if (buffId === 'poison' || buffId === 'fire' || buffId === 'frostbite') {
      const dotHandler = DOT_HANDLERS[buffId];
      dotHandler?.apply(targetCard, normalizedDuration);
      return { executed: true, reason: `${buffId}_applied` };
    }

    return { executed: true, reason: 'no_buff' };
  }

  applyTypeAdvantageToValue({ effectId, resolvedValue, sourceType, targetType }) {
    const normalizedResolvedValue = Number.isFinite(resolvedValue)
      ? Math.max(0, Math.floor(resolvedValue))
      : 0;
    if (normalizedResolvedValue <= 0) return normalizedResolvedValue;

    const normalizedSourceType = this.normalizeCardType(sourceType);
    const normalizedTargetType = this.normalizeCardType(targetType);

    let hasAdvantage = false;
    if (effectId === 'damage_enemy') {
      hasAdvantage = TYPE_ADVANTAGE_BY_ATTACKER[normalizedSourceType] === normalizedTargetType;
    } else if (effectId === 'heal_target' || effectId === 'retaliation_bonus' || effectId === 'life_steal') {
      hasAdvantage = normalizedSourceType && normalizedSourceType === normalizedTargetType;
    }

    if (!hasAdvantage) {
      return normalizedResolvedValue;
    }

    return Math.ceil(normalizedResolvedValue * TYPE_ADVANTAGE_MULTIPLIER);
  }

  getTargetCardForEffect({ match, casterId, targetSide, targetSlotIndex }) {
    if (!match || !casterId || !Number.isInteger(targetSlotIndex)) return null;
    const targetPlayerId = targetSide === 'player'
      ? casterId
      : match.players.find((id) => id !== casterId);
    if (!targetPlayerId) return null;
    const targetState = match.cardsByPlayer.get(targetPlayerId);
    return targetState?.board?.find((card) => card.slotIndex === targetSlotIndex) || null;
  }

  resolveTypeAdjustedAbilityValue({ match, casterId, targetSide, targetSlotIndex, effectId, resolvedValue, sourceType }) {
    const targetCard = this.getTargetCardForEffect({ match, casterId, targetSide, targetSlotIndex });
    const targetType = targetCard?.catalogCard?.type;
    return this.applyTypeAdvantageToValue({
      effectId,
      resolvedValue,
      sourceType,
      targetType,
    });
  }

  selectRandomFriendlyLifeStealTarget({ match, casterId, spellId = '' }) {
    if (!match || !casterId) return null;
    const casterState = match.cardsByPlayer.get(casterId);
    const friendlyBoardCards = (casterState?.board || []).filter((card) => card?.catalogCard);
    if (!friendlyBoardCards.length) return null;

    let seed = 0;
    const normalizedSpellId = String(spellId || '');
    for (let index = 0; index < normalizedSpellId.length; index += 1) {
      seed = ((seed * 31) + normalizedSpellId.charCodeAt(index)) >>> 0;
    }
    const selectedIndex = seed % friendlyBoardCards.length;
    return friendlyBoardCards[selectedIndex] || null;
  }

  applyResolvedAbilityEffect({
    match,
    casterId,
    targetSide,
    targetSlotIndex,
    effectId,
    resolvedValue,
    sourceType,
    enemyValueSourceStat = null,
  }) {
    if (!match || !casterId) return { executed: false, reason: 'caster_missing' };
    if (effectId !== 'damage_enemy' && effectId !== 'heal_target' && effectId !== 'retaliation_bonus' && effectId !== 'life_steal' && effectId !== 'disruption') {
      return { executed: true, reason: 'no_effect' };
    }

    const adjustedResolvedValue = this.resolveTypeAdjustedAbilityValue({
      match,
      casterId,
      targetSide,
      targetSlotIndex,
      effectId,
      resolvedValue,
      sourceType,
    });
    const hasDamage = (effectId === 'damage_enemy' || effectId === 'disruption') && adjustedResolvedValue > 0;
    const hasLifeSteal = effectId === 'life_steal' && adjustedResolvedValue > 0;
    const hasHealing = effectId === 'heal_target' && adjustedResolvedValue > 0;
    const hasRetaliationBonus = effectId === 'retaliation_bonus' && adjustedResolvedValue > 0;
    if (!hasDamage && !hasHealing && !hasRetaliationBonus && !hasLifeSteal) {
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

    if (effectId === 'retaliation_bonus') {
      const existingBonus = Number(defenderCard.retaliationBonus);
      const normalizedExistingBonus = Number.isFinite(existingBonus)
        ? Math.max(0, Math.floor(existingBonus))
        : 0;
      defenderCard.retaliationBonus = normalizedExistingBonus + adjustedResolvedValue;
      return { executed: true, appliedValue: adjustedResolvedValue };
    }

    if (effectId === 'disruption') {
      const disruptionTargetStat = ['damage', 'speed', 'defense'].includes(enemyValueSourceStat)
        ? enemyValueSourceStat
        : 'damage';
      const defenderAttack = this.findPendingAttackBySlot(match, defenderId, targetSlotIndex);
      if (defenderAttack?.id) {
        const adjustedOutcome = this.applyCommitRollPenalty({
          match,
          attackId: defenderAttack.id,
          rollType: disruptionTargetStat,
          penaltyValue: adjustedResolvedValue,
          source: 'attack',
          targetStat: disruptionTargetStat,
        });
        if (Number.isFinite(adjustedOutcome)) {
          const rollEntry = match.commitRollsByAttackId?.get(`${defenderAttack.id}:${disruptionTargetStat}`);
          if (rollEntry) rollEntry.disruptedByAttackId = defenderAttack.id;
          return {
            executed: true,
            appliedValue: adjustedResolvedValue,
            reason: 'disruption_applied',
            disruptedAttackId: defenderAttack.id,
            disruptionTargetStat,
            disruptionAdjustedOutcome: adjustedOutcome,
          };
        }
      }
    }

    const currentHealth = Number(defenderCard.catalogCard.health);
    if (!Number.isFinite(currentHealth)) {
      return { executed: false, reason: 'target_invalid' };
    }

    const nextHealth = (effectId === 'damage_enemy' || effectId === 'life_steal' || effectId === 'disruption')
      ? currentHealth - adjustedResolvedValue
      : currentHealth + adjustedResolvedValue;
    defenderCard.catalogCard.health = nextHealth;

    if (nextHealth <= 0) {
      defenderState.board = defenderState.board.filter((card) => card !== defenderCard);
    }

    return {
      executed: true,
      appliedValue: adjustedResolvedValue,
      reason: effectId === 'disruption' ? 'disruption_damage_fallback' : 'effect_applied',
    };
  }


  applyRetaliationDamage({ match, attackerId, attackerSlotIndex, retaliationDamage = 0, attackDefense = 0 }) {
    if (!match || !attackerId || !Number.isInteger(attackerSlotIndex)) {
      return {
        retaliationDamage: 0,
        retaliationBlockedByDefense: 0,
        retaliationAppliedDamage: 0,
        attackDefense: 0,
        defenseRemaining: 0,
      };
    }

    const normalizedRetaliationDamage = Number.isFinite(retaliationDamage)
      ? Math.max(0, Math.floor(retaliationDamage))
      : 0;
    const normalizedAttackDefense = Number.isFinite(attackDefense)
      ? Math.max(0, Math.floor(attackDefense))
      : 0;
    const retaliationBlockedByDefense = Math.min(normalizedRetaliationDamage, normalizedAttackDefense);
    const retaliationAppliedDamage = Math.max(0, normalizedRetaliationDamage - normalizedAttackDefense);
    const defenseRemaining = Math.max(0, normalizedAttackDefense - retaliationBlockedByDefense);

    if (retaliationAppliedDamage <= 0) {
      return {
        retaliationDamage: normalizedRetaliationDamage,
        retaliationBlockedByDefense,
        retaliationAppliedDamage,
        attackDefense: normalizedAttackDefense,
        defenseRemaining,
      };
    }

    const attackerState = match.cardsByPlayer.get(attackerId);
    const attackerCard = attackerState?.board?.find((card) => card.slotIndex === attackerSlotIndex);
    const currentHealth = Number(attackerCard?.catalogCard?.health);
    if (!attackerCard?.catalogCard || !Number.isFinite(currentHealth)) {
      return {
        retaliationDamage: normalizedRetaliationDamage,
        retaliationBlockedByDefense,
        retaliationAppliedDamage: 0,
        attackDefense: normalizedAttackDefense,
        defenseRemaining,
      };
    }

    const nextHealth = currentHealth - retaliationAppliedDamage;
    attackerCard.catalogCard.health = nextHealth;

    if (nextHealth <= 0) {
      attackerState.board = attackerState.board.filter((card) => card !== attackerCard);
    }

    return {
      retaliationDamage: normalizedRetaliationDamage,
      retaliationBlockedByDefense,
      retaliationAppliedDamage,
      attackDefense: normalizedAttackDefense,
      defenseRemaining,
    };
  }

  resolveCommitAttackStep(match, attackerId, attack) {
    const attackerState = match.cardsByPlayer.get(attackerId);
    const attackerCard = attackerState?.board?.find((card) => card.slotIndex === attack.attackerSlotIndex) || null;
    const ability = this.getAttackAbilityForCard(attackerCard, attack.selectedAbilityIndex);
    const baseResolvedValue = this.resolveAttackValue({
      ability,
      attackId: attack.id,
      commitRollsByAttackId: match.commitRollsByAttackId,
    });
    const resolvedValue = this.resolveTypeAdjustedAbilityValue({
      match,
      casterId: attackerId,
      targetSide: attack.targetSide,
      targetSlotIndex: attack.targetSlotIndex,
      effectId: ability?.effectId || 'none',
      resolvedValue: baseResolvedValue,
      sourceType: attackerCard?.catalogCard?.type,
    });

    return {
      ...attack,
      effectId: ability?.effectId || 'none',
      baseResolvedValue,
      resolvedValue,
      resolvedDamage: ability?.effectId === 'damage_enemy' || ability?.effectId === 'life_steal' ? resolvedValue : 0,
      resolvedHealing: ability?.effectId === 'heal_target' ? resolvedValue : 0,
      resolvedLifeStealHealing: ability?.effectId === 'life_steal' ? resolvedValue : 0,
      buffId: ability?.buffId || 'none',
      buffTarget: ability?.buffTarget || 'none',
      buffDurationTurns: Number.isInteger(ability?.durationTurns) ? ability.durationTurns : null,
      enemyValueSourceStat: typeof ability?.enemyValueSourceStat === 'string' ? ability.enemyValueSourceStat : null,
    };
  }

  applyCommitEffects(match) {
    const commitExecutionByAttackId = new Map();
    const remainingAttacks = this.getOrderedCommitAttacks(match).map((entry) => ({
      attackerId: entry.attackerId,
      attack: entry.attack,
    }));
    const executedCommitAttackIds = [];

    while (remainingAttacks.length) {
      const [nextAttack] = this.getOrderedCommitAttacks(match, remainingAttacks);
      if (!nextAttack) break;

      const removeIndex = remainingAttacks.findIndex((entry) => entry.attackerId === nextAttack.attackerId && entry.attack?.id === nextAttack.attack?.id);
      if (removeIndex >= 0) remainingAttacks.splice(removeIndex, 1);

      const attackerId = nextAttack.attackerId;
      const attack = nextAttack.attack;
      const tauntAdjustedAttack = this.resolveAttackTargetForTaunt(match, attackerId, attack);
      const attackerState = match.cardsByPlayer.get(attackerId);
      const attackerCard = attackerState?.board?.find((card) => card.slotIndex === attack.attackerSlotIndex) || null;
      if (!attackerCard?.catalogCard) {
        commitExecutionByAttackId.set(attack.id, {
          executed: false,
          reason: 'attacker_missing',
          speedOutcome: nextAttack.speedOutcome,
          adjustedSpeedOutcome: nextAttack.adjustedSpeedOutcome,
          frostbiteStacks: nextAttack.frostbiteStacks,
        });
        continue;
      }

      if (Number.isInteger(attackerCard.silenceTurnsRemaining) && attackerCard.silenceTurnsRemaining > 0) {
        commitExecutionByAttackId.set(attack.id, {
          executed: false,
          reason: 'silenced',
          buffExecuted: true,
          buffReason: null,
          retaliationDamage: 0,
          retaliationBlockedByDefense: 0,
          retaliationAppliedDamage: 0,
          attackDefense: 0,
          defenseRemaining: 0,
          speedOutcome: nextAttack.speedOutcome,
          adjustedSpeedOutcome: nextAttack.adjustedSpeedOutcome,
          frostbiteStacks: nextAttack.frostbiteStacks,
        });
        continue;
      }

      const resolvedAttack = this.resolveCommitAttackStep(match, attackerId, tauntAdjustedAttack);
      const executionResult = this.applyResolvedAbilityEffect({
        match,
        casterId: attackerId,
        targetSide: tauntAdjustedAttack.targetSide,
        targetSlotIndex: tauntAdjustedAttack.targetSlotIndex,
        effectId: resolvedAttack.effectId,
        resolvedValue: resolvedAttack.baseResolvedValue,
        sourceType: attackerCard?.catalogCard?.type,
        enemyValueSourceStat: resolvedAttack.enemyValueSourceStat,
      });
      const executedResolvedValue = Number.isFinite(executionResult.appliedValue)
        ? executionResult.appliedValue
        : resolvedAttack.resolvedValue;
      resolvedAttack.resolvedValue = executedResolvedValue;
      resolvedAttack.resolvedDamage = resolvedAttack.effectId === 'damage_enemy' || resolvedAttack.effectId === 'life_steal' || resolvedAttack.effectId === 'disruption' ? executedResolvedValue : 0;
      resolvedAttack.resolvedHealing = resolvedAttack.effectId === 'heal_target' ? executedResolvedValue : 0;
      resolvedAttack.resolvedLifeStealHealing = resolvedAttack.effectId === 'life_steal' ? executedResolvedValue : 0;

      const buffResult = executionResult.executed === false
        ? { executed: false, reason: 'effect_failed' }
        : this.applyResolvedAbilityBuff({
          match,
          casterId: attackerId,
          attack: tauntAdjustedAttack,
          buffId: resolvedAttack.buffId,
          buffTarget: resolvedAttack.buffTarget,
          durationTurns: resolvedAttack.buffDurationTurns,
        });

      const retaliationResult = {
        retaliationDamage: 0,
        retaliationBlockedByDefense: 0,
        retaliationAppliedDamage: 0,
        attackDefense: 0,
        defenseRemaining: 0,
      };

      const isEnemyDamageAttack = executionResult.executed !== false
        && (resolvedAttack.effectId === 'damage_enemy' || resolvedAttack.effectId === 'life_steal' || executionResult.reason === 'disruption_damage_fallback')
        && tauntAdjustedAttack.targetSide === 'opponent'
        && Number.isInteger(tauntAdjustedAttack.targetSlotIndex);

      if (isEnemyDamageAttack) {
        const defenderId = match.players.find((id) => id !== attackerId);
        const defenderState = defenderId ? match.cardsByPlayer.get(defenderId) : null;
        const defenderCard = defenderState?.board?.find((card) => card.slotIndex === tauntAdjustedAttack.targetSlotIndex) || null;
        const defenderAttack = defenderId
          ? this.findPendingAttackBySlot(match, defenderId, tauntAdjustedAttack.targetSlotIndex)
          : null;
        const defenderResolvedAttack = defenderId && defenderAttack
          ? this.resolveCommitAttackStep(match, defenderId, defenderAttack)
          : null;
        const baseRetaliationDamage = defenderResolvedAttack?.effectId === 'damage_enemy'
          ? defenderResolvedAttack.resolvedValue
          : 0;
        const bonusRetaliationDamage = Number(defenderCard?.retaliationBonus);
        const retaliationDamage = baseRetaliationDamage
          + (Number.isFinite(bonusRetaliationDamage) ? Math.max(0, Math.floor(bonusRetaliationDamage)) : 0);
        const defenseRoll = match.commitRollsByAttackId.get(`${attack.id}:defense`);
        const attackDefense = Number(defenseRoll?.roll?.outcome);
        Object.assign(retaliationResult, this.applyRetaliationDamage({
          match,
          attackerId,
          attackerSlotIndex: attack.attackerSlotIndex,
          retaliationDamage,
          attackDefense,
        }));
      }

      const lifeStealResult = {
        lifeStealHealing: 0,
        lifeStealNetHealing: 0,
      };

      if (executionResult.executed !== false && resolvedAttack.effectId === 'life_steal' && Number.isInteger(attack.attackerSlotIndex)) {
        const attackerStateAfter = match.cardsByPlayer.get(attackerId);
        const attackerCardAfterRetaliation = attackerStateAfter?.board?.find((card) => card.slotIndex === attack.attackerSlotIndex) || null;
        const attackerHealth = Number(attackerCardAfterRetaliation?.catalogCard?.health);
        if (attackerCardAfterRetaliation?.catalogCard && Number.isFinite(attackerHealth)) {
          const healedAmount = Math.max(0, Math.floor(executedResolvedValue));
          if (healedAmount > 0) {
            attackerCardAfterRetaliation.catalogCard.health = attackerHealth + healedAmount;
            lifeStealResult.lifeStealHealing = healedAmount;
            lifeStealResult.lifeStealNetHealing = Math.max(0, healedAmount - retaliationResult.retaliationAppliedDamage);
          }
        }
      }

      commitExecutionByAttackId.set(attack.id, {
        ...executionResult,
        buffExecuted: buffResult.executed !== false,
        buffReason: buffResult.reason || null,
        ...retaliationResult,
        ...lifeStealResult,
        speedOutcome: nextAttack.speedOutcome,
        adjustedSpeedOutcome: nextAttack.adjustedSpeedOutcome,
        frostbiteStacks: nextAttack.frostbiteStacks,
      });
      executedCommitAttackIds.push(attack.id);
    }

    match.commitExecutionByAttackId = commitExecutionByAttackId;
    match.executedCommitAttackIds = executedCommitAttackIds;
  }


  getOrderedCommitAttacks(match, attackEntries = null) {
    const pendingCommitAttacksByPlayer = match?.pendingCommitAttacksByPlayer;
    const commitRollsByAttackId = match?.commitRollsByAttackId;
    const ordered = [];
    let originalOrder = 0;

    const getFrostbiteStacks = (attackerId, slotIndex) => {
      if (!attackerId || !Number.isInteger(slotIndex)) return 0;
      const attackerState = match?.cardsByPlayer?.get(attackerId);
      const attackerCard = attackerState?.board?.find((card) => card?.slotIndex === slotIndex) || null;
      if (!attackerCard) return 0;
      const turnsRemaining = Number.isInteger(attackerCard.frostbiteTurnsRemaining) ? attackerCard.frostbiteTurnsRemaining : 0;
      if (turnsRemaining < 1) return 0;
      return Number.isInteger(attackerCard.frostbiteStacks) ? Math.max(1, attackerCard.frostbiteStacks) : 1;
    };

    const entries = Array.isArray(attackEntries)
      ? attackEntries
      : (match?.players || []).flatMap((attackerId) => {
        const attacks = pendingCommitAttacksByPlayer?.get(attackerId) || [];
        return attacks.map((attack) => ({ attackerId, attack }));
      });

    for (const entry of entries) {
      const attackerId = entry?.attackerId;
      const attack = entry?.attack;
      if (!attackerId || !attack?.id) continue;
      const speedRollEntry = commitRollsByAttackId?.get(`${attack.id}:speed`);
      const speedOutcome = Number(speedRollEntry?.roll?.outcome);
      const speedResolvedAt = Number(speedRollEntry?.submittedAt);
      const normalizedSpeedOutcome = Number.isFinite(speedOutcome) ? Math.max(0, Math.floor(speedOutcome)) : 0;
      const frostbiteStacks = getFrostbiteStacks(attackerId, attack?.attackerSlotIndex);
      const adjustedSpeedOutcome = Math.max(0, normalizedSpeedOutcome - frostbiteStacks);

      ordered.push({
        attackerId,
        attack,
        speedOutcome: normalizedSpeedOutcome,
        adjustedSpeedOutcome,
        frostbiteStacks,
        hasFrostbiteSpeedPenalty: frostbiteStacks > 0,
        speedResolvedAt: Number.isFinite(speedResolvedAt) ? speedResolvedAt : Number.POSITIVE_INFINITY,
        originalOrder,
      });
      originalOrder += 1;
    }

    ordered.sort((a, b) => {
      if (b.adjustedSpeedOutcome !== a.adjustedSpeedOutcome) return b.adjustedSpeedOutcome - a.adjustedSpeedOutcome;
      if (a.hasFrostbiteSpeedPenalty !== b.hasFrostbiteSpeedPenalty) {
        return a.hasFrostbiteSpeedPenalty ? 1 : -1;
      }
      if (a.speedResolvedAt !== b.speedResolvedAt) return a.speedResolvedAt - b.speedResolvedAt;
      return a.originalOrder - b.originalOrder;
    });

    return ordered;
  }


  resolveCommitPhase(match) {
    match.phase = 2;
    match.phaseStartedAt = Date.now();
    const pendingAttacks = new Map();
    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      const attacks = playerState?.board
        ?.filter((card) => card.attackCommitted === true && Number.isInteger(card.slotIndex))
        .filter((card) => {
          const silenced = Number.isInteger(card.silenceTurnsRemaining) && card.silenceTurnsRemaining > 0;
          if (!silenced) return true;
          card.attackCommitted = false;
          card.targetSlotIndex = null;
          card.targetSide = null;
          card.selectedAbilityIndex = 0;
          return false;
        })
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
    match.executedCommitAttackIds = [];
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
      this.applyPendingSpellDisruptionDebuffsToCommitRolls(match);
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

    const normalizedRollType = normalizeDisruptionTargetStat(rollType);
    const commitRollKey = `${attackId}:${normalizedRollType}`;

    match.commitRollsByAttackId.set(commitRollKey, {
      attackId,
      attackerId: playerId,
      rollType: normalizedRollType,
      sides: Number.isFinite(sides) ? sides : null,
      roll,
      submittedAt: Date.now(),
    });

    this.applySpellDisruptionDebuffToCommitRoll({
      match,
      attackerId: playerId,
      attackId,
      rollType: normalizedRollType,
    });

    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }

  readyPlayerInMatch(match, playerId) {
    match.readyPlayers.add(playerId);

    const allPlayersReady = match.players.every((id) => match.readyPlayers.has(id));
    if (!allPlayersReady) return;

    this.resolveCommitPhase(match);
  }

  validatePhaseTurnPayload(payload, match, playerId, playerState, currentTurnNumber) {
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

    if (uniqueIds.size > knownCards.size) {
      return { error: `expected at most ${knownCards.size} known cards between hand, board, and discard` };
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
        tauntTurnsRemaining: Number.isInteger(knownCard?.tauntTurnsRemaining) ? knownCard.tauntTurnsRemaining : 0,
        silenceTurnsRemaining: Number.isInteger(knownCard?.silenceTurnsRemaining) ? knownCard.silenceTurnsRemaining : 0,
        poisonTurnsRemaining: Number.isInteger(knownCard?.poisonTurnsRemaining) ? knownCard.poisonTurnsRemaining : 0,
        poisonStacks: Number.isInteger(knownCard?.poisonStacks) ? knownCard.poisonStacks : 0,
        fireTurnsRemaining: Number.isInteger(knownCard?.fireTurnsRemaining) ? knownCard.fireTurnsRemaining : 0,
        fireStacks: Number.isInteger(knownCard?.fireStacks) ? knownCard.fireStacks : 0,
        frostbiteTurnsRemaining: Number.isInteger(knownCard?.frostbiteTurnsRemaining) ? knownCard.frostbiteTurnsRemaining : 0,
        frostbiteStacks: Number.isInteger(knownCard?.frostbiteStacks) ? knownCard.frostbiteStacks : 0,
        disruptionDebuffTurnsRemaining: Number.isInteger(knownCard?.disruptionDebuffTurnsRemaining) ? knownCard.disruptionDebuffTurnsRemaining : 0,
        disruptionDebuffs: knownCard?.disruptionDebuffs && typeof knownCard.disruptionDebuffs === 'object'
          ? {
            ...createEmptyDisruptionDebuffs(),
            ...knownCard.disruptionDebuffs,
          }
          : createEmptyDisruptionDebuffs(),
      });
    }

    const attacks = Array.isArray(payload.attacks) ? payload.attacks : [];
    const opponentId = match.players.find((id) => id !== playerId) || null;
    const opponentTauntSlots = new Set(this.getActiveTauntCardsForDefender(match, opponentId).map((card) => card.slotIndex));
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
      if (attack.targetSide != null && attack.targetSide !== 'player' && attack.targetSide !== 'opponent') {
        return { error: "targetSide must be either 'player' or 'opponent' when provided" };
      }
      const normalizedTargetSlotIndex = this.normalizeBoardTargetSlotIndex(attack.targetSlotIndex, attack.targetSide || null);
      if (attack.targetSlotIndex != null && normalizedTargetSlotIndex == null) {
        return { error: `targetSlotIndex must be between 0 and ${this.options.boardSlotsPerSide - 1}` };
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
      const knownAttackerCard = knownCards.get(attackerCard.id);
      if (Number.isInteger(attackerCard.silenceTurnsRemaining) && attackerCard.silenceTurnsRemaining > 0) {
        if (knownAttackerCard?.attackCommitted !== true) {
          return { error: `card in slot ${attack.attackerSlotIndex} is silenced and cannot use abilities` };
        }
      }
      if (!Number.isInteger(attackerCard.summonedTurn) || attackerCard.summonedTurn >= currentTurnNumber) {
        return { error: `card in slot ${attack.attackerSlotIndex} has summoning sickness` };
      }
      attackerCard.attackCommitted = true;
      attackerCard.targetSlotIndex = normalizedTargetSlotIndex;
      attackerCard.targetSide = attack.targetSide || null;
      attackerCard.selectedAbilityIndex = Number.isInteger(attack.selectedAbilityIndex) ? attack.selectedAbilityIndex : 0;
      if (attack.targetSide === 'opponent'
        && Number.isInteger(attackerCard.targetSlotIndex)
        && opponentTauntSlots.size > 0
        && !opponentTauntSlots.has(attackerCard.targetSlotIndex)) {
        const forcedTauntTarget = this.getActiveTauntCardsForDefender(match, opponentId)[0] || null;
        if (forcedTauntTarget) {
          attackerCard.targetSlotIndex = forcedTauntTarget.slotIndex;
        }
      }
      seenAttackerSlots.add(attack.attackerSlotIndex);
    }

    const normalizedDiscard = discard.map((card) => knownCards.get(card.id));
    for (const [knownCardId, knownCard] of knownCards.entries()) {
      if (uniqueIds.has(knownCardId)) continue;
      normalizedDiscard.push(knownCard);
    }

    return {
      hand: hand.map((card) => knownCards.get(card.id)),
      board: normalizedBoard,
      discard: normalizedDiscard,
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

  async findMatch(playerId, options = {}) {
    const existing = this.getPlayerPhaseStatus(playerId);
    if (existing.status === 'matched' || existing.status === 'searching') {
      return existing;
    }

    const preferredDeckCardIds = Array.isArray(options.deckCardIds)
      ? options.deckCardIds.filter((cardId) => typeof cardId === 'string' && cardId.trim()).map((cardId) => cardId.trim())
      : [];

    const opponentEntry = this.phaseQueue.shift();
    if (opponentEntry && opponentEntry.playerId && opponentEntry.playerId !== playerId) {
      const opponentId = opponentEntry.playerId;
      const matchId = `match-${randomUUID().slice(0, 8)}`;
      const players = [opponentId, playerId];
      const preferredDeckByPlayer = new Map([
        [opponentId, Array.isArray(opponentEntry.deckCardIds) ? opponentEntry.deckCardIds : []],
        [playerId, preferredDeckCardIds],
      ]);
      const cardsByPlayer = new Map();
      let catalogCards = [];

      try {
        const loadedCards = await this.options.catalogProvider();
        catalogCards = Array.isArray(loadedCards) ? loadedCards : [];
      } catch (error) {
        catalogCards = [];
      }

      players.forEach((id) => {
        const preferredDeck = preferredDeckByPlayer.get(id) || [];
        const cards = this.buildDeckFromCatalog(id, catalogCards, preferredDeck);
        const openingZones = this.buildOpeningZones(cards);
        cardsByPlayer.set(id, {
          allCards: cards,
          hand: openingZones.hand,
          board: [],
          discard: [],
          deck: openingZones.deck,
        });
      });

      const match = {
        id: matchId,
        players,
        cardsByPlayer,
        turnNumber: 1,
        upkeep: 1,
        phase: 1,
        phaseStartedAt: Date.now(),
        phaseEndsAt: null,
        readyPlayers: new Set(),
        lastDrawnCardsByPlayer: new Map(),
        pendingCommitAttacksByPlayer: new Map(),
        commitRollsByAttackId: new Map(),
        commitExecutionByAttackId: new Map(),
        executedCommitAttackIds: [],
        commitCompletedPlayers: new Set(),
        commitAnimationCompletedPlayers: new Set(),
        commitAllRolledAt: null,
        lastDotDamageEvents: [],
        activeSpellResolution: null,
        createdAt: Date.now(),
      };
      this.phaseMatches.set(matchId, match);
      this.phaseMatchmakingState.set(opponentId, { status: 'matched', matchId });
      this.phaseMatchmakingState.set(playerId, { status: 'matched', matchId });
      return this.getPlayerPhaseStatus(playerId);
    }

    this.phaseQueue.push({ playerId, deckCardIds: preferredDeckCardIds });
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

    const validated = this.validatePhaseTurnPayload(payload, match, playerId, playerState, match.turnNumber);
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

    const validated = this.validatePhaseTurnPayload(payload, match, playerId, playerState, match.turnNumber);
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

    const normalizedTargetSlotIndex = this.normalizeBoardTargetSlotIndex(targetSlotIndex, targetSide);
    const normalizedTargetSide = targetSide === 'player' || targetSide === 'opponent' ? targetSide : null;
    if (normalizedTargetSide === 'opponent' && Number.isInteger(normalizedTargetSlotIndex)) {
      const opponentId = match.players.find((id) => id !== playerId);
      const tauntSlots = new Set(this.getActiveTauntCardsForDefender(match, opponentId).map((card) => card.slotIndex));
      if (tauntSlots.size > 0 && !tauntSlots.has(normalizedTargetSlotIndex)) {
        return { error: 'target must be a taunting enemy while taunt is active', statusCode: 400 };
      }
    }

    const parsedDieSides = Number.parseInt(dieSides, 10);
    const spellAbility = this.getAttackAbilityForCard(handCard, Number.isInteger(selectedAbilityIndex) ? selectedAbilityIndex : 0);
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
      targetSlotIndex: normalizedTargetSlotIndex,
      targetSide: normalizedTargetSide,
      rollType: typeof rollType === 'string' && rollType ? rollType : 'damage',
      dieSides: Number.isFinite(parsedDieSides) ? Math.max(2, parsedDieSides) : 6,
      requiresRoll: spellAbility?.valueSourceType === 'roll',
      rollOutcome: null,
      rollData: null,
      effectId: 'none',
      resolvedValue: 0,
      resolvedDamage: 0,
      resolvedHealing: 0,
      resolvedLifeStealHealing: 0,
      lifeStealHealingTargetSlotIndex: null,
      lifeStealHealingTargetSide: null,
      disruptionTargetStat: null,
      disruptionAdjustedOutcome: null,
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

    // Compute deterministic effect metadata as soon as the caster roll is known so
    // both clients can animate/preview the same resolved value before completion.
    const spellCard = active.cardSnapshot?.catalogCard || null;
    const spellAbility = this.getAttackAbilityForCard({ catalogCard: spellCard }, active.selectedAbilityIndex);
    const baseResolvedValue = this.resolveAbilityValue({
      ability: spellAbility,
      rollValue: active.rollOutcome,
    });
    const effectId = spellAbility?.effectId || 'none';
    const resolvedValue = this.resolveTypeAdjustedAbilityValue({
      match,
      casterId: playerId,
      targetSide: active.targetSide,
      targetSlotIndex: active.targetSlotIndex,
      effectId,
      resolvedValue: baseResolvedValue,
      sourceType: spellCard?.type,
      enemyValueSourceStat: spellAbility?.enemyValueSourceStat || null,
    });
    active.effectId = effectId;
    active.resolvedValue = resolvedValue;
    active.resolvedDamage = effectId === 'damage_enemy' || effectId === 'life_steal' ? resolvedValue : 0;
    active.resolvedHealing = effectId === 'heal_target' ? resolvedValue : 0;
    if (effectId === 'life_steal') {
      const lifeStealTarget = this.selectRandomFriendlyLifeStealTarget({
        match,
        casterId: playerId,
        spellId: active.id,
      });
      active.lifeStealHealingTargetSlotIndex = Number.isInteger(lifeStealTarget?.slotIndex)
        ? lifeStealTarget.slotIndex
        : null;
      active.lifeStealHealingTargetSide = Number.isInteger(lifeStealTarget?.slotIndex) ? 'player' : null;
      active.resolvedLifeStealHealing = Number.isInteger(lifeStealTarget?.slotIndex) ? resolvedValue : 0;
    } else {
      active.lifeStealHealingTargetSlotIndex = null;
      active.lifeStealHealingTargetSide = null;
      active.resolvedLifeStealHealing = 0;
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
    const baseResolvedValue = this.resolveAbilityValue({
      ability: spellAbility,
      rollValue: active.rollOutcome,
    });
    const effectId = spellAbility?.effectId || 'none';
    const resolvedValue = this.resolveTypeAdjustedAbilityValue({
      match,
      casterId: playerId,
      targetSide: active.targetSide,
      targetSlotIndex: active.targetSlotIndex,
      effectId,
      resolvedValue: baseResolvedValue,
      sourceType: spellCard?.type,
      enemyValueSourceStat: spellAbility?.enemyValueSourceStat || null,
    });
    const spellDisruptionResult = effectId === 'disruption'
      ? this.applySpellDisruptionDebuff({
        match,
        casterId: playerId,
        targetSide: active.targetSide,
        targetSlotIndex: active.targetSlotIndex,
        enemyValueSourceStat: spellAbility?.enemyValueSourceStat || null,
        resolvedValue,
      })
      : null;
    const executionResult = effectId === 'disruption'
      ? {
        executed: spellDisruptionResult?.executed !== false,
        appliedValue: Number.isFinite(spellDisruptionResult?.appliedValue) ? spellDisruptionResult.appliedValue : resolvedValue,
        reason: spellDisruptionResult?.reason || 'spell_disruption_debuff_applied',
      }
      : this.applyResolvedAbilityEffect({
        match,
        casterId: playerId,
        targetSide: active.targetSide,
        targetSlotIndex: active.targetSlotIndex,
        effectId,
        resolvedValue: baseResolvedValue,
        sourceType: spellCard?.type,
        enemyValueSourceStat: spellAbility?.enemyValueSourceStat || null,
      });

    active.effectId = effectId;
    active.resolvedValue = resolvedValue;
    active.disruptionTargetStat = typeof spellDisruptionResult?.disruptionTargetStat === 'string'
      ? spellDisruptionResult.disruptionTargetStat
      : null;
    active.disruptionAdjustedOutcome = Number.isFinite(spellDisruptionResult?.disruptionAdjustedOutcome)
      ? spellDisruptionResult.disruptionAdjustedOutcome
      : null;
    active.resolvedDamage = (effectId === 'damage_enemy' || effectId === 'life_steal' || executionResult.reason === 'disruption_damage_fallback') && executionResult.executed !== false ? resolvedValue : 0;
    active.resolvedHealing = effectId === 'heal_target' && executionResult.executed !== false ? resolvedValue : 0;
    if (effectId === 'life_steal' && executionResult.executed !== false) {
      const casterState = match.cardsByPlayer.get(playerId);
      const selectedSlotIndex = Number.isInteger(active.lifeStealHealingTargetSlotIndex)
        ? active.lifeStealHealingTargetSlotIndex
        : null;
      const healingTarget = selectedSlotIndex == null
        ? null
        : (casterState?.board || []).find((card) => card?.slotIndex === selectedSlotIndex) || null;
      const healingTargetCurrentHealth = Number(healingTarget?.catalogCard?.health);
      if (healingTarget?.catalogCard && Number.isFinite(healingTargetCurrentHealth) && resolvedValue > 0) {
        healingTarget.catalogCard.health = healingTargetCurrentHealth + resolvedValue;
        active.resolvedLifeStealHealing = resolvedValue;
        active.lifeStealHealingTargetSlotIndex = selectedSlotIndex;
        active.lifeStealHealingTargetSide = 'player';
      } else {
        active.resolvedLifeStealHealing = 0;
        active.lifeStealHealingTargetSlotIndex = null;
        active.lifeStealHealingTargetSide = null;
      }
    } else {
      active.resolvedLifeStealHealing = 0;
      active.lifeStealHealingTargetSlotIndex = null;
      active.lifeStealHealingTargetSide = null;
    }

    this.applyResolvedAbilityBuff({
      match,
      casterId: playerId,
      attack: {
        attackerSlotIndex: null,
        targetSlotIndex: active.targetSlotIndex,
        targetSide: active.targetSide,
      },
      buffId: spellAbility?.buffId || 'none',
      buffTarget: spellAbility?.buffTarget || 'none',
      durationTurns: Number.isInteger(spellAbility?.durationTurns) ? spellAbility.durationTurns : null,
    });

    active.completedAt = Date.now();
    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }
}

module.exports = { PhaseManagerServer };
