const { randomUUID } = require('crypto');
const DiceEngine = require('../../shared/dieEngine');

function createDiceApi() {
  const diceStore = new Map();
  let rollCounter = 0;

  function createDie(body = {}) {
    const sides = DiceEngine.normalizeSides(body.sides);
    const areaSize = Number.isFinite(body.areaSize) ? Math.max(4, Number(body.areaSize)) : 8;
    const die = {
      id: randomUUID(),
      sides,
      areaSize,
      history: [],
    };
    diceStore.set(die.id, die);
    return die;
  }

  function rollDie(die, options = {}) {
    rollCounter += 1;
    const seed = `${die.id}:${Date.now()}:${rollCounter}`;
    const sim = DiceEngine.simulateRoll({
      sides: die.sides,
      seed,
      areaSize: die.areaSize,
      debug: options.debug,
      tuning: options.tuning,
    });

    const roll = {
      rollId: randomUUID(),
      createdAt: new Date().toISOString(),
      ...sim,
    };

    die.history.push(roll);
    if (die.history.length > 50) {
      die.history.shift();
    }

    return roll;
  }

  function listDice() {
    return Array.from(diceStore.values()).map((die) => ({
      id: die.id,
      sides: die.sides,
      areaSize: die.areaSize,
      rolls: die.history.length,
      lastOutcome: die.history[die.history.length - 1]?.outcome ?? null,
    }));
  }

  function getDie(id) {
    return diceStore.get(id) || null;
  }

  return {
    createDie,
    rollDie,
    listDice,
    getDie,
  };
}

module.exports = {
  createDiceApi,
};
