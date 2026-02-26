const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function createSpellMatch({
  targetHealth = 6,
  ability = null,
  rollOutcome = 3,
  spellType = null,
  targetType = null,
  targetSide = 'opponent',
}) {
  const server = new PhaseManagerServer();
  const playerId = 'p1';
  const opponentId = 'p2';
  const spellId = 'spell-abc';
  const spellCardId = 'spell-card-1';

  const match = {
    id: 'match-spell-effects-test',
    players: [playerId, opponentId],
    turnNumber: 1,
    phase: 1,
    phaseStartedAt: Date.now(),
    readyPlayers: new Set(),
    cardsByPlayer: new Map(),
    lastDrawnCardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
    commitAllRolledAt: null,
    activeSpellResolution: {
      id: spellId,
      casterId: playerId,
      cardId: spellCardId,
      cardSnapshot: {
        id: spellCardId,
        color: 0,
        catalogCard: {
          cardKind: 'Spell',
          type: spellType,
          ability1: ability,
          ability2: null,
        },
      },
      selectedAbilityIndex: 0,
      targetSlotIndex: 0,
      targetSide,
      rollType: 'damage',
      dieSides: 6,
      rollOutcome,
      rollData: null,
      startedAt: Date.now(),
      completedAt: null,
    },
  };

  const casterState = {
    hand: [{ id: spellCardId, color: 0, catalogCard: { cardKind: 'Spell', type: spellType } }],
    board: [],
    deck: [],
    discard: [],
  };

  const defenderCard = {
    id: 'target-board-card',
    slotIndex: 0,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
    catalogCard: {
      type: targetType,
      health: targetHealth,
      ability1: null,
      ability2: null,
    },
  };

  const opponentState = {
    hand: [],
    board: targetSide === 'opponent' ? [defenderCard] : [],
    deck: [],
    discard: [],
  };

  if (targetSide === 'player') {
    casterState.board.push(defenderCard);
  }

  match.cardsByPlayer.set(playerId, casterState);
  match.cardsByPlayer.set(opponentId, opponentState);
  match.lastDrawnCardsByPlayer.set(playerId, []);
  match.lastDrawnCardsByPlayer.set(opponentId, []);
  match.pendingCommitAttacksByPlayer.set(playerId, []);
  match.pendingCommitAttacksByPlayer.set(opponentId, []);

  server.phaseMatchmakingState.set(playerId, { status: 'matched', matchId: match.id });
  server.phaseMatchmakingState.set(opponentId, { status: 'matched', matchId: match.id });
  server.phaseMatches.set(match.id, match);

  return { server, match, playerId, spellId, defenderCard, opponentState };
}

{
  const { server, match, playerId, spellId } = createSpellMatch({
    targetHealth: 6,
    rollOutcome: 5,
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'roll',
      valueSourceStat: 'efct',
    },
  });

  const rollResult = server.submitSpellRoll({
    playerId,
    spellId,
    rollOutcome: 5,
    rollData: null,
  });

  assert.equal(rollResult.statusCode, 200);
  assert.equal(match.activeSpellResolution.effectId, 'damage_enemy', 'rolled spells should publish effect metadata immediately');
  assert.equal(match.activeSpellResolution.resolvedValue, 5, 'rolled spells should publish resolved values immediately');
  assert.equal(match.activeSpellResolution.resolvedDamage, 5, 'rolled spells should publish resolved damage immediately');
}

{
  const { server, match, playerId, spellId, defenderCard } = createSpellMatch({
    targetHealth: 6,
    rollOutcome: 3,
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'roll',
      valueSourceStat: 'efct',
    },
  });

  const result = server.completeSpellResolution({ playerId, spellId });

  assert.equal(result.statusCode, 200);
  assert.equal(defenderCard.catalogCard.health, 3, 'spell damage should persist on target');
  assert.equal(match.activeSpellResolution.resolvedDamage, 3, 'completed spells should expose resolvedDamage');
  assert.equal(match.activeSpellResolution.effectId, 'damage_enemy', 'completed spells should expose effect id');
}

{
  const { server, match, playerId, spellId, opponentState } = createSpellMatch({
    targetHealth: 2,
    rollOutcome: 4,
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'roll',
      valueSourceStat: 'efct',
    },
  });

  const result = server.completeSpellResolution({ playerId, spellId });

  assert.equal(result.statusCode, 200);
  assert.equal(opponentState.board.length, 0, 'spell damage should remove defeated targets');
  assert.equal(match.activeSpellResolution.resolvedDamage, 4, 'spell metadata should reflect lethal damage');
}

{
  const { server, match, playerId, spellId, defenderCard } = createSpellMatch({
    targetHealth: 6,
    rollOutcome: 3,
    ability: {
      effectId: 'retaliation_bonus',
      valueSourceType: 'roll',
      valueSourceStat: 'efct',
    },
  });

  const result = server.completeSpellResolution({ playerId, spellId });

  assert.equal(result.statusCode, 200);
  assert.equal(defenderCard.retaliationBonus, 3, 'retaliation bonus spells should add a temporary retaliation bonus to the target');
  assert.equal(match.activeSpellResolution.effectId, 'retaliation_bonus', 'completed spells should expose retaliation bonus effect metadata');
}

{
  const { server, match, playerId, spellId, defenderCard } = createSpellMatch({
    targetHealth: 10,
    rollOutcome: 3,
    spellType: 'Fire',
    targetType: 'Nature',
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'roll',
      valueSourceStat: 'efct',
    },
  });

  const rollResult = server.submitSpellRoll({ playerId, spellId, rollOutcome: 3, rollData: null });
  assert.equal(rollResult.statusCode, 200);
  assert.equal(match.activeSpellResolution.resolvedDamage, 5, 'type-advantaged spell preview damage should be multiplied and rounded up');

  const result = server.completeSpellResolution({ playerId, spellId });
  assert.equal(result.statusCode, 200);
  assert.equal(defenderCard.catalogCard.health, 5, 'type-advantaged spell damage should be multiplied and rounded up');
}

{
  const { server, match, playerId, spellId, defenderCard } = createSpellMatch({
    targetHealth: 4,
    rollOutcome: 3,
    spellType: 'Nature',
    targetType: 'Nature',
    targetSide: 'player',
    ability: {
      effectId: 'heal_target',
      valueSourceType: 'roll',
      valueSourceStat: 'efct',
    },
  });

  const rollResult = server.submitSpellRoll({ playerId, spellId, rollOutcome: 3, rollData: null });
  assert.equal(rollResult.statusCode, 200);
  assert.equal(match.activeSpellResolution.resolvedHealing, 5, 'same-type beneficial spell preview should be multiplied and rounded up');

  const result = server.completeSpellResolution({ playerId, spellId });
  assert.equal(result.statusCode, 200);
  assert.equal(defenderCard.catalogCard.health, 9, 'same-type beneficial spell resolution should be multiplied and rounded up');
}

console.log('phase manager spell effects checks passed');
