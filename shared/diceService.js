const { randomUUID } = require('crypto');
const DiceEngine = require('./dieEngine');

class DiceService {
  constructor() {
    this.diceStore = new Map();
    this.rollCounter = 0;
  }

  createDie(body = {}) {
    const sides = DiceEngine.normalizeSides(body.sides);
    const areaSize = Number.isFinite(body.areaSize) ? Math.max(4, Number(body.areaSize)) : 8;
    const die = { id: randomUUID(), sides, areaSize, history: [] };
    this.diceStore.set(die.id, die);
    return die;
  }

  listDice() {
    return Array.from(this.diceStore.values()).map((die) => ({
      id: die.id,
      sides: die.sides,
      areaSize: die.areaSize,
      rolls: die.history.length,
      lastOutcome: die.history[die.history.length - 1]?.outcome ?? null,
    }));
  }

  getDie(id) {
    return this.diceStore.get(id) || null;
  }

  rollDie(dieId, options = {}) {
    const die = this.getDie(dieId);
    if (!die) return null;

    this.rollCounter += 1;
    const seed = `${die.id}:${Date.now()}:${this.rollCounter}`;
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
    if (die.history.length > 50) die.history.shift();

    return { die, roll };
  }

  getHistory(dieId) {
    const die = this.getDie(dieId);
    if (!die) return null;
    return {
      dieId,
      sides: die.sides,
      areaSize: die.areaSize,
      history: die.history,
    };
  }
}

module.exports = DiceService;
