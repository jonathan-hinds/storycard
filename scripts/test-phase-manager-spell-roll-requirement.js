const assert = require('node:assert/strict');
const { PhaseManagerServer } = require('../shared/phase-manager/net/PhaseManagerServer');

function createMatchWithSpell(ability) {
  const server = new PhaseManagerServer();
  const matchId = 'match-spell-roll-req';
  const playerId = 'p1';
  const opponentId = 'p2';
  const spellCard = {
    id: 'spell-card',
    color: 0x111111,
    catalogCard: {
      cardKind: 'Spell',
      ability1: ability,
      ability2: null,
    },
  };

  const match = {
    id: matchId,
    players: [playerId, opponentId],
    turnNumber: 1,
    upkeep: 1,
    phase: 1,
    phaseStartedAt: Date.now(),
    phaseEndsAt: null,
    readyPlayers: new Set(),
    cardsByPlayer: new Map([
      [playerId, { board: [], hand: [spellCard], deck: [], discard: [] }],
      [opponentId, { board: [], hand: [], deck: [], discard: [] }],
    ]),
    lastDrawnCardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
    commitAnimationCompletedPlayers: new Set(),
    activeSpellResolution: null,
  };

  server.phaseMatches.set(matchId, match);
  server.phaseMatchmakingState.set(playerId, { status: 'matched', matchId });
  server.phaseMatchmakingState.set(opponentId, { status: 'matched', matchId });

  return { server, playerId };
}

{
  const { server, playerId } = createMatchWithSpell({ effectId: 'damage_enemy', valueSourceType: 'roll' });
  const result = server.startSpellResolution({ playerId, cardId: 'spell-card', selectedAbilityIndex: 0 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.matchState.meta.activeSpellResolution.requiresRoll, true);
}

{
  const { server, playerId } = createMatchWithSpell({ effectId: 'none', buffId: 'silence', buffTarget: 'enemy', valueSourceType: 'none', durationTurns: 2 });
  const result = server.startSpellResolution({ playerId, cardId: 'spell-card', selectedAbilityIndex: 0 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.matchState.meta.activeSpellResolution.requiresRoll, false);
}

console.log('phase manager spell roll requirement checks passed');
