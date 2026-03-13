const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

async function main() {
  const increments = [];
  const server = new PhaseManagerServer({
    onBattleMetricIncrement: ({ playerId, metricKey, increment }) => {
      increments.push({ playerId, metricKey, increment });
    },
  });

  await server.findMatch('player-a');
  const status = await server.findMatch('player-b');
  assert.equal(status.status, 'matched', 'players should be matched');

  const match = server.phaseMatches.get(status.matchId);
  assert.ok(match, 'match should exist');

  const playerAState = match.cardsByPlayer.get('player-a');
  const playerBState = match.cardsByPlayer.get('player-b');

  playerAState.hand = [{
    id: 'spell-1',
    color: '#fff',
    catalogCard: {
      cardKind: 'Spell',
      attackAbilities: [],
    },
  }];

  const spellResult = server.startSpellResolution({
    playerId: 'player-a',
    cardId: 'spell-1',
    selectedAbilityIndex: 0,
    targetSide: null,
    targetSlotIndex: null,
    dieSides: 6,
    rollType: 'damage',
  });
  assert.equal(spellResult.statusCode, 200, 'spell start should succeed');

  playerBState.board = [{
    id: 'b-creature-1',
    slotIndex: 0,
    catalogCard: {
      cardKind: 'Creature',
      health: 1,
    },
  }];
  match.initialCreatureCountByPlayer.set('player-b', 1);

  const damageResult = server.applyDamageToCard({
    match,
    targetPlayerId: 'player-b',
    targetSlotIndex: 0,
    damage: 1,
    sourcePlayerId: 'player-a',
  });
  assert.equal(damageResult.executed, true, 'damage should execute');
  assert.equal(match.phase, 3, 'match should complete after lethal damage');

  const byKey = (playerId, key) => increments
    .filter((entry) => entry.playerId === playerId && entry.metricKey === key)
    .reduce((sum, entry) => sum + entry.increment, 0);

  assert.equal(byKey('player-a', 'totalSpellsPlayed'), 1, 'spell casts should increment immediately');
  assert.equal(byKey('player-a', 'totalCreaturesKilled'), 1, 'kills should increment immediately');
  assert.equal(byKey('player-b', 'totalCreaturesLost'), 1, 'losses should increment immediately');
  assert.equal(byKey('player-a', 'totalGamesPlayed'), 1, 'winner should increment games played');
  assert.equal(byKey('player-a', 'totalWins'), 1, 'winner should increment wins');
  assert.equal(byKey('player-b', 'totalGamesPlayed'), 1, 'loser should increment games played');
  assert.equal(byKey('player-b', 'totalLosses'), 1, 'loser should increment losses');

  await server.findMatch('player-c');
  const dotStatus = await server.findMatch('player-d');
  assert.equal(dotStatus.status, 'matched', 'dot test players should be matched');
  const dotMatch = server.phaseMatches.get(dotStatus.matchId);
  assert.ok(dotMatch, 'dot test match should exist');

  const playerDState = dotMatch.cardsByPlayer.get('player-d');
  playerDState.board = [{
    id: 'd-creature-1',
    slotIndex: 0,
    catalogCard: {
      cardKind: 'Creature',
      health: 1,
    },
    poisonTurnsRemaining: 1,
    poisonStacks: 1,
  }];
  dotMatch.initialCreatureCountByPlayer.set('player-d', 1);

  const dotEvents = server.applyDamageOverTimeAtPhaseChange(dotMatch);
  assert.equal(dotEvents.length, 1, 'dot should produce one damage event');
  assert.equal(dotMatch.phase, 3, 'dot lethal damage should complete match');
  assert.equal(byKey('player-c', 'totalCreaturesKilled'), 1, 'dot kills should increment kills for opposing player');
  assert.equal(byKey('player-d', 'totalCreaturesLost'), 1, 'dot target should increment creatures lost');

  const challengeStatus = await server.findMatch('player-e', { opponentType: 'npc', mode: 'challenge' });
  assert.equal(challengeStatus.status, 'matched', 'challenge player should be matched with npc');
  const challengeMatch = server.phaseMatches.get(challengeStatus.matchId);
  assert.ok(challengeMatch, 'challenge match should exist');

  const challengeNpcId = challengeMatch.players.find((id) => id !== 'player-e');
  assert.ok(challengeNpcId && challengeNpcId.startsWith('npc-'), 'challenge opponent should be npc');

  const challengeNpcState = challengeMatch.cardsByPlayer.get(challengeNpcId);
  challengeNpcState.board = [{
    id: 'npc-creature-1',
    slotIndex: 0,
    catalogCard: {
      cardKind: 'Creature',
      health: 1,
    },
    fireTurnsRemaining: 1,
    fireStacks: 1,
  }];
  challengeMatch.initialCreatureCountByPlayer.set(challengeNpcId, 1);

  const challengeDotEvents = server.applyDamageOverTimeAtPhaseChange(challengeMatch);
  assert.equal(challengeDotEvents.length, 1, 'challenge dot should produce one damage event');
  assert.equal(challengeMatch.phase, 3, 'challenge dot lethal damage should complete match');
  assert.equal(byKey('player-e', 'totalCreaturesKilled'), 1, 'challenge dot kills should increment kills for player');
  assert.equal(byKey(challengeNpcId, 'totalCreaturesLost'), 1, 'challenge npc should increment creatures lost');

  console.log('phase manager metric increment callback checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
