const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

async function createMatch(server, playerA = 'player-a', playerB = 'player-b') {
  await server.findMatch(playerA);
  const matched = await server.findMatch(playerB);
  return matched.matchState;
}

(async () => {
  const server = new PhaseManagerServer();
  const initialState = await createMatch(server);

  assert.equal(initialState.turnNumber, 1, 'turn should start at 1');
  assert.equal(initialState.upkeep, 1, 'upkeep should start at 1');

  const status = server.phaseMatchmakingState.get('player-a');
  const match = server.phaseMatches.get(status.matchId);

  for (let i = 0; i < 12; i += 1) {
    server.advanceMatchToDecisionPhase(match);
  }

  const afterAdvance = server.serializeMatchForPlayer(match, 'player-a');
  assert.equal(afterAdvance.turnNumber, 13, 'turn should continue increasing');
  assert.equal(afterAdvance.upkeep, 10, 'upkeep should cap at 10');

  console.log('phase manager upkeep checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
