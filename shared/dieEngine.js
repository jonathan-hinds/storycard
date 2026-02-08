(function initDiceEngine(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.DiceEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
  const SUPPORTED_SIDES = new Set([6, 8, 12, 20]);

  function normalizeSides(input) {
    const sides = Number.parseInt(input, 10);
    if (!Number.isFinite(sides) || !SUPPORTED_SIDES.has(sides)) {
      throw new Error('Supported dice are D6, D8, D12, and D20.');
    }
    return sides;
  }


  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeTuning(tuning = {}) {
    const throwHeight = Number.isFinite(tuning.throwHeight) ? tuning.throwHeight : 1;
    const throwForward = Number.isFinite(tuning.throwForward) ? tuning.throwForward : 1;
    const throwRotation = Number.isFinite(tuning.throwRotation) ? tuning.throwRotation : 1;
    const groundSlipperiness = Number.isFinite(tuning.groundSlipperiness) ? tuning.groundSlipperiness : 0;
    const dieSlipperiness = Number.isFinite(tuning.dieSlipperiness) ? tuning.dieSlipperiness : 0;

    return {
      throwHeight: clamp(throwHeight, 0.2, 6),
      throwForward: clamp(throwForward, 0, 6),
      throwRotation: clamp(throwRotation, 0, 6),
      groundSlipperiness: clamp(groundSlipperiness, 0, 1),
      dieSlipperiness: clamp(dieSlipperiness, 0, 1),
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

  function createSeededRandom(seedText) {
    return mulberry32(xmur3(String(seedText))());
  }

  function normalizeVector(v) {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  function normalizeQuat(q) {
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= len;
    q.y /= len;
    q.z /= len;
    q.w /= len;
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
        normals.push({ value, normal: normalizeVector({ x, y, z }) });
        value += 1;
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
      const normals = [
        { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: -1, z: -1 },
        { x: -1, y: 1, z: 1 }, { x: -1, y: 1, z: -1 }, { x: -1, y: -1, z: 1 }, { x: -1, y: -1, z: -1 },
        { x: 0, y: invPhi, z: phi }, { x: 0, y: invPhi, z: -phi }, { x: 0, y: -invPhi, z: phi }, { x: 0, y: -invPhi, z: -phi },
        { x: invPhi, y: phi, z: 0 }, { x: invPhi, y: -phi, z: 0 }, { x: -invPhi, y: phi, z: 0 }, { x: -invPhi, y: -phi, z: 0 },
        { x: phi, y: 0, z: invPhi }, { x: phi, y: 0, z: -invPhi }, { x: -phi, y: 0, z: invPhi }, { x: -phi, y: 0, z: -invPhi },
      ];
      return normals.map((normal, i) => ({ value: i + 1, normal: normalizeVector(normal) }));
    }
    return [];
  }

  class PhysicsWorld {
    constructor({ gravity = -14, fixedDt = 1 / 120, maxSubSteps = 2, debug = false } = {}) {
      this.gravity = gravity;
      this.fixedDt = fixedDt;
      this.maxSubSteps = maxSubSteps;
      this.debug = debug;
      this.accumulator = 0;
      this.bodies = [];
      this.staticColliders = [];
      this.lastContactCount = 0;
      this.contactEvents = [];
    }

    createDynamicBody(config) {
      const body = {
        position: { ...config.position },
        orientation: normalizeQuat({ ...config.orientation }),
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        vertices: config.vertices,
        mass: 1,
        invMass: 1,
        invInertia: config.invInertia,
        friction: Number.isFinite(config.friction) ? config.friction : 1.25,
        restitution: 0.03,
        linearDamping: 3.4,
        angularDamping: 8.2,
        ccdSweepRadius: 0.02,
      };
      this.bodies.push(body);
      return body;
    }

    createStaticGround(y = 0) {
      const ground = { id: 'ground', n: { x: 0, y: 1, z: 0 }, offset: -y };
      this.staticColliders.push(ground);
      return ground;
    }

    createStaticBoundary(size = 8) {
      const half = size / 2 - 0.35;
      this.staticColliders.push({ id: 'north', n: { x: 0, y: 0, z: -1 }, offset: half });
      this.staticColliders.push({ id: 'south', n: { x: 0, y: 0, z: 1 }, offset: half });
      this.staticColliders.push({ id: 'east', n: { x: -1, y: 0, z: 0 }, offset: half });
      this.staticColliders.push({ id: 'west', n: { x: 1, y: 0, z: 0 }, offset: half });
    }

    step(dt) {
      this.accumulator += dt;
      this.lastContactCount = 0;
      this.contactEvents = [];

      const maxFrameTime = this.fixedDt * this.maxSubSteps;
      if (this.accumulator > maxFrameTime) this.accumulator = maxFrameTime;

      while (this.accumulator >= this.fixedDt) {
        for (const body of this.bodies) {
          this.#stepBody(body, this.fixedDt);
        }
        this.accumulator -= this.fixedDt;
      }

      if (this.debug && this.contactEvents.length) {
        for (const evt of this.contactEvents) {
          console.log(`[physics-debug] contact collider=${evt.collider} penetration=${evt.penetration.toFixed(5)} normalSpeed=${evt.normalSpeed.toFixed(4)}`);
        }
      }
    }

    #stepBody(body, dt) {
      body.velocity.y += this.gravity * dt;
      const linearDecay = Math.max(0, 1 - body.linearDamping * dt);
      const angularDecay = Math.max(0, 1 - body.angularDamping * dt);
      body.velocity.x *= linearDecay;
      body.velocity.y *= linearDecay;
      body.velocity.z *= linearDecay;
      body.angularVelocity.x *= angularDecay;
      body.angularVelocity.y *= angularDecay;
      body.angularVelocity.z *= angularDecay;

      body.position.x += body.velocity.x * dt;
      body.position.y += body.velocity.y * dt;
      body.position.z += body.velocity.z * dt;
      integrateQuaternion(body.orientation, body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z, dt);

      const worldVertices = body.vertices.map((vertex) => {
        const rotated = rotateVectorByQuat(vertex, body.orientation);
        return {
          x: body.position.x + rotated.x,
          y: body.position.y + rotated.y,
          z: body.position.z + rotated.z,
        };
      });

      const applyImpulse = (direction, impulse, r) => {
        body.velocity.x += direction.x * impulse * body.invMass;
        body.velocity.y += direction.y * impulse * body.invMass;
        body.velocity.z += direction.z * impulse * body.invMass;
        const torque = {
          x: r.y * direction.z - r.z * direction.y,
          y: r.z * direction.x - r.x * direction.z,
          z: r.x * direction.y - r.y * direction.x,
        };
        body.angularVelocity.x += torque.x * impulse * body.invInertia.x;
        body.angularVelocity.y += torque.y * impulse * body.invInertia.y;
        body.angularVelocity.z += torque.z * impulse * body.invInertia.z;
      };

      for (const collider of this.staticColliders) {
        let deepestVertex = null;
        let deepestDistance = 0;
        for (const vertex of worldVertices) {
          const signedDistance = collider.n.x * vertex.x + collider.n.y * vertex.y + collider.n.z * vertex.z + collider.offset;
          if (signedDistance < deepestDistance) {
            deepestDistance = signedDistance;
            deepestVertex = vertex;
          }
        }
        if (!deepestVertex) continue;

        this.lastContactCount += 1;
        const signedDistance = deepestDistance;
        const r = {
          x: deepestVertex.x - body.position.x,
          y: deepestVertex.y - body.position.y,
          z: deepestVertex.z - body.position.z,
        };
        const wxr = {
          x: body.angularVelocity.y * r.z - body.angularVelocity.z * r.y,
          y: body.angularVelocity.z * r.x - body.angularVelocity.x * r.z,
          z: body.angularVelocity.x * r.y - body.angularVelocity.y * r.x,
        };
        const rv = {
          x: body.velocity.x + wxr.x,
          y: body.velocity.y + wxr.y,
          z: body.velocity.z + wxr.z,
        };

        const normalSpeed = rv.x * collider.n.x + rv.y * collider.n.y + rv.z * collider.n.z;
        if (normalSpeed < 0 || signedDistance < -0.0002) {
          const rn = {
            x: r.y * collider.n.z - r.z * collider.n.y,
            y: r.z * collider.n.x - r.x * collider.n.z,
            z: r.x * collider.n.y - r.y * collider.n.x,
          };
          const invInertiaRn = {
            x: rn.x * body.invInertia.x,
            y: rn.y * body.invInertia.y,
            z: rn.z * body.invInertia.z,
          };
          const rotationalK = collider.n.x * (invInertiaRn.y * r.z - invInertiaRn.z * r.y)
            + collider.n.y * (invInertiaRn.z * r.x - invInertiaRn.x * r.z)
            + collider.n.z * (invInertiaRn.x * r.y - invInertiaRn.y * r.x);
          const k = body.invMass + rotationalK;
          const baumgarteBias = Math.max(0, -signedDistance - 0.0005) * 10;
          const impulseN = Math.max(0, (-(1 + body.restitution) * normalSpeed + baumgarteBias) / (k || 1));
          applyImpulse(collider.n, impulseN, r);

          const tangent = {
            x: rv.x - normalSpeed * collider.n.x,
            y: rv.y - normalSpeed * collider.n.y,
            z: rv.z - normalSpeed * collider.n.z,
          };
          const tangentSpeed = Math.hypot(tangent.x, tangent.y, tangent.z);
          if (tangentSpeed > 1e-6) {
            const t = {
              x: tangent.x / tangentSpeed,
              y: tangent.y / tangentSpeed,
              z: tangent.z / tangentSpeed,
            };
            const vt = rv.x * t.x + rv.y * t.y + rv.z * t.z;
            const frictionImpulse = Math.max(-body.friction * impulseN, Math.min(body.friction * impulseN, -vt / (body.invMass || 1)));
            applyImpulse(t, frictionImpulse, r);
          }
        }

        const correction = Math.min(0.008, -signedDistance + 1e-4);
        body.position.x += collider.n.x * correction;
        body.position.y += collider.n.y * correction;
        body.position.z += collider.n.z * correction;

        this.contactEvents.push({ collider: collider.id, penetration: -signedDistance, normalSpeed });
      }
    }

  }
  class Die {
    constructor({ sides, random, world, areaSize, tuning }) {
      this.sides = sides;
      this.random = random;
      this.tuning = normalizeTuning(tuning);
      this.meshToBodyTransform = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      };
      this.vertices = dieVertices(sides);
      this.faceNormals = getFaceNormals(sides);
      const invInertia = this.#computeInertia(this.vertices);
      this.body = world.createDynamicBody({
        vertices: this.vertices,
        invInertia,
        position: { x: 0, y: 1.8, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        friction: 0.3 + (1 - this.tuning.dieSlipperiness) * 1.55,
      });
      this.areaSize = areaSize;
      this.rollApplied = false;
      this.maxLinearSpeed = 0;
      this.maxAngularSpeed = 0;
    }

    #computeInertia(vertices) {
      const bounds = vertices.reduce((acc, v) => ({
        minX: Math.min(acc.minX, v.x), maxX: Math.max(acc.maxX, v.x),
        minY: Math.min(acc.minY, v.y), maxY: Math.max(acc.maxY, v.y),
        minZ: Math.min(acc.minZ, v.z), maxZ: Math.max(acc.maxZ, v.z),
      }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
      const sx = bounds.maxX - bounds.minX;
      const sy = bounds.maxY - bounds.minY;
      const sz = bounds.maxZ - bounds.minZ;
      return {
        x: 12 / ((sy * sy + sz * sz) || 1),
        y: 12 / ((sx * sx + sz * sz) || 1),
        z: 12 / ((sx * sx + sy * sy) || 1),
      };
    }

    reset() {
      const spread = this.areaSize * 0.06;
      this.body.position.x = (this.random() * 2 - 1) * spread;
      this.body.position.y = 1.2 + this.random() * 0.2;
      this.body.position.z = (this.random() * 2 - 1) * spread;
      this.body.orientation = normalizeQuat({
        x: this.random() * 2 - 1,
        y: this.random() * 2 - 1,
        z: this.random() * 2 - 1,
        w: this.random() * 2 - 1,
      });
      this.body.velocity = { x: 0, y: 0, z: 0 };
      this.body.angularVelocity = { x: 0, y: 0, z: 0 };
      this.rollApplied = false;
      this.maxLinearSpeed = 0;
      this.maxAngularSpeed = 0;
    }

    roll() {
      if (this.rollApplied) return;
      const impulse = {
        x: (this.random() * 2 - 1) * 5.1 * this.tuning.throwForward,
        y: (1.7 + this.random() * 1.2) * this.tuning.throwHeight,
        z: (this.random() * 2 - 1) * 5.1 * this.tuning.throwForward,
      };
      const angularImpulse = {
        x: (this.random() * 2 - 1) * 7.8 * this.tuning.throwRotation,
        y: (this.random() * 2 - 1) * 7.8 * this.tuning.throwRotation,
        z: (this.random() * 2 - 1) * 7.8 * this.tuning.throwRotation,
      };

      this.body.velocity.x += impulse.x;
      this.body.velocity.y += impulse.y;
      this.body.velocity.z += impulse.z;
      this.body.angularVelocity.x += angularImpulse.x;
      this.body.angularVelocity.y += angularImpulse.y;
      this.body.angularVelocity.z += angularImpulse.z;

      const linearCap = 14.5 + (Math.max(this.tuning.throwHeight, this.tuning.throwForward) - 1) * 4.25;
      const angularCap = 24.0 + (this.tuning.throwRotation - 1) * 8.5;
      this.#clampVelocity(Math.max(14.5, linearCap), Math.max(24.0, angularCap));
      this.rollApplied = true;

      return {
        initialLinearSpeed: Math.hypot(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z),
        initialAngularSpeed: Math.hypot(this.body.angularVelocity.x, this.body.angularVelocity.y, this.body.angularVelocity.z),
      };
    }

    #clampVelocity(maxLinear, maxAngular) {
      const linear = Math.hypot(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z);
      if (linear > maxLinear) {
        const s = maxLinear / linear;
        this.body.velocity.x *= s;
        this.body.velocity.y *= s;
        this.body.velocity.z *= s;
      }
      const angular = Math.hypot(this.body.angularVelocity.x, this.body.angularVelocity.y, this.body.angularVelocity.z);
      if (angular > maxAngular) {
        const s = maxAngular / angular;
        this.body.angularVelocity.x *= s;
        this.body.angularVelocity.y *= s;
        this.body.angularVelocity.z *= s;
      }
    }

    getTopFace() {
      const up = { x: 0, y: 1, z: 0 };
      let winner = null;
      let bestDot = Number.NEGATIVE_INFINITY;
      for (const face of this.faceNormals) {
        const worldNormal = rotateVectorByQuat(face.normal, this.body.orientation);
        const dot = worldNormal.x * up.x + worldNormal.y * up.y + worldNormal.z * up.z;
        if (dot > bestDot) {
          bestDot = dot;
          winner = { value: face.value, alignment: dot };
        }
      }
      return winner;
    }

    getFrameSnapshot(step) {
      const linear = Math.hypot(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z);
      const angular = Math.hypot(this.body.angularVelocity.x, this.body.angularVelocity.y, this.body.angularVelocity.z);
      this.maxLinearSpeed = Math.max(this.maxLinearSpeed, linear);
      this.maxAngularSpeed = Math.max(this.maxAngularSpeed, angular);
      return {
        step,
        x: Number(this.body.position.x.toFixed(4)),
        y: Number(this.body.position.y.toFixed(4)),
        z: Number(this.body.position.z.toFixed(4)),
        vx: Number(this.body.velocity.x.toFixed(4)),
        vy: Number(this.body.velocity.y.toFixed(4)),
        vz: Number(this.body.velocity.z.toFixed(4)),
        wx: Number(this.body.angularVelocity.x.toFixed(4)),
        wy: Number(this.body.angularVelocity.y.toFixed(4)),
        wz: Number(this.body.angularVelocity.z.toFixed(4)),
        qx: Number(this.body.orientation.x.toFixed(6)),
        qy: Number(this.body.orientation.y.toFixed(6)),
        qz: Number(this.body.orientation.z.toFixed(6)),
        qw: Number(this.body.orientation.w.toFixed(6)),
      };
    }
  }

  class DiceRoller {
    constructor({ sides, seed, areaSize = 8, debug = false, tuning = {} }) {
      this.random = createSeededRandom(seed);
      this.tuning = normalizeTuning(tuning);
      this.physics = new PhysicsWorld({ debug });
      this.physics.createStaticGround(0);
      this.physics.createStaticBoundary(areaSize);
      this.die = new Die({ sides, random: this.random, world: this.physics, areaSize, tuning: this.tuning });
      this.debug = debug;
      this.logs = [];
    }

    run() {
      this.die.reset();
      const groundFriction = 0.25 + (1 - this.tuning.groundSlipperiness) * 1.25;
      this.die.body.friction = Math.max(0.05, (groundFriction + this.die.body.friction) * 0.5);
      const initial = this.die.roll();
      this.logs.push(`roll initial linear=${initial.initialLinearSpeed.toFixed(4)} angular=${initial.initialAngularSpeed.toFixed(4)}`);

      const frames = [];
      const outputDt = 1 / 60;
      const maxFrames = 900;
      let belowThresholdFrames = 0;
      let settled = false;

      for (let i = 0; i < maxFrames; i += 1) {
        this.physics.step(outputDt);
        frames.push(this.die.getFrameSnapshot(i));

        const linearSpeed = Math.hypot(this.die.body.velocity.x, this.die.body.velocity.y, this.die.body.velocity.z);
        const angularSpeed = Math.hypot(this.die.body.angularVelocity.x, this.die.body.angularVelocity.y, this.die.body.angularVelocity.z);
        const atRest = linearSpeed < 0.16 && angularSpeed < 0.28;
        const shouldForceSleep = i > 120 && linearSpeed < 0.25 && angularSpeed < 0.5;
        belowThresholdFrames = atRest ? belowThresholdFrames + 1 : 0;
        if ((belowThresholdFrames >= 18 && i > 45) || shouldForceSleep) {
          this.die.body.velocity.x = 0;
          this.die.body.velocity.y = 0;
          this.die.body.velocity.z = 0;
          this.die.body.angularVelocity.x = 0;
          this.die.body.angularVelocity.y = 0;
          this.die.body.angularVelocity.z = 0;
          frames.push(this.die.getFrameSnapshot(i + 1));
          settled = true;
          break;
        }
      }

      const topFace = this.die.getTopFace();
      const penetrationIssues = this.physics.contactEvents.filter((evt) => evt.penetration > 0.02).length;
      this.logs.push(`roll max linear=${this.die.maxLinearSpeed.toFixed(4)} angular=${this.die.maxAngularSpeed.toFixed(4)}`);
      this.logs.push(`roll contacts=${this.physics.lastContactCount} penetrationIssues=${penetrationIssues}`);

      return {
        frames,
        outcome: topFace.value,
        settled,
        diagnostics: {
          topDotUp: topFace.alignment,
          contactPoints: this.physics.lastContactCount,
          logs: this.logs,
          world: {
            gravity: this.physics.gravity,
            fixedDt: this.physics.fixedDt,
            maxSubSteps: this.physics.maxSubSteps,
            colliders: this.physics.staticColliders,
            groundFriction: 0.25 + (1 - this.tuning.groundSlipperiness) * 1.25,
            dieFriction: this.die.body.friction,
          },
          tuning: this.tuning,
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
    const tuning = normalizeTuning(options.tuning);
    const roller = new DiceRoller({ sides, seed, areaSize, debug, tuning });
    const result = roller.run();
    return {
      seed,
      sides,
      areaSize,
      dt: roller.physics.fixedDt,
      frames: result.frames,
      outcome: result.outcome,
      metadata: {
        totalFrames: result.frames.length,
        settled: result.settled,
        diagnostics: result.diagnostics,
      },
    };
  }

  return {
    normalizeSides,
    createSeededRandom,
    simulateRoll,
    PhysicsWorld,
    Die,
    DiceRoller,
  };
});
