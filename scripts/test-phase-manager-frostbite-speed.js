const assert = require('node:assert/strict');
const { PhaseManagerServer } = require('../shared/phase-manager/net/PhaseManagerServer');

const server = new PhaseManagerServer();

function buildCard({ id, slotIndex, frostbiteTurnsRemaining = 0, frostbiteStacks = 0 }) {
  return {
    id,
    slotIndex,
    catalogCard: {
      health: 10,
      ability1: {
        effectId: 'damage_enemy',
        valueSourceType: 'fixed',
        valueSourceFixed: 1,
        buffId: 'none',
        buffTarget: 'none',
        durationTurns: null,
      },
    },
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
    frostbiteTurnsRemaining,
    frostbiteStacks,
  };
}

const aAttackId = 'p1:0:opponent:0';
const bAttackId = 'p2:0:opponent:0';
const cAttackId = 'p2:1:opponent:0';

const match = {
  id: 'match-frostbite-order',
  players: ['p1', 'p2'],
  cardsByPlayer: new Map([
    ['p1', { board: [buildCard({ id: 'a', slotIndex: 0, frostbiteTurnsRemaining: 2, frostbiteStacks: 1 })], hand: [], deck: [], discard: [] }],
    ['p2', { board: [buildCard({ id: 'b', slotIndex: 0 }), buildCard({ id: 'c', slotIndex: 1 })], hand: [], deck: [], discard: [] }],
  ]),
  pendingCommitAttacksByPlayer: new Map([
    ['p1', [{ id: aAttackId, attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
    ['p2', [
      { id: bAttackId, attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 },
      { id: cAttackId, attackerSlotIndex: 1, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 },
    ]],
  ]),
  commitRollsByAttackId: new Map([
    [`${aAttackId}:speed`, { roll: { outcome: 3 }, submittedAt: 1 }],
    [`${bAttackId}:speed`, { roll: { outcome: 2 }, submittedAt: 3 }],
    [`${cAttackId}:speed`, { roll: { outcome: 2 }, submittedAt: 4 }],
  ]),
};

const ordered = server.getOrderedCommitAttacks(match);
assert.deepEqual(
  ordered.map((entry) => entry.attack.id),
  [bAttackId, cAttackId, aAttackId],
  'frostbite-adjusted speed ties should resolve after all natural ties',
);

const frostbitten = ordered.find((entry) => entry.attack.id === aAttackId);
assert.equal(frostbitten.speedOutcome, 3, 'raw roll should remain visible for debugging');
assert.equal(frostbitten.adjustedSpeedOutcome, 2, 'frostbite should reduce commit order speed by its stacks');
assert.equal(frostbitten.frostbiteStacks, 1, 'frostbite stack metadata should be carried with ordered attacks');

console.log('phase manager frostbite speed ordering checks passed');
