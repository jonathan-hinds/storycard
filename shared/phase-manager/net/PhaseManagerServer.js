const { randomUUID } = require('crypto');
const { DEFAULT_MESH_COLOR, normalizeCatalogCardDesign } = require('../../cards-catalog/catalogCardDesign');

const DEFAULT_CARD_MESH_COLOR = 0x000000;

const DEFAULT_OPTIONS = {
  deckSizePerPlayer: 10,
  startingHandSize: 3,
  maxHandSize: 7,
  boardSlotsPerSide: 3,
  npcActionDelayMs: 1200,
  npcStartDelayMs: 1800,
};

const PROFILE_METRIC_KEYS = Object.freeze([
  'totalGamesPlayed',
  'totalWins',
  'totalLosses',
  'totalCreaturesKilled',
  'totalCreaturesLost',
  'totalSpellsPlayed',
]);

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
      npcDeckProvider: typeof options.npcDeckProvider === 'function' ? options.npcDeckProvider : async () => [],
      playerProfileProvider: typeof options.playerProfileProvider === 'function' ? options.playerProfileProvider : async () => null,
      onBattleMetrics: typeof options.onBattleMetrics === 'function' ? options.onBattleMetrics : null,
      onBattleMetricIncrement: typeof options.onBattleMetricIncrement === 'function' ? options.onBattleMetricIncrement : null,
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


  createEmptyBattleMetrics() {
    return {
      totalGamesPlayed: 0,
      totalWins: 0,
      totalLosses: 0,
      totalCreaturesKilled: 0,
      totalCreaturesLost: 0,
      totalSpellsPlayed: 0,
    };
  }

  normalizeProfileMetrics(metricsInput = null) {
    const metrics = metricsInput && typeof metricsInput === 'object' ? metricsInput : {};
    return PROFILE_METRIC_KEYS.reduce((accumulator, metricKey) => {
      const numericValue = Number(metrics[metricKey]);
      accumulator[metricKey] = Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
      return accumulator;
    }, {});
  }

  createDefaultPlayerProfile(playerId) {
    const normalizedPlayerId = typeof playerId === 'string' ? playerId.trim() : '';
    const isNpc = normalizedPlayerId.startsWith('npc-');
    return {
      playerId: normalizedPlayerId || null,
      username: isNpc ? 'NPC Opponent' : 'Player',
      avatarImagePath: null,
      metrics: this.normalizeProfileMetrics(),
    };
  }

  normalizePlayerProfile(playerId, profileInput = null) {
    const fallback = this.createDefaultPlayerProfile(playerId);
    const profile = profileInput && typeof profileInput === 'object' ? profileInput : {};
    const normalizedUsername = typeof profile.username === 'string' ? profile.username.trim() : '';
    const normalizedAvatarPath = typeof profile.avatarImagePath === 'string' ? profile.avatarImagePath.trim() : '';
    return {
      playerId: fallback.playerId,
      username: normalizedUsername || fallback.username,
      avatarImagePath: normalizedAvatarPath || null,
      metrics: this.normalizeProfileMetrics(profile.metrics),
    };
  }

  async loadPlayerProfile(playerId) {
    const fallback = this.createDefaultPlayerProfile(playerId);
    const normalizedPlayerId = fallback.playerId;
    if (!normalizedPlayerId || normalizedPlayerId.startsWith('npc-')) {
      return fallback;
    }

    try {
      const profile = await this.options.playerProfileProvider(normalizedPlayerId);
      return this.normalizePlayerProfile(normalizedPlayerId, profile);
    } catch (error) {
      return fallback;
    }
  }

  getMatchProfile(match, playerId) {
    if (!match || !playerId) return null;
    if (!(match.profilesByPlayer instanceof Map)) {
      match.profilesByPlayer = new Map();
    }
    if (!match.profilesByPlayer.has(playerId)) {
      match.profilesByPlayer.set(playerId, this.createDefaultPlayerProfile(playerId));
    }
    return match.profilesByPlayer.get(playerId) || null;
  }

  getMatchMetricsForPlayer(match, playerId) {
    if (!match || !playerId) return this.createEmptyBattleMetrics();
    if (!(match.metricsByPlayer instanceof Map)) {
      match.metricsByPlayer = new Map();
    }
    if (!match.metricsByPlayer.has(playerId)) {
      match.metricsByPlayer.set(playerId, this.createEmptyBattleMetrics());
    }
    return match.metricsByPlayer.get(playerId);
  }

  recordMatchMetric(match, playerId, metricKey, amount = 1) {
    if (!match || !playerId || typeof metricKey !== 'string') return;
    const metrics = this.getMatchMetricsForPlayer(match, playerId);
    if (!(metricKey in metrics)) return;
    const increment = Number.isFinite(Number(amount)) ? Math.max(0, Math.floor(Number(amount))) : 0;
    if (increment < 1) return;
    metrics[metricKey] += increment;

    if (typeof this.options.onBattleMetricIncrement === 'function') {
      Promise.resolve(this.options.onBattleMetricIncrement({
        matchId: match.id,
        mode: match.mode || 'matchmaking',
        playerId,
        metricKey,
        increment,
        metrics: { ...metrics },
      }))
        .then(() => {
          this.enqueueMetricUpdateEvent(match, playerId, {
            metricKey,
            increment,
            success: true,
          });
        })
        .catch((error) => {
          this.enqueueMetricUpdateEvent(match, playerId, {
            metricKey,
            increment,
            success: false,
            error: error?.message || 'unknown error',
          });
        });
    }
  }

  enqueueMetricUpdateEvent(match, playerId, event = {}) {
    if (!match || !playerId || !event || typeof event !== 'object') return;
    if (!(match.metricUpdateEventsByPlayer instanceof Map)) {
      match.metricUpdateEventsByPlayer = new Map();
    }
    if (!match.metricUpdateEventsByPlayer.has(playerId)) {
      match.metricUpdateEventsByPlayer.set(playerId, []);
    }
    const queue = match.metricUpdateEventsByPlayer.get(playerId);
    if (!Array.isArray(queue)) return;
    queue.push({
      metricKey: event.metricKey,
      increment: Number.isFinite(Number(event.increment)) ? Math.max(0, Math.floor(Number(event.increment))) : 0,
      success: event.success === true,
      error: typeof event.error === 'string' ? event.error : null,
      emittedAt: Date.now(),
    });
  }

  takeMetricUpdateEvents(match, playerId) {
    if (!match || !playerId) return [];
    if (!(match.metricUpdateEventsByPlayer instanceof Map)) return [];
    const queued = match.metricUpdateEventsByPlayer.get(playerId);
    if (!Array.isArray(queued) || queued.length === 0) return [];
    match.metricUpdateEventsByPlayer.set(playerId, []);
    return queued.map((event) => ({ ...event }));
  }

  removeDefeatedCreaturesFromBoard(match, playerId) {
    if (!match || !playerId) return [];
    const playerState = match.cardsByPlayer.get(playerId);
    if (!playerState || !Array.isArray(playerState.board) || !playerState.board.length) return [];

    const defeated = [];
    playerState.board = playerState.board.filter((card) => {
      const currentHealth = Number(card?.catalogCard?.health);
      if (Number.isFinite(currentHealth) && currentHealth <= 0) {
        defeated.push(card);
        return false;
      }
      return true;
    });

    if (defeated.length) {
      if (!Array.isArray(playerState.discard)) {
        playerState.discard = [];
      }
      playerState.discard.push(...defeated);
    }

    return defeated;
  }

  finalizeMatchIfGameOver(match) {
    if (!match || match.phase === 3 || !Array.isArray(match.players)) return;

    const defeatedPlayers = match.players.filter((playerId) => {
      const initialCreatureCount = Number(match.initialCreatureCountByPlayer?.get?.(playerId));
      if (!Number.isFinite(initialCreatureCount) || initialCreatureCount < 1) return false;
      const metrics = this.getMatchMetricsForPlayer(match, playerId);
      return Number(metrics.totalCreaturesLost) >= initialCreatureCount;
    });

    if (defeatedPlayers.length !== 1) return;

    const loserId = defeatedPlayers[0];
    const winnerId = match.players.find((playerId) => playerId !== loserId) || null;
    if (!winnerId) return;

    match.phase = 3;
    match.phaseStartedAt = Date.now();
    match.phaseEndsAt = match.phaseStartedAt;
    match.completedAt = match.phaseStartedAt;
    match.outcome = {
      winnerId,
      loserId,
      completedAt: match.completedAt,
    };

    this.recordMatchMetric(match, winnerId, 'totalGamesPlayed', 1);
    this.recordMatchMetric(match, winnerId, 'totalWins', 1);
    this.recordMatchMetric(match, loserId, 'totalGamesPlayed', 1);
    this.recordMatchMetric(match, loserId, 'totalLosses', 1);

    if (typeof this.options.onBattleMetrics === 'function') {
      const metricsPayload = {};
      for (const playerId of match.players) {
        metricsPayload[playerId] = { ...this.getMatchMetricsForPlayer(match, playerId) };
      }
      Promise.resolve(this.options.onBattleMetrics({
        matchId: match.id,
        mode: match.mode || 'matchmaking',
        players: [...match.players],
        winnerId,
        loserId,
        metricsByPlayer: metricsPayload,
      })).catch(() => {});
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


  isNpcPlayerId(playerId) {
    return typeof playerId === 'string' && playerId.startsWith('npc-');
  }

  getNpcPlayerIds(match) {
    if (!match || !Array.isArray(match.players)) return [];
    return match.players.filter((id) => this.isNpcPlayerId(id));
  }

  rollNpcDie(sides = 6) {
    const normalizedSides = Number.isFinite(Number(sides)) ? Math.max(2, Math.floor(Number(sides))) : 6;
    return 1 + Math.floor(Math.random() * normalizedSides);
  }

  getFirstOpenBoardSlot(board = []) {
    const occupied = new Set(board
      .map((card) => (Number.isInteger(card?.slotIndex) ? card.slotIndex : null))
      .filter((slotIndex) => slotIndex != null));
    for (let slotIndex = 0; slotIndex < this.options.boardSlotsPerSide; slotIndex += 1) {
      if (!occupied.has(slotIndex)) return slotIndex;
    }
    return null;
  }

  chooseNpcPreferredEnemyTargetSlot(match, npcId) {
    const enemyId = match?.players?.find((id) => id !== npcId);
    if (!enemyId) return null;
    const tauntCards = this.getActiveTauntCardsForDefender(match, enemyId);
    if (tauntCards.length) return tauntCards[0].slotIndex;
    const enemyBoard = match?.cardsByPlayer?.get(enemyId)?.board || [];
    const firstEnemy = enemyBoard
      .filter((card) => Number.isInteger(card?.slotIndex))
      .sort((a, b) => a.slotIndex - b.slotIndex)[0] || null;
    return Number.isInteger(firstEnemy?.slotIndex) ? firstEnemy.slotIndex : null;
  }

  getNpcCreatureCandidateTargets(match, npcId, ability) {
    if (!match || !npcId || !ability) return [];
    const { valid, targetRule } = this.resolveAbilityTargetRule(ability);
    if (!valid) return [];
    const npcState = match.cardsByPlayer.get(npcId);
    const enemyId = match.players.find((id) => id !== npcId);
    const enemyState = enemyId ? match.cardsByPlayer.get(enemyId) : null;

    if (targetRule === 'none') {
      return [{ targetSide: null, targetSlotIndex: null }];
    }

    if (targetRule === 'self') {
      return [{ targetSide: 'player', targetSlotIndex: null, requiresSelfSlot: true }];
    }

    if (targetRule === 'friendly') {
      return (npcState?.board || [])
        .filter((card) => Number.isInteger(card?.slotIndex))
        .map((card) => ({ targetSide: 'player', targetSlotIndex: card.slotIndex }));
    }

    if (targetRule === 'enemy') {
      const tauntCards = this.getActiveTauntCardsForDefender(match, enemyId);
      const tauntSlotSet = new Set(tauntCards.map((card) => card.slotIndex));
      return (enemyState?.board || [])
        .filter((card) => Number.isInteger(card?.slotIndex))
        .filter((card) => tauntSlotSet.size === 0 || tauntSlotSet.has(card.slotIndex))
        .map((card) => ({ targetSide: 'opponent', targetSlotIndex: card.slotIndex }));
    }

    return [];
  }

  scoreNpcTargetCandidate({ match, npcId, ability, candidate, attackerCard = null, attackerSlotIndex = null }) {
    if (!match || !npcId || !ability || !candidate) return Number.NEGATIVE_INFINITY;
    const npcState = match.cardsByPlayer.get(npcId);
    const enemyId = match.players.find((id) => id !== npcId);
    const enemyState = enemyId ? match.cardsByPlayer.get(enemyId) : null;
    const effectId = String(ability.effectId || 'none').trim().toLowerCase();
    const buffId = String(ability.buffId || 'none').trim().toLowerCase();

    const enemyBoardPressure = (enemyState?.board || []).reduce((sum, card) => {
      const health = Number(card?.catalogCard?.health);
      return sum + (Number.isFinite(health) ? Math.max(0, health) : 0);
    }, 0);
    const friendlyBoardPressure = (npcState?.board || []).reduce((sum, card) => {
      const health = Number(card?.catalogCard?.health);
      return sum + (Number.isFinite(health) ? Math.max(0, health) : 0);
    }, 0);
    const needsDefense = enemyBoardPressure > friendlyBoardPressure;

    const resolveTargetCard = () => {
      if (!Number.isInteger(candidate.targetSlotIndex)) return null;
      if (candidate.targetSide === 'opponent') {
        return enemyState?.board?.find((card) => card.slotIndex === candidate.targetSlotIndex) || null;
      }
      if (candidate.targetSide === 'player') {
        const resolvedSlot = candidate.requiresSelfSlot ? attackerSlotIndex : candidate.targetSlotIndex;
        if (!Number.isInteger(resolvedSlot)) return null;
        return npcState?.board?.find((card) => card.slotIndex === resolvedSlot) || null;
      }
      return null;
    };

    const targetCard = resolveTargetCard();
    const targetHealth = Number(targetCard?.catalogCard?.health);
    const targetHealthValue = Number.isFinite(targetHealth) ? Math.max(0, targetHealth) : 0;
    const attackValue = this.resolveAbilityValue({ ability, rollValue: 4 });
    const hasEnemyTarget = candidate.targetSide === 'opponent' && Number.isInteger(candidate.targetSlotIndex);
    const hasFriendlyTarget = candidate.targetSide === 'player' && (Number.isInteger(candidate.targetSlotIndex) || candidate.requiresSelfSlot);

    let score = 0;

    if (effectId === 'damage_enemy' || effectId === 'life_steal' || effectId === 'disruption') {
      if (!hasEnemyTarget) return Number.NEGATIVE_INFINITY;
      score += 30;
      if (Number.isFinite(targetHealth)) {
        const wouldDefeat = attackValue >= targetHealthValue;
        score += wouldDefeat ? 35 : Math.min(18, targetHealthValue);
      }
      if (effectId === 'life_steal') {
        const attackerHealth = Number(attackerCard?.catalogCard?.health);
        if (Number.isFinite(attackerHealth) && attackerHealth <= 4) score += 12;
      }
      if (needsDefense) score += 6;
    } else if (effectId === 'heal_target') {
      if (!hasFriendlyTarget) return Number.NEGATIVE_INFINITY;
      const missingHealth = Number.isFinite(targetHealth) ? Math.max(0, 10 - targetHealth) : 0;
      score += 10 + Math.min(20, missingHealth * 2);
      if (needsDefense) score += 8;
    } else if (effectId === 'none') {
      score += 2;
    }

    if (buffId !== 'none') {
      score += 8;
      if (buffId === 'taunt' && hasFriendlyTarget) {
        const tauntTurns = Number(targetCard?.tauntTurnsRemaining);
        score += Number.isFinite(tauntTurns) && tauntTurns > 0 ? 2 : 12;
        if (needsDefense) score += 10;
      }
      if (buffId === 'silence' && hasEnemyTarget) {
        const alreadySilenced = Number(targetCard?.silenceTurnsRemaining);
        score += Number.isFinite(alreadySilenced) && alreadySilenced > 0 ? 1 : 14;
      }
      if ((buffId === 'poison' || buffId === 'fire' || buffId === 'frostbite' || buffId === 'focal_mark') && hasEnemyTarget) {
        score += 9;
      }
    }

    if (hasEnemyTarget && Number.isInteger(candidate.targetSlotIndex)) {
      score += Math.max(0, 4 - candidate.targetSlotIndex);
    }

    return score;
  }

  chooseNpcCreatureAttackPlan(match, npcId, attackerCard, availableUpkeep = Number.POSITIVE_INFINITY) {
    if (!match || !npcId || !attackerCard?.catalogCard || !Number.isInteger(attackerCard.slotIndex)) return null;
    const normalizedAvailableUpkeep = Number.isFinite(availableUpkeep)
      ? Math.max(0, Math.floor(availableUpkeep))
      : Number.POSITIVE_INFINITY;
    const abilities = [
      this.getAttackAbilityForCard(attackerCard, 0),
      this.getAttackAbilityForCard(attackerCard, 1),
    ].filter(Boolean);
    if (!abilities.length) return null;

    let bestPlan = null;
    abilities.forEach((ability, index) => {
      const abilityCost = this.getAbilityUpkeepCost(ability);
      if (abilityCost > normalizedAvailableUpkeep) return;
      const candidates = this.getNpcCreatureCandidateTargets(match, npcId, ability);
      candidates.forEach((candidate) => {
        const scoredCandidate = candidate.requiresSelfSlot
          ? { ...candidate, targetSlotIndex: attackerCard.slotIndex }
          : candidate;
        const score = this.scoreNpcTargetCandidate({
          match,
          npcId,
          ability,
          candidate: scoredCandidate,
          attackerCard,
          attackerSlotIndex: attackerCard.slotIndex,
        });
        if (!Number.isFinite(score)) return;
        if (!bestPlan || score > bestPlan.score) {
          bestPlan = {
            score,
            upkeepCost: abilityCost,
            selectedAbilityIndex: index,
            targetSide: scoredCandidate.targetSide || null,
            targetSlotIndex: Number.isInteger(scoredCandidate.targetSlotIndex) ? scoredCandidate.targetSlotIndex : null,
          };
        }
      });
    });

    return bestPlan;
  }

  getNpcActionDelayMs() {
    const parsed = Number.parseInt(this.options.npcActionDelayMs, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 1200;
  }

  getNpcStartDelayMs() {
    const parsed = Number.parseInt(this.options.npcStartDelayMs, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 1800;
  }

  getNpcSpellCandidateTargets(match, npcId, spellCard) {
    if (!match || !npcId || !spellCard?.catalogCard) return [];
    const ability = this.getAttackAbilityForCard(spellCard, 0) || {};
    const { valid, targetRule } = this.resolveAbilityTargetRule(ability);
    if (!valid) return [];
    const npcState = match.cardsByPlayer.get(npcId);
    const enemyId = match.players.find((id) => id !== npcId);
    const enemyState = enemyId ? match.cardsByPlayer.get(enemyId) : null;
    const candidates = [];

    if (targetRule === 'none') {
      return [{ targetSide: null, targetSlotIndex: null }];
    }

    if (targetRule === 'self') {
      for (const card of npcState?.board || []) {
        if (!Number.isInteger(card?.slotIndex)) continue;
        candidates.push({ targetSide: 'player', targetSlotIndex: card.slotIndex });
      }
      return candidates;
    }

    if (targetRule === 'friendly') {
      for (const card of npcState?.board || []) {
        if (!Number.isInteger(card?.slotIndex)) continue;
        candidates.push({ targetSide: 'player', targetSlotIndex: card.slotIndex });
      }
      return candidates;
    }

    if (targetRule === 'enemy') {
      const tauntCards = this.getActiveTauntCardsForDefender(match, enemyId);
      const tauntSlotSet = new Set(tauntCards.map((card) => card.slotIndex));
      for (const card of enemyState?.board || []) {
        if (!Number.isInteger(card?.slotIndex)) continue;
        if (tauntSlotSet.size > 0 && !tauntSlotSet.has(card.slotIndex)) continue;
        candidates.push({ targetSide: 'opponent', targetSlotIndex: card.slotIndex });
      }
      return candidates;
    }

    return [];
  }

  chooseNpcSpellAction(match, npcId) {
    const npcState = match?.cardsByPlayer?.get(npcId);
    if (!npcState) return null;
    if (match?.activeSpellResolution && match.activeSpellResolution.completedAt == null) return null;

    for (const handCard of npcState.hand) {
      if (handCard?.catalogCard?.cardKind !== 'Spell') continue;
      const spellAbility = this.getAttackAbilityForCard(handCard, 0);
      const upkeepCost = this.getAbilityUpkeepCost(spellAbility);
      if (upkeepCost > this.getPlayerUpkeepValue(npcState)) continue;
      if (match.npcSpellCardsCastThisTurn instanceof Set && match.npcSpellCardsCastThisTurn.has(handCard.id)) continue;
      const candidateTargets = this.getNpcSpellCandidateTargets(match, npcId, handCard);
      for (const candidate of candidateTargets) {
        const previewResult = this.startSpellResolution({
          playerId: npcId,
          cardId: handCard.id,
          selectedAbilityIndex: 0,
          targetSide: candidate.targetSide,
          targetSlotIndex: candidate.targetSlotIndex,
          rollType: 'damage',
          dieSides: 6,
        });
        if (previewResult?.error) continue;
        npcState.upkeep = Math.max(0, this.getPlayerUpkeepValue(npcState) - upkeepCost);
        npcState.spentUpkeepOnSpellsThisTurn = this.getPlayerSpellUpkeepSpentValue(npcState) + upkeepCost;
        return {
          type: 'spell',
          cardId: handCard.id,
          spellId: match.activeSpellResolution?.id,
        };
      }
    }

    return null;
  }

  validateSpellTargetSelection({ match, casterId, ability, targetSide, targetSlotIndex }) {
    const { valid, targetRule } = this.resolveAbilityTargetRule(ability);
    if (!valid) {
      return { valid: false, error: 'spell ability targeting is invalid' };
    }

    if (targetRule === 'none') {
      return { valid: true, targetSide: null, targetSlotIndex: null };
    }

    if (!Number.isInteger(targetSlotIndex)) {
      return { valid: false, error: 'spell target is required' };
    }

    if (targetRule === 'enemy' && targetSide !== 'opponent') {
      return { valid: false, error: 'spell must target an enemy' };
    }
    if ((targetRule === 'self' || targetRule === 'friendly') && targetSide !== 'player') {
      return { valid: false, error: 'spell must target a friendly card' };
    }

    const targetPlayerId = targetSide === 'player'
      ? casterId
      : match.players.find((id) => id !== casterId);
    if (!targetPlayerId) return { valid: false, error: 'target player not found' };
    const targetState = match.cardsByPlayer.get(targetPlayerId);
    const targetCard = targetState?.board?.find((card) => card?.slotIndex === targetSlotIndex);
    if (!targetCard) return { valid: false, error: 'target card not found' };

    return { valid: true, targetSide, targetSlotIndex };
  }

  initializeNpcAutomationForMatch(match, { withStartDelay = false } = {}) {
    if (!match) return;
    const now = Date.now();
    const startDelay = withStartDelay ? this.getNpcStartDelayMs() : 0;
    const entries = new Map();
    for (const npcId of this.getNpcPlayerIds(match)) {
      entries.set(npcId, {
        nextActionAt: now + startDelay,
      });
    }
    match.npcAutomationByPlayer = entries;
  }

  processNpcDecisionPhase(match) {
    if (!match || match.phase !== 1) return;
    if (match.npcAutomationProcessing) return;
    match.npcAutomationProcessing = true;
    const now = Date.now();
    if (!(match.npcAutomationByPlayer instanceof Map)) {
      this.initializeNpcAutomationForMatch(match, { withStartDelay: false });
    }

    try {
      for (const npcId of this.getNpcPlayerIds(match)) {
      const automation = match.npcAutomationByPlayer.get(npcId) || { nextActionAt: now };
      if (now < automation.nextActionAt) continue;
      if (match.readyPlayers.has(npcId)) continue;
      const npcState = match.cardsByPlayer.get(npcId);
      if (!npcState) continue;

      if (match.activeSpellResolution && match.activeSpellResolution.completedAt == null && match.activeSpellResolution.casterId === npcId) {
        const activeSpell = match.activeSpellResolution;
        if (activeSpell.requiresRoll && !Number.isFinite(activeSpell.rollOutcome)) {
          this.submitSpellRoll({
            playerId: npcId,
            spellId: activeSpell.id,
            rollOutcome: this.rollNpcDie(activeSpell.dieSides),
            rollData: null,
          });
        }
        this.completeSpellResolution({ playerId: npcId, spellId: activeSpell.id });
        automation.nextActionAt = now + this.getNpcActionDelayMs();
        match.npcAutomationByPlayer.set(npcId, automation);
        continue;
      }

      const spellAction = this.chooseNpcSpellAction(match, npcId);
      if (spellAction) {
        if (!(match.npcSpellCardsCastThisTurn instanceof Set)) {
          match.npcSpellCardsCastThisTurn = new Set();
        }
        if (spellAction.cardId) {
          match.npcSpellCardsCastThisTurn.add(spellAction.cardId);
        }
        automation.nextActionAt = now + this.getNpcActionDelayMs();
        match.npcAutomationByPlayer.set(npcId, automation);
        continue;
      }

      if (npcState.board.length < this.options.boardSlotsPerSide) {
        const nextCreatureIndex = npcState.hand.findIndex((card) => card?.catalogCard?.cardKind !== 'Spell');
        if (nextCreatureIndex >= 0) {
          const slotIndex = this.getFirstOpenBoardSlot(npcState.board);
          if (Number.isInteger(slotIndex)) {
            const [creatureCard] = npcState.hand.splice(nextCreatureIndex, 1);
            npcState.board.push({
              ...creatureCard,
              slotIndex,
              summonedTurn: match.turnNumber,
              attackCommitted: false,
              targetSlotIndex: null,
              targetSide: null,
              selectedAbilityIndex: 0,
            });
            automation.nextActionAt = now + this.getNpcActionDelayMs();
            match.npcAutomationByPlayer.set(npcId, automation);
            continue;
          }
        }
      }

      let changedAttackPlan = false;
      let remainingUpkeep = Math.max(0, this.getPlayerUpkeepValue(npcState) + this.getCommittedAttackUpkeepCost(npcState.board));
      for (const card of npcState.board) {
        const isSilenced = Number.isInteger(card?.silenceTurnsRemaining) && card.silenceTurnsRemaining > 0;
        const isSummoningSick = !Number.isInteger(card?.summonedTurn) || card.summonedTurn >= match.turnNumber;
        const nextPlan = !isSilenced && !isSummoningSick
          ? this.chooseNpcCreatureAttackPlan(match, npcId, card, remainingUpkeep)
          : null;
        const shouldCommit = Boolean(nextPlan);
        const nextTargetSide = shouldCommit ? nextPlan.targetSide : null;
        const nextTargetSlot = shouldCommit ? nextPlan.targetSlotIndex : null;
        const nextSelectedAbilityIndex = shouldCommit && Number.isInteger(nextPlan.selectedAbilityIndex)
          ? nextPlan.selectedAbilityIndex
          : 0;
        if (card.attackCommitted !== shouldCommit || card.targetSide !== nextTargetSide || card.targetSlotIndex !== nextTargetSlot) {
          changedAttackPlan = true;
        }
        card.attackCommitted = shouldCommit;
        card.targetSide = nextTargetSide;
        card.targetSlotIndex = nextTargetSlot;
        card.selectedAbilityIndex = nextSelectedAbilityIndex;
        if (shouldCommit) {
          const upkeepCost = Number.isFinite(nextPlan.upkeepCost)
            ? Math.max(0, Math.floor(nextPlan.upkeepCost))
            : this.getAbilityUpkeepCost(this.getAttackAbilityForCard(card, nextSelectedAbilityIndex));
          remainingUpkeep = Math.max(0, remainingUpkeep - upkeepCost);
        }
      }
      npcState.upkeep = remainingUpkeep;
      this.forceAttacksToTauntTarget(match, npcId);

      const humanId = match.players.find((id) => id !== npcId);
      const readyPayload = {
        playerId: npcId,
        hand: npcState.hand,
        board: npcState.board,
        discard: npcState.discard,
      };
      const canReady = humanId ? match.readyPlayers.has(humanId) || !changedAttackPlan : true;
      if (canReady) {
        this.readyUp(readyPayload);
      }

      automation.nextActionAt = now + this.getNpcActionDelayMs();
      match.npcAutomationByPlayer.set(npcId, automation);
      }
    } finally {
      match.npcAutomationProcessing = false;
    }
  }

  autoPlayNpcDecisionPhase(match) {
    this.processNpcDecisionPhase(match);
  }

  prepareNpcAttackPlanForReady(match, npcId) {
    if (!match || !npcId || match.phase !== 1) return;
    const npcState = match.cardsByPlayer.get(npcId);
    if (!npcState) return;

    let remainingUpkeep = Math.max(0, this.getPlayerUpkeepValue(npcState) + this.getCommittedAttackUpkeepCost(npcState.board));
    for (const card of npcState.board || []) {
      const isSilenced = Number.isInteger(card?.silenceTurnsRemaining) && card.silenceTurnsRemaining > 0;
      const isSummoningSick = !Number.isInteger(card?.summonedTurn) || card.summonedTurn >= match.turnNumber;
      const nextPlan = !isSilenced && !isSummoningSick
        ? this.chooseNpcCreatureAttackPlan(match, npcId, card, remainingUpkeep)
        : null;
      const shouldCommit = Boolean(nextPlan);
      card.attackCommitted = shouldCommit;
      card.targetSide = shouldCommit ? nextPlan.targetSide : null;
      card.targetSlotIndex = shouldCommit ? nextPlan.targetSlotIndex : null;
      card.selectedAbilityIndex = shouldCommit && Number.isInteger(nextPlan.selectedAbilityIndex)
        ? nextPlan.selectedAbilityIndex
        : 0;
      if (shouldCommit) {
        const upkeepCost = Number.isFinite(nextPlan.upkeepCost)
          ? Math.max(0, Math.floor(nextPlan.upkeepCost))
          : this.getAbilityUpkeepCost(this.getAttackAbilityForCard(card, card.selectedAbilityIndex));
        remainingUpkeep = Math.max(0, remainingUpkeep - upkeepCost);
      }
    }

    npcState.upkeep = remainingUpkeep;
    this.forceAttacksToTauntTarget(match, npcId);
  }

  autoSubmitNpcCommitRolls(match) {
    if (!match || match.phase !== 2) return;
    for (const npcId of this.getNpcPlayerIds(match)) {
      const attacks = match.pendingCommitAttacksByPlayer.get(npcId) || [];
      for (const attack of attacks) {
        ['damage', 'speed', 'defense'].forEach((rollType) => {
          const key = `${attack.id}:${rollType}`;
          if (match.commitRollsByAttackId.has(key)) return;
          const outcome = this.rollNpcDie(6);
          match.commitRollsByAttackId.set(key, {
            attackId: attack.id,
            attackerId: npcId,
            rollType,
            sides: 6,
            roll: { outcome, frames: [] },
            submittedAt: Date.now(),
          });
          this.applySpellDisruptionDebuffToCommitRoll({
            match,
            attackerId: npcId,
            attackId: attack.id,
            rollType,
          });
        });
      }
    }
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
        focalMarkTurnsRemaining: 0,
        focalMarkBonusDamage: 0,
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

    const isCreatureCard = (card) => String(card?.cardKind || '').trim().toLowerCase() === 'creature';
    const creaturePool = cardPool.filter((card) => isCreatureCard(card));
    const nonCreaturePool = cardPool.filter((card) => !isCreatureCard(card));

    const deckCards = [];
    preferredCards.slice(0, this.options.deckSizePerPlayer).forEach((catalogCard) => {
      deckCards.push(catalogCard);
    });

    while (deckCards.length < this.options.deckSizePerPlayer) {
      const randomCard = cardPool[Math.floor(Math.random() * cardPool.length)] || {};
      deckCards.push(randomCard);
    }

    if (creaturePool.length && nonCreaturePool.length) {
      const countCreatures = () => deckCards.filter((card) => isCreatureCard(card)).length;
      while (countCreatures() < 3) {
        const replaceIndex = deckCards.findIndex((card) => !isCreatureCard(card));
        if (replaceIndex < 0) break;
        const randomCreature = creaturePool[Math.floor(Math.random() * creaturePool.length)] || creaturePool[0];
        deckCards[replaceIndex] = randomCreature;
      }
      while (countCreatures() > 3) {
        const replaceIndex = deckCards.findIndex((card) => isCreatureCard(card));
        if (replaceIndex < 0) break;
        const randomNonCreature = nonCreaturePool[Math.floor(Math.random() * nonCreaturePool.length)] || nonCreaturePool[0];
        deckCards[replaceIndex] = randomNonCreature;
      }
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
        focalMarkTurnsRemaining: 0,
        focalMarkBonusDamage: 0,
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
        resolvedAttack.resolvedValue = Number.isFinite(executionState.resolvedValue)
          ? executionState.resolvedValue
          : resolvedAttack.resolvedValue;
        resolvedAttack.resolvedDamage = Number.isFinite(executionState.resolvedDamage)
          ? executionState.resolvedDamage
          : resolvedAttack.resolvedDamage;
        resolvedAttack.resolvedHealing = Number.isFinite(executionState.resolvedHealing)
          ? executionState.resolvedHealing
          : resolvedAttack.resolvedHealing;
        resolvedAttack.resolvedLifeStealHealing = Number.isFinite(executionState.resolvedLifeStealHealing)
          ? executionState.resolvedLifeStealHealing
          : resolvedAttack.resolvedLifeStealHealing;
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

    const metricUpdateEvents = this.takeMetricUpdateEvents(match, playerId);

    return {
      id: match.id,
      turnNumber: match.turnNumber,
      upkeep: this.getPlayerUpkeepValue(playerState),
      upkeepTotal: this.getPlayerUpkeepTotalValue(playerState),
      phase: match.phase,
      isComplete: match.phase === 3,
      outcome: match.outcome
        ? {
          ...match.outcome,
          didPlayerWin: match.outcome.winnerId === playerId,
        }
        : null,
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
        metricUpdateEvents,
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
    const getOpponentId = (playerId) => match.players.find((id) => id !== playerId) || null;

    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      if (!playerState?.board?.length) return;

      playerState.board.forEach((card) => {
        Object.entries(DOT_HANDLERS).forEach(([dotId, dotHandler]) => {
          const dotDamage = dotHandler.tick(card);
          if (dotDamage < 1) return;
          const damageResult = this.applyDamageToCard({
            match,
            targetPlayerId: playerId,
            targetSlotIndex: card.slotIndex,
            damage: dotDamage,
            sourcePlayerId: getOpponentId(playerId),
            applyFocalMarkBonus: true,
          });
          if (damageResult.executed === false) return;
          events.push({
            playerId,
            cardId: card.id,
            slotIndex: Number.isInteger(card.slotIndex) ? card.slotIndex : null,
            damage: Number.isFinite(damageResult.totalDamageApplied) ? damageResult.totalDamageApplied : dotDamage,
            baseDamage: dotDamage,
            focalMarkBonusDamage: Number.isFinite(damageResult.focalMarkBonusDamage) ? damageResult.focalMarkBonusDamage : 0,
            appliedDebuffs: [dotId],
            resultingHealth: damageResult.resultingHealth,
          });
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
    match.npcSpellCardsCastThisTurn = new Set();
    match.lastDotDamageEvents = this.applyDamageOverTimeAtPhaseChange(match);
    match.players.forEach((playerId) => {
      const playerState = match.cardsByPlayer.get(playerId);
      if (!playerState) return;
      const nextUpkeepTotal = Math.min(MAX_UPKEEP, this.getPlayerUpkeepTotalValue(playerState) + 1);
      playerState.upkeepTotal = nextUpkeepTotal;
      playerState.upkeep = nextUpkeepTotal;
      playerState.spentUpkeepOnSpellsThisTurn = 0;
      playerState.board = playerState.board.map((card) => {
        const nextFocalMarkTurnsRemaining = Math.max(0, (Number.isInteger(card.focalMarkTurnsRemaining) ? card.focalMarkTurnsRemaining : 0) - 1);
        const currentFocalMarkBonusDamage = Math.max(0, (Number.isFinite(card.focalMarkBonusDamage) ? Math.floor(card.focalMarkBonusDamage) : 0));
        return {
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
        focalMarkTurnsRemaining: nextFocalMarkTurnsRemaining,
        focalMarkBonusDamage: nextFocalMarkTurnsRemaining > 0 ? currentFocalMarkBonusDamage : 0,
        disruptionDebuffTurnsRemaining: Math.max(0, (Number.isInteger(card.disruptionDebuffTurnsRemaining) ? card.disruptionDebuffTurnsRemaining : 0) - 1),
        disruptionDebuffs: createEmptyDisruptionDebuffs(),
        };
      });
    });
    this.applyDecisionPhaseStartDraw(match);
    this.initializeNpcAutomationForMatch(match, { withStartDelay: false });
    this.autoPlayNpcDecisionPhase(match);
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


  getAbilityUpkeepCost(ability) {
    const parsedCost = Number.parseInt(ability?.cost, 10);
    if (!Number.isFinite(parsedCost)) return 0;
    return Math.max(0, Math.floor(parsedCost));
  }

  resolveAbilityTargetRule(ability) {
    const normalizedEffectId = typeof ability?.effectId === 'string'
      ? ability.effectId.trim().toLowerCase()
      : 'none';
    const normalizedBuffId = typeof ability?.buffId === 'string'
      ? ability.buffId.trim().toLowerCase()
      : 'none';
    const normalizedTarget = typeof ability?.target === 'string'
      ? ability.target.trim().toLowerCase()
      : 'none';
    const normalizedBuffTarget = typeof ability?.buffTarget === 'string'
      ? ability.buffTarget.trim().toLowerCase()
      : 'none';

    const hasEffect = normalizedEffectId !== 'none';
    const hasBuff = normalizedBuffId !== 'none';
    const allowedTargetKinds = new Set(['self', 'friendly', 'enemy']);

    if (hasEffect) {
      if (!allowedTargetKinds.has(normalizedTarget)) {
        return { valid: false, targetRule: null };
      }
      return { valid: true, targetRule: normalizedTarget };
    }

    if (hasBuff) {
      if (!allowedTargetKinds.has(normalizedBuffTarget)) {
        return { valid: false, targetRule: null };
      }
      return { valid: true, targetRule: normalizedBuffTarget };
    }

    return { valid: true, targetRule: 'none' };
  }

  getPlayerUpkeepTotalValue(playerState) {
    const value = Number.parseInt(playerState?.upkeepTotal, 10);
    return Number.isFinite(value) ? Math.max(1, Math.min(MAX_UPKEEP, value)) : 1;
  }

  getPlayerUpkeepValue(playerState) {
    const value = Number.parseInt(playerState?.upkeep, 10);
    return Number.isFinite(value) ? Math.max(0, Math.min(this.getPlayerUpkeepTotalValue(playerState), value)) : this.getPlayerUpkeepTotalValue(playerState);
  }

  getPlayerSpellUpkeepSpentValue(playerState) {
    const value = Number.parseInt(playerState?.spentUpkeepOnSpellsThisTurn, 10);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  getCommittedAttackUpkeepCost(board) {
    if (!Array.isArray(board)) return 0;
    return board.reduce((total, card) => {
      if (card?.attackCommitted !== true) return total;
      const ability = this.getAttackAbilityForCard(card, Number.isInteger(card?.selectedAbilityIndex) ? card.selectedAbilityIndex : 0);
      return total + this.getAbilityUpkeepCost(ability);
    }, 0);
  }

  getAttackAbilityForCard(card, selectedAbilityIndex = 0) {
    const catalogCard = card?.catalogCard || {};
    const abilities = [catalogCard.ability1, catalogCard.ability2].filter(Boolean);
    if (!abilities.length) return null;
    const selectedAbility = Number.isInteger(selectedAbilityIndex) && selectedAbilityIndex >= 0 && selectedAbilityIndex < abilities.length
      ? abilities[selectedAbilityIndex]
      : abilities[0];
    if (!selectedAbility || typeof selectedAbility !== 'object') return selectedAbility;

    const normalizedEffectId = typeof selectedAbility.effectId === 'string'
      ? selectedAbility.effectId.trim().toLowerCase()
      : 'none';
    const normalizedBuffId = typeof selectedAbility.buffId === 'string'
      ? selectedAbility.buffId.trim().toLowerCase()
      : 'none';
    if (normalizedEffectId !== 'taunt' || normalizedBuffId !== 'none') {
      return selectedAbility;
    }

    const normalizedTarget = typeof selectedAbility.target === 'string'
      ? selectedAbility.target.trim().toLowerCase()
      : 'none';
    const fallbackBuffTarget = normalizedTarget === 'self' || normalizedTarget === 'friendly'
      ? normalizedTarget
      : 'self';
    return {
      ...selectedAbility,
      effectId: 'none',
      buffId: 'taunt',
      buffTarget: fallbackBuffTarget,
    };
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

  resolveRetaliationDamageFromCommittedAttack(match, committedAttack) {
    if (!match?.commitRollsByAttackId || !committedAttack?.id) {
      return 0;
    }
    if (committedAttack.retaliationEnabled === false) {
      return 0;
    }

    const retaliationRoll = match.commitRollsByAttackId.get(`${committedAttack.id}:damage`);
    const retaliationRollOutcome = normalizeRollOutcome(Number(retaliationRoll?.roll?.outcome));
    const normalizedRollDamage = Number.isFinite(retaliationRollOutcome)
      ? Math.max(0, Math.floor(retaliationRollOutcome))
      : 0;
    const committedRetaliationBonus = Number(committedAttack.committedRetaliationBonus);
    const normalizedRetaliationBonus = Number.isFinite(committedRetaliationBonus)
      ? Math.max(0, Math.floor(committedRetaliationBonus))
      : 0;

    return normalizedRollDamage + normalizedRetaliationBonus;
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
    if (buffId !== 'taunt' && buffId !== 'silence' && buffId !== 'poison' && buffId !== 'fire' && buffId !== 'frostbite' && buffId !== 'focal_mark') {
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

    if (buffId === 'focal_mark') {
      const bonusDamage = Number.isFinite(attack?.resolvedValue)
        ? Math.max(0, Math.floor(attack.resolvedValue))
        : 0;
      if (bonusDamage < 1) {
        return { executed: false, reason: 'invalid_bonus_value' };
      }
      targetCard.focalMarkTurnsRemaining = normalizedDuration;
      targetCard.focalMarkBonusDamage = bonusDamage;
      return { executed: true, reason: 'focal_mark_applied' };
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


  applyDamageToCard({
    match,
    targetPlayerId,
    targetSlotIndex,
    damage,
    sourcePlayerId = null,
    applyFocalMarkBonus = true,
  }) {
    const normalizedDamage = Number.isFinite(damage)
      ? Math.max(0, Math.floor(damage))
      : 0;
    if (!match || !targetPlayerId || !Number.isInteger(targetSlotIndex)) {
      return { executed: false, reason: 'target_missing', appliedValue: 0, focalMarkBonusDamage: 0, totalDamageApplied: 0 };
    }
    if (normalizedDamage < 1) {
      return { executed: true, reason: 'no_value', appliedValue: 0, focalMarkBonusDamage: 0, totalDamageApplied: 0 };
    }

    const targetState = match.cardsByPlayer.get(targetPlayerId);
    const targetCard = targetState?.board?.find((card) => card.slotIndex === targetSlotIndex) || null;
    const currentHealth = Number(targetCard?.catalogCard?.health);
    if (!targetCard?.catalogCard || !Number.isFinite(currentHealth)) {
      return { executed: false, reason: 'target_invalid', appliedValue: 0, focalMarkBonusDamage: 0, totalDamageApplied: 0 };
    }

    const focalMarkBonusDamage = this.getFocalMarkBonusDamageForCard({
      card: targetCard,
      applyFocalMarkBonus,
    });
    const totalDamageApplied = normalizedDamage + focalMarkBonusDamage;
    const nextHealth = currentHealth - totalDamageApplied;
    targetCard.catalogCard.health = nextHealth;

    if (nextHealth <= 0) {
      const defeated = this.removeDefeatedCreaturesFromBoard(match, targetPlayerId);
      if (defeated.length) {
        if (sourcePlayerId) {
          this.recordMatchMetric(match, sourcePlayerId, 'totalCreaturesKilled', defeated.length);
        }
        this.recordMatchMetric(match, targetPlayerId, 'totalCreaturesLost', defeated.length);
      }
      this.finalizeMatchIfGameOver(match);
    }

    return {
      executed: true,
      reason: 'effect_applied',
      appliedValue: normalizedDamage,
      focalMarkBonusDamage,
      totalDamageApplied,
      resultingHealth: nextHealth,
    };
  }

  getFocalMarkBonusDamageForCard({ card, applyFocalMarkBonus = true }) {
    if (!applyFocalMarkBonus || !card) return 0;
    const markDuration = Number.isInteger(card.focalMarkTurnsRemaining) ? card.focalMarkTurnsRemaining : 0;
    const markBonus = Number.isFinite(card.focalMarkBonusDamage)
      ? Math.max(0, Math.floor(card.focalMarkBonusDamage))
      : 0;
    return markDuration > 0 && markBonus > 0 ? markBonus : 0;
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

    if (effectId === 'damage_enemy' || effectId === 'life_steal' || effectId === 'disruption') {
      const damageResult = this.applyDamageToCard({
        match,
        targetPlayerId: defenderId,
        targetSlotIndex,
        damage: adjustedResolvedValue,
        sourcePlayerId: casterId,
        applyFocalMarkBonus: true,
      });
      return {
        ...damageResult,
        reason: effectId === 'disruption' ? 'disruption_damage_fallback' : damageResult.reason,
      };
    }

    const currentHealth = Number(defenderCard.catalogCard.health);
    if (!Number.isFinite(currentHealth)) {
      return { executed: false, reason: 'target_invalid' };
    }
    defenderCard.catalogCard.health = currentHealth + adjustedResolvedValue;

    return {
      executed: true,
      appliedValue: adjustedResolvedValue,
      reason: 'effect_applied',
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
      const defeated = this.removeDefeatedCreaturesFromBoard(match, attackerId);
      if (defeated.length) {
        const defenderId = match.players.find((id) => id !== attackerId) || null;
        if (defenderId) {
          this.recordMatchMetric(match, defenderId, 'totalCreaturesKilled', defeated.length);
        }
        this.recordMatchMetric(match, attackerId, 'totalCreaturesLost', defeated.length);
      }
      this.finalizeMatchIfGameOver(match);
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

      if (executionResult.executed !== false
        && (resolvedAttack.effectId === 'damage_enemy' || resolvedAttack.effectId === 'life_steal' || executionResult.reason === 'disruption_damage_fallback')) {
        resolvedAttack.resolvedValue = Number.isFinite(executionResult.totalDamageApplied)
          ? executionResult.totalDamageApplied
          : resolvedAttack.resolvedValue;
        resolvedAttack.resolvedDamage = resolvedAttack.resolvedValue;
      }

      const buffResult = executionResult.executed === false
        ? { executed: false, reason: 'effect_failed' }
        : this.applyResolvedAbilityBuff({
          match,
          casterId: attackerId,
          attack: {
            ...tauntAdjustedAttack,
            resolvedValue: resolvedAttack.baseResolvedValue,
          },
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
        const retaliationDamage = this.resolveRetaliationDamageFromCommittedAttack(match, defenderAttack);
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
        resolvedValue: Number.isFinite(resolvedAttack.resolvedValue) ? resolvedAttack.resolvedValue : 0,
        resolvedDamage: Number.isFinite(resolvedAttack.resolvedDamage) ? resolvedAttack.resolvedDamage : 0,
        resolvedHealing: Number.isFinite(resolvedAttack.resolvedHealing) ? resolvedAttack.resolvedHealing : 0,
        resolvedLifeStealHealing: Number.isFinite(resolvedAttack.resolvedLifeStealHealing)
          ? resolvedAttack.resolvedLifeStealHealing
          : 0,
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
          .map((card) => {
            const attackId = `${playerId}:${card.slotIndex}:${card.targetSide || 'none'}:${Number.isInteger(card.targetSlotIndex) ? card.targetSlotIndex : 'none'}`;
            const selectedAbilityIndex = Number.isInteger(card.selectedAbilityIndex) ? card.selectedAbilityIndex : 0;
            const selectedAbility = this.getAttackAbilityForCard(card, selectedAbilityIndex);
            const retaliationEnabled = selectedAbility?.effectId === 'damage_enemy';
            const retaliationBonus = Number(card.retaliationBonus);
            const committedRetaliationBonus = Number.isFinite(retaliationBonus)
              ? Math.max(0, Math.floor(retaliationBonus))
              : 0;

            return {
              id: attackId,
              attackerId: playerId,
              attackerSlotIndex: card.slotIndex,
              targetSlotIndex: Number.isInteger(card.targetSlotIndex) ? card.targetSlotIndex : null,
              targetSide: card.targetSide || null,
              selectedAbilityIndex,
              retaliationEnabled,
              committedRetaliationBonus,
            };
          }) || [];
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
    this.autoSubmitNpcCommitRolls(match);
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
    for (const npcPlayerId of this.getNpcPlayerIds(match)) {
      match.commitCompletedPlayers.add(npcPlayerId);
    }
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
    for (const npcPlayerId of this.getNpcPlayerIds(match)) {
      match.commitAnimationCompletedPlayers.add(npcPlayerId);
    }
    if (match.commitAnimationCompletedPlayers.size === match.players.length) {
      if (match.phase === 3) {
        // Battle already ended during commit resolution.
      } else {
        this.advanceMatchToDecisionPhase(match);
      }
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

    if (!this.isNpcPlayerId(playerId) && match?.phase === 1) {
      if (!(match.npcAutomationByPlayer instanceof Map)) {
        this.initializeNpcAutomationForMatch(match, { withStartDelay: false });
      }
      for (let attempts = 0; attempts < 8; attempts += 1) {
        for (const npcPlayerId of this.getNpcPlayerIds(match)) {
          if (match.readyPlayers.has(npcPlayerId)) continue;
          const automation = match.npcAutomationByPlayer.get(npcPlayerId) || { nextActionAt: Date.now() };
          automation.nextActionAt = 0;
          match.npcAutomationByPlayer.set(npcPlayerId, automation);
        }
        this.processNpcDecisionPhase(match);
        const allNpcReady = this.getNpcPlayerIds(match).every((npcPlayerId) => match.readyPlayers.has(npcPlayerId));
        if (allNpcReady || match.phase !== 1) break;
      }
    }

    for (const npcPlayerId of this.getNpcPlayerIds(match)) {
      this.prepareNpcAttackPlanForReady(match, npcPlayerId);
      match.readyPlayers.add(npcPlayerId);
    }

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
        focalMarkTurnsRemaining: Number.isInteger(knownCard?.focalMarkTurnsRemaining) ? knownCard.focalMarkTurnsRemaining : 0,
        focalMarkBonusDamage: Number.isFinite(knownCard?.focalMarkBonusDamage) ? Math.max(0, Math.floor(knownCard.focalMarkBonusDamage)) : 0,
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

    const upkeepTotal = this.getPlayerUpkeepTotalValue(playerState);
    let remainingUpkeep = upkeepTotal;
    const spellUpkeepCost = this.getPlayerSpellUpkeepSpentValue(playerState);
    if (spellUpkeepCost > remainingUpkeep) {
      return { error: 'insufficient upkeep for selected abilities' };
    }
    remainingUpkeep -= spellUpkeepCost;

    for (const card of normalizedBoard) {
      if (card.attackCommitted !== true) continue;
      const ability = this.getAttackAbilityForCard(card, Number.isInteger(card.selectedAbilityIndex) ? card.selectedAbilityIndex : 0);
      const upkeepCost = this.getAbilityUpkeepCost(ability);
      if (upkeepCost > remainingUpkeep) {
        return { error: 'insufficient upkeep for selected abilities' };
      }
      remainingUpkeep -= upkeepCost;
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
      upkeepTotal,
      upkeep: remainingUpkeep,
      spentUpkeepOnSpellsThisTurn: spellUpkeepCost,
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
      if (!match.npcAutomationProcessing) {
        this.processNpcDecisionPhase(match);
      }
      const opponentId = match.players.find((id) => id !== playerId) || null;
      const playerProfile = this.getMatchProfile(match, playerId);
      const opponentProfile = this.getMatchProfile(match, opponentId);
      return {
        status: 'matched',
        matchId: match.id,
        opponentId,
        playerProfile,
        opponentProfile,
        queueCount: this.phaseQueue.length,
        matchState: this.serializeMatchForPlayer(match, playerId),
      };
    }

    return { status: 'idle', queueCount: this.phaseQueue.length };
  }

  async getRandomNpcDeckCardIds() {
    let npcDecks = [];
    try {
      const loadedDecks = await this.options.npcDeckProvider();
      npcDecks = Array.isArray(loadedDecks) ? loadedDecks : [];
    } catch (error) {
      npcDecks = [];
    }

    const candidateDecks = npcDecks
      .map((deck) => (Array.isArray(deck?.deck?.cards) ? deck.deck.cards : []))
      .map((cards) => cards.filter((cardId) => typeof cardId === 'string' && cardId.trim()).map((cardId) => cardId.trim()))
      .filter((cards) => cards.length > 0);

    if (!candidateDecks.length) {
      return [];
    }

    const randomIndex = Math.floor(Math.random() * candidateDecks.length);
    return candidateDecks[randomIndex];
  }

  async findMatch(playerId, options = {}) {
    const existing = this.getPlayerPhaseStatus(playerId);
    if (existing.status === 'matched' || existing.status === 'searching') {
      return existing;
    }

    const preferredDeckCardIds = Array.isArray(options.deckCardIds)
      ? options.deckCardIds.filter((cardId) => typeof cardId === 'string' && cardId.trim()).map((cardId) => cardId.trim())
      : [];
    const normalizedOpponentType = typeof options.opponentType === 'string' ? options.opponentType.trim().toLowerCase() : '';
    const normalizedMode = typeof options.mode === 'string' && options.mode.trim() ? options.mode.trim().toLowerCase() : 'matchmaking';
    const useNpcOpponent = normalizedOpponentType === 'npc';

    const createMatchState = async (players, preferredDeckByPlayer) => {
      const cardsByPlayer = new Map();
      const profilesByPlayer = new Map();
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
          upkeepTotal: 1,
          upkeep: 1,
          spentUpkeepOnSpellsThisTurn: 0,
        });
      });

      const metricsByPlayer = new Map();
      const initialCreatureCountByPlayer = new Map();
      players.forEach((id) => {
        metricsByPlayer.set(id, this.createEmptyBattleMetrics());
        const playerState = cardsByPlayer.get(id);
        const creatureCount = (playerState?.allCards || []).filter((card) => card?.catalogCard?.cardKind === 'Creature').length;
        initialCreatureCountByPlayer.set(id, creatureCount);
      });

      const loadedProfiles = await Promise.all(players.map((id) => this.loadPlayerProfile(id)));
      loadedProfiles.forEach((profile, index) => {
        const playerIdForProfile = players[index];
        profilesByPlayer.set(playerIdForProfile, this.normalizePlayerProfile(playerIdForProfile, profile));
      });

      return {
        id: `match-${randomUUID().slice(0, 8)}`,
        players,
        profilesByPlayer,
        cardsByPlayer,
        metricsByPlayer,
        initialCreatureCountByPlayer,
        mode: normalizedMode || 'matchmaking',
        turnNumber: 1,
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
        metricUpdateEventsByPlayer: new Map(),
        npcSpellCardsCastThisTurn: new Set(),
        createdAt: Date.now(),
      };
    };

    const opponentEntry = useNpcOpponent ? null : this.phaseQueue.shift();
    if (opponentEntry && opponentEntry.playerId && opponentEntry.playerId !== playerId) {
      const opponentId = opponentEntry.playerId;
      const players = [opponentId, playerId];
      const preferredDeckByPlayer = new Map([
        [opponentId, Array.isArray(opponentEntry.deckCardIds) ? opponentEntry.deckCardIds : []],
        [playerId, preferredDeckCardIds],
      ]);
      const match = await createMatchState(players, preferredDeckByPlayer);
      this.phaseMatches.set(match.id, match);
      this.phaseMatchmakingState.set(opponentId, { status: 'matched', matchId: match.id });
      this.phaseMatchmakingState.set(playerId, { status: 'matched', matchId: match.id });
      return this.getPlayerPhaseStatus(playerId);
    }

    if (useNpcOpponent) {
      const npcPlayerId = `npc-${randomUUID().slice(0, 8)}`;
      const npcDeckCardIds = await this.getRandomNpcDeckCardIds();
      const players = [npcPlayerId, playerId];
      const preferredDeckByPlayer = new Map([
        [npcPlayerId, npcDeckCardIds],
        [playerId, preferredDeckCardIds],
      ]);
      const match = await createMatchState(players, preferredDeckByPlayer);
      this.phaseMatches.set(match.id, match);
      this.phaseMatchmakingState.set(npcPlayerId, { status: 'matched', matchId: match.id });
      this.phaseMatchmakingState.set(playerId, { status: 'matched', matchId: match.id });
      this.initializeNpcAutomationForMatch(match, { withStartDelay: true });
      this.autoPlayNpcDecisionPhase(match);
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
    playerState.upkeepTotal = validated.upkeepTotal;
    playerState.upkeep = validated.upkeep;
    playerState.spentUpkeepOnSpellsThisTurn = validated.spentUpkeepOnSpellsThisTurn;
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
    playerState.upkeepTotal = validated.upkeepTotal;
    playerState.upkeep = validated.upkeep;
    playerState.spentUpkeepOnSpellsThisTurn = validated.spentUpkeepOnSpellsThisTurn;

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

    const spellAbility = this.getAttackAbilityForCard(handCard, Number.isInteger(selectedAbilityIndex) ? selectedAbilityIndex : 0);
    const upkeepCost = this.getAbilityUpkeepCost(spellAbility);
    const availableUpkeep = this.getPlayerUpkeepValue(playerState);
    if (upkeepCost > availableUpkeep) {
      return { error: 'insufficient upkeep for selected ability', statusCode: 400 };
    }
    const normalizedTargetSlotIndex = this.normalizeBoardTargetSlotIndex(targetSlotIndex, targetSide);
    const normalizedTargetSide = targetSide === 'player' || targetSide === 'opponent' ? targetSide : null;
    const targetValidation = this.validateSpellTargetSelection({
      match,
      casterId: playerId,
      ability: spellAbility,
      targetSide: normalizedTargetSide,
      targetSlotIndex: normalizedTargetSlotIndex,
    });
    if (!targetValidation.valid) {
      return { error: targetValidation.error, statusCode: 400 };
    }
    if (normalizedTargetSide === 'opponent' && Number.isInteger(normalizedTargetSlotIndex)) {
      const opponentId = match.players.find((id) => id !== playerId);
      const tauntSlots = new Set(this.getActiveTauntCardsForDefender(match, opponentId).map((card) => card.slotIndex));
      if (tauntSlots.size > 0 && !tauntSlots.has(normalizedTargetSlotIndex)) {
        return { error: 'target must be a taunting enemy while taunt is active', statusCode: 400 };
      }
    }

    playerState.upkeep = Math.max(0, availableUpkeep - upkeepCost);
    playerState.spentUpkeepOnSpellsThisTurn = this.getPlayerSpellUpkeepSpentValue(playerState) + upkeepCost;
    this.recordMatchMetric(match, playerId, 'totalSpellsPlayed', 1);

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
    const previewTargetCard = this.getTargetCardForEffect({
      match,
      casterId: playerId,
      targetSide: active.targetSide,
      targetSlotIndex: active.targetSlotIndex,
    });
    const focalMarkPreviewBonus = this.getFocalMarkBonusDamageForCard({
      card: previewTargetCard,
      applyFocalMarkBonus: effectId === 'damage_enemy' || effectId === 'life_steal',
    });
    active.resolvedDamage = effectId === 'damage_enemy' || effectId === 'life_steal'
      ? Math.max(0, resolvedValue + focalMarkPreviewBonus)
      : 0;
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
    active.resolvedDamage = (effectId === 'damage_enemy' || effectId === 'life_steal' || executionResult.reason === 'disruption_damage_fallback') && executionResult.executed !== false
      ? (Number.isFinite(executionResult.totalDamageApplied)
        ? executionResult.totalDamageApplied
        : (Number.isFinite(executionResult.appliedValue) ? executionResult.appliedValue : resolvedValue))
      : 0;
    active.resolvedHealing = effectId === 'heal_target' && executionResult.executed !== false
      ? (Number.isFinite(executionResult.appliedValue) ? executionResult.appliedValue : resolvedValue)
      : 0;
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
        resolvedValue: baseResolvedValue,
      },
      buffId: spellAbility?.buffId || 'none',
      buffTarget: spellAbility?.buffTarget || 'none',
      durationTurns: Number.isInteger(spellAbility?.durationTurns) ? spellAbility.durationTurns : null,
    });

    const casterState = match.cardsByPlayer.get(playerId);
    if (casterState) {
      const spellHandIndex = casterState.hand.findIndex((card) => card?.id === active.cardId);
      if (spellHandIndex >= 0) {
        const [consumedSpell] = casterState.hand.splice(spellHandIndex, 1);
        casterState.discard.push(consumedSpell);
      }
    }

    active.completedAt = Date.now();
    this.finalizeMatchIfGameOver(match);
    return { payload: this.getPlayerPhaseStatus(playerId), statusCode: 200 };
  }
}

module.exports = { PhaseManagerServer };
