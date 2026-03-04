const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function buildCreature({ id, slotIndex, health = 10, summonedTurn = 1, ability }) {
  return {
    id,
    slotIndex,
    summonedTurn,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
    tauntTurnsRemaining: 0,
    silenceTurnsRemaining: 0,
    focalMarkTurnsRemaining: 0,
    focalMarkBonusDamage: 0,
    catalogCard: {
      health,
      type: 'Unknown',
      ability1: ability,
      ability2: null,
    },
  };
}

function buildMatchWithBoards(p1Board, p2Board) {
  return {
    id: 'match-focal-mark',
    players: ['p1', 'p2'],
    turnNumber: 2,
    upkeep: 1,
    phase: 2,
    phaseStartedAt: Date.now(),
    phaseEndsAt: null,
    readyPlayers: new Set(['p1', 'p2']),
    cardsByPlayer: new Map([
      ['p1', { board: p1Board, hand: [], deck: [], discard: [] }],
      ['p2', { board: p2Board, hand: [], deck: [], discard: [] }],
    ]),
    lastDrawnCardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map(),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
    commitAnimationCompletedPlayers: new Set(),
    activeSpellResolution: null,
  };
}

// Scenario 1: spell applies focal mark to C with no immediate damage.
{
  const server = new PhaseManagerServer();
  const playerId = 'p1';
  const opponentId = 'p2';
  const spellId = 'spell-focal-mark';
  const spellCardId = 'spell-card-1';

  const targetCard = buildCreature({
    id: 'c',
    slotIndex: 0,
    health: 12,
    ability: { effectId: 'none', valueSourceType: 'none' },
  });

  const match = {
    id: 'match-focal-mark-spell',
    players: [playerId, opponentId],
    turnNumber: 1,
    phase: 1,
    phaseStartedAt: Date.now(),
    readyPlayers: new Set(),
    cardsByPlayer: new Map([
      [playerId, { hand: [{ id: spellCardId, catalogCard: { cardKind: 'Spell', type: 'Unknown' } }], board: [], deck: [], discard: [] }],
      [opponentId, { hand: [], board: [targetCard], deck: [], discard: [] }],
    ]),
    lastDrawnCardsByPlayer: new Map(),
    pendingCommitAttacksByPlayer: new Map([[playerId, []], [opponentId, []]]),
    commitRollsByAttackId: new Map(),
    commitExecutionByAttackId: new Map(),
    activeSpellResolution: {
      id: spellId,
      casterId: playerId,
      cardId: spellCardId,
      cardSnapshot: {
        id: spellCardId,
        color: 0,
        catalogCard: {
          cardKind: 'Spell',
          type: 'Unknown',
          ability1: {
            effectId: 'none',
            buffId: 'focal_mark',
            buffTarget: 'enemy',
            valueSourceType: 'fixed',
            valueSourceFixed: 2,
            durationTurns: 2,
          },
        },
      },
      selectedAbilityIndex: 0,
      targetSlotIndex: 0,
      targetSide: 'opponent',
      rollType: 'damage',
      dieSides: 6,
      rollOutcome: 2,
      startedAt: Date.now(),
      completedAt: null,
    },
  };

  server.phaseMatchmakingState.set(playerId, { status: 'matched', matchId: match.id });
  server.phaseMatchmakingState.set(opponentId, { status: 'matched', matchId: match.id });
  server.phaseMatches.set(match.id, match);

  const result = server.completeSpellResolution({ playerId, spellId });
  assert.equal(result.statusCode, 200);
  assert.equal(targetCard.catalogCard.health, 12, 'focal mark application should not directly damage target by itself');
  assert.equal(targetCard.focalMarkTurnsRemaining, 2, 'focal mark spell should apply configured duration');
  assert.equal(targetCard.focalMarkBonusDamage, 2, 'focal mark spell should persist bonus damage value on target');
}

// Scenario 2: A applies mark first, B attacks next and gets mark bonus.
{
  const server = new PhaseManagerServer();

  const creatureA = buildCreature({
    id: 'a',
    slotIndex: 0,
    ability: {
      effectId: 'none',
      valueSourceType: 'fixed',
      valueSourceFixed: 2,
      buffId: 'focal_mark',
      buffTarget: 'enemy',
      durationTurns: 2,
    },
  });
  const creatureB = buildCreature({
    id: 'b',
    slotIndex: 1,
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 4,
    },
  });
  const creatureC = buildCreature({
    id: 'c',
    slotIndex: 0,
    health: 12,
    ability: { effectId: 'none', valueSourceType: 'none' },
  });

  const match = buildMatchWithBoards([creatureA, creatureB], [creatureC]);
  match.pendingCommitAttacksByPlayer.set('p1', [
    { id: 'p1:a', attackerSlotIndex: 0, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 },
    { id: 'p1:b', attackerSlotIndex: 1, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 },
  ]);
  match.pendingCommitAttacksByPlayer.set('p2', []);
  match.commitRollsByAttackId = new Map([
    ['p1:a:speed', { roll: { outcome: 3 }, submittedAt: 1 }],
    ['p1:b:speed', { roll: { outcome: 2 }, submittedAt: 2 }],
  ]);

  server.applyCommitEffects(match);

  assert.equal(creatureC.catalogCard.health, 6, 'C should lose 6 health total (base 4 + focal mark bonus 2) when B attacks after A marks');
  const bExecution = match.commitExecutionByAttackId.get('p1:b');
  assert.equal(bExecution?.executed, true, 'B attack should execute normally after mark is applied');
}

// Scenario 3: late focal mark should not retroactively increase earlier B->C damage.
{
  const server = new PhaseManagerServer();

  const creatureA = buildCreature({
    id: 'a',
    slotIndex: 0,
    ability: {
      effectId: 'none',
      valueSourceType: 'fixed',
      valueSourceFixed: 2,
      buffId: 'focal_mark',
      buffTarget: 'enemy',
      durationTurns: 2,
    },
  });
  const creatureB = buildCreature({
    id: 'b',
    slotIndex: 1,
    health: 10,
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 4,
    },
  });
  const creatureC = buildCreature({
    id: 'c',
    slotIndex: 0,
    health: 12,
    ability: {
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 3,
    },
  });

  const match = buildMatchWithBoards([creatureA, creatureB], [creatureC]);
  match.pendingCommitAttacksByPlayer.set('p1', [
    { id: 'p1:b', attackerSlotIndex: 1, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 },
    { id: 'p1:a', attackerSlotIndex: 0, targetSlotIndex: 0, targetSide: 'opponent', selectedAbilityIndex: 0 },
  ]);
  match.pendingCommitAttacksByPlayer.set('p2', [
    { id: 'p2:c', attackerSlotIndex: 0, targetSlotIndex: 1, targetSide: 'opponent', selectedAbilityIndex: 0 },
  ]);
  match.commitRollsByAttackId = new Map([
    ['p2:c:speed', { roll: { outcome: 3 }, submittedAt: 1 }],
    ['p1:b:speed', { roll: { outcome: 2 }, submittedAt: 2 }],
    ['p1:a:speed', { roll: { outcome: 1 }, submittedAt: 3 }],
  ]);

  server.applyCommitEffects(match);

  assert.equal(creatureC.catalogCard.health, 4, 'C should only take base-damage interactions before A applies late focal mark (no retroactive bonus applied to earlier attacks)');
  assert.equal(creatureC.focalMarkTurnsRemaining, 2, 'late A attack should still apply focal mark for future hits');
  assert.equal(creatureC.focalMarkBonusDamage, 2, 'late focal mark should carry the configured bonus amount');
}

console.log('phase manager focal mark checks passed');
