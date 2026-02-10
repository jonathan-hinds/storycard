const DiceEngine = require('../shared/dieEngine');

function capture(seed, sides, tuning) {
  const result = DiceEngine.simulateRoll({ seed, sides, tuning, areaSize: 8 });
  const last = result.frames[result.frames.length - 1];
  return {
    outcome: result.outcome,
    settleFrames: result.metadata.totalFrames,
    q: [last.qx, last.qy, last.qz, last.qw],
  };
}

const tuning = {
  throwHeight: 2.5,
  throwForward: 0,
  throwRotation: 3.9,
  dieWeight: 3,
  rotationFriction: 0,
  groundSlipperiness: 0,
  dieSlipperiness: 1,
};

const vectors = [
  ['seed-a', 6],
  ['seed-b', 8],
  ['seed-c', 12],
  ['seed-d', 20],
];

for (const [seed, sides] of vectors) {
  const before = capture(seed, sides, tuning);
  const after = capture(seed, sides, tuning);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`Deterministic mismatch for d${sides} ${seed}`);
  }
}

console.log('deterministic snapshot checks passed');
