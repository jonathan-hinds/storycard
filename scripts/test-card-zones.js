const assert = require('assert');
const { CardGameServer } = require('../shared/card-game');

const server = new CardGameServer({
  cards: [
    { id: 'card-alpha', zone: 'board', slotIndex: 0, held: false },
  ],
});

const picked = server.applyCardAction('card-alpha', 'pickup', { zone: 'board', slotIndex: 0 });
assert.equal(picked.zone, 'staging', 'pickup should move the card into staging');
assert.equal(picked.slotIndex, null, 'pickup clears slot index while staging');

const dropped = server.applyCardAction('card-alpha', 'putdown', { zone: 'board', slotIndex: 2 });
assert.equal(dropped.zone, 'board', 'putdown should move card to requested zone');
assert.equal(dropped.slotIndex, 2, 'putdown should persist slot index');

const fallback = server.applyCardAction('card-alpha', 'putdown', { zone: 'unknown-zone' });
assert.equal(fallback.zone, 'board', 'unknown putdown zone should fall back to previous zone');

console.log('card zone server checks passed');
