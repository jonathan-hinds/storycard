const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

const server = new PhaseManagerServer();

const playerId = 'p1';
const opponentId = 'p2';
const match = {
  id: 'match-spell-sync-test',
  players: [playerId, opponentId],
  turnNumber: 1,
  phase: 1,
  phaseStartedAt: Date.now(),
  readyPlayers: new Set(),
  cardsByPlayer: new Map(),
  lastDrawnCardsByPlayer: new Map(),
  pendingCommitAttacksByPlayer: new Map(),
  commitRollsByAttackId: new Map(),
  commitExecutionByAttackId: new Map(),
  commitAllRolledAt: null,
  activeSpellResolution: {
    id: 'spell-1234',
    casterId: playerId,
    cardId: 'spell-card-1',
    cardSnapshot: { id: 'spell-card-1', color: 0x111111, catalogCard: { cardKind: 'Spell' } },
    selectedAbilityIndex: 0,
    targetSlotIndex: 2,
    targetSide: 'opponent',
    rollType: 'damage',
    dieSides: 6,
    rollOutcome: null,
    rollData: null,
    lifeStealHealingTargetSide: 'player',
    lifeStealHealingTargetSlotIndex: 1,
    startedAt: Date.now(),
    completedAt: null,
  },
};

match.cardsByPlayer.set(playerId, { hand: [], board: [], deck: [], discard: [] });
match.cardsByPlayer.set(opponentId, { hand: [], board: [], deck: [], discard: [] });
match.lastDrawnCardsByPlayer.set(playerId, []);
match.lastDrawnCardsByPlayer.set(opponentId, []);
match.pendingCommitAttacksByPlayer.set(playerId, []);
match.pendingCommitAttacksByPlayer.set(opponentId, []);

const casterView = server.serializeMatchForPlayer(match, playerId);
assert.equal(casterView.meta.activeSpellResolution.casterSide, 'player');
assert.equal(casterView.meta.activeSpellResolution.targetSide, 'opponent');
assert.equal(casterView.meta.activeSpellResolution.lifeStealHealingTargetSide, 'player');

const targetView = server.serializeMatchForPlayer(match, opponentId);
assert.equal(targetView.meta.activeSpellResolution.casterSide, 'opponent');
assert.equal(targetView.meta.activeSpellResolution.targetSide, 'player');
assert.equal(targetView.meta.activeSpellResolution.lifeStealHealingTargetSide, 'opponent');

console.log('phase manager spell sync checks passed');
