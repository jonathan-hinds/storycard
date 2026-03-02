const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function makeCard(id, cardKind) {
  return {
    id,
    color: 0,
    catalogCard: { id, cardKind },
  };
}

async function main() {
  const server = new PhaseManagerServer({ startingHandSize: 3 });

  const orderedDeck = [
    makeCard('spell-1', 'Spell'),
    makeCard('spell-2', 'Spell'),
    makeCard('spell-3', 'Spell'),
    makeCard('creature-1', 'Creature'),
    makeCard('spell-4', 'Spell'),
  ];

  server.shuffleCards = (cards) => [...cards];
  const openingZones = server.buildOpeningZones(orderedDeck);
  assert.equal(openingZones.hand.length, 3, 'opening hand should use configured hand size');
  assert.equal(
    openingZones.hand.some((card) => card.catalogCard.cardKind === 'Creature'),
    true,
    'opening hand should contain at least one creature when the deck contains creatures',
  );

  const matchingServer = new PhaseManagerServer({
    deckSizePerPlayer: 5,
    startingHandSize: 3,
    catalogProvider: async () => [
      { id: 'spell-a', cardKind: 'Spell' },
      { id: 'spell-b', cardKind: 'Spell' },
      { id: 'spell-c', cardKind: 'Spell' },
      { id: 'creature-a', cardKind: 'Creature' },
      { id: 'spell-d', cardKind: 'Spell' },
    ],
  });

  matchingServer.shuffleCards = (cards) => [...cards];

  await matchingServer.findMatch('player-a', {
    deckCardIds: ['spell-a', 'spell-b', 'spell-c', 'creature-a', 'spell-d'],
  });
  const status = await matchingServer.findMatch('player-b', {
    deckCardIds: ['spell-a', 'spell-b', 'spell-c', 'creature-a', 'spell-d'],
  });

  const playerHand = status.matchState.players.player.hand;
  const opponentHand = status.matchState.players.opponent.hand;

  assert.equal(playerHand.some((card) => card.catalogCard.cardKind === 'Creature'), true,
    'player opening hand should contain at least one creature');
  assert.equal(opponentHand.some((card) => card.catalogCard.cardKind === 'Creature'), true,
    'opponent opening hand should contain at least one creature');

  console.log('phase manager opening hand checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
