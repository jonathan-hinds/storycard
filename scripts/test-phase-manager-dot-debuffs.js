const assert = require('node:assert/strict');
const { PhaseManagerServer } = require('../shared/phase-manager/net/PhaseManagerServer');

const server = new PhaseManagerServer();

function createMatch() {
  const p1 = 'p1';
  const p2 = 'p2';
  const target = {
    id: 'target',
    slotIndex: 0,
    catalogCard: { health: 100, ability1: null, ability2: null },
    poisonTurnsRemaining: 0,
    poisonStacks: 0,
    fireTurnsRemaining: 0,
    fireStacks: 0,
    frostbiteTurnsRemaining: 0,
    frostbiteStacks: 0,
    bleedTurnsRemaining: 0,
    bleedStacks: 0,
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

  targetCard().focalMarkTurnsRemaining = 2;
  targetCard().focalMarkBonusDamage = 4;

  for (const buffId of ['poison', 'fire', 'frostbite', 'bleed']) {
    const applied = server.applyResolvedAbilityBuff({
      match,
      casterId: p1,
      attack: { targetSide: 'opponent', targetSlotIndex: 0 },
      buffId,
      buffTarget: 'enemy',
      durationTurns: 2,
    });
    assert.equal(applied.executed, true);

    const reapplied = server.applyResolvedAbilityBuff({
      match,
      casterId: p1,
      attack: { targetSide: 'opponent', targetSlotIndex: 0 },
      buffId,
      buffTarget: 'enemy',
      durationTurns: 4,
    });
    assert.equal(reapplied.executed, true);
  }

  assert.equal(targetCard().poisonTurnsRemaining, 3, 'poison reapply should extend by one turn');
  assert.equal(targetCard().poisonStacks, 2, 'poison reapply should increase stacks');
  assert.equal(targetCard().fireTurnsRemaining, 2, 'fire reapply should keep same duration while active');
  assert.equal(targetCard().fireStacks, 2, 'fire reapply should increase stacks');
  assert.equal(targetCard().frostbiteTurnsRemaining, 2, 'frostbite reapply should keep same duration while active');
  assert.equal(targetCard().frostbiteStacks, 2, 'frostbite reapply should increase stacks');
  assert.equal(targetCard().bleedTurnsRemaining, 2, 'bleed reapply should keep same duration while active');
  assert.equal(targetCard().bleedStacks, 2, 'bleed reapply should increase stacks');

  server.advanceMatchToDecisionPhase(match);

  assert.equal(targetCard().catalogCard.health, 84, 'poison, fire, and bleed tick damage should each apply focal mark separately');
  assert.equal(match.lastDotDamageEvents.length, 3, 'active damage-over-time effects should emit one event each when ticking');

  const firstTickByDebuff = new Map(match.lastDotDamageEvents.map((event) => [event.appliedDebuffs[0], event]));
  assert.equal(firstTickByDebuff.get('poison').baseDamage, 1);
  assert.equal(firstTickByDebuff.get('poison').focalMarkBonusDamage, 4);
  assert.equal(firstTickByDebuff.get('fire').baseDamage, 2);
  assert.equal(firstTickByDebuff.get('fire').focalMarkBonusDamage, 4);
  assert.equal(firstTickByDebuff.get('bleed').baseDamage, 1);
  assert.equal(firstTickByDebuff.get('bleed').focalMarkBonusDamage, 4);

  server.advanceMatchToDecisionPhase(match);

  assert.equal(targetCard().fireTurnsRemaining, 0, 'fire should expire on second tick');
  assert.equal(targetCard().frostbiteTurnsRemaining, 0, 'frostbite should expire on second tick');
  assert.equal(targetCard().bleedTurnsRemaining, 0, 'bleed should expire on second tick');
  assert.equal(targetCard().bleedStacks, 0, 'bleed stacks should clear on expiry');

  const bleedExpiryEvent = match.lastDotDamageEvents.find((event) => event.appliedDebuffs.includes('bleed') && event.appliedDebuffs.includes('expiry'));
  assert.equal(Boolean(bleedExpiryEvent), true, 'bleed expiry should emit a dedicated expiry event');
  assert.equal(bleedExpiryEvent.baseDamage, 14, 'bleed expiry should deal 10% current hp per stack (2 stacks)');
  assert.equal(bleedExpiryEvent.focalMarkBonusDamage, 4, 'bleed expiry should stack with focal mark bonus');

  server.advanceMatchToDecisionPhase(match);
  assert.equal(targetCard().poisonTurnsRemaining, 0, 'poison should eventually expire after its extended duration');
  assert.equal(targetCard().poisonStacks, 0, 'poison stacks should clear on expiry');
}

console.log('phase manager dot debuff checks passed');
