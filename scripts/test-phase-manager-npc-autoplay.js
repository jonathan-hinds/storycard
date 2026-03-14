const assert = require('assert');
const { PhaseManagerServer } = require('../shared/phase-manager');

function makeCreature(id) {
  return {
    id,
    cardKind: 'Creature',
    health: 5,
    ability1: {
      target: 'enemy',
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 2,
    },
  };
}

function makeEnemySpell(id) {
  return {
    id,
    cardKind: 'Spell',
    health: 0,
    ability1: {
      target: 'enemy',
      effectId: 'damage_enemy',
      valueSourceType: 'fixed',
      valueSourceFixed: 1,
    },
  };
}

function makeFriendlyHealSpell(id) {
  return {
    id,
    cardKind: 'Spell',
    health: 0,
    ability1: {
      target: 'friendly',
      effectId: 'heal_target',
      valueSourceType: 'fixed',
      valueSourceFixed: 2,
    },
  };
}

function makeFriendlyTauntSpell(id) {
  return {
    id,
    cardKind: 'Spell',
    health: 0,
    ability1: {
      target: 'friendly',
      effectId: 'none',
      buffId: 'taunt',
      durationTurns: 2,
      valueSourceType: 'fixed',
      valueSourceFixed: 0,
    },
  };
}

function makeEnemySilenceSpell(id) {
  return {
    id,
    cardKind: 'Spell',
    health: 0,
    ability1: {
      target: 'enemy',
      effectId: 'none',
      buffId: 'silence',
      durationTurns: 2,
      valueSourceType: 'fixed',
      valueSourceFixed: 0,
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const server = new PhaseManagerServer({
    boardSlotsPerSide: 3,
    deckSizePerPlayer: 6,
    startingHandSize: 3,
    npcStartDelayMs: 40,
    npcActionDelayMs: 20,
    catalogProvider: async () => [
      makeCreature('creature-1'),
      makeFriendlyHealSpell('spell-heal-1'),
      makeCreature('creature-2'),
      makeCreature('creature-3'),
      makeCreature('creature-4'),
      makeEnemySpell('spell-dmg-1'),
    ],
  });

  server.shuffleCards = (cards) => [...cards];

  const matchStatus = await server.findMatch('human-player', {
    opponentType: 'npc',
    deckCardIds: ['creature-1', 'creature-2', 'creature-3', 'creature-4', 'spell-heal-1', 'spell-dmg-1'],
  });

  assert.equal(matchStatus.status, 'matched', 'expected NPC matchmaking to create a matched game');

  const match = server.phaseMatches.get(matchStatus.matchId);
  assert.ok(match, 'expected active match to be present');

  const npcId = match.players.find((id) => id.startsWith('npc-'));
  assert.ok(npcId, 'expected NPC player id');

  const npcStateAtStart = match.cardsByPlayer.get(npcId);
  assert.ok(npcStateAtStart, 'expected NPC player state');
  assert.equal(npcStateAtStart.board.length, 0, 'NPC should not instantly dump cards before start delay elapses');

  await delay(60);
  server.getPlayerPhaseStatus('human-player');
  const npcStateAfterFirstAction = match.cardsByPlayer.get(npcId);
  const hasStartedActing = npcStateAfterFirstAction.board.length > 0
    || npcStateAfterFirstAction.hand.length < 3
    || (match.activeSpellResolution && match.activeSpellResolution.completedAt == null);
  assert.equal(hasStartedActing, true, 'NPC should start acting after the delay');

  for (let index = 0; index < 6; index += 1) {
    await delay(25);
    server.getPlayerPhaseStatus('human-player');
  }

  const npcState = match.cardsByPlayer.get(npcId);
  assert.ok(npcState.board.every((card) => Number.isInteger(card.slotIndex)), 'NPC board cards should have slot indices');

  assert.ok(npcState.board.length >= 1, 'NPC should eventually summon to board');

  const enemyTargetSpellInHand = npcState.hand.find((card) => card?.catalogCard?.ability1?.target === 'enemy');
  if (enemyTargetSpellInHand) {
    const invalidEnemyTargetCast = server.startSpellResolution({
      playerId: npcId,
      cardId: enemyTargetSpellInHand.id,
      selectedAbilityIndex: 0,
      targetSide: 'player',
      targetSlotIndex: npcState.board[0]?.slotIndex ?? 0,
      rollType: 'damage',
      dieSides: 6,
    });
    assert.equal(invalidEnemyTargetCast.statusCode, 400, 'Engine should reject enemy-target spell cast onto friendly target');
  }

  const humanReadyResult = server.readyUp({
    playerId: 'human-player',
    hand: match.cardsByPlayer.get('human-player').hand,
    board: match.cardsByPlayer.get('human-player').board,
    discard: match.cardsByPlayer.get('human-player').discard,
  });
  assert.equal(humanReadyResult.statusCode, 200, 'human ready should succeed');
  assert.equal(match.phase, 2, 'match should move to commit phase after human ready vs NPC');

  const npcAttacks = match.pendingCommitAttacksByPlayer.get(npcId) || [];
  if (npcAttacks.length > 0) {
    const hasNpcSpeedRoll = npcAttacks.some((attack) => match.commitRollsByAttackId.has(`${attack.id}:speed`));
    assert.equal(hasNpcSpeedRoll, true, 'NPC attacks should have auto-submitted commit rolls');
  }

  const followup = await server.findMatch('human-quick-ready', {
    opponentType: 'npc',
    deckCardIds: ['creature-1', 'creature-2', 'creature-3', 'creature-4', 'spell-heal-1', 'spell-dmg-1'],
  });
  const followupMatch = server.phaseMatches.get(followup.matchId);
  const followupNpcId = followupMatch.players.find((id) => id.startsWith('npc-'));
  const followupHumanId = followupMatch.players.find((id) => id === 'human-quick-ready');
  const followupNpcState = followupMatch.cardsByPlayer.get(followupNpcId);
  const followupHumanState = followupMatch.cardsByPlayer.get(followupHumanId);

  followupMatch.turnNumber = 2;
  followupMatch.phase = 1;
  followupMatch.readyPlayers = new Set();
  followupMatch.pendingCommitAttacksByPlayer = new Map();
  followupMatch.commitRollsByAttackId = new Map();
  followupMatch.commitExecutionByAttackId = new Map();
  followupMatch.activeSpellResolution = null;
  followupMatch.npcAutomationByPlayer = new Map([[followupNpcId, { nextActionAt: Date.now() + 60_000 }]]);

  const npcCreatureIndex = followupNpcState.hand.findIndex((card) => card?.catalogCard?.cardKind === 'Creature');
  const humanCreatureIndex = followupHumanState.hand.findIndex((card) => card?.catalogCard?.cardKind === 'Creature');
  assert.ok(npcCreatureIndex >= 0, 'expected a creature in NPC hand for quick-ready scenario');
  assert.ok(humanCreatureIndex >= 0, 'expected a creature in human hand for quick-ready scenario');

  const followupNpcCard = {
    ...followupNpcState.hand[npcCreatureIndex],
    catalogCard: {
      ...(followupNpcState.hand[npcCreatureIndex]?.catalogCard || {}),
      cardKind: 'Creature',
      health: 5,
      ability1: {
        name: 'Quick Strike',
        cost: '1',
        target: 'enemy',
        effectId: 'damage_enemy',
        buffId: 'none',
        valueSourceType: 'fixed',
        valueSourceFixed: 2,
      },
      ability2: null,
    },
    slotIndex: 0,
    summonedTurn: 1,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
  };
  const followupHumanCard = {
    ...followupHumanState.hand[humanCreatureIndex],
    catalogCard: {
      ...(followupHumanState.hand[humanCreatureIndex]?.catalogCard || {}),
      cardKind: 'Creature',
      health: 5,
      ability1: {
        name: 'Quick Strike',
        cost: '1',
        target: 'enemy',
        effectId: 'damage_enemy',
        buffId: 'none',
        valueSourceType: 'fixed',
        valueSourceFixed: 2,
      },
      ability2: null,
    },
    slotIndex: 0,
    summonedTurn: 1,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
  };

  followupNpcState.board = [followupNpcCard];
  followupNpcState.hand = followupNpcState.hand.filter((_, index) => index !== npcCreatureIndex);
  followupNpcState.upkeepTotal = 2;
  followupNpcState.upkeep = 2;

  followupHumanState.board = [followupHumanCard];
  followupHumanState.hand = followupHumanState.hand.filter((_, index) => index !== humanCreatureIndex);
  followupHumanState.upkeepTotal = 2;
  followupHumanState.upkeep = 2;

  const quickReadyResult = server.readyUp({
    playerId: followupHumanId,
    hand: followupHumanState.hand,
    board: followupHumanState.board,
    discard: followupHumanState.discard,
  });

  assert.equal(quickReadyResult.statusCode, 200, 'quick human ready should still succeed');
  const followupNpcAttacks = followupMatch.pendingCommitAttacksByPlayer.get(followupNpcId) || [];
  assert.ok(followupNpcAttacks.length >= 1, 'NPC should still commit attacks when human readies before NPC delay elapses');

  const strategyServer = new PhaseManagerServer({
    boardSlotsPerSide: 3,
    deckSizePerPlayer: 6,
    startingHandSize: 3,
    npcStartDelayMs: 0,
    npcActionDelayMs: 0,
    catalogProvider: async () => [
      makeCreature('strat-creature-1'),
      makeCreature('strat-creature-2'),
      makeCreature('strat-creature-3'),
      makeFriendlyHealSpell('strat-heal'),
      makeFriendlyTauntSpell('strat-taunt'),
      makeEnemySilenceSpell('strat-silence'),
    ],
  });
  strategyServer.shuffleCards = (cards) => [...cards];
  const strategyMatchStatus = await strategyServer.findMatch('human-strategy', {
    opponentType: 'npc',
    deckCardIds: ['strat-creature-1', 'strat-creature-2', 'strat-creature-3', 'strat-heal', 'strat-taunt', 'strat-silence'],
  });
  const strategyMatch = strategyServer.phaseMatches.get(strategyMatchStatus.matchId);
  const strategyNpcId = strategyMatch.players.find((id) => id.startsWith('npc-'));
  const strategyHumanId = strategyMatch.players.find((id) => !id.startsWith('npc-'));
  const strategyNpcState = strategyMatch.cardsByPlayer.get(strategyNpcId);
  const strategyHumanState = strategyMatch.cardsByPlayer.get(strategyHumanId);

  strategyMatch.turnNumber = 3;
  strategyMatch.phase = 1;
  strategyMatch.readyPlayers = new Set();
  strategyMatch.activeSpellResolution = null;
  strategyMatch.npcAutomationByPlayer = new Map([[strategyNpcId, { nextActionAt: Date.now() }]]);

  const npcBoardCard = {
    id: 'npc-board-1',
    cardId: 'strat-creature-1',
    slotIndex: 0,
    summonedTurn: 1,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
    tauntTurnsRemaining: 0,
    silenceTurnsRemaining: 0,
    catalogCard: {
      ...makeCreature('strat-creature-1'),
      ability1: {
        ...makeCreature('strat-creature-1').ability1,
        cost: '2',
      },
    },
  };
  const humanBoardCard = {
    id: 'human-board-1',
    cardId: 'strat-creature-2',
    slotIndex: 0,
    summonedTurn: 1,
    attackCommitted: false,
    targetSlotIndex: null,
    targetSide: null,
    selectedAbilityIndex: 0,
    tauntTurnsRemaining: 0,
    silenceTurnsRemaining: 0,
    catalogCard: {
      ...makeCreature('strat-creature-2'),
      health: 5,
    },
  };

  const healSpell = {
    id: 'npc-spell-heal',
    cardId: 'strat-heal',
    catalogCard: {
      ...makeFriendlyHealSpell('strat-heal'),
      ability1: {
        ...makeFriendlyHealSpell('strat-heal').ability1,
        cost: '1',
      },
    },
  };
  const tauntSpell = {
    id: 'npc-spell-taunt',
    cardId: 'strat-taunt',
    catalogCard: {
      ...makeFriendlyTauntSpell('strat-taunt'),
      ability1: {
        ...makeFriendlyTauntSpell('strat-taunt').ability1,
        cost: '1',
      },
    },
  };
  const silenceSpell = {
    id: 'npc-spell-silence',
    cardId: 'strat-silence',
    catalogCard: {
      ...makeEnemySilenceSpell('strat-silence'),
      ability1: {
        ...makeEnemySilenceSpell('strat-silence').ability1,
        cost: '1',
      },
    },
  };

  strategyNpcState.board = [npcBoardCard];
  strategyNpcState.hand = [healSpell, tauntSpell, silenceSpell];
  strategyNpcState.discard = [];
  strategyNpcState.upkeepTotal = 2;
  strategyNpcState.upkeep = 2;

  strategyHumanState.board = [humanBoardCard];

  const reservedSpellAction = strategyServer.chooseNpcSpellAction(strategyMatch, strategyNpcId);
  assert.equal(reservedSpellAction, null, 'NPC should reserve upkeep for attacks rather than spend it on low-impact spells');

  humanBoardCard.silenceTurnsRemaining = 2;
  const redundantSilenceAction = strategyServer.chooseNpcSpellAction(strategyMatch, strategyNpcId);
  assert.equal(redundantSilenceAction, null, 'NPC should avoid casting silence on already silenced targets');

  humanBoardCard.silenceTurnsRemaining = 0;
  humanBoardCard.summonedTurn = strategyMatch.turnNumber;
  const noThreatTauntAction = strategyServer.chooseNpcSpellAction(strategyMatch, strategyNpcId);
  assert.equal(noThreatTauntAction, null, 'NPC should avoid taunt when enemy has no active attackers');

  console.log('phase manager npc autoplay checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
