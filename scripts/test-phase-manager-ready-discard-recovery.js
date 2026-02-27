const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

const server = new PhaseManagerServer();

const spellCard = { id: 'spell-1', color: 0x111111, catalogCard: { cardKind: 'Spell' } };
const creatureA = { id: 'creature-a', color: 0x222222, catalogCard: { cardKind: 'Creature' }, summonedTurn: 0 };
const creatureB = { id: 'creature-b', color: 0x333333, catalogCard: { cardKind: 'Creature' }, summonedTurn: 0 };

const playerState = {
  hand: [spellCard, creatureA],
  board: [
    {
      ...creatureB,
      slotIndex: 1,
      attackCommitted: false,
      targetSlotIndex: null,
      targetSide: null,
      selectedAbilityIndex: 0,
      summonedTurn: 1,
    },
  ],
  discard: [],
};

const validated = server.validatePhaseTurnPayload({
  hand: [{ id: 'creature-a', color: creatureA.color }],
  board: [{ id: 'creature-b', color: creatureB.color, slotIndex: 1 }],
  discard: [],
  attacks: [],
}, { players: ['p1', 'p2'], cardsByPlayer: new Map() }, 'p1', playerState, 2);

assert.ok(!validated.error, 'payload that omits a consumed card should not fail validation');
assert.equal(validated.hand.length, 1);
assert.equal(validated.board.length, 1);
assert.equal(validated.discard.length, 1, 'missing known cards should be normalized into discard');
assert.equal(validated.discard[0].id, 'spell-1');

const unknownCardResult = server.validatePhaseTurnPayload({
  hand: [{ id: 'creature-a', color: creatureA.color }, { id: 'hacker-card', color: 0x0 }],
  board: [{ id: 'creature-b', color: creatureB.color, slotIndex: 1 }],
  discard: [],
  attacks: [],
}, { players: ['p1', 'p2'], cardsByPlayer: new Map() }, 'p1', playerState, 2);

assert.equal(unknownCardResult.error, 'unknown card submitted: hacker-card');

console.log('phase manager ready discard recovery checks passed');
