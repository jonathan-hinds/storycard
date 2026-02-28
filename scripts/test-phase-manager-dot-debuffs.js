const assert = require('node:assert/strict');
const { PhaseManagerServer } = require('../shared/phase-manager/net/PhaseManagerServer');

const server = new PhaseManagerServer();

function createMatch() {
  const p1 = 'p1';
  const p2 = 'p2';
  const target = {
    id: 'target',
    slotIndex: 0,
    catalogCard: { health: 7, ability1: null, ability2: null },
    poisonTurnsRemaining: 0,
    fireTurnsRemaining: 0,
    tauntTurnsRemaining: 0,
    silenceTurnsRemaining: 0,
  };

  return {
    match: {
      id: 'dot-match',
      players: [p1, p2],
      cardsByPlayer: new Map([
        [p1, { board: [], hand: [], deck: [], discard: [] }],
        [p2, { board: [target], hand: [], deck: [], discard: [] }],
      ]),
      turnNumber: 1,
      upkeep: 1,
      phase: 2,
      phaseStartedAt: Date.now(),
      phaseEndsAt: null,
      readyPlayers: new Set([p1, p2]),
      pendingCommitAttacksByPlayer: new Map(),
      commitRollsByAttackId: new Map(),
      commitExecutionByAttackId: new Map(),
      commitAnimationCompletedPlayers: new Set(),
      lastDrawnCardsByPlayer: new Map(),
      activeSpellResolution: null,
      lastDotDamageEvents: [],
    },
    p1,
    p2,
    target,
  };
}

{
  const { match, p1, target } = createMatch();

  const poisonResult = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'poison',
    buffTarget: 'enemy',
    durationTurns: 2,
  });
  assert.equal(poisonResult.executed, true);
  assert.equal(target.poisonTurnsRemaining, 2);

  const fireResult = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'fire',
    buffTarget: 'enemy',
    durationTurns: 2,
  });
  assert.equal(fireResult.executed, true);
  assert.equal(target.fireTurnsRemaining, 2);

  server.advanceMatchToDecisionPhase(match);

  assert.equal(target.catalogCard.health, 5, 'poison + fire should deal 2 total damage when both are active');
  assert.equal(target.poisonTurnsRemaining, 1, 'poison duration should tick down each phase change');
  assert.equal(target.fireTurnsRemaining, 1, 'fire duration should tick down each phase change');
  assert.equal(match.lastDotDamageEvents.length, 1, 'dot tick should be surfaced as a match event');
  assert.equal(match.lastDotDamageEvents[0].damage, 2);
  assert.deepEqual(match.lastDotDamageEvents[0].appliedDebuffs.sort(), ['fire', 'poison']);
}

console.log('phase manager dot debuff checks passed');
