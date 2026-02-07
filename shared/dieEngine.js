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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeVector(v) {
    const length = Math.hypot(v.x, v.y, v.z) || 1;
    return {
      x: v.x / length,
      y: v.y / length,
      z: v.z / length,
    };
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
    if (!Number.isFinite(sides) || !SUPPORTED_SIDES.has(sides)) {
      throw new Error('Supported dice are D6, D8, D12, and D20.');
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

  function getFaceNormals(sides) {
    const phi = GOLDEN_RATIO;
    const invPhi = 1 / phi;

    if (sides === 3) {
      return [
        { value: 1, normal: normalizeVector({ x: 1, y: 0.35, z: 0 }) },
        { value: 2, normal: normalizeVector({ x: -0.5, y: 0.35, z: Math.sqrt(3) / 2 }) },
        { value: 3, normal: normalizeVector({ x: -0.5, y: 0.35, z: -Math.sqrt(3) / 2 }) },
      ];
    }

    if (sides === 4) {
      return [
        { value: 1, normal: normalizeVector({ x: 1, y: 1, z: 1 }) },
        { value: 2, normal: normalizeVector({ x: -1, y: -1, z: 1 }) },
        { value: 3, normal: normalizeVector({ x: -1, y: 1, z: -1 }) },
        { value: 4, normal: normalizeVector({ x: 1, y: -1, z: -1 }) },
      ];
    }

    if (sides === 6) {
      return [
        { value: 3, normal: { x: 1, y: 0, z: 0 } },
        { value: 4, normal: { x: -1, y: 0, z: 0 } },
        { value: 1, normal: { x: 0, y: 1, z: 0 } },
        { value: 6, normal: { x: 0, y: -1, z: 0 } },
        { value: 2, normal: { x: 0, y: 0, z: 1 } },
        { value: 5, normal: { x: 0, y: 0, z: -1 } },
      ];
    }

    if (sides === 8) {
      const normals = [];
      let value = 1;
      for (const x of [-1, 1]) {
        for (const y of [-1, 1]) {
          for (const z of [-1, 1]) {
            normals.push({ value, normal: normalizeVector({ x, y, z }) });
            value += 1;
          }
        }
      }
      return normals;
    }

    if (sides === 12) {
      return [
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
    }

    if (sides === 20) {
      const points = [
        { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: -1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: -1, z: -1 },
        { x: -1, y: 1, z: 1 }, { x: -1, y: 1, z: -1 }, { x: -1, y: -1, z: 1 }, { x: -1, y: -1, z: -1 },
        { x: 0, y: invPhi, z: phi }, { x: 0, y: invPhi, z: -phi }, { x: 0, y: -invPhi, z: phi }, { x: 0, y: -invPhi, z: -phi },
        { x: invPhi, y: phi, z: 0 }, { x: invPhi, y: -phi, z: 0 }, { x: -invPhi, y: phi, z: 0 }, { x: -invPhi, y: -phi, z: 0 },
        { x: phi, y: 0, z: invPhi }, { x: phi, y: 0, z: -invPhi }, { x: -phi, y: 0, z: invPhi }, { x: -phi, y: 0, z: -invPhi },
      ];
      return points.map((point, index) => ({ value: index + 1, normal: normalizeVector(point) }));
    }

    return [];
  }

  function topFaceInfo(orientation, sides) {
    const up = { x: 0, y: 1, z: 0 };
    const faces = getFaceNormals(sides);

    let winningFace = faces[0];
    let bestDot = Number.NEGATIVE_INFINITY;
    let winningNormal = { x: 0, y: 1, z: 0 };
    for (const face of faces) {
      const worldNormal = rotateVectorByQuat(face.normal, orientation);
      const dot = worldNormal.x * up.x + worldNormal.y * up.y + worldNormal.z * up.z;
      if (dot > bestDot) {
        bestDot = dot;
        winningFace = face;
        winningNormal = worldNormal;
      }
    }

    return {
      value: winningFace.value,
      alignment: bestDot,
      normal: winningNormal,
    };
  }

  function alignOrientationToTopFace(orientation, sides) {
    const faceInfo = topFaceInfo(orientation, sides);
    const axis = {
      x: faceInfo.normal.z,
      y: 0,
      z: -faceInfo.normal.x,
    };
    const axisLength = Math.hypot(axis.x, axis.y, axis.z);
    const alignment = clamp(faceInfo.alignment, -1, 1);
    const angle = Math.acos(alignment);

    if (axisLength <= 1e-8 || angle <= 1e-8) {
      return {
        orientation: normalizeQuat({
          x: orientation.x,
          y: orientation.y,
          z: orientation.z,
          w: orientation.w,
        }),
        alignment,
      };
    }

    const halfAngle = angle * 0.5;
    const sinHalf = Math.sin(halfAngle);
    const invLength = 1 / axisLength;
    const correction = {
      x: axis.x * invLength * sinHalf,
      y: axis.y * invLength * sinHalf,
      z: axis.z * invLength * sinHalf,
      w: Math.cos(halfAngle),
    };

    const q = orientation;
    const cx = correction.x;
    const cy = correction.y;
    const cz = correction.z;
    const cw = correction.w;

    const snapped = normalizeQuat({
      x: cw * q.x + cx * q.w + cy * q.z - cz * q.y,
      y: cw * q.y - cx * q.z + cy * q.w + cz * q.x,
      z: cw * q.z + cx * q.y - cy * q.x + cz * q.w,
      w: cw * q.w - cx * q.x - cy * q.y - cz * q.z,
    });

    return {
      orientation: snapped,
      alignment,
    };
  }

  function outcomeFromOrientation(orientation, sides) {
    return topFaceInfo(orientation, sides).value;
  }

  function simulateRoll(options) {
    const sides = normalizeSides(options.sides);
    const seed = String(options.seed || Date.now());
    const areaSize = Number.isFinite(options.areaSize) ? options.areaSize : 8;
    const baseSteps = Number.isFinite(options.steps) ? options.steps : 200;
    const steps = Math.max(baseSteps, 720);
    const dt = Number.isFinite(options.dt) ? options.dt : 1 / 60;

    const rng = createSeededRandom(seed);
    const halfArea = areaSize / 2;
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
    let stableFaceFrames = 0;

    const settleProfile = {
      floorLinearDrag: sides >= 12 ? 0.875 : 0.935,
      floorSpinDrag: sides >= 12 ? 0.76 : 0.9,
      baseAlignStrength: sides >= 12 ? 56 : 36,
      fineAlignStrength: sides >= 12 ? 88 : 62,
      flatAlignment: sides >= 12 ? 0.9996 : 0.9988,
      stableFrames: sides >= 12 ? 28 : 15,
    };

    const frames = [];

    for (let i = 0; i < steps; i += 1) {
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
      const floorY = 0.23;
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

      const drag = py <= floorY + 0.001 ? settleProfile.floorLinearDrag : 0.985;
      vx *= drag;
      vy *= bounced ? 0.94 : 0.995;
      vz *= drag;
      const spinDrag = py <= floorY + 0.001 ? settleProfile.floorSpinDrag : 0.975;
      wx *= spinDrag;
      wy *= spinDrag;
      wz *= spinDrag;
      if (py <= floorY + 0.001 && Math.abs(vy) < 0.25) {
        vy = 0;
      }

      if (py <= floorY + 0.001) {
        const faceInfo = topFaceInfo(orientation, sides);
        const faceNormal = faceInfo.normal;
        const correctionAxis = {
          x: -faceNormal.z,
          y: 0,
          z: faceNormal.x,
        };
        const correctionMagnitude = Math.hypot(correctionAxis.x, correctionAxis.y, correctionAxis.z);
        const correctionAngle = Math.acos(clamp(faceInfo.alignment, -1, 1));

        if (correctionMagnitude > 1e-6 && correctionAngle > 0.0005) {
          const invMagnitude = 1 / correctionMagnitude;
          const alignStrength = correctionAngle < 0.35
            ? settleProfile.fineAlignStrength
            : settleProfile.baseAlignStrength;
          const correctionSpeed = correctionAngle * alignStrength;
          const cx = correctionAxis.x * invMagnitude;
          const cy = correctionAxis.y * invMagnitude;
          const cz = correctionAxis.z * invMagnitude;
          integrateQuaternion(
            orientation,
            cx * correctionSpeed,
            cy * correctionSpeed,
            cz * correctionSpeed,
            dt
          );
          wx *= 0.52;
          wy *= 0.82;
          wz *= 0.52;
        }

        if (faceInfo.alignment > 0.995) {
          wx *= 0.58;
          wz *= 0.58;
        }
        if (faceInfo.alignment > 0.999 && Math.hypot(vx, vz) < 0.05) {
          wx = 0;
          wz = 0;
        }
      }

      const travel = Math.hypot(vx, vz);
      angle = normalizeAngle(angle + (wy * dt) + travel * 0.015);

      if (Math.abs(vx) < 0.02) vx = 0;
      if (Math.abs(vy) < 0.02) vy = 0;
      if (Math.abs(vz) < 0.02) vz = 0;
      if (Math.abs(wx) < 0.02) wx = 0;
      if (Math.abs(wy) < 0.02) wy = 0;
      if (Math.abs(wz) < 0.02) wz = 0;

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

      const isMostlyStill = Math.abs(vx) < 0.04
        && Math.abs(vy) < 0.04
        && Math.abs(vz) < 0.04
        && Math.abs(wx) < 0.12
        && Math.abs(wy) < 0.12
        && Math.abs(wz) < 0.12
        && py <= floorY + 0.001;

      const faceInfo = topFaceInfo(orientation, sides);
      const isFlatEnough = faceInfo.alignment > settleProfile.flatAlignment;
      if (isMostlyStill && isFlatEnough) {
        stableFaceFrames += 1;
      } else {
        stableFaceFrames = 0;
      }

      if (stableFaceFrames >= settleProfile.stableFrames && i > 35) {
        break;
      }
    }

    const finalFrame = frames[frames.length - 1];
    const rawRenderedOrientation = finalFrame && typeof finalFrame.qx === 'number'
      ? {
        x: finalFrame.qx,
        y: finalFrame.qy,
        z: finalFrame.qz,
        w: finalFrame.qw,
      }
      : orientation;

    const snapped = alignOrientationToTopFace(rawRenderedOrientation, sides);
    const renderedOrientation = snapped.orientation;
    if (finalFrame) {
      finalFrame.qx = Number(renderedOrientation.x.toFixed(6));
      finalFrame.qy = Number(renderedOrientation.y.toFixed(6));
      finalFrame.qz = Number(renderedOrientation.z.toFixed(6));
      finalFrame.qw = Number(renderedOrientation.w.toFixed(6));
      finalFrame.wx = 0;
      finalFrame.wy = 0;
      finalFrame.wz = 0;
    }

    const outcome = outcomeFromOrientation(renderedOrientation, sides) || angleToOutcome(finalFrame.angle, sides);

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
