const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

const server = new PhaseManagerServer();

function createCreature({ id, slotIndex, health, effectId = 'damage_enemy', value = 0, targetSlotIndex = 0, targetSide = 'opponent' }) {
  return {
    id,
    slotIndex,
    attackCommitted: true,
    targetSlotIndex,
    targetSide,
    selectedAbilityIndex: 0,
    catalogCard: {
      health,
      ability1: {
        effectId,
        valueSourceType: 'fixed',
        valueSourceFixed: value,
      },
      ability2: null,
    },
  };
}

{
  const match = {
    id: 'match-life-steal-basic',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attacker = createCreature({ id: 'attacker', slotIndex: 0, health: 8, effectId: 'life_steal', value: 4 });
  const defender = createCreature({ id: 'defender', slotIndex: 0, health: 10, effectId: 'damage_enemy', value: 0, targetSide: null, targetSlotIndex: null });

  match.cardsByPlayer.set('p1', { board: [attacker] });
  match.cardsByPlayer.set('p2', { board: [defender] });
  match.pendingCommitAttacksByPlayer.set('p1', [{
    id: 'p1:0:opponent:0',
    attackerSlotIndex: 0,
    targetSlotIndex: 0,
    targetSide: 'opponent',
    selectedAbilityIndex: 0,
  }]);
  match.pendingCommitAttacksByPlayer.set('p2', []);

  server.applyCommitEffects(match);

  assert.equal(defender.catalogCard.health, 6, 'life steal should damage the enemy target');
  assert.equal(attacker.catalogCard.health, 12, 'life steal should heal the attacker by dealt damage');

  const execution = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  assert.equal(execution.lifeStealHealing, 4, 'execution state should report life steal healing amount');
  assert.equal(execution.lifeStealNetHealing, 4, 'net healing should equal heal amount when no retaliation is applied');
}

{
  const match = {
    id: 'match-life-steal-retaliation',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attacker = createCreature({ id: 'attacker', slotIndex: 0, health: 10, effectId: 'life_steal', value: 4 });
  const defender = createCreature({ id: 'defender', slotIndex: 0, health: 12, effectId: 'damage_enemy', value: 3, targetSlotIndex: 0, targetSide: 'opponent' });

  match.cardsByPlayer.set('p1', { board: [attacker] });
  match.cardsByPlayer.set('p2', { board: [defender] });
  match.pendingCommitAttacksByPlayer.set('p1', [{
    id: 'p1:0:opponent:0',
    attackerSlotIndex: 0,
    targetSlotIndex: 0,
    targetSide: 'opponent',
    selectedAbilityIndex: 0,
  }]);
  match.pendingCommitAttacksByPlayer.set('p2', [{
    id: 'p2:0:none:none',
    attackerSlotIndex: 0,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
  }]);

  server.applyCommitEffects(match);

  assert.equal(defender.catalogCard.health, 8, 'life steal attack should still damage the defender');
  assert.equal(attacker.catalogCard.health, 11, 'life steal should apply after retaliation damage (10 - 3 + 4)');

  const execution = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  assert.equal(execution.retaliationAppliedDamage, 3, 'retaliation should be tracked for life steal attacks');
  assert.equal(execution.lifeStealHealing, 4, 'gross life steal healing should be tracked');
  assert.equal(execution.lifeStealNetHealing, 1, 'net healing should subtract retaliation applied damage');
}

console.log('phase manager life steal checks passed');
