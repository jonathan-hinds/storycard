const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function makeCreature(id, slotIndex) {
  return {
    id,
    color: 0x111111,
    catalogCard: {
      id,
      cardKind: 'Creature',
      health: 5,
      ability1: {
        cost: '1',
        target: 'enemy',
        effectId: 'damage_enemy',
        valueSourceType: 'fixed',
        valueSourceFixed: 1,
      },
    },
    slotIndex,
    summonedTurn: 0,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
  };
}

function makeSpell(id) {
  return {
    id,
    color: 0x222222,
    catalogCard: {
      id,
      cardKind: 'Spell',
      health: 0,
      ability1: {
        cost: '1',
        target: 'enemy',
        effectId: 'damage_enemy',
        valueSourceType: 'fixed',
        valueSourceFixed: 1,
      },
    },
  };
}

async function main() {
  const server = new PhaseManagerServer();
  const p1 = 'player-1';
  const p2 = 'player-2';
  await server.findMatch(p1);
  const matched = await server.findMatch(p2);
  const match = server.phaseMatches.get(matched.matchId);
  const s1 = match.cardsByPlayer.get(p1);
  const s2 = match.cardsByPlayer.get(p2);

  match.turnNumber = 2;
  s1.upkeepTotal = 2;
  s1.upkeep = 2;
  s1.spentUpkeepOnSpellsThisTurn = 0;
  s1.board = [makeCreature('c1', 0)];
  s2.board = [makeCreature('e1', 0)];

  const syncResult = server.syncState({
    playerId: p1,
    hand: s1.hand,
    board: s1.board,
    discard: s1.discard,
    attacks: [{ attackerSlotIndex: 0, selectedAbilityIndex: 0, targetSide: 'opponent', targetSlotIndex: 0 }],
  });
  assert.equal(syncResult.statusCode, 200, 'creature commit should succeed when upkeep is available');
  assert.equal(s1.upkeep, 1, 'creature ability should immediately consume upkeep during phase 1');

  s1.hand = [makeSpell('spell-1')];
  const castResult = server.startSpellResolution({
    playerId: p1,
    cardId: 'spell-1',
    selectedAbilityIndex: 0,
    targetSide: 'opponent',
    targetSlotIndex: 0,
    rollType: 'damage',
    dieSides: 6,
  });
  assert.equal(castResult.statusCode, 200, 'spell cast should succeed when upkeep is available');
  assert.equal(s1.upkeep, 0, 'spell cast should immediately consume upkeep');

  const recastResult = server.startSpellResolution({
    playerId: p1,
    cardId: 'spell-1',
    selectedAbilityIndex: 0,
    targetSide: 'opponent',
    targetSlotIndex: 0,
    rollType: 'damage',
    dieSides: 6,
  });
  assert.equal(recastResult.statusCode, 409, 'cannot cast another spell while one is resolving');

  match.activeSpellResolution.completedAt = Date.now();
  const noUpkeepResult = server.startSpellResolution({
    playerId: p1,
    cardId: 'spell-1',
    selectedAbilityIndex: 0,
    targetSide: 'opponent',
    targetSlotIndex: 0,
    rollType: 'damage',
    dieSides: 6,
  });
  assert.equal(noUpkeepResult.statusCode, 400, 'spell cast should fail after upkeep is depleted');

  console.log('phase manager ability upkeep cost checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
