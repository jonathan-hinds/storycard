(function initDiceEngine(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.DiceEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TWO_PI = Math.PI * 2;
  const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
  const SUPPORTED_SIDES = new Set([6, 8, 12, 20]);

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function normalizeSides(input) {
    const sides = Number.parseInt(input, 10);
    if (!Number.isFinite(sides) || !SUPPORTED_SIDES.has(sides)) {
      throw new Error('Supported dice are D6, D8, D12, and D20.');
    }
    return sides;
  }

  function normalizeVector(v) {
    const length = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  }

  function normalizeQuat(q) {
    const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= length; q.y /= length; q.z /= length; q.w /= length;
    return q;
  }

  function mulQuat(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  function integrateQuaternion(q, wx, wy, wz, dt) {
    const halfDt = dt * 0.5;
    const dq = { x: wx * halfDt, y: wy * halfDt, z: wz * halfDt, w: 0 };
    const next = mulQuat(dq, q);
    q.x += next.x;
    q.y += next.y;
    q.z += next.z;
    q.w += next.w;
    return normalizeQuat(q);
  }

  function rotateVectorByQuat(v, q) {
    const x = v.x; const y = v.y; const z = v.z;
    const qx = q.x; const qy = q.y; const qz = q.z; const qw = q.w;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    return {
      x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
      y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
      z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
    };
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
  function createSeededRandom(seedText) { return mulberry32(xmur3(String(seedText))()); }

  function getFaceNormals(sides) {
    const phi = GOLDEN_RATIO;
    const invPhi = 1 / phi;
    if (sides === 6) return [
      { value: 3, normal: { x: 1, y: 0, z: 0 } },
      { value: 4, normal: { x: -1, y: 0, z: 0 } },
      { value: 1, normal: { x: 0, y: 1, z: 0 } },
      { value: 6, normal: { x: 0, y: -1, z: 0 } },
      { value: 2, normal: { x: 0, y: 0, z: 1 } },
      { value: 5, normal: { x: 0, y: 0, z: -1 } },
    ];
    if (sides === 8) {
      const normals = []; let value = 1;
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        normals.push({ value, normal: normalizeVector({ x, y, z }) }); value += 1;
      }
      return normals;
    }
    if (sides === 12) return [
      { value: 1, normal: normalizeVector({ x: 0, y: 1, z: phi }) },
      { value: 2, normal: normalizeVector({ x: 0, y: 1, z: -phi }) },
      { value: 3, normal: normalizeVector({ x: 0, y: -1, z: phi }) },
      { value: 4, normal: normalizeVector({ x: 0, y: -1, z: -phi }) },
      { value: 5, normal: normalizeVector({ x: 1, y: phi, z: 0 }) },
      { value: 6, normal: normalizeVector({ x: 1, y: -phi, z: 0 }) },
      { value: 7, normal: normalizeVector({ x: -1, y: phi, z: 0 }) },
      { value: 8, normal: normalizeVector({ x: -1, y: -phi, z: 0 }) },
      { value: 9, normal: normalizeVector({ x: phi, y: 0, z: 1 }) },
      { value: 10, normal: normalizeVector({ x: phi, y: 0, z: -1 }) },
      { value: 11, normal: normalizeVector({ x: -phi, y: 0, z: 1 }) },
      { value: 12, normal: normalizeVector({ x: -phi, y: 0, z: -1 }) },
    ];
    if (sides === 20) {
      const pts = [
        { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: -1, z: -1 },
        { x: -1, y: 1, z: 1 }, { x: -1, y: 1, z: -1 }, { x: -1, y: -1, z: 1 }, { x: -1, y: -1, z: -1 },
        { x: 0, y: invPhi, z: phi }, { x: 0, y: invPhi, z: -phi }, { x: 0, y: -invPhi, z: phi }, { x: 0, y: -invPhi, z: -phi },
        { x: invPhi, y: phi, z: 0 }, { x: invPhi, y: -phi, z: 0 }, { x: -invPhi, y: phi, z: 0 }, { x: -invPhi, y: -phi, z: 0 },
        { x: phi, y: 0, z: invPhi }, { x: phi, y: 0, z: -invPhi }, { x: -phi, y: 0, z: invPhi }, { x: -phi, y: 0, z: -invPhi },
      ];
      return pts.map((p, i) => ({ value: i + 1, normal: normalizeVector(p) }));
    }
    return [];
  }

  function topFaceInfo(orientation, sides) {
    const up = { x: 0, y: 1, z: 0 };
    let winner = null;
    let bestDot = Number.NEGATIVE_INFINITY;
    for (const face of getFaceNormals(sides)) {
      const worldNormal = rotateVectorByQuat(face.normal, orientation);
      const dot = worldNormal.x * up.x + worldNormal.y * up.y + worldNormal.z * up.z;
      if (dot > bestDot) {
        bestDot = dot;
        winner = { value: face.value, normal: worldNormal, alignment: dot };
      }
    }
    return winner;
  }

  function dieVertices(sides) {
    const phi = GOLDEN_RATIO;
    const invPhi = 1 / phi;
    if (sides === 6) {
      const a = 0.675;
      return [
        { x: -a, y: -a, z: -a }, { x: a, y: -a, z: -a }, { x: a, y: a, z: -a }, { x: -a, y: a, z: -a },
        { x: -a, y: -a, z: a }, { x: a, y: -a, z: a }, { x: a, y: a, z: a }, { x: -a, y: a, z: a },
      ];
    }
    if (sides === 8) {
      const a = 1;
      return [{ x: a, y: 0, z: 0 }, { x: -a, y: 0, z: 0 }, { x: 0, y: a, z: 0 }, { x: 0, y: -a, z: 0 }, { x: 0, y: 0, z: a }, { x: 0, y: 0, z: -a }];
    }
    if (sides === 12) {
      const vertices = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) vertices.push({ x: sx, y: sy, z: sz });
      for (const sy of [-invPhi, invPhi]) for (const sz of [-phi, phi]) vertices.push({ x: 0, y: sy, z: sz });
      for (const sx of [-invPhi, invPhi]) for (const sy of [-phi, phi]) vertices.push({ x: sx, y: sy, z: 0 });
      for (const sx of [-phi, phi]) for (const sz of [-invPhi, invPhi]) vertices.push({ x: sx, y: 0, z: sz });
      return vertices.map((v) => ({ x: v.x * 0.8, y: v.y * 0.8, z: v.z * 0.8 }));
    }
    if (sides === 20) {
      const vertices = [];
      for (const sy of [-1, 1]) for (const sz of [-phi, phi]) vertices.push({ x: 0, y: sy, z: sz });
      for (const sx of [-1, 1]) for (const sy of [-phi, phi]) vertices.push({ x: sx, y: sy, z: 0 });
      for (const sx of [-phi, phi]) for (const sz of [-1, 1]) vertices.push({ x: sx, y: 0, z: sz });
      return vertices.map((v) => ({ x: v.x * 0.72, y: v.y * 0.72, z: v.z * 0.72 }));
    }
    return [];
  }

  class PhysicsWorld {
    constructor({ areaSize = 8, gravity = -18, fixedDt = 1 / 60, maxSubSteps = 5, debug = false } = {}) {
      this.areaSize = areaSize;
      this.gravity = gravity;
      this.fixedDt = fixedDt;
      this.maxSubSteps = maxSubSteps;
      this.debug = debug;
      const half = areaSize / 2 - 0.4;
      this.planes = [
        { id: 'ground', n: { x: 0, y: 1, z: 0 }, offset: 0 },
        { id: 'north', n: { x: 0, y: 0, z: -1 }, offset: -half },
        { id: 'south', n: { x: 0, y: 0, z: 1 }, offset: -half },
        { id: 'east', n: { x: -1, y: 0, z: 0 }, offset: -half },
        { id: 'west', n: { x: 1, y: 0, z: 0 }, offset: -half },
      ];
    }

    step(entity, dt) {
      const steps = Math.min(this.maxSubSteps, Math.max(1, Math.ceil(dt / this.fixedDt)));
      const subDt = dt / steps;
      let totalContacts = 0;
      for (let s = 0; s < steps; s += 1) {
        entity.velocity.y += this.gravity * subDt;
        entity.velocity.x *= 1 - entity.linearDamping * subDt;
        entity.velocity.y *= 1 - entity.linearDamping * subDt;
        entity.velocity.z *= 1 - entity.linearDamping * subDt;
        entity.angularVelocity.x *= 1 - entity.angularDamping * subDt;
        entity.angularVelocity.y *= 1 - entity.angularDamping * subDt;
        entity.angularVelocity.z *= 1 - entity.angularDamping * subDt;

        entity.position.x += entity.velocity.x * subDt;
        entity.position.y += entity.velocity.y * subDt;
        entity.position.z += entity.velocity.z * subDt;
        integrateQuaternion(entity.orientation, entity.angularVelocity.x, entity.angularVelocity.y, entity.angularVelocity.z, subDt);

        totalContacts += this.solveContacts(entity, subDt);
      }
      return totalContacts;
    }

    solveContacts(entity) {
      const worldVerts = entity.worldVertices();
      let contacts = 0;
      for (const plane of this.planes) {
        for (const vw of worldVerts) {
          const dist = plane.n.x * vw.x + plane.n.y * vw.y + plane.n.z * vw.z + plane.offset;
          if (dist >= 0) continue;
          contacts += 1;
          const r = { x: vw.x - entity.position.x, y: vw.y - entity.position.y, z: vw.z - entity.position.z };
          const wxr = {
            x: entity.angularVelocity.y * r.z - entity.angularVelocity.z * r.y,
            y: entity.angularVelocity.z * r.x - entity.angularVelocity.x * r.z,
            z: entity.angularVelocity.x * r.y - entity.angularVelocity.y * r.x,
          };
          const rv = { x: entity.velocity.x + wxr.x, y: entity.velocity.y + wxr.y, z: entity.velocity.z + wxr.z };
          const vn = rv.x * plane.n.x + rv.y * plane.n.y + rv.z * plane.n.z;
          if (vn < 0 || dist < -0.001) {
            const rn = {
              x: r.y * plane.n.z - r.z * plane.n.y,
              y: r.z * plane.n.x - r.x * plane.n.z,
              z: r.x * plane.n.y - r.y * plane.n.x,
            };
            const invInertiaRn = {
              x: rn.x * entity.invInertia.x,
              y: rn.y * entity.invInertia.y,
              z: rn.z * entity.invInertia.z,
            };
            const k = entity.invMass + plane.n.x * (invInertiaRn.y * r.z - invInertiaRn.z * r.y)
              + plane.n.y * (invInertiaRn.z * r.x - invInertiaRn.x * r.z)
              + plane.n.z * (invInertiaRn.x * r.y - invInertiaRn.y * r.x);
            const impulseN = Math.max(0, (-(1 + entity.restitution) * vn + (-dist * 25)) / (k || 1));
            entity.applyImpulse(plane.n, impulseN, r);

            const tangent = {
              x: rv.x - vn * plane.n.x,
              y: rv.y - vn * plane.n.y,
              z: rv.z - vn * plane.n.z,
            };
            const tLen = Math.hypot(tangent.x, tangent.y, tangent.z);
            if (tLen > 1e-6) {
              const tx = tangent.x / tLen; const ty = tangent.y / tLen; const tz = tangent.z / tLen;
              const vt = rv.x * tx + rv.y * ty + rv.z * tz;
              const jt = clamp(-vt / (entity.invMass || 1), -entity.friction * impulseN, entity.friction * impulseN);
              entity.applyImpulse({ x: tx, y: ty, z: tz }, jt, r);
            }
          }
        }
      }
      return contacts;
    }
  }

  class DieEntity {
    constructor({ sides, random, areaSize }) {
      this.sides = sides;
      this.vertices = dieVertices(sides);
      const half = areaSize / 2;
      this.position = { x: (random() * 2 - 1) * areaSize * 0.08, y: 2 + random() * 0.6, z: (random() * 2 - 1) * areaSize * 0.08 };
      this.orientation = normalizeQuat({ x: random() * 0.4, y: random() * 0.4, z: random() * 0.4, w: 1 });
      this.velocity = { x: (random() * 2 - 1) * 6, y: 0, z: (random() * 2 - 1) * 6 };
      this.angularVelocity = { x: (random() * 2 - 1) * 18, y: (random() * 2 - 1) * 18, z: (random() * 2 - 1) * 18 };
      this.mass = 1;
      this.invMass = 1 / this.mass;
      const bounds = this.vertices.reduce((acc, v) => ({
        minX: Math.min(acc.minX, v.x), maxX: Math.max(acc.maxX, v.x),
        minY: Math.min(acc.minY, v.y), maxY: Math.max(acc.maxY, v.y),
        minZ: Math.min(acc.minZ, v.z), maxZ: Math.max(acc.maxZ, v.z),
      }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
      const sx = bounds.maxX - bounds.minX; const sy = bounds.maxY - bounds.minY; const sz = bounds.maxZ - bounds.minZ;
      this.invInertia = {
        x: 12 / (this.mass * (sy * sy + sz * sz)),
        y: 12 / (this.mass * (sx * sx + sz * sz)),
        z: 12 / (this.mass * (sx * sx + sy * sy)),
      };
      this.friction = 0.42;
      this.restitution = 0.12;
      this.linearDamping = 0.28;
      this.angularDamping = 0.42;
      this.sleepLinearThreshold = 0.1;
      this.sleepAngularThreshold = 0.2;
      this.sleepFrames = 0;
      this.maxX = half - 0.2;
      this.maxZ = half - 0.2;
    }

    worldVertices() {
      return this.vertices.map((v) => {
        const r = rotateVectorByQuat(v, this.orientation);
        return { x: this.position.x + r.x, y: this.position.y + r.y, z: this.position.z + r.z };
      });
    }

    applyImpulse(direction, impulse, r) {
      this.velocity.x += direction.x * impulse * this.invMass;
      this.velocity.y += direction.y * impulse * this.invMass;
      this.velocity.z += direction.z * impulse * this.invMass;
      const torque = {
        x: r.y * direction.z - r.z * direction.y,
        y: r.z * direction.x - r.x * direction.z,
        z: r.x * direction.y - r.y * direction.x,
      };
      this.angularVelocity.x += torque.x * impulse * this.invInertia.x;
      this.angularVelocity.y += torque.y * impulse * this.invInertia.y;
      this.angularVelocity.z += torque.z * impulse * this.invInertia.z;
    }

    settleInfo(contactPoints) {
      const linearSpeed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
      const angularSpeed = Math.hypot(this.angularVelocity.x, this.angularVelocity.y, this.angularVelocity.z);
      const minGroundDist = Math.min(...this.worldVertices().map((v) => v.y));
      const top = topFaceInfo(this.orientation, this.sides);
      return {
        linearSpeed,
        angularSpeed,
        minGroundDist,
        topDot: top.alignment,
        topValue: top.value,
        contactPoints,
      };
    }
  }

  class DebugRenderer {
    constructor(enabled) { this.enabled = enabled; this.logs = []; }
    log(msg) { if (this.enabled) this.logs.push(msg); }
  }

  class DieRoller {
    constructor({ sides, seed, areaSize, debug }) {
      this.random = createSeededRandom(seed);
      this.world = new PhysicsWorld({ areaSize, debug });
      this.die = new DieEntity({ sides, random: this.random, areaSize });
      this.debug = new DebugRenderer(debug);
    }

    run() {
      const frames = [];
      const dt = this.world.fixedDt;
      const maxFrames = 1500;
      let settled = false;
      let finalDiagnostics = null;

      for (let i = 0; i < maxFrames; i += 1) {
        const contacts = this.world.step(this.die, dt);
        const info = this.die.settleInfo(contacts);

        const linearOk = info.linearSpeed < this.die.sleepLinearThreshold;
        const angularOk = info.angularSpeed < this.die.sleepAngularThreshold;
        const noPenetration = info.minGroundDist > -0.002;
        const hasGroundContact = info.contactPoints > 0 || info.minGroundDist < 0.02;
        if (linearOk && angularOk && noPenetration && hasGroundContact) this.die.sleepFrames += 1;
        else this.die.sleepFrames = 0;

        frames.push({
          step: i,
          x: Number(this.die.position.x.toFixed(4)),
          y: Number(this.die.position.y.toFixed(4)),
          z: Number(this.die.position.z.toFixed(4)),
          vx: Number(this.die.velocity.x.toFixed(4)),
          vy: Number(this.die.velocity.y.toFixed(4)),
          vz: Number(this.die.velocity.z.toFixed(4)),
          wx: Number(this.die.angularVelocity.x.toFixed(4)),
          wy: Number(this.die.angularVelocity.y.toFixed(4)),
          wz: Number(this.die.angularVelocity.z.toFixed(4)),
          qx: Number(this.die.orientation.x.toFixed(6)),
          qy: Number(this.die.orientation.y.toFixed(6)),
          qz: Number(this.die.orientation.z.toFixed(6)),
          qw: Number(this.die.orientation.w.toFixed(6)),
        });

        if (this.die.sleepFrames >= 24 && i > 40) {
          finalDiagnostics = info;
          this.debug.log(`settled frame=${i} pos=(${this.die.position.x.toFixed(3)},${this.die.position.y.toFixed(3)},${this.die.position.z.toFixed(3)}) lin=${info.linearSpeed.toFixed(4)} ang=${info.angularSpeed.toFixed(4)} dotUp=${info.topDot.toFixed(4)} contacts=${info.contactPoints}`);
          settled = true;
          break;
        }
      }

      if (!finalDiagnostics) {
        finalDiagnostics = this.die.settleInfo(0);
        const fallbackSettled = finalDiagnostics.linearSpeed < this.die.sleepLinearThreshold
          && finalDiagnostics.angularSpeed < this.die.sleepAngularThreshold
          && finalDiagnostics.minGroundDist > -0.002
          && finalDiagnostics.topDot > 0.92;
        if (fallbackSettled) {
          settled = true;
          this.debug.log(`settled-fallback pos=(${this.die.position.x.toFixed(3)},${this.die.position.y.toFixed(3)},${this.die.position.z.toFixed(3)}) lin=${finalDiagnostics.linearSpeed.toFixed(4)} ang=${finalDiagnostics.angularSpeed.toFixed(4)} dotUp=${finalDiagnostics.topDot.toFixed(4)} contacts=${finalDiagnostics.contactPoints}`);
        }
      }
      if (finalDiagnostics.topDot < 0.95) {
        const before = topFaceInfo(this.die.orientation, this.die.sides);
        const axis = { x: before.normal.z, y: 0, z: -before.normal.x };
        const axisLen = Math.hypot(axis.x, axis.y, axis.z);
        if (axisLen > 1e-6) {
          const angle = Math.acos(clamp(before.alignment, -1, 1));
          const s = Math.sin(angle / 2) / axisLen;
          const correction = normalizeQuat({ x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) });
          this.die.orientation = normalizeQuat(mulQuat(correction, this.die.orientation));
          this.die.velocity = { x: 0, y: 0, z: 0 };
          this.die.angularVelocity = { x: 0, y: 0, z: 0 };
        }
      }

      const top = topFaceInfo(this.die.orientation, this.die.sides);
      const last = frames[frames.length - 1];
      if (last) {
        last.qx = Number(this.die.orientation.x.toFixed(6));
        last.qy = Number(this.die.orientation.y.toFixed(6));
        last.qz = Number(this.die.orientation.z.toFixed(6));
        last.qw = Number(this.die.orientation.w.toFixed(6));
      }

      return {
        frames,
        outcome: top.value,
        settled,
        diagnostics: {
          finalPosition: { ...this.die.position },
          finalVelocity: { ...this.die.velocity },
          finalAngularVelocity: { ...this.die.angularVelocity },
          topDotUp: top.alignment,
          topFaceValue: top.value,
          contactPoints: finalDiagnostics.contactPoints,
          logs: this.debug.logs,
          world: {
            gravity: this.world.gravity,
            fixedDt: this.world.fixedDt,
            maxSubSteps: this.world.maxSubSteps,
            colliders: this.world.planes.map((p) => ({ id: p.id, normal: p.n, offset: p.offset })),
          },
          collider: {
            type: 'convex',
            vertexCount: this.die.vertices.length,
            sides: this.die.sides,
          },
        },
      };
    }
  }

  function simulateRoll(options) {
    const sides = normalizeSides(options.sides);
    const seed = String(options.seed || Date.now());
    const areaSize = Number.isFinite(options.areaSize) ? options.areaSize : 8;
    const debug = Boolean(options.debug);
    const roller = new DieRoller({ sides, seed, areaSize, debug });
    const result = roller.run();
    return {
      seed,
      sides,
      areaSize,
      dt: roller.world.fixedDt,
      frames: result.frames,
      outcome: result.outcome,
      metadata: {
        totalFrames: result.frames.length,
        settled: result.settled,
        diagnostics: result.diagnostics,
      },
    };
  }

  return { normalizeSides, createSeededRandom, simulateRoll };
});
