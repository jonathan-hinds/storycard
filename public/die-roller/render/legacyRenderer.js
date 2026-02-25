import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';

const debugPhysicsToggle = document.getElementById('debug-physics');

const DIE_FACE_LAYOUTS = {
  3: [1, 2, 3],
  4: [1, 2, 3, 4],
  6: [3, 4, 1, 6, 2, 5],
  8: [1, 2, 3, 4, 5, 6, 7, 8],
  12: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  20: Array.from({ length: 20 }, (_, i) => i + 1),
};

const BASE_DIE_COLOR = new THREE.Color(0xffffff);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const UV_PRECISION = 100000;
const TEMPLATE_PADDING = 32;
const TEMPLATE_MAX_SIZE = 2048;
const D6_SKIN_TEXTURE_PATH = '/public/assets/d6skin.png';
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function tagSharedTexture(texture) {
  if (!texture) return texture;
  texture.userData = {
    ...(texture.userData || {}),
    persistentSharedTexture: true,
  };
  return texture;
}

const DIE_UV_EXPORTS = {
  6: {
    dieId: null,
    sides: 6,
    texturePath: '/public/assets/d6skin2.png',
    imageWidth: 1024,
    imageHeight: 1344,
    faces: [
      {
        value: 1,
        points: [
          { x: 345.7126, y: 1006.25255 },
          { x: 687.39414, y: 1007.54072 },
          { x: 686.39071, y: 1334.13579 },
          { x: 345.778, y: 1334.56149 },
        ],
      },
      {
        value: 2,
        points: [
          { x: 345.7126, y: 674.17005 },
          { x: 345.85819, y: 345.25249 },
          { x: 685.8708, y: 345.75472 },
          { x: 685.91967, y: 674.17005 },
        ],
      },
      {
        value: 3,
        points: [
          { x: 685.91967, y: 1006.27562 },
          { x: 345.7126, y: 1006.32056 },
          { x: 345.90316, y: 674.26164 },
          { x: 685.75252, y: 674.39143 },
        ],
      },
      {
        value: 4,
        points: [
          { x: 345.77321, y: 674.26164 },
          { x: 345.77321, y: 1006.32056 },
          { x: 17.46879, y: 1006.79373 },
          { x: 17.46879, y: 673.89408 },
        ],
      },
      {
        value: 5,
        points: [
          { x: 345.65734, y: 25.48231 },
          { x: 686.42331, y: 25.73342 },
          { x: 685.91967, y: 346.3037 },
          { x: 345.7126, y: 346.3037 },
        ],
      },
      {
        value: 6,
        points: [
          { x: 1015.12495, y: 1006.32056 },
          { x: 686.82053, y: 1006.32056 },
          { x: 686.82053, y: 674.26164 },
          { x: 1015.12495, y: 674.26164 },
        ],
      },
    ],
  },
};

function getTexture(path) {
  if (!path) return null;
  if (!textureCache.has(path)) {
    const texture = tagSharedTexture(textureLoader.load(path));
    texture.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(path, texture);
  }
  return textureCache.get(path);
}

const D6_SKIN_TEXTURE = getTexture(D6_SKIN_TEXTURE_PATH);

function createDebugGroundTexture() {
  const size = 256;
  const cells = 8;
  const cellSize = size / cells;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const isEven = (x + y) % 2 === 0;
      ctx.fillStyle = isEven ? '#6ea8ff' : '#1f2a44';
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  return tagSharedTexture(texture);
}

const DEBUG_GROUND_TEXTURE = createDebugGroundTexture();


const debugSliderConfig = [
  {
    key: 'throwHeight',
    inputId: 'throw-height',
    outputId: 'throw-height-value',
    defaultValue: 2.5,
    formatValue: (value) => `${((1.7 + 0.6) * value).toFixed(2)} m/s avg`,
  },
  {
    key: 'throwForward',
    inputId: 'throw-forward',
    outputId: 'throw-forward-value',
    defaultValue: 0,
    formatValue: (value) => `±${(5.1 * value).toFixed(2)} m/s`,
  },
  {
    key: 'throwRotation',
    inputId: 'throw-rotation',
    outputId: 'throw-rotation-value',
    defaultValue: 3.9,
    formatValue: (value) => `±${(7.8 * value).toFixed(2)} rad/s`,
  },
  {
    key: 'dieWeight',
    inputId: 'die-weight',
    outputId: 'die-weight-value',
    defaultValue: 3,
    formatValue: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: 'rotationFriction',
    inputId: 'rotation-friction',
    outputId: 'rotation-friction-value',
    defaultValue: 0,
    formatValue: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: 'groundSlipperiness',
    inputId: 'ground-slipperiness',
    outputId: 'ground-slipperiness-value',
    defaultValue: 0,
    formatValue: (value) => `μ ${value.toFixed(2)}`,
  },
  {
    key: 'dieSlipperiness',
    inputId: 'die-slipperiness',
    outputId: 'die-slipperiness-value',
    defaultValue: 1,
    formatValue: (value) => `μ ${value.toFixed(2)}`,
  },
];

const debugTuning = Object.fromEntries(debugSliderConfig.map((cfg) => [cfg.key, cfg.defaultValue]));

function updateDebugTuningValue(config) {
  const input = document.getElementById(config.inputId);
  const output = document.getElementById(config.outputId);
  if (!input || !output) return;
  const value = Number.parseFloat(input.value);
  const safeValue = Number.isFinite(value) ? value : config.defaultValue;
  debugTuning[config.key] = safeValue;
  output.textContent = config.formatValue ? config.formatValue(safeValue) : safeValue.toFixed(2);
}

function initializeDebugSliders() {
  for (const config of debugSliderConfig) {
    const input = document.getElementById(config.inputId);
    if (!input) continue;
    input.addEventListener('input', () => updateDebugTuningValue(config));
    updateDebugTuningValue(config);
  }
}


function roundKey(value) {
  return Math.round(value * 10000) / 10000;
}

function computeInsetPolygon(points, margin) {
  const area = points.reduce((acc, point, index) => {
    const next = points[(index + 1) % points.length];
    return acc + (point.x * next.y - point.y * next.x);
  }, 0) * 0.5;
  const isCCW = area >= 0;
  const insetLines = [];

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const edge = new THREE.Vector2().subVectors(b, a).normalize();
    const inward = isCCW ? new THREE.Vector2(-edge.y, edge.x) : new THREE.Vector2(edge.y, -edge.x);
    insetLines.push({ point: a.clone().addScaledVector(inward, margin), dir: edge });
  }

  const intersections = [];
  for (let i = 0; i < insetLines.length; i += 1) {
    const first = insetLines[i];
    const second = insetLines[(i + 1) % insetLines.length];
    const det = first.dir.x * second.dir.y - first.dir.y * second.dir.x;
    if (Math.abs(det) < 1e-5) return null;
    const delta = new THREE.Vector2().subVectors(second.point, first.point);
    const t = (delta.x * second.dir.y - delta.y * second.dir.x) / det;
    intersections.push(first.point.clone().addScaledVector(first.dir, t));
  }

  return intersections;
}

function getFaceFrame(normal) {
  const up = WORLD_UP.clone().projectOnPlane(normal);
  if (up.lengthSq() < 1e-6) {
    up.copy(WORLD_RIGHT).projectOnPlane(normal);
  }
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  return { right, up };
}

function getPolygonCentroid(points) {
  let signedArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    signedArea += cross;
    centroidX += (current.x + next.x) * cross;
    centroidY += (current.y + next.y) * cross;
  }

  const areaFactor = signedArea * 0.5;
  if (Math.abs(areaFactor) < 1e-6) {
    const fallback = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return {
      x: fallback.x / points.length,
      y: fallback.y / points.length,
    };
  }

  const factor = 1 / (6 * areaFactor);
  return {
    x: centroidX * factor,
    y: centroidY * factor,
  };
}

function drawFaceLabelTexture(value, facePoints2D, insetPoints2D) {
  const size = 512;
  const canvas = document.createElement('canvas');
  const xs = facePoints2D.map((p) => p.x);
  const ys = facePoints2D.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1e-5, maxX - minX);
  const height = Math.max(1e-5, maxY - minY);

  if (width >= height) {
    canvas.width = Math.max(size, Math.round((width / height) * size));
    canvas.height = size;
  } else {
    canvas.width = size;
    canvas.height = Math.max(size, Math.round((height / width) * size));
  }

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const toCanvas = (point) => ({
    x: ((point.x - minX) / width) * canvas.width,
    y: ((maxY - point.y) / height) * canvas.height,
  });

  const insetCanvas = insetPoints2D.map(toCanvas);
  ctx.save();
  ctx.beginPath();
  insetCanvas.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.clip();

  const insetXs = insetCanvas.map((p) => p.x);
  const insetYs = insetCanvas.map((p) => p.y);
  const safeWidth = Math.max(...insetXs) - Math.min(...insetXs);
  const safeHeight = Math.max(...insetYs) - Math.min(...insetYs);
  const faceCenter = getPolygonCentroid(insetCanvas);

  const text = String(value);
  let low = 16;
  let high = Math.min(canvas.width, canvas.height) * 0.9;
  let best = 60;
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2;
    ctx.font = `600 ${mid}px Inter, Arial, sans-serif`;
    const metrics = ctx.measureText(text);
    const textHeight = (metrics.actualBoundingBoxAscent || mid * 0.8) + (metrics.actualBoundingBoxDescent || mid * 0.2);
    if (metrics.width <= safeWidth * 0.62 && textHeight <= safeHeight * 0.62) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  ctx.fillStyle = '#0b1021';
  ctx.font = `600 ${best}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const finalMetrics = ctx.measureText(text);
  const textLeft = finalMetrics.actualBoundingBoxLeft ?? 0;
  const textRight = finalMetrics.actualBoundingBoxRight ?? finalMetrics.width;
  const textAscent = finalMetrics.actualBoundingBoxAscent ?? best * 0.8;
  const textDescent = finalMetrics.actualBoundingBoxDescent ?? best * 0.2;
  const textCenterXOffset = (textRight - textLeft) * 0.5;
  const textCenterY = (textAscent + textDescent) * 0.5 - textDescent;
  const drawX = faceCenter.x - textCenterXOffset;
  const drawY = faceCenter.y + textCenterY;
  ctx.fillText(text, drawX, drawY);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function extractPlanarFaces(geometry) {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const positions = nonIndexed.attributes.position;
  const groups = new Map();

  for (let i = 0; i < positions.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, i);
    const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
    const normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b, a),
      new THREE.Vector3().subVectors(c, a)
    ).normalize();
    if (normal.dot(a) < 0) {
      normal.multiplyScalar(-1);
    }
    const planeDistance = normal.dot(a);
    const key = `${roundKey(normal.x)}:${roundKey(normal.y)}:${roundKey(normal.z)}:${roundKey(planeDistance)}`;

    if (!groups.has(key)) {
      groups.set(key, { normal: normal.clone(), vertices: [] });
    }

    const group = groups.get(key);
    [a, b, c].forEach((vertex) => {
      if (!group.vertices.some((existing) => existing.distanceToSquared(vertex) < 1e-8)) {
        group.vertices.push(vertex);
      }
    });
  }

  return [...groups.values()].map((face) => {
    const center = face.vertices.reduce((acc, vertex) => acc.add(vertex), new THREE.Vector3()).multiplyScalar(1 / face.vertices.length);
    const { right, up } = getFaceFrame(face.normal);
    const points2D = face.vertices.map((vertex) => {
      const local = vertex.clone().sub(center);
      return new THREE.Vector2(local.dot(right), local.dot(up));
    });
    const ordered = points2D
      .map((point, index) => ({ point, vertex: face.vertices[index] }))
      .sort((first, second) => Math.atan2(first.point.y, first.point.x) - Math.atan2(second.point.y, second.point.x));

    return {
      center,
      normal: face.normal,
      right,
      up,
      points2D: ordered.map((entry) => entry.point),
    };
  });
}

function roundUv(value) {
  return Math.round(value * UV_PRECISION) / UV_PRECISION;
}

function vertexKey(vertex) {
  return `${roundUv(vertex.x)}:${roundUv(vertex.y)}:${roundUv(vertex.z)}`;
}

function edgeKey(a, b) {
  const keyA = vertexKey(a);
  const keyB = vertexKey(b);
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

function extractFacePolygons3D(geometry, sides) {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const positions = nonIndexed.attributes.position;
  const groups = new Map();

  for (let i = 0; i < positions.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, i);
    const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
    const normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b, a),
      new THREE.Vector3().subVectors(c, a)
    ).normalize();
    if (normal.dot(a) < 0) {
      normal.multiplyScalar(-1);
    }
    const planeDistance = normal.dot(a);
    const key = `${roundKey(normal.x)}:${roundKey(normal.y)}:${roundKey(normal.z)}:${roundKey(planeDistance)}`;

    if (!groups.has(key)) {
      groups.set(key, { normal: normal.clone(), vertices: new Map() });
    }

    const group = groups.get(key);
    [a, b, c].forEach((vertex) => {
      group.vertices.set(vertexKey(vertex), vertex.clone());
    });
  }

  const faces = [...groups.values()].map((face, index) => {
    const vertices = [...face.vertices.values()];
    const center = vertices.reduce((acc, vertex) => acc.add(vertex), new THREE.Vector3()).multiplyScalar(1 / vertices.length);
    const { right, up } = getFaceFrame(face.normal);
    const ordered = vertices
      .map((vertex) => {
        const local = vertex.clone().sub(center);
        return {
          vertex,
          point2D: new THREE.Vector2(local.dot(right), local.dot(up)),
        };
      })
      .sort((first, second) => Math.atan2(first.point2D.y, first.point2D.x) - Math.atan2(second.point2D.y, second.point2D.x));

    return {
      id: index,
      center,
      normal: face.normal,
      points3D: ordered.map((entry) => entry.vertex),
      points2D: ordered.map((entry) => entry.point2D),
    };
  });

  return selectNumberedFaces(faces, sides)
    .sort((a, b) => {
      if (Math.abs(a.center.y - b.center.y) > 1e-4) return b.center.y - a.center.y;
      const angleA = Math.atan2(a.center.z, a.center.x);
      const angleB = Math.atan2(b.center.z, b.center.x);
      return angleA - angleB;
    })
    .map((face, index) => ({ ...face, id: index }));
}

function mapFaceValuesForTemplate(sideCount, faceCount) {
  const values = DIE_FACE_LAYOUTS[sideCount];
  if (values && values.length === faceCount) return values;
  return Array.from({ length: faceCount }, (_, i) => i + 1);
}

function deriveStableFaceId(face, index) {
  if (face?.id != null) return String(face.id);
  const valuePart = Number.isFinite(face?.value) ? `v:${face.value}` : `v:na`;
  const pointPart = Array.isArray(face?.points)
    ? face.points
      .map((point) => `${Math.round((point.x || 0) * UV_PRECISION)}:${Math.round((point.y || 0) * UV_PRECISION)}`)
      .sort()
      .join('|')
    : 'no-points';
  return `${valuePart}|${pointPart}|idx:${index}`;
}

function normalizeUvExport(data) {
  if (!data || !Array.isArray(data.faces) || data.faces.length === 0) return null;
  const width = Number(data.imageWidth);
  const height = Number(data.imageHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const faces = data.faces
    .map((face, index) => {
      if (!Array.isArray(face?.points) || face.points.length < 3) return null;
      return {
        id: deriveStableFaceId(face, index),
        value: Number(face.value),
        points: face.points.map((point) => new THREE.Vector2(Number(point.x), Number(point.y))),
      };
    })
    .filter(Boolean);

  if (faces.length === 0) return null;
  return {
    dieId: data.dieId ?? null,
    sides: Number(data.sides) || faces.length,
    texturePath: data.texturePath || null,
    imageWidth: width,
    imageHeight: height,
    faces,
  };
}

function buildUvNetFromExport(sideCount) {
  const uvExport = normalizeUvExport(DIE_UV_EXPORTS[sideCount]);
  if (!uvExport) return null;

  // Keep physical/readout face mapping tied to DIE_FACE_LAYOUTS; UV JSON only drives texture placement.
  const layoutValues = mapFaceValuesForTemplate(sideCount, uvExport.faces.length);
  const facesByValue = new Map();
  uvExport.faces.forEach((face) => {
    if (!Number.isFinite(face.value)) return;
    if (!facesByValue.has(face.value)) {
      facesByValue.set(face.value, []);
    }
    facesByValue.get(face.value).push(face);
  });

  const sortedFallbackFaces = [...uvExport.faces].sort((a, b) => a.id.localeCompare(b.id));
  const usedFaceIds = new Set();
  const orderedFaces = layoutValues.map((value, index) => {
    const matching = facesByValue.get(value) || [];
    const byValue = matching.find((face) => !usedFaceIds.has(face.id));
    const fallback = sortedFallbackFaces.find((face) => !usedFaceIds.has(face.id));
    const selected = byValue || fallback;
    if (!selected) return null;
    usedFaceIds.add(selected.id);
    return {
      id: index,
      sourceId: selected.id,
      value,
      points: selected.points.map((point) => point.clone()),
    };
  }).filter(Boolean);

  if (orderedFaces.length === 0) return null;
  return {
    texturePath: uvExport.texturePath,
    bounds: {
      minX: 0,
      minY: 0,
      width: uvExport.imageWidth,
      height: uvExport.imageHeight,
    },
    net: orderedFaces,
  };
}

function signedDistanceToLine(point, a, b) {
  const edge = new THREE.Vector2().subVectors(b, a);
  const rel = new THREE.Vector2().subVectors(point, a);
  return edge.x * rel.y - edge.y * rel.x;
}

function projectNeighborFace(points, sourceA, sourceB, targetA, targetB, reverse) {
  const srcA = reverse ? sourceB : sourceA;
  const srcB = reverse ? sourceA : sourceB;
  const sourceEdge = new THREE.Vector2().subVectors(srcB, srcA);
  const targetEdge = new THREE.Vector2().subVectors(targetB, targetA);
  const angle = Math.atan2(targetEdge.y, targetEdge.x) - Math.atan2(sourceEdge.y, sourceEdge.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return points.map((point) => {
    const local = point.clone().sub(srcA);
    const rotated = new THREE.Vector2(
      local.x * cos - local.y * sin,
      local.x * sin + local.y * cos
    );
    return rotated.add(targetA);
  });
}

function generateUnwrappedNet(geometry, sideCount) {
  const faces = extractFacePolygons3D(geometry, sideCount);
  const edgeToFaces = new Map();
  const neighborMap = new Map();

  faces.forEach((face) => {
    for (let i = 0; i < face.points3D.length; i += 1) {
      const a = face.points3D[i];
      const b = face.points3D[(i + 1) % face.points3D.length];
      const key = edgeKey(a, b);
      if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
      edgeToFaces.get(key).push({ faceId: face.id, edgeIndex: i });
    }
  });

  edgeToFaces.forEach((entries, key) => {
    if (entries.length !== 2) return;
    const [first, second] = entries;
    if (!neighborMap.has(first.faceId)) neighborMap.set(first.faceId, []);
    if (!neighborMap.has(second.faceId)) neighborMap.set(second.faceId, []);
    neighborMap.get(first.faceId).push({ faceId: second.faceId, viaEdge: first.edgeIndex, edgeKey: key });
    neighborMap.get(second.faceId).push({ faceId: first.faceId, viaEdge: second.edgeIndex, edgeKey: key });
  });

  const placements = new Map();
  const queue = [];
  const root = faces[0];
  placements.set(root.id, root.points2D.map((point) => point.clone()));
  queue.push(root.id);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentPlacement = placements.get(currentId);
    const neighbors = neighborMap.get(currentId) || [];

    neighbors.forEach((neighborInfo) => {
      if (placements.has(neighborInfo.faceId)) return;
      const neighborFace = faces.find((face) => face.id === neighborInfo.faceId);
      const sharedEntries = edgeToFaces.get(neighborInfo.edgeKey);
      if (!sharedEntries || sharedEntries.length !== 2) return;

      const currentEntry = sharedEntries.find((entry) => entry.faceId === currentId);
      const neighborEntry = sharedEntries.find((entry) => entry.faceId === neighborInfo.faceId);
      if (!currentEntry || !neighborEntry) return;

      const curA = currentPlacement[currentEntry.edgeIndex];
      const curB = currentPlacement[(currentEntry.edgeIndex + 1) % currentPlacement.length];

      const neighA = neighborFace.points2D[neighborEntry.edgeIndex];
      const neighB = neighborFace.points2D[(neighborEntry.edgeIndex + 1) % neighborFace.points2D.length];

      const candidateA = projectNeighborFace(neighborFace.points2D, neighA, neighB, curA, curB, false);
      const candidateB = projectNeighborFace(neighborFace.points2D, neighA, neighB, curA, curB, true);

      const currentCentroid = getPolygonCentroid(currentPlacement);
      const signCurrent = signedDistanceToLine(new THREE.Vector2(currentCentroid.x, currentCentroid.y), curA, curB);

      const centroidA = getPolygonCentroid(candidateA);
      const signA = signedDistanceToLine(new THREE.Vector2(centroidA.x, centroidA.y), curA, curB);

      const chosen = signA * signCurrent < 0 ? candidateA : candidateB;
      placements.set(neighborInfo.faceId, chosen);
      queue.push(neighborInfo.faceId);
    });
  }

  const values = mapFaceValuesForTemplate(sideCount, faces.length);
  return faces.map((face, index) => ({
    id: face.id,
    value: values[index] ?? index + 1,
    points: placements.get(face.id) || face.points2D,
  }));
}

function renderTemplateCanvas(net, options = {}) {
  const { includeFaceValues = true } = options;
  const minX = Math.min(...net.flatMap((face) => face.points.map((point) => point.x)));
  const maxX = Math.max(...net.flatMap((face) => face.points.map((point) => point.x)));
  const minY = Math.min(...net.flatMap((face) => face.points.map((point) => point.y)));
  const maxY = Math.max(...net.flatMap((face) => face.points.map((point) => point.y)));
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = Math.min((TEMPLATE_MAX_SIZE - TEMPLATE_PADDING * 2) / width, (TEMPLATE_MAX_SIZE - TEMPLATE_PADDING * 2) / height);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale + TEMPLATE_PADDING * 2);
  canvas.height = Math.ceil(height * scale + TEMPLATE_PADDING * 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;

  const toCanvas = (point) => new THREE.Vector2(
    TEMPLATE_PADDING + (point.x - minX) * scale,
    canvas.height - (TEMPLATE_PADDING + (point.y - minY) * scale)
  );

  net.forEach((face) => {
    const mapped = face.points.map(toCanvas);
    ctx.beginPath();
    mapped.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();

    if (includeFaceValues) {
      const centroid = getPolygonCentroid(mapped);
      const fontSize = Math.max(14, Math.sqrt(scale) * 2.5);
      ctx.font = `500 ${fontSize}px Inter, Arial, sans-serif`;
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(face.value), centroid.x, centroid.y);
    }
  });

  return {
    canvas,
    bounds: { minX, minY, width, height },
  };
}

function downloadUvTemplate(sides) {
  const sideCount = Number.parseInt(sides, 10);
  const geometry = createDieGeometry(sideCount);
  const net = generateUnwrappedNet(geometry, sideCount);
  geometry.dispose();
  const { canvas } = renderTemplateCanvas(net, { includeFaceValues: true });

  const link = document.createElement('a');
  link.download = `d${sideCount}-uv-template.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function downloadD6SkinTemplate(path = D6_SKIN_TEXTURE_PATH) {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    const link = document.createElement('a');
    link.download = 'd6-skin-template.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  image.src = path;
}

function downloadDieSkinTemplate(sides) {
  const sideCount = Number.parseInt(sides, 10);
  const exportedUv = buildUvNetFromExport(sideCount);
  if (exportedUv?.texturePath) {
    downloadD6SkinTemplate(exportedUv.texturePath);
    return;
  }
  if (sideCount === 6) {
    downloadD6SkinTemplate();
    return;
  }
  downloadUvTemplate(sideCount);
}

function mapGeometryToNetUvs(geometry, net, options = {}) {
  const faces = extractFacePolygons3D(geometry, net.length);
  const netById = new Map(net.map((face) => [face.id, face]));
  const uvs = [];
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = nonIndexed.attributes.position;

  const computedMinX = Math.min(...net.flatMap((face) => face.points.map((point) => point.x)));
  const computedMaxX = Math.max(...net.flatMap((face) => face.points.map((point) => point.x)));
  const computedMinY = Math.min(...net.flatMap((face) => face.points.map((point) => point.y)));
  const computedMaxY = Math.max(...net.flatMap((face) => face.points.map((point) => point.y)));
  const minX = Number.isFinite(options.bounds?.minX) ? options.bounds.minX : computedMinX;
  const minY = Number.isFinite(options.bounds?.minY) ? options.bounds.minY : computedMinY;
  const width = Number.isFinite(options.bounds?.width)
    ? Math.max(1e-6, options.bounds.width)
    : Math.max(1e-6, computedMaxX - computedMinX);
  const height = Number.isFinite(options.bounds?.height)
    ? Math.max(1e-6, options.bounds.height)
    : Math.max(1e-6, computedMaxY - computedMinY);

  for (let i = 0; i < positions.count; i += 3) {
    const triangle = [
      new THREE.Vector3().fromBufferAttribute(positions, i),
      new THREE.Vector3().fromBufferAttribute(positions, i + 1),
      new THREE.Vector3().fromBufferAttribute(positions, i + 2),
    ];

    const centroid = triangle
      .reduce((acc, vertex) => acc.add(vertex), new THREE.Vector3())
      .multiplyScalar(1 / 3);

    let bestFace = faces[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const face of faces) {
      const normalScore = face.normal.dot(centroid.clone().normalize());
      const planeDistance = Math.abs(face.normal.dot(centroid.clone().sub(face.center)));
      const score = normalScore - planeDistance * 4;
      if (score > bestScore) {
        bestScore = score;
        bestFace = face;
      }
    }

    const netFace = netById.get(bestFace.id);
    triangle.forEach((vertex) => {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      bestFace.points3D.forEach((faceVertex, index) => {
        const dist = faceVertex.distanceToSquared(vertex);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestIndex = index;
        }
      });

      const netPoint = netFace.points[bestIndex] || netFace.points[0];
      const u = (netPoint.x - minX) / width;
      const v = (netPoint.y - minY) / height;
      uvs.push(u, v);
    });
  }

  nonIndexed.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return nonIndexed;
}

function createDieTemplateTexture(sideCount, net) {
  const { canvas } = renderTemplateCanvas(net, { includeFaceValues: true });
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createFaceLabelMesh(value, face) {
  const xs = face.points2D.map((p) => p.x);
  const ys = face.points2D.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const marginScale = face.points2D.length === 3 ? 0.24 : face.points2D.length === 5 ? 0.18 : 0.15;
  const insetMargin = Math.min(width, height) * marginScale;
  const inset = computeInsetPolygon(face.points2D, insetMargin)
    || face.points2D.map((point) => point.clone().multiplyScalar(0.76));

  const texture = drawFaceLabelTexture(value, face.points2D, inset);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  plane.position.copy(face.center).addScaledVector(face.normal, 0.01);
  const basis = new THREE.Matrix4().makeBasis(face.right, face.up, face.normal);
  plane.quaternion.setFromRotationMatrix(basis);
  plane.renderOrder = 2;
  return plane;
}

function selectNumberedFaces(faces, sides) {
  if (sides === 3) {
    return faces.filter((face) => face.points2D.length === 4);
  }
  if (sides === 8 || sides === 20) {
    return faces.filter((face) => face.points2D.length === 3);
  }
  if (sides === 12) {
    return faces.filter((face) => face.points2D.length === 5);
  }
  return faces;
}

function addFaceLabels(mesh, sides) {
  const values = DIE_FACE_LAYOUTS[sides] || Array.from({ length: sides }, (_, i) => i + 1);
  const faces = selectNumberedFaces(extractPlanarFaces(mesh.geometry), sides)
    .sort((a, b) => {
      if (Math.abs(a.center.y - b.center.y) > 1e-4) return b.center.y - a.center.y;
      const angleA = Math.atan2(a.center.z, a.center.x);
      const angleB = Math.atan2(b.center.z, b.center.x);
      return angleA - angleB;
    })
    .slice(0, values.length);

  faces.forEach((face, index) => {
    mesh.add(createFaceLabelMesh(values[index], face));
  });
}

function createD3Geometry() {
  const radius = 0.85;
  const height = 1.2;
  const halfHeight = height / 2;

  const points = [
    new THREE.Vector3(radius, halfHeight, 0),
    new THREE.Vector3(radius * Math.cos((2 * Math.PI) / 3), halfHeight, radius * Math.sin((2 * Math.PI) / 3)),
    new THREE.Vector3(radius * Math.cos((4 * Math.PI) / 3), halfHeight, radius * Math.sin((4 * Math.PI) / 3)),
  ];

  const bottom = points.map((point) => new THREE.Vector3(point.x, -halfHeight, point.z));

  const positions = [];
  const normals = [];
  const uvs = [];

  const addVertex = (vertex, normal, u, v) => {
    positions.push(vertex.x, vertex.y, vertex.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(u, v);
  };

  const addFace = (topA, topB, bottomA, bottomB) => {
    const edge = new THREE.Vector3().subVectors(topB, topA);
    const down = new THREE.Vector3().subVectors(bottomA, topA);
    const normal = new THREE.Vector3().crossVectors(edge, down).normalize();

    addVertex(topA, normal, 0, 1);
    addVertex(bottomA, normal, 0, 0);
    addVertex(topB, normal, 1, 1);

    addVertex(topB, normal, 1, 1);
    addVertex(bottomA, normal, 0, 0);
    addVertex(bottomB, normal, 1, 0);
  };

  for (let i = 0; i < 3; i += 1) {
    const next = (i + 1) % 3;
    addFace(points[i], points[next], bottom[i], bottom[next]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  geometry.clearGroups();
  for (let i = 0; i < 3; i += 1) {
    geometry.addGroup(i * 6, 6, i);
  }

  return geometry;
}

function createDieGeometry(sideCount) {
  if (sideCount === 3) return createD3Geometry();
  if (sideCount === 4) return new THREE.TetrahedronGeometry(1);
  if (sideCount === 6) return new THREE.BoxGeometry(1.35, 1.35, 1.35);
  if (sideCount === 8) return new THREE.OctahedronGeometry(1);
  if (sideCount === 12) return new THREE.DodecahedronGeometry(1);
  if (sideCount === 20) return new THREE.IcosahedronGeometry(1);
  return new THREE.CylinderGeometry(0.9, 0.9, 1.1, Math.min(sideCount, 64));
}

function createDieMesh(sides) {
  const sideCount = Number.parseInt(sides, 10);
  const baseGeometry = createDieGeometry(sideCount);
  const generatedNet = generateUnwrappedNet(baseGeometry, sideCount);
  const exportedUv = buildUvNetFromExport(sideCount);
  const net = exportedUv?.net || generatedNet;
  const numberedFaces = selectNumberedFaces(extractPlanarFaces(baseGeometry), sideCount)
    .sort((a, b) => {
      if (Math.abs(a.center.y - b.center.y) > 1e-4) return b.center.y - a.center.y;
      const angleA = Math.atan2(a.center.z, a.center.x);
      const angleB = Math.atan2(b.center.z, b.center.x);
      return angleA - angleB;
    });
  const values = mapFaceValuesForTemplate(sideCount, numberedFaces.length);
  const faceValueMap = numberedFaces.map((face, index) => ({
    normal: face.normal.clone().normalize(),
    value: values[index] ?? index + 1,
  }));

  const geometry = mapGeometryToNetUvs(baseGeometry, net, { bounds: exportedUv?.bounds });
  if (geometry !== baseGeometry) {
    baseGeometry.dispose();
  }
  const templateTexture = exportedUv?.texturePath
    ? getTexture(exportedUv.texturePath)
    : sideCount === 6
      ? D6_SKIN_TEXTURE
      : createDieTemplateTexture(sideCount, net);
  const material = new THREE.MeshStandardMaterial({
    color: BASE_DIE_COLOR,
    map: templateTexture,
    metalness: 0.02,
    roughness: 0.82,
  });
  const mesh = new THREE.Mesh(geometry, material);
  return { mesh, faceValueMap };
}

function getCurrentRollValue(mesh, faceValueMap) {
  if (!mesh || !faceValueMap?.length) return null;
  let winningValue = null;
  let bestDot = Number.NEGATIVE_INFINITY;

  faceValueMap.forEach((face) => {
    const worldNormal = face.normal.clone().applyQuaternion(mesh.quaternion).normalize();
    if (worldNormal.y > bestDot) {
      bestDot = worldNormal.y;
      winningValue = face.value;
    }
  });

  return winningValue;
}


function createPhysicsDebugHelpers(areaSize, mesh) {
  const helperGroup = new THREE.Group();
  const half = areaSize / 2 - 0.4;

  const floor = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(areaSize, areaSize)),
    new THREE.LineBasicMaterial({ color: 0x4db0ff })
  );
  floor.rotation.x = -Math.PI / 2;
  helperGroup.add(floor);

  const wallGeoA = new THREE.BoxGeometry(areaSize, 0.55, 0.02);
  const wallGeoB = new THREE.BoxGeometry(0.02, 0.55, areaSize);
  const wallMat = new THREE.LineBasicMaterial({ color: 0x4db0ff });

  const north = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeoA), wallMat);
  north.position.set(0, 0.275, half);
  helperGroup.add(north);
  const south = north.clone();
  south.position.z = -half;
  helperGroup.add(south);
  const east = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeoB), wallMat);
  east.position.set(half, 0.275, 0);
  helperGroup.add(east);
  const west = east.clone();
  west.position.x = -half;
  helperGroup.add(west);

  const dieCollider = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry.clone()),
    new THREE.LineBasicMaterial({ color: 0xffaa44 })
  );
  helperGroup.add(dieCollider);

  helperGroup.visible = Boolean(debugPhysicsToggle?.checked);
  return { helperGroup, dieCollider };
}

function createSceneForCanvas(canvas, sides) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 300, canvas.clientHeight || 300, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const cameraOffset = new THREE.Vector3(0, 5.8, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);

  const topLight = new THREE.DirectionalLight(0xffffff, 0.75);
  topLight.position.set(0, 8, 0.8);
  scene.add(topLight);

  const group = new THREE.Group();
  const areaSize = 7.1;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(areaSize, areaSize),
    new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0.02, transparent: true, opacity: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const debugFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(areaSize, areaSize),
    new THREE.MeshStandardMaterial({
      map: DEBUG_GROUND_TEXTURE,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    })
  );
  debugFloor.rotation.x = -Math.PI / 2;
  debugFloor.position.y = 0.004;
  debugFloor.visible = Boolean(debugPhysicsToggle?.checked);
  group.add(debugFloor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.95, metalness: 0.04, transparent: true, opacity: 0 });
  const wallHeight = 0.52;
  const wallThickness = 0.2;
  const half = areaSize / 2;

  const northSouth = new THREE.BoxGeometry(areaSize, wallHeight, wallThickness);
  const eastWest = new THREE.BoxGeometry(wallThickness, wallHeight, areaSize);

  const north = new THREE.Mesh(northSouth, wallMaterial);
  north.position.set(0, wallHeight / 2, half);
  group.add(north);

  const south = north.clone();
  south.position.z = -half;
  group.add(south);

  const east = new THREE.Mesh(eastWest, wallMaterial);
  east.position.set(half, wallHeight / 2, 0);
  group.add(east);

  const west = east.clone();
  west.position.x = -half;
  group.add(west);

  const { mesh, faceValueMap } = createDieMesh(sides);
  group.add(mesh);
  scene.add(group);

  const debugHelpers = createPhysicsDebugHelpers(areaSize, mesh);
  group.add(debugHelpers.helperGroup);

  camera.position.copy(mesh.position).add(cameraOffset);
  camera.lookAt(mesh.position);

  return {
    renderer,
    scene,
    camera,
    mesh,
    faceValueMap,
    cameraOffset,
    animation: null,
    currentValue: getCurrentRollValue(mesh, faceValueMap),
    debugHelpers,
    debugFloor,
    diagnostics: null,
    lights: {
      ambient,
      topLight,
    },
  };
}

function disposeMaterial(material) {
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((entry) => {
    if (!entry) return;
    const textureKeys = [
      'map',
      'alphaMap',
      'aoMap',
      'bumpMap',
      'displacementMap',
      'emissiveMap',
      'envMap',
      'lightMap',
      'metalnessMap',
      'normalMap',
      'roughnessMap',
    ];
    textureKeys.forEach((key) => {
      const texture = entry[key];
      if (texture && texture.userData?.persistentSharedTexture !== true) {
        texture.dispose();
      }
    });
    entry.dispose();
  });
}

function disposeObject3D(root) {
  if (!root) return;
  root.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) disposeMaterial(node.material);
  });
}

function destroySceneForCanvas(visual) {
  if (!visual) return;
  if (visual.scene) {
    disposeObject3D(visual.scene);
    visual.scene.clear();
  }
  if (visual.renderer) {
    if (visual.renderer.renderLists) visual.renderer.renderLists.dispose();
    visual.renderer.dispose();
    if (typeof visual.renderer.forceContextLoss === 'function') {
      visual.renderer.forceContextLoss();
    }
  }
}

function resizeRendererToDisplaySize(visual) {
  const canvas = visual.renderer.domElement;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const expectedWidth = Math.floor(width * pixelRatio);
  const expectedHeight = Math.floor(height * pixelRatio);
  const needsResize = canvas.width !== expectedWidth || canvas.height !== expectedHeight;

  if (!needsResize) return;

  visual.renderer.setPixelRatio(pixelRatio);
  visual.renderer.setSize(width, height, false);
  visual.camera.aspect = width / Math.max(height, 1);
  visual.camera.updateProjectionMatrix();
}

function syncCameraToDie(visual) {
  visual.camera.position.copy(visual.mesh.position).add(visual.cameraOffset);
  visual.camera.lookAt(visual.mesh.position);
}

function applyFrameToMesh(mesh, frame) {
  mesh.position.set(frame.x, frame.y ?? 0.23, frame.z ?? frame.y ?? 0);

  if (typeof frame.qx === 'number') {
    mesh.quaternion.set(frame.qx, frame.qy, frame.qz, frame.qw);
  } else {
    mesh.rotation.set((frame.vz || 0) * 0.1, frame.angle || 0, -(frame.vx || 0) * 0.1);
  }
}



export {
  debugTuning,
  downloadDieSkinTemplate,
  createSceneForCanvas,
  applyFrameToMesh,
  getCurrentRollValue,
  resizeRendererToDisplaySize,
  syncCameraToDie,
  destroySceneForCanvas,
};
