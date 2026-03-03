const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

const sharedCatalogCard = {
  id: 'shared-creature',
  name: 'Mirror Slime',
  cardKind: 'Creature',
  type: 'Nature',
  health: 10,
  damage: 'D4',
  speed: 'D6',
  defense: 'D6',
  ability1: {
    cost: '1',
    name: 'Bonk',
    description: 'Deal a fixed amount of damage.',
    target: 'enemy',
    effectId: 'damage_enemy',
    valueSourceType: 'fixed',
    valueSourceFixed: 3,
  },
};

const server = new PhaseManagerServer({
  deckSizePerPlayer: 2,
  catalogProvider: async () => [sharedCatalogCard],
});

const deck = server.buildDeckFromCatalog('p1', [sharedCatalogCard], ['shared-creature', 'shared-creature']);
assert.equal(deck.length, 2, 'deck should include both requested cards');
assert.notStrictEqual(deck[0].catalogCard, deck[1].catalogCard, 'duplicate cards must not share the same catalogCard reference');

const match = {
  id: 'instance-isolation-match',
  players: ['p1', 'p2'],
  cardsByPlayer: new Map(),
  pendingCommitAttacksByPlayer: new Map(),
  commitRollsByAttackId: new Map(),
  commitExecutionByAttackId: new Map(),
};

const targetA = { ...deck[0], slotIndex: 0, attackCommitted: false };
const targetB = { ...deck[1], slotIndex: 1, attackCommitted: false };
const attacker = {
  id: 'attacker',
  slotIndex: 0,
  attackCommitted: true,
  targetSlotIndex: 0,
  targetSide: 'opponent',
  selectedAbilityIndex: 0,
  catalogCard: {
    health: 10,
    ability1: {
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 3,
    },
    ability2: null,
  },
};

match.cardsByPlayer.set('p1', { board: [attacker] });
match.cardsByPlayer.set('p2', { board: [targetA, targetB] });
match.pendingCommitAttacksByPlayer.set('p1', [{
  id: 'p1:0:opponent:0',
  attackerSlotIndex: 0,
  targetSlotIndex: 0,
  targetSide: 'opponent',
  selectedAbilityIndex: 0,
}]);
match.pendingCommitAttacksByPlayer.set('p2', []);

server.applyCommitEffects(match);

assert.equal(targetA.catalogCard.health, 7, 'attacked card should lose health');
assert.equal(targetB.catalogCard.health, 10, 'unattacked duplicate card should keep its original health');

console.log('phase manager card instance isolation checks passed');
