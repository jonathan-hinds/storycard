const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

async function main() {
  const server = new PhaseManagerServer();
  const playerId = 'human-player';
  const status = await server.findMatch(playerId, { solo: true });

  assert.equal(status.status, 'matched', 'solo matchmaking should immediately return a match');
  const match = server.phaseMatches.get(status.matchId);
  assert.ok(match, 'solo match should be created');

  const npcId = match.players.find((id) => id !== playerId);
  assert.ok(npcId && npcId.startsWith('npc-'), 'solo match should include an NPC player id');
  assert.equal(server.isNpcPlayer(npcId), true, 'npc players should be tracked by the server');
  assert.equal(match.readyPlayers.has(npcId), true, 'npc should auto-ready during decision phase');

  const playerState = match.cardsByPlayer.get(playerId);
  assert.ok(playerState, 'human player state should exist');

  const hand = playerState.hand.map((card) => ({ id: card.id }));
  const board = [];
  const discard = [];

  const firstCreature = playerState.hand.find((card) => card?.catalogCard?.cardKind === 'Creature');
  if (firstCreature) {
    board.push({ id: firstCreature.id, slotIndex: 0 });
    const handIndex = hand.findIndex((entry) => entry.id === firstCreature.id);
    if (handIndex >= 0) hand.splice(handIndex, 1);
  }

  const readyResult = server.readyUp({
    playerId,
    hand,
    board,
    discard,
    attacks: [],
  });

  assert.equal(readyResult.statusCode, 200, 'human player should be able to ready up in solo mode');
  const afterReadyMatch = server.phaseMatches.get(status.matchId);
  assert.equal(afterReadyMatch.phase, 2, 'match should progress to commit phase when both human and npc are ready');

  const commitCompleteResult = server.completeCommitRolls({ playerId });
  assert.equal(commitCompleteResult.statusCode, 200, 'human should be able to complete commit rolls');

  const animationCompleteResult = server.completeCommitAnimations({ playerId });
  assert.equal(animationCompleteResult.statusCode, 200, 'human should be able to complete commit animations');

  const finalStatus = server.getPlayerPhaseStatus(playerId);
  assert.equal(finalStatus.status, 'matched');
  assert.equal(finalStatus.matchState.phase, 1, 'match should cycle back to decision phase after commit animations complete');
  assert.equal(finalStatus.matchState.turnNumber, 2, 'turn should advance after commit phase resolution');

  console.log('phase manager solo npc checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
