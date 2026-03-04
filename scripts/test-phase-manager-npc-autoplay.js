const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function makeCreature(id) {
  return {
    id,
    cardKind: 'Creature',
    health: 5,
    ability1: {
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 2,
    },
  };
}

function makeEnemySpell(id) {
  return {
    id,
    cardKind: 'Spell',
    health: 0,
    ability1: {
      target: 'enemy',
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 1,
    },
  };
}

function makeFriendlyHealSpell(id) {
  return {
    id,
    cardKind: 'Spell',
    health: 0,
    ability1: {
      target: 'friendly',
      effectId: 'heal_target',
      valueSourceType: 'fixed',
      valueSourceFixed: 2,
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const server = new PhaseManagerServer({
    boardSlotsPerSide: 3,
    deckSizePerPlayer: 6,
    startingHandSize: 3,
    npcStartDelayMs: 40,
    npcActionDelayMs: 20,
    catalogProvider: async () => [
      makeCreature('creature-1'),
      makeFriendlyHealSpell('spell-heal-1'),
      makeCreature('creature-2'),
      makeCreature('creature-3'),
      makeCreature('creature-4'),
      makeEnemySpell('spell-dmg-1'),
    ],
  });

  server.shuffleCards = (cards) => [...cards];

  const matchStatus = await server.findMatch('human-player', {
    opponentType: 'npc',
    deckCardIds: ['creature-1', 'creature-2', 'creature-3', 'creature-4', 'spell-heal-1', 'spell-dmg-1'],
  });

  assert.equal(matchStatus.status, 'matched', 'expected NPC matchmaking to create a matched game');

  const match = server.phaseMatches.get(matchStatus.matchId);
  assert.ok(match, 'expected active match to be present');

  const npcId = match.players.find((id) => id.startsWith('npc-'));
  assert.ok(npcId, 'expected NPC player id');

  const npcStateAtStart = match.cardsByPlayer.get(npcId);
  assert.ok(npcStateAtStart, 'expected NPC player state');
  assert.equal(npcStateAtStart.board.length, 0, 'NPC should not instantly dump cards before start delay elapses');

  await delay(60);
  server.getPlayerPhaseStatus('human-player');
  const npcStateAfterFirstAction = match.cardsByPlayer.get(npcId);
  const hasStartedActing = npcStateAfterFirstAction.board.length > 0
    || npcStateAfterFirstAction.hand.length < 3
    || (match.activeSpellResolution && match.activeSpellResolution.completedAt == null);
  assert.equal(hasStartedActing, true, 'NPC should start acting after the delay');

  for (let index = 0; index < 6; index += 1) {
    await delay(25);
    server.getPlayerPhaseStatus('human-player');
  }

  const npcState = match.cardsByPlayer.get(npcId);
  assert.ok(npcState.board.every((card) => Number.isInteger(card.slotIndex)), 'NPC board cards should have slot indices');

  assert.ok(npcState.board.length >= 1, 'NPC should eventually summon to board');

  const enemyTargetSpellInHand = npcState.hand.find((card) => card?.catalogCard?.ability1?.target === 'enemy');
  if (enemyTargetSpellInHand) {
    const invalidEnemyTargetCast = server.startSpellResolution({
      playerId: npcId,
      cardId: enemyTargetSpellInHand.id,
      selectedAbilityIndex: 0,
      targetSide: 'player',
      targetSlotIndex: npcState.board[0]?.slotIndex ?? 0,
      rollType: 'damage',
      dieSides: 6,
    });
    assert.equal(invalidEnemyTargetCast.statusCode, 400, 'Engine should reject enemy-target spell cast onto friendly target');
  }

  const humanReadyResult = server.readyUp({
    playerId: 'human-player',
    hand: match.cardsByPlayer.get('human-player').hand,
    board: match.cardsByPlayer.get('human-player').board,
    discard: match.cardsByPlayer.get('human-player').discard,
  });
  assert.equal(humanReadyResult.statusCode, 200, 'human ready should succeed');
  assert.equal(match.phase, 2, 'match should move to commit phase after human ready vs NPC');

  const npcAttacks = match.pendingCommitAttacksByPlayer.get(npcId) || [];
  if (npcAttacks.length > 0) {
    const hasNpcSpeedRoll = npcAttacks.some((attack) => match.commitRollsByAttackId.has(`${attack.id}:speed`));
    assert.equal(hasNpcSpeedRoll, true, 'NPC attacks should have auto-submitted commit rolls');
  }

  console.log('phase manager npc autoplay checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
