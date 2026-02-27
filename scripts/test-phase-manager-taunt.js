const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function createCreature({ id, slotIndex, ability1 = null, targetSlotIndex = 0 }) {
  return {
    id,
    slotIndex,
    attackCommitted: true,
    targetSlotIndex,
    targetSide: 'opponent',
    selectedAbilityIndex: 0,
    tauntTurnsRemaining: 0,
    catalogCard: {
      health: 10,
      ability1,
      ability2: null,
    },
  };
}

const server = new PhaseManagerServer();

{
  const p1 = 'p1';
  const p2 = 'p2';
  const taunter = createCreature({
    id: 'taunter',
    slotIndex: 1,
    ability1: { effectId: 'taunt', valueSourceType: 'none', durationTurns: 2 },
    targetSlotIndex: null,
  });
  const ally = createCreature({
    id: 'ally',
    slotIndex: 2,
    ability1: { effectId: 'damage_enemy', valueSourceType: 'fixed', valueSourceFixed: 2 },
    targetSlotIndex: 1,
  });
  const enemyAttacker = createCreature({
    id: 'enemy-attacker',
    slotIndex: 0,
    ability1: { effectId: 'damage_enemy', valueSourceType: 'fixed', valueSourceFixed: 2 },
    targetSlotIndex: 2,
  });

  const match = {
    players: [p1, p2],
    cardsByPlayer: new Map([
      [p1, { board: [taunter, ally] }],
      [p2, { board: [enemyAttacker] }],
    ]),
    pendingCommitAttacksByPlayer: new Map([
      [p1, [{ id: 'p1:1:none:none', attackerSlotIndex: 1, targetSlotIndex: null, targetSide: null, selectedAbilityIndex: 0 }]],
      [p2, [{ id: 'p2:0:opponent:2', attackerSlotIndex: 0, targetSlotIndex: 2, targetSide: 'opponent', selectedAbilityIndex: 0 }]],
    ]),
    commitRollsByAttackId: new Map([
      ['p1:1:none:none:speed', { roll: { outcome: 6 }, submittedAt: 1 }],
      ['p2:0:opponent:2:speed', { roll: { outcome: 1 }, submittedAt: 2 }],
    ]),
    commitExecutionByAttackId: new Map(),
  };

  server.applyCommitEffects(match);

  assert.equal(taunter.tauntTurnsRemaining, 2, 'taunt effect should apply configured duration to caster');
  assert.equal(taunter.catalogCard.health, 8, 'post-taunt enemy attack should be redirected into the taunting creature');
  assert.equal(ally.catalogCard.health, 10, 'non-taunting allies should not receive redirected damage while taunt is active');
}

{
  const match = {
    players: ['p1', 'p2'],
    cardsByPlayer: new Map([
      ['p2', {
        board: [{ id: 'taunt-enemy', slotIndex: 0, tauntTurnsRemaining: 2, catalogCard: { health: 9, ability1: null, ability2: null } }],
      }],
    ]),
  };
  const playerState = {
    hand: [],
    board: [{
      id: 'attacker',
      slotIndex: 1,
      summonedTurn: 0,
      attackCommitted: false,
      targetSlotIndex: null,
      targetSide: null,
      selectedAbilityIndex: 0,
      tauntTurnsRemaining: 0,
      catalogCard: { health: 10, ability1: { effectId: 'damage_enemy' }, ability2: null },
    }],
    discard: [],
  };

  const invalid = server.validatePhaseTurnPayload({
    playerId: 'p1',
    hand: [],
    board: [{ id: 'attacker', slotIndex: 1 }],
    discard: [],
    attacks: [{ attackerSlotIndex: 1, targetSlotIndex: 1, targetSide: 'opponent', selectedAbilityIndex: 0 }],
  }, match, 'p1', playerState, 1);

  assert.equal(invalid.error, 'target must be a taunting enemy while taunt is active');
}

console.log('phase manager taunt checks passed');
