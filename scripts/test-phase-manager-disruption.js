const assert = require('node:assert/strict');
const { PhaseManagerServer } = require('../shared/phase-manager/net/PhaseManagerServer');

const server = new PhaseManagerServer();

function buildCard({ id, slotIndex, health = 10, ability1 }) {
  return {
    id,
    slotIndex,
    catalogCard: { health, ability1 },
    summonedTurn: 1,
    attackCommitted: true,
    targetSide: 'opponent',
    targetSlotIndex: 0,
    selectedAbilityIndex: 0,
    tauntTurnsRemaining: 0,
    silenceTurnsRemaining: 0,
    poisonTurnsRemaining: 0,
    poisonStacks: 0,
    fireTurnsRemaining: 0,
    fireStacks: 0,
    frostbiteTurnsRemaining: 0,
    frostbiteStacks: 0,
  };
}

function makeMatch({ p1Board, p2Board, p1Attacks, p2Attacks, rolls }) {
  return {
    id: 'm1',
    players: ['p1', 'p2'],
    cardsByPlayer: new Map([
      ['p1', { board: p1Board, hand: [], deck: [], discard: [] }],
      ['p2', { board: p2Board, hand: [], deck: [], discard: [] }],
    ]),
    pendingCommitAttacksByPlayer: new Map([
      ['p1', p1Attacks],
      ['p2', p2Attacks],
    ]),
    commitRollsByAttackId: new Map(rolls),
    commitExecutionByAttackId: new Map(),
    readyPlayers: new Set(),
    turnNumber: 1,
    upkeep: 1,
    phase: 2,
    lastDrawnCardsByPlayer: new Map([['p1', []], ['p2', []]]),
    activeSpellResolution: null,
    commitAllRolledAt: Date.now(),
  };
}

// Scenario 1: disruption against attacker modifies their rolled source stat.
{
  const disruptAbility = { effectId: 'disruption', valueSourceType: 'roll', valueSourceStat: 'damage', enemyValueSourceStat: 'damage', buffId: 'none', buffTarget: 'none' };
  const strikeAbility = { effectId: 'damage_enemy', valueSourceType: 'roll', valueSourceStat: 'damage', buffId: 'none', buffTarget: 'none' };
  const aAttackId = 'p1:0:opponent:0';
  const bAttackId = 'p2:0:opponent:0';
  const match = makeMatch({
    p1Board: [buildCard({ id: 'a', slotIndex: 0, ability1: disruptAbility })],
    p2Board: [buildCard({ id: 'b', slotIndex: 0, ability1: strikeAbility })],
    p1Attacks: [{ id: aAttackId, attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }],
    p2Attacks: [{ id: bAttackId, attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }],
    rolls: [
      [`${aAttackId}:damage`, { roll: { outcome: 2 }, submittedAt: 1 }],
      [`${aAttackId}:speed`, { roll: { outcome: 3 }, submittedAt: 1 }],
      [`${aAttackId}:defense`, { roll: { outcome: 6 }, submittedAt: 1 }],
      [`${bAttackId}:damage`, { roll: { outcome: 4 }, submittedAt: 2 }],
      [`${bAttackId}:speed`, { roll: { outcome: 1 }, submittedAt: 2 }],
      [`${bAttackId}:defense`, { roll: { outcome: 2 }, submittedAt: 2 }],
    ],
  });

  server.applyCommitEffects(match);
  const state = server.serializeMatchForPlayer(match, 'p1');
  const bAttack = state.meta.commitAttacks.find((attack) => attack.id === bAttackId);
  assert.equal(bAttack.resolvedDamage, 2, 'disruption should reduce enemy damage roll by source roll');
}

// Scenario 2: disruption against non-attacker behaves like normal damage.
{
  const disruptAbility = { effectId: 'disruption', valueSourceType: 'roll', valueSourceStat: 'damage', enemyValueSourceStat: 'damage', buffId: 'none', buffTarget: 'none' };
  const aAttackId = 'p1:0:opponent:0';
  const target = buildCard({ id: 'b', slotIndex: 0, health: 10, ability1: { effectId: 'none', valueSourceType: 'none', buffId: 'none', buffTarget: 'none' } });
  const match = makeMatch({
    p1Board: [buildCard({ id: 'a', slotIndex: 0, ability1: disruptAbility })],
    p2Board: [target],
    p1Attacks: [{ id: aAttackId, attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }],
    p2Attacks: [],
    rolls: [
      [`${aAttackId}:damage`, { roll: { outcome: 3 }, submittedAt: 1 }],
      [`${aAttackId}:speed`, { roll: { outcome: 3 }, submittedAt: 1 }],
      [`${aAttackId}:defense`, { roll: { outcome: 1 }, submittedAt: 1 }],
    ],
  });

  server.applyCommitEffects(match);
  assert.equal(match.cardsByPlayer.get('p2').board[0].catalogCard.health, 7, 'disruption should damage health if target has no queued attack');
}

// Scenario 3: speed disruption should reorder later attacks.
{
  const disruptSpeed = { effectId: 'disruption', valueSourceType: 'roll', valueSourceStat: 'damage', enemyValueSourceStat: 'speed', buffId: 'none', buffTarget: 'none' };
  const strike = { effectId: 'damage_enemy', valueSourceType: 'roll', valueSourceStat: 'damage', buffId: 'none', buffTarget: 'none' };
  const aAttackId = 'p1:0:opponent:0';
  const bAttackId = 'p1:1:opponent:0';
  const cAttackId = 'p2:0:opponent:0';
  const match = makeMatch({
    p1Board: [buildCard({ id: 'a', slotIndex: 0, ability1: disruptSpeed }), buildCard({ id: 'b', slotIndex: 1, ability1: strike })],
    p2Board: [buildCard({ id: 'c', slotIndex: 0, ability1: strike })],
    p1Attacks: [
      { id: aAttackId, attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 },
      { id: bAttackId, attackerSlotIndex: 1, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 },
    ],
    p2Attacks: [
      { id: cAttackId, attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 },
    ],
    rolls: [
      [`${aAttackId}:damage`, { roll: { outcome: 2 }, submittedAt: 1 }],
      [`${aAttackId}:speed`, { roll: { outcome: 10 }, submittedAt: 1 }],
      [`${aAttackId}:defense`, { roll: { outcome: 5 }, submittedAt: 1 }],
      [`${bAttackId}:damage`, { roll: { outcome: 4 }, submittedAt: 3 }],
      [`${bAttackId}:speed`, { roll: { outcome: 2 }, submittedAt: 3 }],
      [`${bAttackId}:defense`, { roll: { outcome: 1 }, submittedAt: 3 }],
      [`${cAttackId}:damage`, { roll: { outcome: 10 }, submittedAt: 2 }],
      [`${cAttackId}:speed`, { roll: { outcome: 3 }, submittedAt: 2 }],
      [`${cAttackId}:defense`, { roll: { outcome: 1 }, submittedAt: 2 }],
    ],
  });

  server.applyCommitEffects(match);
  const state = server.serializeMatchForPlayer(match, 'p1');
  assert.deepEqual(
    state.meta.commitAttacks.map((attack) => attack.id),
    [aAttackId, bAttackId, cAttackId],
    'disruption speed reductions should alter pending attack order',
  );
}

console.log('phase manager disruption checks passed');
