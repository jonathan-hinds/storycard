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
  const WORLD_UP = { x: 0, y: 1, z: 0 };
  const DEFAULT_ROLL_CONFIG = {
    startLinSpeedMin: 1.2,
    startLinSpeedMax: 2.2,
    startAngSpeedMin: 2.1,
    startAngSpeedMax: 5.4,
    maxLinVel: 3.1,
    maxAngVel: 7.2,
    settledLinearEps: 0.085,
    settledAngularEps: 0.16,
    settledFramesRequired: 28,
    alignDurationMsMin: 100,
    alignDurationMsMax: 250,
    alignEpsilon: 1e-4,
  };

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

  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  function mulQuat(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  function quatFromAxisAngle(axis, angle) {
    const half = angle * 0.5;
    const s = Math.sin(half);
    return normalizeQuat({ x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) });
  }

  function quatFromTo(from, to) {
    const f = normalizeVector(from);
    const t = normalizeVector(to);
    const d = clamp(dot(f, t), -1, 1);
    if (d > 1 - 1e-8) return { x: 0, y: 0, z: 0, w: 1 };
    if (d < -1 + 1e-8) {
      const ortho = Math.abs(f.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
      const axis = normalizeVector(cross(f, ortho));
      return quatFromAxisAngle(axis, Math.PI);
    }
    const axis = cross(f, t);
    return normalizeQuat({ x: axis.x, y: axis.y, z: axis.z, w: 1 + d });
  }

  function slerpQuat(a, b, t) {
    let cosHalfTheta = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let bb = b;
    if (cosHalfTheta < 0) {
      cosHalfTheta = -cosHalfTheta;
      bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    }
    if (cosHalfTheta > 0.9995) {
      return normalizeQuat({
        x: a.x + t * (bb.x - a.x),
        y: a.y + t * (bb.y - a.y),
        z: a.z + t * (bb.z - a.z),
        w: a.w + t * (bb.w - a.w),
      });
    }
    const halfTheta = Math.acos(clamp(cosHalfTheta, -1, 1));
    const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
    return {
      x: a.x * ratioA + bb.x * ratioB,
      y: a.y * ratioA + bb.y * ratioB,
      z: a.z * ratioA + bb.z * ratioB,
      w: a.w * ratioA + bb.w * ratioB,
    };
  }

  function limitVectorMagnitude(v, maxMagnitude) {
    const magnitude = Math.hypot(v.x, v.y, v.z);
    if (magnitude <= maxMagnitude || magnitude < 1e-9) return magnitude;
    const scale = maxMagnitude / magnitude;
    v.x *= scale;
    v.y *= scale;
    v.z *= scale;
    return maxMagnitude;
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
    let winner = null;
    let bestDot = Number.NEGATIVE_INFINITY;
    for (const face of getFaceNormals(sides)) {
      const worldNormal = rotateVectorByQuat(face.normal, orientation);
      const alignment = dot(worldNormal, WORLD_UP);
      if (alignment > bestDot) {
        bestDot = alignment;
        winner = { value: face.value, normal: worldNormal, alignment, localNormal: face.normal };
      }
    }
    return winner;
  }

  function alignmentTargetForTopFace(orientation, sides) {
    const winner = topFaceInfo(orientation, sides);
    const currentTopWorld = rotateVectorByQuat(winner.localNormal, orientation);
    const correction = quatFromTo(currentTopWorld, WORLD_UP);
    return {
      winner,
      targetOrientation: normalizeQuat(mulQuat(correction, orientation)),
    };
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
          if (dist < 0) {
            const correction = Math.min(0.03, -dist * 0.35);
            entity.position.x += plane.n.x * correction;
            entity.position.y += plane.n.y * correction;
            entity.position.z += plane.n.z * correction;
          }

          if (vn < 0) {
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
            const impulseN = Math.max(0, (-(1 + entity.restitution) * vn) / (k || 1));
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
    constructor({ sides, random, areaSize, rollConfig }) {
      this.sides = sides;
      this.random = random;
      this.rollConfig = rollConfig;
      this.vertices = dieVertices(sides);
      const half = areaSize / 2;
      this.position = { x: (random() * 2 - 1) * areaSize * 0.08, y: 2 + random() * 0.6, z: (random() * 2 - 1) * areaSize * 0.08 };
      this.orientation = normalizeQuat({ x: random() * 0.4, y: random() * 0.4, z: random() * 0.4, w: 1 });
      this.velocity = { x: 0, y: 0, z: 0 };
      this.angularVelocity = { x: 0, y: 0, z: 0 };
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
      this.friction = 0.56;
      this.restitution = 0.06;
      this.linearDamping = 0.45;
      this.angularDamping = 0.68;
      this.sleepLinearThreshold = rollConfig.settledLinearEps;
      this.sleepAngularThreshold = rollConfig.settledAngularEps;
      this.sleepFrames = 0;
      this.maxX = half - 0.2;
      this.maxZ = half - 0.2;
    }

    applyInitialRollImpulse() {
      const linSpeed = this.rollConfig.startLinSpeedMin + (this.rollConfig.startLinSpeedMax - this.rollConfig.startLinSpeedMin) * this.random();
      const linAngle = this.random() * TWO_PI;
      this.velocity = {
        x: Math.cos(linAngle) * linSpeed,
        y: 0,
        z: Math.sin(linAngle) * linSpeed,
      };
      const axis = normalizeVector({ x: this.random() * 2 - 1, y: this.random() * 2 - 1, z: this.random() * 2 - 1 });
      const angSpeed = this.rollConfig.startAngSpeedMin + (this.rollConfig.startAngSpeedMax - this.rollConfig.startAngSpeedMin) * this.random();
      this.angularVelocity = { x: axis.x * angSpeed, y: axis.y * angSpeed, z: axis.z * angSpeed };
      const initLin = limitVectorMagnitude(this.velocity, this.rollConfig.maxLinVel);
      const initAng = limitVectorMagnitude(this.angularVelocity, this.rollConfig.maxAngVel);
      return { initLin, initAng };
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
      this.rollConfig = { ...DEFAULT_ROLL_CONFIG };
      this.world = new PhysicsWorld({ areaSize, debug });
      this.die = new DieEntity({ sides, random: this.random, areaSize, rollConfig: this.rollConfig });
      this.debug = new DebugRenderer(debug);
    }

    run() {
      const frames = [];
      const dt = this.world.fixedDt;
      const maxFrames = 900;
      let settled = false;
      let finalDiagnostics = null;
      const initialSpeeds = this.die.applyInitialRollImpulse();
      this.debug.log(`roll-start lin=${initialSpeeds.initLin.toFixed(4)} ang=${initialSpeeds.initAng.toFixed(4)} cfg=${JSON.stringify(this.rollConfig)}`);
      let maxObservedLin = initialSpeeds.initLin;
      let maxObservedAng = initialSpeeds.initAng;
      let settledFrame = -1;

      for (let i = 0; i < maxFrames; i += 1) {
        const contacts = this.world.step(this.die, dt);
        limitVectorMagnitude(this.die.velocity, this.rollConfig.maxLinVel);
        limitVectorMagnitude(this.die.angularVelocity, this.rollConfig.maxAngVel);
        const info = this.die.settleInfo(contacts);
        maxObservedLin = Math.max(maxObservedLin, info.linearSpeed);
        maxObservedAng = Math.max(maxObservedAng, info.angularSpeed);

        const linearOk = info.linearSpeed < this.die.sleepLinearThreshold;
        const angularOk = info.angularSpeed < this.die.sleepAngularThreshold;
        const noPenetration = info.minGroundDist > -0.02;
        const hasGroundContact = info.contactPoints > 0 || info.minGroundDist < 0.02;
        if (linearOk && angularOk && noPenetration && hasGroundContact) this.die.sleepFrames += 1;
        else this.die.sleepFrames = 0;

        if (i > 420) {
          this.die.velocity.x *= 0.985;
          this.die.velocity.y *= 0.985;
          this.die.velocity.z *= 0.985;
          this.die.angularVelocity.x *= 0.98;
          this.die.angularVelocity.y *= 0.98;
          this.die.angularVelocity.z *= 0.98;
        }

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

        if (this.die.sleepFrames >= this.rollConfig.settledFramesRequired && i > 40) {
          finalDiagnostics = info;
          this.debug.log(`settled frame=${i} pos=(${this.die.position.x.toFixed(3)},${this.die.position.y.toFixed(3)},${this.die.position.z.toFixed(3)}) lin=${info.linearSpeed.toFixed(4)} ang=${info.angularSpeed.toFixed(4)} dotUp=${info.topDot.toFixed(4)} contacts=${info.contactPoints}`);
          settled = true;
          settledFrame = i;
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
      const beforeAlignment = topFaceInfo(this.die.orientation, this.die.sides);
      const { targetOrientation, winner } = alignmentTargetForTopFace(this.die.orientation, this.die.sides);
      const speedBeforeAlign = this.die.settleInfo(finalDiagnostics?.contactPoints || 0);
      this.debug.log(`settle-confirmed type=d${this.die.sides} value=${winner.value} topDotBefore=${beforeAlignment.alignment.toFixed(6)} lin=${speedBeforeAlign.linearSpeed.toFixed(6)} ang=${speedBeforeAlign.angularSpeed.toFixed(6)}`);

      this.die.velocity = { x: 0, y: 0, z: 0 };
      this.die.angularVelocity = { x: 0, y: 0, z: 0 };

      const startOrientation = { ...this.die.orientation };
      const alignDurationMs = this.rollConfig.alignDurationMsMin
        + (this.rollConfig.alignDurationMsMax - this.rollConfig.alignDurationMsMin) * this.random();
      const alignFrames = Math.max(2, Math.round((alignDurationMs / 1000) / dt));
      for (let a = 1; a <= alignFrames; a += 1) {
        const t = a / alignFrames;
        this.die.orientation = slerpQuat(startOrientation, targetOrientation, t);
        frames.push({
          step: frames.length,
          x: Number(this.die.position.x.toFixed(4)),
          y: Number(this.die.position.y.toFixed(4)),
          z: Number(this.die.position.z.toFixed(4)),
          vx: 0,
          vy: 0,
          vz: 0,
          wx: 0,
          wy: 0,
          wz: 0,
          qx: Number(this.die.orientation.x.toFixed(6)),
          qy: Number(this.die.orientation.y.toFixed(6)),
          qz: Number(this.die.orientation.z.toFixed(6)),
          qw: Number(this.die.orientation.w.toFixed(6)),
        });
      }

      const top = topFaceInfo(this.die.orientation, this.die.sides);
      this.debug.log(`alignment-complete type=d${this.die.sides} value=${top.value} topDotAfter=${top.alignment.toFixed(6)} epsilon=${this.rollConfig.alignEpsilon}`);
      this.debug.log(`roll-stats durationFrames=${settledFrame >= 0 ? settledFrame + 1 : frames.length} durationMs=${((settledFrame >= 0 ? settledFrame + 1 : frames.length) * dt * 1000).toFixed(1)} maxLin=${maxObservedLin.toFixed(4)} maxAng=${maxObservedAng.toFixed(4)}`);

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
          topFaceNormal: top.normal,
          alignmentEpsilon: this.rollConfig.alignEpsilon,
          rollConfig: this.rollConfig,
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
