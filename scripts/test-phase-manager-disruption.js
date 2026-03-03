const assert = require('node:assert/strict');
const { PhaseManagerServer } = require('../shared/phase-manager/net/PhaseManagerServer');

const server = new PhaseManagerServer();

function buildCard({ id, slotIndex, health = 10, ability }) {
  return {
    id,
    slotIndex,
    catalogCard: {
      health,
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
    disruptionDebuffTurnsRemaining: 0,
    disruptionDebuffs: { damage: 0, speed: 0, defense: 0 },
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
  turnNumber: 1,
  upkeep: 1,
  phase: 2,
  readyPlayers: new Set(),
  commitCompletedPlayers: new Set(),
  commitAnimationCompletedPlayers: new Set(),
  lastDrawnCardsByPlayer: new Map(),
  lastDotDamageEvents: [],
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
      board: [buildCard({ id: 'c', slotIndex: 0, ability: damageAbility })],
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


const serializedForP1 = server.serializeMatchForPlayer(match, 'p1');
const disruptedEnemyStep = (serializedForP1.meta.commitAttacks || []).find((step) => step.id === 'p2:0:opponent:0');
assert.equal(
  disruptedEnemyStep?.adjustedRollOutcomes?.speed,
  1,
  'disruption should publish adjusted roll outcomes for affected attacks so UI can display them',
);

const fallbackMatch = {
  turnNumber: 1,
  upkeep: 1,
  phase: 2,
  readyPlayers: new Set(),
  commitCompletedPlayers: new Set(),
  commitAnimationCompletedPlayers: new Set(),
  lastDrawnCardsByPlayer: new Map(),
  lastDotDamageEvents: [],
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


const serializedFallback = server.serializeMatchForPlayer(fallbackMatch, 'p1');
const disruptedFallbackStep = (serializedFallback.meta.commitAttacks || []).find((step) => step.id === 'p1:0:opponent:0');
assert.equal(
  disruptedFallbackStep?.adjustedRollOutcomes?.damage,
  undefined,
  'fallback damage disruption should not report a roll adjustment when no enemy roll was modified',
);



const spellDisruptionMatch = {
  turnNumber: 1,
  upkeep: 1,
  phase: 2,
  readyPlayers: new Set(),
  commitCompletedPlayers: new Set(),
  commitAnimationCompletedPlayers: new Set(),
  lastDrawnCardsByPlayer: new Map(),
  lastDotDamageEvents: [],
  id: 'match-spell-disruption-debuff',
  players: ['p1', 'p2'],
  cardsByPlayer: new Map([
    ['p1', { board: [buildCard({ id: 'ally', slotIndex: 0, ability: damageAbility })], hand: [], deck: [], discard: [] }],
    ['p2', {
      board: [buildCard({ id: 'enemy', slotIndex: 0, ability: damageAbility })],
      hand: [], deck: [], discard: [],
    }],
  ]),
  pendingCommitAttacksByPlayer: new Map([
    ['p1', [{ id: 'p1:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
    ['p2', [{ id: 'p2:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
  ]),
  commitRollsByAttackId: new Map([
    ['p1:0:opponent:0:damage', { roll: { outcome: 2 }, submittedAt: 1 }],
    ['p1:0:opponent:0:speed', { roll: { outcome: 4 }, submittedAt: 1 }],
    ['p2:0:opponent:0:damage', { roll: { outcome: 5 }, submittedAt: 2 }],
    ['p2:0:opponent:0:speed', { roll: { outcome: 6 }, submittedAt: 2 }],
  ]),
};

const debuffResult = server.applySpellDisruptionDebuff({
  match: spellDisruptionMatch,
  casterId: 'p1',
  targetSide: 'opponent',
  targetSlotIndex: 0,
  enemyValueSourceStat: 'speed',
  resolvedValue: 3,
});
assert.equal(debuffResult.executed, true, 'spell disruption should create a pending debuff on the target card');
assert.equal(
  spellDisruptionMatch.cardsByPlayer.get('p2').board[0].disruptionDebuffTurnsRemaining,
  1,
  'spell disruption debuff should last exactly one upcoming commit phase',
);

server.applyPendingSpellDisruptionDebuffsToCommitRolls(spellDisruptionMatch);
assert.equal(
  spellDisruptionMatch.commitRollsByAttackId.get('p2:0:opponent:0:speed').roll.outcome,
  3,
  'spell disruption should reduce the enemy speed roll before attacks are ordered',
);

const spellOrder = server.getOrderedCommitAttacks(spellDisruptionMatch).map((entry) => entry.attack.id);
assert.deepEqual(
  spellOrder,
  ['p1:0:opponent:0', 'p2:0:opponent:0'],
  'spell disruption speed debuff should update attack ordering before animations resolve',
);



const immediateSpellRollMatch = {
  turnNumber: 1,
  upkeep: 1,
  phase: 2,
  readyPlayers: new Set(),
  commitCompletedPlayers: new Set(),
  commitAnimationCompletedPlayers: new Set(),
  lastDrawnCardsByPlayer: new Map(),
  lastDotDamageEvents: [],
  id: 'match-spell-disruption-immediate-roll',
  players: ['p1', 'p2'],
  cardsByPlayer: new Map([
    ['p1', { board: [buildCard({ id: 'ally', slotIndex: 0, ability: damageAbility })], hand: [], deck: [], discard: [] }],
    ['p2', {
      board: [buildCard({ id: 'enemy', slotIndex: 0, ability: damageAbility })],
      hand: [], deck: [], discard: [],
    }],
  ]),
  pendingCommitAttacksByPlayer: new Map([
    ['p1', [{ id: 'p1:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
    ['p2', [{ id: 'p2:0:opponent:0', attackerSlotIndex: 0, targetSide: 'opponent', targetSlotIndex: 0, selectedAbilityIndex: 0 }]],
  ]),
  commitRollsByAttackId: new Map([
    ['p2:0:opponent:0:damage', { roll: { outcome: 6 }, submittedAt: 1 }],
    ['p2:0:opponent:0:speed', { roll: { outcome: 6 }, submittedAt: 1 }],
    ['p2:0:opponent:0:defense', { roll: { outcome: 6 }, submittedAt: 1 }],
  ]),
};

server.applySpellDisruptionDebuff({
  match: immediateSpellRollMatch,
  casterId: 'p1',
  targetSide: 'opponent',
  targetSlotIndex: 0,
  enemyValueSourceStat: 'SPD',
  resolvedValue: 6,
});

server.applySpellDisruptionDebuffToCommitRoll({
  match: immediateSpellRollMatch,
  attackerId: 'p2',
  attackId: 'p2:0:opponent:0',
  rollType: 'speed',
});

assert.equal(
  immediateSpellRollMatch.commitRollsByAttackId.get('p2:0:opponent:0:speed').roll.outcome,
  0,
  'spell disruption should immediately adjust the targeted roll outcome as soon as that roll resolves',
);
assert.equal(
  immediateSpellRollMatch.commitRollsByAttackId.get('p2:0:opponent:0:damage').roll.outcome,
  6,
  'spell disruption should not alter non-target damage rolls',
);
assert.equal(
  immediateSpellRollMatch.commitRollsByAttackId.get('p2:0:opponent:0:defense').roll.outcome,
  6,
  'spell disruption should not alter non-target defense rolls',
);

const serializedSpell = server.serializeMatchForPlayer(spellDisruptionMatch, 'p1');
const spellDisruptedStep = (serializedSpell.meta.commitAttacks || []).find((step) => step.id === 'p2:0:opponent:0');
assert.equal(
  spellDisruptedStep?.adjustedRollOutcomes?.speed,
  3,
  'spell disruption should publish adjusted speed roll outcomes for impacted attacks',
);

console.log('phase manager disruption checks passed');
