const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function buildCreature({ id, slotIndex, health = 10, tauntTurnsRemaining = 0, summonedTurn = 1, ability }) {
  return {
    id,
    slotIndex,
    summonedTurn,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
    tauntTurnsRemaining,
    silenceTurnsRemaining: 0,
    catalogCard: {
      health,
      type: 'Unknown',
      ability1: ability,
      ability2: null,
    },
  };
}

function createTauntOrderMatch({ speedAttacker, speedTaunter }) {
  const server = new PhaseManagerServer();
  const match = {
    id: 'match-taunt-order',
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
    pendingCommitBuffs: [],
    activeSpellResolution: null,
  };

  const attacker = buildCreature({
    id: 'p1-attacker',
    slotIndex: 0,
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 4,
      buffId: 'none',
    },
  });

  const taunter = buildCreature({
    id: 'p2-taunter',
    slotIndex: 0,
    ability: {
      effectId: 'none',
      valueSourceType: 'none',
      buffId: 'taunt',
      buffTarget: 'self',
      durationTurns: 2,
    },
  });

  const originalTarget = buildCreature({
    id: 'p2-original-target',
    slotIndex: 1,
    ability: {
      effectId: 'none',
      valueSourceType: 'none',
      buffId: 'none',
    },
  });

  match.cardsByPlayer.set('p1', { board: [attacker], hand: [], deck: [], discard: [] });
  match.cardsByPlayer.set('p2', { board: [taunter, originalTarget], hand: [], deck: [], discard: [] });

  match.pendingCommitAttacksByPlayer.set('p1', [{
    id: 'p1:0:opponent:1',
    attackerSlotIndex: 0,
    targetSlotIndex: 1,
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
    ['p1:0:opponent:1:speed', { roll: { outcome: speedAttacker }, submittedAt: 1 }],
    ['p2:0:opponent:0:speed', { roll: { outcome: speedTaunter }, submittedAt: 2 }],
  ]);

  return { server, match, taunter, originalTarget };
}

// Faster taunt attacker should redirect slower enemy attack in the same commit phase.
{
  const { server, match, taunter, originalTarget } = createTauntOrderMatch({ speedAttacker: 1, speedTaunter: 2 });

  server.applyCommitEffects(match);

  assert.equal(taunter.tauntTurnsRemaining, 2, 'taunt duration should apply immediately for same-phase targeting rules');
  assert.equal(taunter.catalogCard.health, 6, 'redirected attack should damage the taunt card');
  assert.equal(originalTarget.catalogCard.health, 10, 'original non-taunt target should be spared after redirect');
}

// Slower taunt attacker should not retroactively redirect a faster attack that already executed.
{
  const { server, match, taunter, originalTarget } = createTauntOrderMatch({ speedAttacker: 2, speedTaunter: 1 });

  server.applyCommitEffects(match);

  assert.equal(originalTarget.catalogCard.health, 6, 'faster attack should keep its original target before taunt resolves');
  assert.equal(taunter.catalogCard.health, 10, 'taunt card should not take damage when taunt resolves too late');
  assert.equal(taunter.tauntTurnsRemaining, 2, 'taunt duration should still be applied when taunt resolves second');
}

console.log('phase manager taunt order checks passed');
