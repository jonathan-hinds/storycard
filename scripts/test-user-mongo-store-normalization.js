const assert = require('assert');
const {
  normalizeDeckFromDocument,
  normalizeCardId,
} = require('../shared/user/mongoStore');

function run() {
  assert.strictEqual(normalizeCardId(' abc '), 'abc');
  assert.strictEqual(normalizeCardId({ id: ' card-1 ' }), 'card-1');
  assert.strictEqual(normalizeCardId({ cardId: ' card-2 ' }), 'card-2');
  assert.strictEqual(normalizeCardId({ $oid: ' 507f1f77bcf86cd799439011 ' }), '507f1f77bcf86cd799439011');

  const normalizedModern = normalizeDeckFromDocument({
    deck: {
      cards: [' c1 ', { id: ' c2 ' }],
      creatureCount: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  });
  assert.deepStrictEqual(normalizedModern, {
    cards: ['c1', 'c2'],
    creatureCount: 3,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const normalizedLegacy = normalizeDeckFromDocument({
    deckCardIds: [' c3 ', { cardId: ' c4 ' }],
    deckCreatureCount: 4,
    deckUpdatedAt: '2026-01-02T00:00:00.000Z',
  });
  assert.deepStrictEqual(normalizedLegacy, {
    cards: ['c3', 'c4'],
    creatureCount: 4,
    updatedAt: '2026-01-02T00:00:00.000Z',
  });

  const normalizedLegacyArray = normalizeDeckFromDocument({
    deck: [' c5 ', { id: ' c6 ' }],
  });
  assert.deepStrictEqual(normalizedLegacyArray, {
    cards: ['c5', 'c6'],
    creatureCount: 0,
    updatedAt: null,
  });

  console.log('user mongoStore normalization checks passed');
}

run();
