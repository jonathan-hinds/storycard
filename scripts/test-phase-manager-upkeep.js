const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

async function main() {
  const server = new PhaseManagerServer();

  await server.findMatch('player-a');
  const matchedStatus = await server.findMatch('player-b');
  assert.equal(matchedStatus.status, 'matched', 'second player should match immediately');

  const matchId = matchedStatus.matchId;
  const match = server.phaseMatches.get(matchId);
  assert.ok(match, 'active match should exist');
  assert.equal(match.turnNumber, 1, 'new matches should start on turn 1');

  const playerState = match.cardsByPlayer.get('player-a');
  assert.equal(playerState.upkeep, 1, 'new matches should start upkeep at 1');
  assert.equal(playerState.upkeepTotal, 1, 'new matches should start upkeep total at 1');

  const playerStatus = server.getPlayerPhaseStatus('player-a');
  assert.equal(playerStatus.matchState.upkeep, 1, 'serialized match state should expose upkeep');
  assert.equal(playerStatus.matchState.upkeepTotal, 1, 'serialized match state should expose upkeep total');

  for (let i = 0; i < 20; i += 1) {
    server.advanceMatchToDecisionPhase(match);
  }

  assert.equal(match.turnNumber, 21, 'turn should advance each decision phase transition');
  assert.equal(playerState.upkeep, 10, 'upkeep should cap at 10');
  assert.equal(playerState.upkeepTotal, 10, 'upkeep total should cap at 10');

  const cappedStatus = server.getPlayerPhaseStatus('player-b');
  assert.equal(cappedStatus.matchState.upkeep, 10, 'serialized upkeep should reflect capped value');
  assert.equal(cappedStatus.matchState.upkeepTotal, 10, 'serialized upkeep total should reflect capped value');

  console.log('phase manager upkeep checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
