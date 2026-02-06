(function initDiceEngine(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.DiceEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TWO_PI = Math.PI * 2;

  function normalizeSides(input) {
    const sides = Number.parseInt(input, 10);
    if (!Number.isFinite(sides) || sides < 3) {
      throw new Error('A die must have at least 3 sides.');
    }
    return sides;
  }

  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i += 1) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function hash() {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(a) {
    return function random() {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createSeededRandom(seedText) {
    const seedFn = xmur3(String(seedText));
    return mulberry32(seedFn());
  }

  function normalizeAngle(angle) {
    let next = angle % TWO_PI;
    if (next < 0) {
      next += TWO_PI;
    }
    return next;
  }

  function angleToOutcome(angle, sides) {
    const slice = TWO_PI / sides;
    const normalized = normalizeAngle(angle + slice / 2);
    return (Math.floor(normalized / slice) % sides) + 1;
  }

  function simulateRoll(options) {
    const sides = normalizeSides(options.sides);
    const seed = String(options.seed || Date.now());
    const areaSize = Number.isFinite(options.areaSize) ? options.areaSize : 8;
    const steps = Number.isFinite(options.steps) ? options.steps : 200;
    const dt = Number.isFinite(options.dt) ? options.dt : 1 / 60;

    const rng = createSeededRandom(seed);
    const halfArea = areaSize / 2;
    const min = -halfArea + 0.5;
    const max = halfArea - 0.5;

    let px = (rng() * 2 - 1) * (areaSize * 0.2);
    let py = (rng() * 2 - 1) * (areaSize * 0.2);
    let vx = (rng() * 2 - 1) * 7;
    let vy = (rng() * 2 - 1) * 7;
    let angle = rng() * TWO_PI;
    let angularV = (rng() * 2 - 1) * 20;

    const frames = [];

    for (let i = 0; i < steps; i += 1) {
      px += vx * dt;
      py += vy * dt;
      angle = normalizeAngle(angle + angularV * dt);

      let bounced = false;
      if (px < min) {
        px = min;
        vx = Math.abs(vx) * 0.75;
        angularV *= 0.9;
        bounced = true;
      }
      if (px > max) {
        px = max;
        vx = -Math.abs(vx) * 0.75;
        angularV *= 0.9;
        bounced = true;
      }
      if (py < min) {
        py = min;
        vy = Math.abs(vy) * 0.75;
        angularV *= 0.9;
        bounced = true;
      }
      if (py > max) {
        py = max;
        vy = -Math.abs(vy) * 0.75;
        angularV *= 0.9;
        bounced = true;
      }

      const drag = bounced ? 0.94 : 0.97;
      vx *= drag;
      vy *= drag;
      angularV *= 0.965;

      if (Math.abs(vx) < 0.02) vx = 0;
      if (Math.abs(vy) < 0.02) vy = 0;
      if (Math.abs(angularV) < 0.02) angularV = 0;

      frames.push({
        step: i,
        x: Number(px.toFixed(4)),
        y: Number(py.toFixed(4)),
        angle: Number(angle.toFixed(5)),
        vx: Number(vx.toFixed(4)),
        vy: Number(vy.toFixed(4)),
        angularV: Number(angularV.toFixed(4)),
      });

      if (vx === 0 && vy === 0 && angularV === 0 && i > 20) {
        break;
      }
    }

    const finalFrame = frames[frames.length - 1];
    const outcome = angleToOutcome(finalFrame.angle, sides);

    return {
      seed,
      sides,
      areaSize,
      dt,
      frames,
      outcome,
      metadata: {
        totalFrames: frames.length,
      },
    };
  }

  return {
    normalizeSides,
    normalizeAngle,
    angleToOutcome,
    createSeededRandom,
    simulateRoll,
  };
});
