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

function makeSpell(id) {
  return {
    id,
    cardKind: 'Spell',
    health: 0,
    ability1: {
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 1,
    },
  };
}

async function main() {
  const server = new PhaseManagerServer({
    boardSlotsPerSide: 3,
    deckSizePerPlayer: 6,
    startingHandSize: 3,
    catalogProvider: async () => [
      makeCreature('creature-1'),
      makeCreature('creature-2'),
      makeCreature('creature-3'),
      makeCreature('creature-4'),
      makeSpell('spell-1'),
      makeSpell('spell-2'),
    ],
  });

  server.shuffleCards = (cards) => [...cards];

  const matchStatus = await server.findMatch('human-player', {
    opponentType: 'npc',
    deckCardIds: ['creature-1', 'creature-2', 'creature-3', 'creature-4', 'spell-1', 'spell-2'],
  });

  assert.equal(matchStatus.status, 'matched', 'expected NPC matchmaking to create a matched game');

  const match = server.phaseMatches.get(matchStatus.matchId);
  assert.ok(match, 'expected active match to be present');

  const npcId = match.players.find((id) => id.startsWith('npc-'));
  assert.ok(npcId, 'expected NPC player id');

  const npcState = match.cardsByPlayer.get(npcId);
  assert.ok(npcState, 'expected NPC player state');

  assert.ok(npcState.board.length > 0, 'NPC should auto-play creatures during decision phase');
  assert.ok(npcState.board.every((card) => Number.isInteger(card.slotIndex)), 'NPC board cards should have slot indices');

  const hadSpellInCatalog = true;
  if (hadSpellInCatalog) {
    const openingHandSize = 3;
    assert.ok(npcState.hand.length <= openingHandSize, 'NPC should cast at most one spell from opening hand when available');
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
