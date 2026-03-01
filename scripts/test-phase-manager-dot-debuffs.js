const assert = require('node:assert/strict');
const { PhaseManagerServer } = require('../shared/phase-manager/net/PhaseManagerServer');

const server = new PhaseManagerServer();

function createMatch() {
  const p1 = 'p1';
  const p2 = 'p2';
  const target = {
    id: 'target',
    slotIndex: 0,
    catalogCard: { health: 12, ability1: null, ability2: null },
    poisonTurnsRemaining: 0,
    poisonStacks: 0,
    fireTurnsRemaining: 0,
    fireStacks: 0,
    frostbiteTurnsRemaining: 0,
    frostbiteStacks: 0,
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
  };
}

{
  const { match, p1, p2 } = createMatch();
  const targetCard = () => match.cardsByPlayer.get(p2).board[0];

  const poisonResult = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'poison',
    buffTarget: 'enemy',
    durationTurns: 2,
  });
  assert.equal(poisonResult.executed, true);
  assert.equal(targetCard().poisonTurnsRemaining, 2, 'initial poison should use configured duration');
  assert.equal(targetCard().poisonStacks, 1, 'initial poison should start with one application stack');

  const poisonRefreshResult = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'poison',
    buffTarget: 'enemy',
    durationTurns: 2,
  });
  assert.equal(poisonRefreshResult.executed, true);
  assert.equal(targetCard().poisonTurnsRemaining, 3, 'reapplying poison should only extend by one turn');
  assert.equal(targetCard().poisonStacks, 2, 'reapplying poison should increase the stack counter for badge display');

  const fireResult = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'fire',
    buffTarget: 'enemy',
    durationTurns: 2,
  });
  assert.equal(fireResult.executed, true);
  assert.equal(targetCard().fireTurnsRemaining, 2, 'initial fire should use configured duration');
  assert.equal(targetCard().fireStacks, 1, 'initial fire should start at one stack of damage');

  const fireRefreshResult = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'fire',
    buffTarget: 'enemy',
    durationTurns: 4,
  });
  assert.equal(fireRefreshResult.executed, true);
  assert.equal(targetCard().fireTurnsRemaining, 2, 'reapplying fire should not change duration while active');
  assert.equal(targetCard().fireStacks, 2, 'reapplying fire should increase fire damage while active');

  const frostbiteResult = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'frostbite',
    buffTarget: 'enemy',
    durationTurns: 2,
  });
  assert.equal(frostbiteResult.executed, true);
  assert.equal(targetCard().frostbiteTurnsRemaining, 2, 'initial frostbite should use configured duration');
  assert.equal(targetCard().frostbiteStacks, 1, 'initial frostbite should start at one stack');

  const frostbiteRefreshResult = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'frostbite',
    buffTarget: 'enemy',
    durationTurns: 4,
  });
  assert.equal(frostbiteRefreshResult.executed, true);
  assert.equal(targetCard().frostbiteTurnsRemaining, 2, 'reapplying frostbite should not change duration while active');
  assert.equal(targetCard().frostbiteStacks, 2, 'reapplying frostbite should increase speed penalty stacks while active');

  server.advanceMatchToDecisionPhase(match);

  assert.equal(targetCard().catalogCard.health, 9, 'poison + amplified fire should deal 3 total damage');
  assert.equal(targetCard().poisonTurnsRemaining, 2, 'poison duration should tick down each phase change');
  assert.equal(targetCard().poisonStacks, 2, 'poison stack counter should persist while poison is active');
  assert.equal(targetCard().fireTurnsRemaining, 1, 'fire duration should tick down each phase change');
  assert.equal(targetCard().fireStacks, 2, 'fire damage amplification should persist while the effect is active');
  assert.equal(targetCard().frostbiteTurnsRemaining, 1, 'frostbite duration should tick down each phase change');
  assert.equal(targetCard().frostbiteStacks, 2, 'frostbite stacks should persist while active');
  assert.equal(match.lastDotDamageEvents.length, 1, 'dot tick should be surfaced as a match event');
  assert.equal(match.lastDotDamageEvents[0].damage, 3);
  assert.deepEqual(match.lastDotDamageEvents[0].appliedDebuffs.sort(), ['fire', 'poison']);

  server.advanceMatchToDecisionPhase(match);
  assert.equal(targetCard().catalogCard.health, 6, 'second tick should still apply amplified fire before fire expires');
  assert.equal(targetCard().poisonTurnsRemaining, 1, 'poison should still be active after second tick');
  assert.equal(targetCard().fireTurnsRemaining, 0, 'fire should expire when its duration runs out');
  assert.equal(targetCard().fireStacks, 0, 'fire amplification should reset once the effect expires');
  assert.equal(targetCard().frostbiteTurnsRemaining, 0, 'frostbite should expire when its duration runs out');
  assert.equal(targetCard().frostbiteStacks, 0, 'frostbite stacks should reset once the effect expires');
  assert.equal(targetCard().poisonStacks, 2, 'poison stack counter should persist until poison expires');

  server.advanceMatchToDecisionPhase(match);
  assert.equal(targetCard().poisonTurnsRemaining, 0, 'poison should expire after extended duration elapses');
  assert.equal(targetCard().poisonStacks, 0, 'poison stack counter should reset once poison expires');

  const fireAfterExpiry = server.applyResolvedAbilityBuff({
    match,
    casterId: p1,
    attack: { targetSide: 'opponent', targetSlotIndex: 0 },
    buffId: 'fire',
    buffTarget: 'enemy',
    durationTurns: 2,
  });
  assert.equal(fireAfterExpiry.executed, true);
  assert.equal(targetCard().fireTurnsRemaining, 2, 'fire should apply fresh duration after expiry');
  assert.equal(targetCard().fireStacks, 1, 'fire amplification should restart at one after expiry');
}

console.log('phase manager dot debuff checks passed');
