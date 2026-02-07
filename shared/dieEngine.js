(function initDiceEngine(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.DiceEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TWO_PI = Math.PI * 2;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeQuat(q) {
    const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= length;
    q.y /= length;
    q.z /= length;
    q.w /= length;
    return q;
  }

  function integrateQuaternion(q, wx, wy, wz, dt) {
    const halfDt = dt * 0.5;
    const dx = halfDt * (wx * q.w + wy * q.z - wz * q.y);
    const dy = halfDt * (-wx * q.z + wy * q.w + wz * q.x);
    const dz = halfDt * (wx * q.y - wy * q.x + wz * q.w);
    const dw = halfDt * (-wx * q.x - wy * q.y - wz * q.z);
    q.x += dx;
    q.y += dy;
    q.z += dz;
    q.w += dw;
    return normalizeQuat(q);
  }

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

  function rotateVectorByQuat(vector, q) {
    const x = vector.x;
    const y = vector.y;
    const z = vector.z;

    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;

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

  function setQuaternion(target, source) {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
    target.w = source.w;
    return target;
  }

  function quatMultiply(a, b) {
    return {
      x: (a.w * b.x) + (a.x * b.w) + (a.y * b.z) - (a.z * b.y),
      y: (a.w * b.y) - (a.x * b.z) + (a.y * b.w) + (a.z * b.x),
      z: (a.w * b.z) + (a.x * b.y) - (a.y * b.x) + (a.z * b.w),
      w: (a.w * b.w) - (a.x * b.x) - (a.y * b.y) - (a.z * b.z),
    };
  }

  function quatFromUnitVectors(from, to) {
    const crossX = (from.y * to.z) - (from.z * to.y);
    const crossY = (from.z * to.x) - (from.x * to.z);
    const crossZ = (from.x * to.y) - (from.y * to.x);
    const dot = (from.x * to.x) + (from.y * to.y) + (from.z * to.z);

    if (dot < -0.999999) {
      const axis = Math.abs(from.x) > Math.abs(from.z)
        ? { x: -from.y, y: from.x, z: 0, w: 0 }
        : { x: 0, y: -from.z, z: from.y, w: 0 };
      return normalizeQuat(axis);
    }

    return normalizeQuat({
      x: crossX,
      y: crossY,
      z: crossZ,
      w: 1 + dot,
    });
  }

  function getFloorYForSides(sides) {
    if (sides === 3) return 0.65;
    if (sides === 4) return 1;
    if (sides === 6) return 0.675;
    if (sides === 8) return 1;
    if (sides === 12) return 1;
    if (sides === 20) return 1;
    return 0.55;
  }

  function snapD6OrientationFlat(orientation) {
    const up = { x: 0, y: 1, z: 0 };
    const faces = [
      { normal: { x: 1, y: 0, z: 0 } },
      { normal: { x: -1, y: 0, z: 0 } },
      { normal: { x: 0, y: 1, z: 0 } },
      { normal: { x: 0, y: -1, z: 0 } },
      { normal: { x: 0, y: 0, z: 1 } },
      { normal: { x: 0, y: 0, z: -1 } },
    ];

    let bestFace = faces[2];
    let bestDot = Number.NEGATIVE_INFINITY;

    for (const face of faces) {
      const worldNormal = rotateVectorByQuat(face.normal, orientation);
      const dot = worldNormal.y;
      if (dot > bestDot) {
        bestDot = dot;
        bestFace = face;
      }
    }

    const worldTopNormal = rotateVectorByQuat(bestFace.normal, orientation);
    const delta = quatFromUnitVectors(worldTopNormal, up);
    return normalizeQuat(quatMultiply(delta, orientation));
  }

  function d6OutcomeFromOrientation(orientation) {
    const up = { x: 0, y: 1, z: 0 };
    const faces = [
      { value: 3, normal: { x: 1, y: 0, z: 0 } },
      { value: 4, normal: { x: -1, y: 0, z: 0 } },
      { value: 1, normal: { x: 0, y: 1, z: 0 } },
      { value: 6, normal: { x: 0, y: -1, z: 0 } },
      { value: 2, normal: { x: 0, y: 0, z: 1 } },
      { value: 5, normal: { x: 0, y: 0, z: -1 } },
    ];

    let winningValue = 1;
    let bestDot = Number.NEGATIVE_INFINITY;
    for (const face of faces) {
      const worldNormal = rotateVectorByQuat(face.normal, orientation);
      const dot = worldNormal.x * up.x + worldNormal.y * up.y + worldNormal.z * up.z;
      if (dot > bestDot) {
        bestDot = dot;
        winningValue = face.value;
      }
    }

    return winningValue;
  }

  function getD6TopFace(orientation) {
    const faces = [
      { value: 3, normal: { x: 1, y: 0, z: 0 } },
      { value: 4, normal: { x: -1, y: 0, z: 0 } },
      { value: 1, normal: { x: 0, y: 1, z: 0 } },
      { value: 6, normal: { x: 0, y: -1, z: 0 } },
      { value: 2, normal: { x: 0, y: 0, z: 1 } },
      { value: 5, normal: { x: 0, y: 0, z: -1 } },
    ];

    let topFace = faces[2];
    let topNormal = rotateVectorByQuat(topFace.normal, orientation);
    let bestDot = topNormal.y;

    for (const face of faces) {
      const worldNormal = rotateVectorByQuat(face.normal, orientation);
      if (worldNormal.y > bestDot) {
        bestDot = worldNormal.y;
        topFace = face;
        topNormal = worldNormal;
      }
    }

    return {
      value: topFace.value,
      dot: bestDot,
      worldNormal: topNormal,
    };
  }

  function simulateRoll(options) {
    const sides = normalizeSides(options.sides);
    const seed = String(options.seed || Date.now());
    const areaSize = Number.isFinite(options.areaSize) ? options.areaSize : 8;
    const steps = Number.isFinite(options.steps) ? options.steps : 200;
    const maxSteps = sides === 6 ? Math.max(steps, 520) : steps;
    const dt = Number.isFinite(options.dt) ? options.dt : 1 / 60;

    const rng = createSeededRandom(seed);
    const halfArea = areaSize / 2;
    const floorY = getFloorYForSides(sides);
    const min = -halfArea + 0.5;
    const max = halfArea - 0.5;

    const roamRadius = areaSize * 0.26;
    let px = (rng() * 2 - 1) * (areaSize * 0.08);
    let py = 1.1 + rng() * 0.5;
    let pz = (rng() * 2 - 1) * (areaSize * 0.08);
    let vx = (rng() * 2 - 1) * 5;
    let vy = 0;
    let vz = (rng() * 2 - 1) * 5;
    let angle = rng() * TWO_PI;
    let wx = (rng() * 2 - 1) * 20;
    let wy = (rng() * 2 - 1) * 20;
    let wz = (rng() * 2 - 1) * 20;
    const orientation = normalizeQuat({ x: 0, y: 0, z: 0, w: 1 });
    let d6LowMotionFrames = 0;
    let d6Settled = false;

    const frames = [];

    for (let i = 0; i < maxSteps; i += 1) {
      const gravity = 24;
      const centerForce = 2.1;
      vx += -px * centerForce * dt;
      vz += -pz * centerForce * dt;
      vy -= gravity * dt;

      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;
      integrateQuaternion(orientation, wx, wy, wz, dt);

      let bounced = false;
      if (py < floorY) {
        py = floorY;
        if (Math.abs(vy) > 0.3) {
          vy = Math.abs(vy) * 0.42;
          wx += (rng() * 2 - 1) * 2.7;
          wz += (rng() * 2 - 1) * 2.7;
        } else {
          vy = 0;
        }
        vx *= 0.86;
        vz *= 0.86;
        bounced = true;
      }

      const wallSpinImpulse = 2.2;
      if (px < min) {
        px = min;
        vx = Math.abs(vx) * 0.7;
        vy += Math.abs(vx) * 0.15;
        wy += (rng() * 2 - 1) * wallSpinImpulse;
        wz *= 0.9;
        bounced = true;
      }
      if (px > max) {
        px = max;
        vx = -Math.abs(vx) * 0.7;
        vy += Math.abs(vx) * 0.15;
        wy += (rng() * 2 - 1) * wallSpinImpulse;
        wz *= 0.9;
        bounced = true;
      }
      if (pz < min) {
        pz = min;
        vz = Math.abs(vz) * 0.7;
        vy += Math.abs(vz) * 0.15;
        wx += (rng() * 2 - 1) * wallSpinImpulse;
        wz *= 0.9;
        bounced = true;
      }
      if (pz > max) {
        pz = max;
        vz = -Math.abs(vz) * 0.7;
        vy += Math.abs(vz) * 0.15;
        wx += (rng() * 2 - 1) * wallSpinImpulse;
        wz *= 0.9;
        bounced = true;
      }

      const radial = Math.hypot(px, pz);
      if (radial > roamRadius) {
        const nx = px / radial;
        const nz = pz / radial;
        px = nx * roamRadius;
        pz = nz * roamRadius;
        const dot = vx * nx + vz * nz;
        vx = (vx - 1.6 * dot * nx) * 0.85;
        vz = (vz - 1.6 * dot * nz) * 0.85;
        bounced = true;
      }

      const drag = py <= floorY + 0.001 ? 0.935 : 0.985;
      vx *= drag;
      vy *= bounced ? 0.94 : 0.995;
      vz *= drag;
      const spinDrag = py <= floorY + 0.001 ? 0.955 : 0.975;
      wx *= spinDrag;
      wy *= spinDrag;
      wz *= spinDrag;

      const travel = Math.hypot(vx, vz);
      angle = normalizeAngle(angle + (wy * dt) + travel * 0.015);

      if (Math.abs(vx) < 0.02) vx = 0;
      if (Math.abs(vy) < 0.02) vy = 0;
      if (Math.abs(vz) < 0.02) vz = 0;
      if (Math.abs(wx) < 0.02) wx = 0;
      if (Math.abs(wy) < 0.02) wy = 0;
      if (Math.abs(wz) < 0.02) wz = 0;

      const speed = Math.hypot(vx, vy, vz);
      const spin = Math.hypot(wx, wy, wz);
      const grounded = py <= floorY + 0.001;
      if (sides === 6 && grounded) {
        vx *= 0.92;
        vz *= 0.92;
        wx *= 0.88;
        wy *= 0.88;
        wz *= 0.88;
      }

      if (sides === 6 && grounded) {
        const topFace = getD6TopFace(orientation);

        if (speed < 0.8 && spin < 1.6) {
          d6LowMotionFrames += 1;
          if (topFace.dot <= 0.985) {
            wx += -topFace.worldNormal.z * 3.1 * dt;
            wz += topFace.worldNormal.x * 3.1 * dt;
            wy *= 0.78;
          }
        } else {
          d6LowMotionFrames = 0;
        }

        if (d6LowMotionFrames >= 24) {
          py = floorY;
          vx = 0;
          vy = 0;
          vz = 0;
          wx = 0;
          wy = 0;
          wz = 0;
          const flattened = snapD6OrientationFlat(orientation);
          setQuaternion(orientation, flattened);
          d6Settled = true;
        }
      }

      frames.push({
        step: i,
        x: Number(px.toFixed(4)),
        y: Number(py.toFixed(4)),
        z: Number(pz.toFixed(4)),
        angle: Number(angle.toFixed(5)),
        vx: Number(vx.toFixed(4)),
        vy: Number(vy.toFixed(4)),
        vz: Number(vz.toFixed(4)),
        wx: Number(wx.toFixed(4)),
        wy: Number(wy.toFixed(4)),
        wz: Number(wz.toFixed(4)),
        qx: Number(orientation.x.toFixed(6)),
        qy: Number(orientation.y.toFixed(6)),
        qz: Number(orientation.z.toFixed(6)),
        qw: Number(orientation.w.toFixed(6)),
      });

      if (vx === 0 && vy === 0 && vz === 0 && wx === 0 && wy === 0 && wz === 0 && i > 35 && (sides !== 6 || d6Settled)) {
        break;
      }
    }

    if (sides === 6 && !d6Settled && frames.length > 0) {
      const flattened = snapD6OrientationFlat(orientation);
      setQuaternion(orientation, flattened);
      const settleStart = frames[frames.length - 1];
      for (let hold = 0; hold < 24; hold += 1) {
        frames.push({
          step: settleStart.step + hold + 1,
          x: settleStart.x,
          y: Number(floorY.toFixed(4)),
          z: settleStart.z,
          angle: settleStart.angle,
          vx: 0,
          vy: 0,
          vz: 0,
          wx: 0,
          wy: 0,
          wz: 0,
          qx: Number(orientation.x.toFixed(6)),
          qy: Number(orientation.y.toFixed(6)),
          qz: Number(orientation.z.toFixed(6)),
          qw: Number(orientation.w.toFixed(6)),
        });
      }
    }

    const finalFrame = frames[frames.length - 1];
    const renderedOrientation = finalFrame && typeof finalFrame.qx === 'number'
      ? {
        x: finalFrame.qx,
        y: finalFrame.qy,
        z: finalFrame.qz,
        w: finalFrame.qw,
      }
      : orientation;

    const outcome = sides === 6
      ? d6OutcomeFromOrientation(renderedOrientation)
      : angleToOutcome(finalFrame.angle, sides);

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
