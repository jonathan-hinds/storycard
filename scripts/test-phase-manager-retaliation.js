const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

const server = new PhaseManagerServer();

function createCreature({ id, slotIndex, health, attackCommitted = true, targetSlotIndex = 0, targetSide = 'opponent', damageValue = 0 }) {
  return {
    id,
    slotIndex,
    attackCommitted,
    targetSlotIndex,
    targetSide,
    selectedAbilityIndex: 0,
    catalogCard: {
      health,
      ability1: {
        effectId: 'damage_enemy',
        valueSourceType: 'fixed',
        valueSourceFixed: damageValue,
      },
      ability2: null,
    },
  };
}

{
  const match = {
    id: 'match-retaliation-1',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attacker = createCreature({ id: 'a', slotIndex: 0, health: 5, damageValue: 3 });
  const defender = createCreature({ id: 'b', slotIndex: 0, health: 5, damageValue: 2 });

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

  match.commitRollsByAttackId.set('p1:0:opponent:0:defense', {
    attackId: 'p1:0:opponent:0',
    attackerId: 'p1',
    rollType: 'defense',
    roll: { outcome: 3 },
  });

  server.applyCommitEffects(match);

  assert.equal(defender.catalogCard.health, 2, 'attacker should deal direct damage to defender health');
  assert.equal(attacker.catalogCard.health, 5, 'retaliation should be fully blocked when defense >= retaliation damage');

  const execution = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  assert.ok(execution, 'execution state should exist for attacker');
  assert.equal(execution.retaliationDamage, 2, 'retaliation damage should mirror defender attack value');
  assert.equal(execution.retaliationAppliedDamage, 0, 'retaliation applied damage should be zero when fully blocked');
  assert.equal(execution.defenseRemaining, 1, 'defense should be reduced by blocked retaliation');
}

{
  const match = {
    id: 'match-retaliation-2',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attacker = {
    id: 'healer',
    slotIndex: 1,
    attackCommitted: true,
    targetSlotIndex: 0,
    targetSide: 'player',
    selectedAbilityIndex: 0,
    catalogCard: {
      health: 5,
      ability1: {
        effectId: 'heal_target',
        valueSourceType: 'fixed',
        valueSourceFixed: 2,
      },
      ability2: null,
    },
  };
  const ally = createCreature({ id: 'ally', slotIndex: 0, health: 3, attackCommitted: false, targetSide: null, targetSlotIndex: null, damageValue: 0 });
  const enemy = createCreature({ id: 'enemy', slotIndex: 0, health: 5, damageValue: 4 });

  match.cardsByPlayer.set('p1', { board: [attacker, ally] });
  match.cardsByPlayer.set('p2', { board: [enemy] });
  match.pendingCommitAttacksByPlayer.set('p1', [{
    id: 'p1:1:player:0',
    attackerSlotIndex: 1,
    targetSlotIndex: 0,
    targetSide: 'player',
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

  assert.equal(ally.catalogCard.health, 5, 'healing attacks should still resolve');
  const execution = match.commitExecutionByAttackId.get('p1:1:player:0');
  assert.equal(execution.retaliationDamage, 0, 'healing should not trigger retaliation');
  assert.equal(attacker.catalogCard.health, 5, 'healing caster should not take retaliation damage');
}


{
  const match = {
    id: 'match-retaliation-3',
    players: ['p1', 'p2'],
    turnNumber: 1,
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attacker = createCreature({ id: 'a', slotIndex: 0, health: 5, damageValue: 3 });
  const defender = createCreature({ id: 'b', slotIndex: 0, health: 5, damageValue: 2 });

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

  const spellResult = server.applyResolvedAbilityEffect({
    match,
    casterId: 'p2',
    targetSide: 'player',
    targetSlotIndex: 0,
    effectId: 'retaliation_bonus',
    resolvedValue: 3,
  });

  assert.equal(spellResult.executed, true, 'retaliation bonus spell should execute');
  assert.equal(defender.retaliationBonus, 3, 'retaliation bonus should be stored on defender card');

  server.applyCommitEffects(match);

  assert.equal(attacker.catalogCard.health, 2, 'attacker should take retaliation damage from defender bonus even when defender did not attack');
  const execution = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  assert.equal(execution.retaliationDamage, 3, 'retaliation damage should include temporary retaliation bonuses');
}


console.log('phase manager retaliation checks passed');
