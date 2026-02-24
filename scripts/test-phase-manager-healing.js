const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function createBoardCard({ id, slotIndex, health, ability1 }) {
  return {
    id,
    slotIndex,
    attackCommitted: true,
    targetSlotIndex: 0,
    targetSide: 'player',
    selectedAbilityIndex: 0,
    catalogCard: {
      health,
      ability1,
      ability2: null,
    },
  };
}

function createMatchWithAttackerAbility(ability, targetCardHealth) {
  const attackerId = 'p1';
  const opponentId = 'p2';
  const match = {
    id: 'match-heal-test',
    players: [attackerId, opponentId],
    cardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
  };

  const attackerBoardCard = createBoardCard({
    id: 'attacker-card',
    slotIndex: 1,
    health: 10,
    ability1: ability,
  });

  const targetCard = {
    id: 'target-card',
    slotIndex: 0,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
    catalogCard: {
      health: targetCardHealth,
      ability1: null,
      ability2: null,
    },
  };

  match.cardsByPlayer.set(attackerId, { board: [attackerBoardCard] });
  match.cardsByPlayer.set(opponentId, { board: [] });
  match.pendingCommitAttacksByPlayer.set(attackerId, [{
    id: `${attackerId}:1:player:0`,
    attackerSlotIndex: 1,
    targetSlotIndex: 0,
    targetSide: 'player',
    selectedAbilityIndex: 0,
  }]);
  match.pendingCommitAttacksByPlayer.set(opponentId, []);

  return { match, attackerId, targetCard };
}

const server = new PhaseManagerServer();

{
  const healAbility = {
    effectId: 'heal_target',
    valueSourceType: 'fixed',
    valueSourceFixed: 4,
  };
  const { match, attackerId, targetCard } = createMatchWithAttackerAbility(healAbility, 3);
  match.cardsByPlayer.get(attackerId).board.push(targetCard);

  server.applyCommitEffects(match);

  assert.equal(targetCard.catalogCard.health, 7, 'fixed healing should increase target health');
  assert.deepEqual(match.commitExecutionByAttackId.get('p1:1:player:0'), { executed: true });
}

{
  const healRollAbility = {
    effectId: 'heal_target',
    valueSourceType: 'roll',
    valueSourceStat: 'damage',
  };
  const { match, attackerId, targetCard } = createMatchWithAttackerAbility(healRollAbility, 6);
  match.cardsByPlayer.get(attackerId).board.push(targetCard);
  match.commitRollsByAttackId.set('p1:1:player:0:damage', {
    attackId: 'p1:1:player:0',
    attackerId,
    rollType: 'damage',
    roll: { outcome: 5 },
  });

  server.applyCommitEffects(match);

  assert.equal(targetCard.catalogCard.health, 11, 'roll healing should use submitted roll outcome');
}

console.log('phase manager healing checks passed');
