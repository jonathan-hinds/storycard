const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

const server = new PhaseManagerServer();

function createCreature({ id, slotIndex, health, attackCommitted = true, targetSlotIndex = 0, targetSide = 'opponent', damageValue = 0, type = null }) {
  return {
    id,
    slotIndex,
    attackCommitted,
    targetSlotIndex,
    targetSide,
    selectedAbilityIndex: 0,
    catalogCard: {
      health,
      type,
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
  match.commitRollsByAttackId.set('p2:0:none:none:damage', {
    attackId: 'p2:0:none:none',
    attackerId: 'p2',
    rollType: 'damage',
    roll: { outcome: 2 },
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

  assert.equal(attacker.catalogCard.health, 5, 'attacker should not take retaliation damage when defender has no committed damage roll');
  const execution = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  assert.equal(execution.retaliationDamage, 0, 'retaliation damage should be zero when defender did not commit a phase 2 damage roll');
}

{
  const match = {
    id: 'match-retaliation-exact-lethal',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attacker = createCreature({ id: 'a', slotIndex: 0, health: 3, damageValue: 3 });
  const defender = createCreature({ id: 'b', slotIndex: 0, health: 5, damageValue: 3, attackCommitted: true, targetSlotIndex: 0, targetSide: 'opponent' });

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
    id: 'p2:0:opponent:0',
    attackerSlotIndex: 0,
    targetSlotIndex: 0,
    targetSide: 'opponent',
    selectedAbilityIndex: 0,
  }]);
  match.commitRollsByAttackId.set('p2:0:opponent:0:damage', {
    attackId: 'p2:0:opponent:0',
    attackerId: 'p2',
    rollType: 'damage',
    roll: { outcome: 3 },
  });

  server.applyCommitEffects(match);

  const attackerState = match.cardsByPlayer.get('p1');
  assert.equal(attackerState.board.length, 0, 'retaliation should remove attackers that reach exactly zero health');
}



{
  const match = {
    id: 'match-retaliation-type-advantage',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attacker = createCreature({ id: 'fire-attacker', slotIndex: 0, health: 6, damageValue: 3, type: 'Fire' });
  const defender = createCreature({ id: 'nature-defender', slotIndex: 0, health: 8, damageValue: 0, type: 'Nature', attackCommitted: false, targetSlotIndex: null, targetSide: null });

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

  assert.equal(defender.catalogCard.health, 3, 'type-vulnerable creature target should take 1.5x damage rounded up');
  const execution = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  assert.equal(execution.appliedValue, 5, 'execution metadata should expose type-adjusted value');
}


{
  const match = {
    id: 'match-retaliation-serialization-values',
    players: ['p1', 'p2'],
    turnNumber: 1,
    upkeep: 1,
    phase: 2,
    readyPlayers: new Set(),
    lastDrawnCardsByPlayer: new Map(),
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
    executedCommitAttackIds: [],
  };

  const attackerA = createCreature({ id: 'attacker-a', slotIndex: 0, health: 20, damageValue: 0, targetSlotIndex: 0, targetSide: 'opponent' });
  const attackerB = createCreature({ id: 'attacker-b', slotIndex: 0, health: 20, damageValue: 0, targetSlotIndex: 0, targetSide: 'opponent' });
  const defenderA = createCreature({ id: 'defender-a', slotIndex: 0, health: 20, damageValue: 0, targetSlotIndex: 0, targetSide: 'opponent' });
  const defenderB = createCreature({ id: 'defender-b', slotIndex: 0, health: 20, damageValue: 0, targetSlotIndex: 0, targetSide: 'opponent' });

  attackerA.catalogCard.ability1 = { effectId: 'damage_enemy', valueSourceType: 'roll', valueSourceStat: 'damage' };
  attackerB.catalogCard.ability1 = { effectId: 'damage_enemy', valueSourceType: 'roll', valueSourceStat: 'damage' };
  defenderA.catalogCard.ability1 = { effectId: 'damage_enemy', valueSourceType: 'roll', valueSourceStat: 'damage' };
  defenderB.catalogCard.ability1 = { effectId: 'damage_enemy', valueSourceType: 'roll', valueSourceStat: 'damage' };

  match.cardsByPlayer.set('p1', { hand: [], board: [attackerA], deck: [], discard: [] });
  match.cardsByPlayer.set('p2', { hand: [], board: [attackerB], deck: [], discard: [] });

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

  match.commitRollsByAttackId.set('p1:0:opponent:0:damage', {
    attackId: 'p1:0:opponent:0',
    attackerId: 'p1',
    rollType: 'damage',
    roll: { outcome: 8 },
    submittedAt: 100,
  });
  match.commitRollsByAttackId.set('p2:0:opponent:0:damage', {
    attackId: 'p2:0:opponent:0',
    attackerId: 'p2',
    rollType: 'damage',
    roll: { outcome: 3 },
    submittedAt: 100,
  });
  match.commitRollsByAttackId.set('p1:0:opponent:0:speed', {
    attackId: 'p1:0:opponent:0',
    attackerId: 'p1',
    rollType: 'speed',
    roll: { outcome: 1 },
    submittedAt: 100,
  });
  match.commitRollsByAttackId.set('p2:0:opponent:0:speed', {
    attackId: 'p2:0:opponent:0',
    attackerId: 'p2',
    rollType: 'speed',
    roll: { outcome: 1 },
    submittedAt: 100,
  });
  match.commitRollsByAttackId.set('p1:0:opponent:0:defense', {
    attackId: 'p1:0:opponent:0',
    attackerId: 'p1',
    rollType: 'defense',
    roll: { outcome: 0 },
    submittedAt: 100,
  });
  match.commitRollsByAttackId.set('p2:0:opponent:0:defense', {
    attackId: 'p2:0:opponent:0',
    attackerId: 'p2',
    rollType: 'defense',
    roll: { outcome: 0 },
    submittedAt: 100,
  });

  server.applyCommitEffects(match);

  const p1View = server.serializeMatchForPlayer(match, 'p1');
  const p2View = server.serializeMatchForPlayer(match, 'p2');

  const p1Attack = p1View.meta.commitAttacks.find((attack) => attack.id === 'p1:0:opponent:0');
  const p2Attack = p2View.meta.commitAttacks.find((attack) => attack.id === 'p2:0:opponent:0');

  assert.equal(p1Attack?.resolvedDamage, 8, 'serialized attacker damage should match executed damage for local attacker');
  assert.equal(p1Attack?.retaliationDamage, 3, 'serialized retaliation should reflect opponent executed damage for local attacker');
  assert.equal(p2Attack?.resolvedDamage, 3, 'serialized attacker damage should match executed damage for remote attacker');
  assert.equal(p2Attack?.retaliationDamage, 8, 'serialized retaliation should reflect opponent executed damage for remote attacker');
}

{
  const match = {
    id: 'match-retaliation-multi-attackers',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attackerA = createCreature({ id: 'a1', slotIndex: 0, health: 10, damageValue: 1, targetSlotIndex: 0, targetSide: 'opponent' });
  const attackerB = createCreature({ id: 'a2', slotIndex: 1, health: 10, damageValue: 1, targetSlotIndex: 0, targetSide: 'opponent' });
  const defender = createCreature({ id: 'd1', slotIndex: 0, health: 20, damageValue: 4, targetSlotIndex: 0, targetSide: 'opponent' });

  match.cardsByPlayer.set('p1', { board: [attackerA, attackerB] });
  match.cardsByPlayer.set('p2', { board: [defender] });
  match.pendingCommitAttacksByPlayer.set('p1', [
    { id: 'p1:0:opponent:0', attackerSlotIndex: 0, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 },
    { id: 'p1:1:opponent:0', attackerSlotIndex: 1, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 },
  ]);
  match.pendingCommitAttacksByPlayer.set('p2', [
    { id: 'p2:0:opponent:0', attackerSlotIndex: 0, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 },
  ]);

  match.commitRollsByAttackId.set('p2:0:opponent:0:damage', { attackId: 'p2:0:opponent:0', attackerId: 'p2', rollType: 'damage', roll: { outcome: 4 } });

  server.applyCommitEffects(match);

  const execA = match.commitExecutionByAttackId.get('p1:0:opponent:0');
  const execB = match.commitExecutionByAttackId.get('p1:1:opponent:0');
  assert.equal(execA?.retaliationDamage, 4, 'first attacker should receive retaliation from shared defending target');
  assert.equal(execB?.retaliationDamage, 4, 'second attacker should also receive retaliation from same defending target');
}

{
  const match = {
    id: 'match-retaliation-after-attacking',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attacker = createCreature({ id: 'late-attacker', slotIndex: 0, health: 12, damageValue: 2, targetSlotIndex: 1, targetSide: 'opponent' });
  const defender = createCreature({ id: 'already-attacked', slotIndex: 0, health: 12, damageValue: 3, targetSlotIndex: 1, targetSide: 'opponent' });
  const defenderTarget = createCreature({ id: 'dummy', slotIndex: 1, health: 30, damageValue: 0, targetSlotIndex: null, targetSide: null, attackCommitted: false });
  const attackerTarget = createCreature({ id: 'dummy2', slotIndex: 1, health: 30, damageValue: 0, targetSlotIndex: null, targetSide: null, attackCommitted: false });

  match.cardsByPlayer.set('p1', { board: [attacker, attackerTarget] });
  match.cardsByPlayer.set('p2', { board: [defender, defenderTarget] });
  match.pendingCommitAttacksByPlayer.set('p1', [
    { id: 'p1:0:opponent:0', attackerSlotIndex: 0, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 },
  ]);
  match.pendingCommitAttacksByPlayer.set('p2', [
    { id: 'p2:0:opponent:1', attackerSlotIndex: 0, targetSlotIndex: 1, targetSide: 'opponent', selectedAbilityIndex: 0 },
  ]);

  match.commitRollsByAttackId.set('p2:0:opponent:1:damage', { attackId: 'p2:0:opponent:1', attackerId: 'p2', rollType: 'damage', roll: { outcome: 3 } });
  match.commitRollsByAttackId.set('p2:0:opponent:1:speed', { attackId: 'p2:0:opponent:1', attackerId: 'p2', rollType: 'speed', roll: { outcome: 6 }, submittedAt: 100 });
  match.commitRollsByAttackId.set('p1:0:opponent:0:speed', { attackId: 'p1:0:opponent:0', attackerId: 'p1', rollType: 'speed', roll: { outcome: 1 }, submittedAt: 200 });

  server.applyCommitEffects(match);

  assert.equal(attacker.catalogCard.health, 9, 'a creature that already attacked should still retaliate when attacked later in phase 2');
}

console.log('phase manager retaliation checks passed');


{
  const match = {
    id: 'match-retaliation-speed-order',
    players: ['p1', 'p2'],
    turnNumber: 1,
    upkeep: 1,
    phase: 2,
    readyPlayers: new Set(),
    lastDrawnCardsByPlayer: new Map(),
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const fastAttacker = createCreature({ id: 'fast', slotIndex: 0, health: 5, damageValue: 2, targetSlotIndex: 0, targetSide: 'opponent' });
  const tieLateAttacker = createCreature({ id: 'late', slotIndex: 1, health: 5, damageValue: 2, targetSlotIndex: 0, targetSide: 'opponent' });
  const tieEarlyAttacker = createCreature({ id: 'early', slotIndex: 0, health: 5, damageValue: 2, targetSlotIndex: 1, targetSide: 'opponent' });
  const slowAttacker = createCreature({ id: 'slow', slotIndex: 1, health: 5, damageValue: 2, targetSlotIndex: 1, targetSide: 'opponent' });

  match.cardsByPlayer.set('p1', { hand: [], board: [fastAttacker, tieLateAttacker], deck: [] });
  match.cardsByPlayer.set('p2', { hand: [], board: [tieEarlyAttacker, slowAttacker], deck: [] });
  match.pendingCommitAttacksByPlayer.set('p1', [
    {
      id: 'p1:0:opponent:0',
      attackerSlotIndex: 0,
      targetSlotIndex: 0,
      targetSide: 'opponent',
      selectedAbilityIndex: 0,
    },
    {
      id: 'p1:1:opponent:0',
      attackerSlotIndex: 1,
      targetSlotIndex: 0,
      targetSide: 'opponent',
      selectedAbilityIndex: 0,
    },
  ]);
  match.pendingCommitAttacksByPlayer.set('p2', [
    {
      id: 'p2:0:opponent:1',
      attackerSlotIndex: 0,
      targetSlotIndex: 1,
      targetSide: 'opponent',
      selectedAbilityIndex: 0,
    },
    {
      id: 'p2:1:opponent:1',
      attackerSlotIndex: 1,
      targetSlotIndex: 1,
      targetSide: 'opponent',
      selectedAbilityIndex: 0,
    },
  ]);

  match.commitRollsByAttackId.set('p1:0:opponent:0:speed', {
    attackId: 'p1:0:opponent:0',
    attackerId: 'p1',
    rollType: 'speed',
    roll: { outcome: 6 },
    submittedAt: 100,
  });
  match.commitRollsByAttackId.set('p1:1:opponent:0:speed', {
    attackId: 'p1:1:opponent:0',
    attackerId: 'p1',
    rollType: 'speed',
    roll: { outcome: 4 },
    submittedAt: 300,
  });
  match.commitRollsByAttackId.set('p2:0:opponent:1:speed', {
    attackId: 'p2:0:opponent:1',
    attackerId: 'p2',
    rollType: 'speed',
    roll: { outcome: 4 },
    submittedAt: 200,
  });
  match.commitRollsByAttackId.set('p2:1:opponent:1:speed', {
    attackId: 'p2:1:opponent:1',
    attackerId: 'p2',
    rollType: 'speed',
    roll: { outcome: 1 },
    submittedAt: 400,
  });

  const ordered = server.getOrderedCommitAttacks(match).map(({ attack }) => attack.id);
  assert.deepEqual(
    ordered,
    ['p1:0:opponent:0', 'p2:0:opponent:1', 'p1:1:opponent:0', 'p2:1:opponent:1'],
    'commit order should sort by highest speed and use earliest speed resolution as tie breaker',
  );

  const serialized = server.serializeMatchForPlayer(match, 'p1');
  assert.deepEqual(
    serialized.meta.commitAttacks.map((attack) => attack.id),
    ordered,
    'serialized commit attacks should preserve speed-based ordering for animation playback',
  );
}
