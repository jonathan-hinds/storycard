import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';

const dieList = document.getElementById('die-list');
const createDieForm = document.getElementById('create-die-form');

const dieVisuals = new Map();

const DIE_FACE_LAYOUTS = {
  3: [1, 2, 3],
  4: [1, 2, 3, 4],
  6: [3, 4, 1, 6, 2, 5],
  8: [1, 2, 3, 4, 5, 6, 7, 8],
  12: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  20: Array.from({ length: 20 }, (_, i) => i + 1),
};

const BASE_DIE_COLOR = new THREE.Color(0xe2e8f0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

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
  const centerX = (Math.min(...insetXs) + Math.max(...insetXs)) * 0.5;
  const centerY = (Math.min(...insetYs) + Math.max(...insetYs)) * 0.5;

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
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, centerX, centerY);
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
  const geometry = createDieGeometry(sideCount);
  const material = new THREE.MeshStandardMaterial({
    color: BASE_DIE_COLOR,
    metalness: 0.16,
    roughness: 0.45,
  });
  const mesh = new THREE.Mesh(geometry, material);
  addFaceLabels(mesh, sideCount);
  return mesh;
}

function createSceneForCanvas(canvas, sides) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(300, 300, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11131a);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const cameraOffset = new THREE.Vector3(0, 5.8, 0.001);

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);

  const topLight = new THREE.DirectionalLight(0xffffff, 0.75);
  topLight.position.set(0, 8, 0.8);
  scene.add(topLight);

  const group = new THREE.Group();
  const areaSize = 7.1;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(areaSize, areaSize),
    new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 1, metalness: 0.02, transparent: true, opacity: 0.35 })
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.95, metalness: 0.04, transparent: true, opacity: 0.18 });
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

  const mesh = createDieMesh(sides);
  group.add(mesh);
  scene.add(group);

  const lookOffset = new THREE.Vector3(0, 0.2, 0);
  camera.position.copy(mesh.position).add(cameraOffset);
  camera.lookAt(mesh.position.clone().add(lookOffset));

  return { renderer, scene, camera, mesh, cameraOffset, lookOffset, animation: null };
}

function syncCameraToDie(visual) {
  visual.camera.position.copy(visual.mesh.position).add(visual.cameraOffset);
  visual.camera.lookAt(visual.mesh.position.clone().add(visual.lookOffset));
}

function applyFrameToMesh(mesh, frame) {
  mesh.position.set(frame.x, frame.y ?? 0.23, frame.z ?? frame.y ?? 0);

  if (typeof frame.qx === 'number') {
    mesh.quaternion.set(frame.qx, frame.qy, frame.qz, frame.qw);
  } else {
    mesh.rotation.set((frame.vz || 0) * 0.1, frame.angle || 0, -(frame.vx || 0) * 0.1);
  }
}

function buildDieCard(die, canvas) {
  const item = document.createElement('article');
  item.className = 'die-item';

  const title = document.createElement('div');
  title.className = 'die-title';
  title.textContent = `Die ${die.sides} sides`;

  const result = document.createElement('div');
  result.className = 'die-result';
  result.textContent = `Last outcome: ${die.lastOutcome ?? '-'} | Rolls: ${die.rolls}`;

  const dieCanvas = canvas || document.createElement('canvas');
  dieCanvas.className = 'die-canvas';
  dieCanvas.width = 300;
  dieCanvas.height = 300;

  const rollBtn = document.createElement('button');
  rollBtn.textContent = 'Roll';
  rollBtn.addEventListener('click', async () => {
    await rollDie(die.id);
    await refreshDice();
  });

  item.append(title, result, dieCanvas, rollBtn);
  return { item, canvas: dieCanvas };
}

function renderDieList(dice) {
  dieList.innerHTML = '';

  const activeIds = new Set(dice.map((die) => die.id));
  for (const [id, visual] of dieVisuals.entries()) {
    if (!activeIds.has(id)) {
      visual.renderer.dispose();
      dieVisuals.delete(id);
    }
  }

  dice.forEach((die) => {
    const existing = dieVisuals.get(die.id);
    const { item, canvas } = buildDieCard(die, existing?.canvas);

    if (existing) {
      existing.die = die;
      existing.canvas = canvas;
    } else {
      dieVisuals.set(die.id, {
        die,
        canvas,
        ...createSceneForCanvas(canvas, die.sides),
      });
    }

    dieList.append(item);
  });
}

function animateRoll(dieId, roll) {
  const visual = dieVisuals.get(dieId);
  if (!visual) return;

  visual.animation = {
    frames: roll.frames,
    index: 0,
  };
}

async function createDie(sides) {
  const response = await fetch('/api/dice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sides }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to create die');
  }
}

async function rollDie(dieId) {
  const response = await fetch(`/api/dice/${dieId}/roll`, { method: 'POST' });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to roll die');
  }

  animateRoll(dieId, data.roll);
}

async function refreshDice() {
  const response = await fetch('/api/dice');
  const data = await response.json();
  renderDieList(data.dice);
}

createDieForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sides = Number.parseInt(new FormData(createDieForm).get('sides'), 10);
  try {
    await createDie(sides);
    await refreshDice();
  } catch (error) {
    alert(error.message);
  }
});

function tick() {
  requestAnimationFrame(tick);

  for (const visual of dieVisuals.values()) {
    if (visual.animation) {
      const frame = visual.animation.frames[visual.animation.index];
      if (frame) {
        applyFrameToMesh(visual.mesh, frame);
        visual.animation.index += 1;
      } else {
        visual.animation = null;
      }
    }

    syncCameraToDie(visual);

    visual.renderer.render(visual.scene, visual.camera);
  }
}

tick();
refreshDice();
