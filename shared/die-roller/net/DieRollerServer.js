const { randomUUID } = require('crypto');
const DiceEngine = require('../../dieEngine');

class DieRollerServer {
  constructor() {
    this.rollCounter = 0;
  }

  roll({ dieId, sides, areaSize = 8, debug = false, tuning }) {
    this.rollCounter += 1;
    const resolvedDieId = dieId || randomUUID();
    const seed = `${resolvedDieId}:${Date.now()}:${this.rollCounter}`;
    return {
      rollId: randomUUID(),
      createdAt: new Date().toISOString(),
      ...DiceEngine.simulateRoll({ sides, seed, areaSize, debug, tuning }),
    };
  }
}

module.exports = { DieRollerServer };
