const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function makeSpellCardInstance() {
  return {
    id: 'instance-spell-1',
    color: 0x111111,
    catalogCard: {
      id: 'spell-1',
      cardKind: 'Spell',
      health: 0,
      ability1: {
        target: 'enemy',
        effectId: 'damage_enemy',
        valueSourceType: 'fixed',
        valueSourceFixed: 1,
      },
    },
  };
}

function makeCreatureCardInstance(id, slotIndex) {
  return {
    id,
    color: 0x222222,
    catalogCard: {
      id,
      cardKind: 'Creature',
      health: 5,
      ability1: {
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

const server = new PhaseManagerServer();
const matchId = 'match-spell-consumption';
const npcId = 'bot-1';
const humanId = 'human-1';
const spellCard = makeSpellCardInstance();

server.phaseMatchmakingState.set(npcId, { status: 'matched', matchId });
server.phaseMatchmakingState.set(humanId, { status: 'matched', matchId });

const match = {
  id: matchId,
  players: [humanId, npcId],
  turnNumber: 1,
  phase: 1,
  phaseStartedAt: Date.now(),
  readyPlayers: new Set(),
  cardsByPlayer: new Map(),
  lastDrawnCardsByPlayer: new Map(),
  pendingCommitAttacksByPlayer: new Map(),
  commitRollsByAttackId: new Map(),
  commitExecutionByAttackId: new Map(),
  activeSpellResolution: null,
};

match.cardsByPlayer.set(npcId, { hand: [spellCard], board: [], deck: [], discard: [] });
match.cardsByPlayer.set(humanId, { hand: [], board: [makeCreatureCardInstance('human-creature-1', 0)], deck: [], discard: [] });
match.lastDrawnCardsByPlayer.set(npcId, []);
match.lastDrawnCardsByPlayer.set(humanId, []);
server.phaseMatches.set(matchId, match);

const startResult = server.startSpellResolution({
  playerId: npcId,
  cardId: spellCard.id,
  selectedAbilityIndex: 0,
  targetSide: 'opponent',
  targetSlotIndex: 0,
  rollType: 'damage',
  dieSides: 6,
});
assert.equal(startResult.statusCode, 200, 'NPC should be able to start spell resolution');

const completeResult = server.completeSpellResolution({
  playerId: npcId,
  spellId: match.activeSpellResolution.id,
});
assert.equal(completeResult.statusCode, 200, 'NPC should be able to complete spell resolution');

const npcState = match.cardsByPlayer.get(npcId);
assert.equal(npcState.hand.some((card) => card.id === spellCard.id), false, 'spell should be removed from hand after resolution');
assert.equal(npcState.discard.some((card) => card.id === spellCard.id), true, 'spell should be moved to discard after resolution');

const recastResult = server.startSpellResolution({
  playerId: npcId,
  cardId: spellCard.id,
  selectedAbilityIndex: 0,
  targetSide: 'opponent',
  targetSlotIndex: 0,
  rollType: 'damage',
  dieSides: 6,
});
assert.equal(recastResult.statusCode, 400, 'consumed spell should not be castable from hand again');

console.log('phase manager spell consumption checks passed');
