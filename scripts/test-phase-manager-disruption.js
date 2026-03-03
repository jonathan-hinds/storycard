const assert = require('node:assert/strict');
const { PhaseManagerServer } = require('../shared/phase-manager/net/PhaseManagerServer');

const server = new PhaseManagerServer();

function buildCard({ id, slotIndex, health = 10, damage = 0, speed = 0, defense = 0, ability }) {
  return {
    id,
    slotIndex,
    catalogCard: {
      health,
      damage,
      speed,
      defense,
      type: 'Fire',
      ability1: ability,
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
    frostbiteTurnsRemaining: 0,
    frostbiteStacks: 0,
  };
}

const disruptionAbility = {
  effectId: 'disruption',
  valueSourceType: 'roll',
  valueSourceStat: 'damage',
  enemyValueSourceStat: 'speed',
  buffId: 'none',
  buffTarget: 'none',
  durationTurns: null,
};

const damageAbility = {
  effectId: 'damage_enemy',
  valueSourceType: 'roll',
  valueSourceStat: 'damage',
  buffId: 'none',
  buffTarget: 'none',
  durationTurns: null,
};

const match = {
  id: 'match-disruption-order',
  players: ['p1', 'p2'],
  cardsByPlayer: new Map([
    ['p1', {
      board: [
        buildCard({ id: 'a', slotIndex: 0, ability: disruptionAbility }),
        buildCard({ id: 'b', slotIndex: 1, ability: damageAbility }),
      ],
      hand: [], deck: [], discard: [],
    }],
    ['p2', {
      board: [buildCard({ id: 'c', slotIndex: 0, speed: 3, ability: damageAbility })],
      hand: [], deck: [], discard: [],
    }],
  ]),
  pendingCommitAttacksByPlayer: new Map([
    ['p1', [
      { id: 'p1:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 },
      { id: 'p1:1:opponent:0', attackerSlotIndex: 1, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 },
    ]],
    ['p2', [
      { id: 'p2:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 },
    ]],
  ]),
  commitRollsByAttackId: new Map([
    ['p1:0:opponent:0:damage', { roll: { outcome: 2 }, submittedAt: 1 }],
    ['p1:0:opponent:0:speed', { roll: { outcome: 10 }, submittedAt: 1 }],
    ['p1:1:opponent:0:damage', { roll: { outcome: 4 }, submittedAt: 2 }],
    ['p1:1:opponent:0:speed', { roll: { outcome: 2 }, submittedAt: 2 }],
    ['p2:0:opponent:0:damage', { roll: { outcome: 10 }, submittedAt: 3 }],
    ['p2:0:opponent:0:speed', { roll: { outcome: 3 }, submittedAt: 3 }],
  ]),
};

server.applyCommitEffects(match);

assert.equal(
  match.commitRollsByAttackId.get('p2:0:opponent:0:speed').roll.outcome,
  1,
  'disruption should reduce the targeted enemy speed roll by attacker source roll',
);
assert.deepEqual(
  match.executedCommitAttackIds,
  ['p1:0:opponent:0', 'p1:1:opponent:0', 'p2:0:opponent:0'],
  'speed disruption should reorder remaining attacks when initiative changes mid-resolution',
);
assert.equal(
  match.cardsByPlayer.get('p2').board[0].catalogCard.speed,
  1,
  'disruption should update the targeted enemy speed stat shown on the card',
);

const fallbackMatch = {
  id: 'match-disruption-fallback',
  players: ['p1', 'p2'],
  cardsByPlayer: new Map([
    ['p1', { board: [buildCard({ id: 'a', slotIndex: 0, ability: { ...disruptionAbility, enemyValueSourceStat: 'damage' } })], hand: [], deck: [], discard: [] }],
    ['p2', { board: [buildCard({ id: 'c', slotIndex: 0, ability: damageAbility })], hand: [], deck: [], discard: [] }],
  ]),
  pendingCommitAttacksByPlayer: new Map([
    ['p1', [{ id: 'p1:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
    ['p2', []],
  ]),
  commitRollsByAttackId: new Map([
    ['p1:0:opponent:0:damage', { roll: { outcome: 3 }, submittedAt: 1 }],
    ['p1:0:opponent:0:speed', { roll: { outcome: 1 }, submittedAt: 1 }],
  ]),
};

server.applyCommitEffects(fallbackMatch);
assert.equal(
  fallbackMatch.cardsByPlayer.get('p2').board[0].catalogCard.health,
  7,
  'disruption should deal normal damage when the target has no committed attack',
);

const afterAttackDisruptionMatch = {
  id: 'match-disruption-visual-update-after-attack',
  players: ['p1', 'p2'],
  cardsByPlayer: new Map([
    ['p1', {
      board: [buildCard({ id: 'a', slotIndex: 0, ability: { ...disruptionAbility, enemyValueSourceStat: 'defense' } })],
      hand: [], deck: [], discard: [],
    }],
    ['p2', {
      board: [buildCard({ id: 'c', slotIndex: 0, defense: 9, ability: damageAbility })],
      hand: [], deck: [], discard: [],
    }],
  ]),
  pendingCommitAttacksByPlayer: new Map([
    ['p1', [{ id: 'p1:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
    ['p2', [{ id: 'p2:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
  ]),
  commitRollsByAttackId: new Map([
    ['p1:0:opponent:0:damage', { roll: { outcome: 6 }, submittedAt: 2 }],
    ['p1:0:opponent:0:speed', { roll: { outcome: 2 }, submittedAt: 2 }],
    ['p2:0:opponent:0:defense', { roll: { outcome: 11 }, submittedAt: 1 }],
    ['p2:0:opponent:0:speed', { roll: { outcome: 9 }, submittedAt: 1 }],
  ]),
};

server.applyCommitEffects(afterAttackDisruptionMatch);
assert.equal(
  afterAttackDisruptionMatch.commitRollsByAttackId.get('p2:0:opponent:0:defense').roll.outcome,
  5,
  'disruption should update enemy defense rolls even when the defender acted first',
);
assert.equal(
  afterAttackDisruptionMatch.cardsByPlayer.get('p2').board[0].catalogCard.defense,
  5,
  'disruption should update enemy defense stat shown on the card even when turn order is unchanged',
);

const damageDisruptionMatch = {
  id: 'match-disruption-damage-visual-update',
  players: ['p1', 'p2'],
  cardsByPlayer: new Map([
    ['p1', {
      board: [buildCard({ id: 'a', slotIndex: 0, ability: { ...disruptionAbility, enemyValueSourceStat: 'damage' } })],
      hand: [], deck: [], discard: [],
    }],
    ['p2', {
      board: [buildCard({ id: 'c', slotIndex: 0, damage: 8, ability: damageAbility })],
      hand: [], deck: [], discard: [],
    }],
  ]),
  pendingCommitAttacksByPlayer: new Map([
    ['p1', [{ id: 'p1:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
    ['p2', [{ id: 'p2:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
  ]),
  commitRollsByAttackId: new Map([
    ['p1:0:opponent:0:damage', { roll: { outcome: 4 }, submittedAt: 1 }],
    ['p1:0:opponent:0:speed', { roll: { outcome: 10 }, submittedAt: 1 }],
    ['p2:0:opponent:0:damage', { roll: { outcome: 7 }, submittedAt: 2 }],
    ['p2:0:opponent:0:speed', { roll: { outcome: 5 }, submittedAt: 2 }],
  ]),
};

server.applyCommitEffects(damageDisruptionMatch);
assert.equal(
  damageDisruptionMatch.cardsByPlayer.get('p2').board[0].catalogCard.damage,
  3,
  'disruption should update enemy damage stat shown on the card',
);

console.log('phase manager disruption checks passed');
