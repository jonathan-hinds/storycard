const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function buildCreature({ id, slotIndex, health = 10, silenceTurnsRemaining = 0, summonedTurn = 1, ability }) {
  return {
    id,
    slotIndex,
    summonedTurn,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
    tauntTurnsRemaining: 0,
    silenceTurnsRemaining,
    catalogCard: {
      health,
      type: 'Unknown',
      ability1: ability,
      ability2: null,
    },
  };
}

function createDuelMatch({ speedA, speedB }) {
  const server = new PhaseManagerServer();
  const match = {
    id: 'match-silence-order',
    players: ['p1', 'p2'],
    turnNumber: 2,
    upkeep: 1,
    phase: 2,
    phaseStartedAt: Date.now(),
    phaseEndsAt: null,
    readyPlayers: new Set(['p1', 'p2']),
    cardsByPlayer: new Map(),
    lastDrawnCardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
    commitAnimationCompletedPlayers: new Set(),
    activeSpellResolution: null,
  };

  const creatureA = buildCreature({
    id: 'a',
    slotIndex: 0,
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 4,
      buffId: 'none',
    },
  });

  const creatureB = buildCreature({
    id: 'b',
    slotIndex: 0,
    ability: {
      effectId: 'none',
      valueSourceType: 'none',
      buffId: 'silence',
      buffTarget: 'enemy',
      durationTurns: 2,
    },
  });

  match.cardsByPlayer.set('p1', { board: [creatureA], hand: [], deck: [], discard: [] });
  match.cardsByPlayer.set('p2', { board: [creatureB], hand: [], deck: [], discard: [] });

  match.pendingCommitAttacksByPlayer.set('p1', [{
    id: 'p1:0:opponent:0',
    attackerSlotIndex: 0,
    targetSlotIndex: 0,
    targetSide: 'opponent',
    selectedAbilityIndex: 0,
  }]);
  match.pendingCommitAttacksByPlayer.set('p2', [{
    id: 'p2:0:opponent:0',
    attackerSlotIndex: 0,
    targetSlotIndex: 0,
    targetSide: 'opponent',
    selectedAbilityIndex: 0,
  }]);

  match.commitRollsByAttackId = new Map([
    ['p1:0:opponent:0:speed', { roll: { outcome: speedA }, submittedAt: 1 }],
    ['p2:0:opponent:0:speed', { roll: { outcome: speedB }, submittedAt: 2 }],
  ]);

  return { server, match, creatureA, creatureB };
}

// Faster silence attacker should cancel the slower committed attack immediately.
{
  const { server, match, creatureA, creatureB } = createDuelMatch({ speedA: 1, speedB: 2 });

  server.applyCommitEffects(match);

  const aExecution = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  const bExecution = match.commitExecutionByAttackId.get('p2:0:opponent:0');

  assert.equal(bExecution?.executed, true, 'silencing attack should execute when it resolves first');
  assert.equal(aExecution?.reason, 'silenced', 'slower attacker should be skipped once silence is applied');
  assert.equal(creatureA.silenceTurnsRemaining, 2, 'silence duration should be applied to the target');
  assert.equal(creatureB.catalogCard.health, 10, 'silenced attacker should forfeit damage and not harm defender');
}

// Faster non-silenced attacker should still execute before being silenced later in the same phase.
{
  const { server, match, creatureA, creatureB } = createDuelMatch({ speedA: 2, speedB: 1 });

  server.applyCommitEffects(match);

  const aExecution = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  const bExecution = match.commitExecutionByAttackId.get('p2:0:opponent:0');

  assert.equal(aExecution?.executed, true, 'faster attacker should execute before later silence resolves');
  assert.equal(bExecution?.executed, true, 'silence attack should still execute when it resolves second');
  assert.equal(creatureA.silenceTurnsRemaining, 2, 'target should still receive silence after the second attack');
  assert.equal(creatureB.catalogCard.health, 6, 'defender should take damage from earlier faster attack');
}

// Silenced creatures should be unable to submit attacks in decision phase.
{
  const server = new PhaseManagerServer();
  const playerState = {
    hand: [],
    board: [buildCreature({
      id: 'silenced',
      slotIndex: 0,
      silenceTurnsRemaining: 1,
      ability: {
        effectId: 'damage_enemy',
        valueSourceType: 'fixed',
        valueSourceFixed: 3,
      },
    })],
    deck: [],
    discard: [],
  };

  const match = {
    players: ['p1', 'p2'],
    cardsByPlayer: new Map([
      ['p1', playerState],
      ['p2', { hand: [], board: [], deck: [], discard: [] }],
    ]),
  };

  const result = server.validatePhaseTurnPayload({
    hand: [],
    board: [{ id: 'silenced', slotIndex: 0 }],
    discard: [],
    attacks: [{ attackerSlotIndex: 0, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 }],
  }, match, 'p1', playerState, 2);

  assert.equal(result?.error, 'card in slot 0 is silenced and cannot use abilities', 'silenced cards should be blocked from committing attacks');
}

console.log('phase manager silence checks passed');
