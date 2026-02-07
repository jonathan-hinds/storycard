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

function makeFaceTexture(value, shape = 'square') {
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 512;
  texCanvas.height = 512;
  const ctx = texCanvas.getContext('2d');

  if (shape === 'triangle') {
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(256, 30);
    ctx.lineTo(482, 470);
    ctx.lineTo(30, 470);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 14;
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else if (shape === 'pentagon') {
    const centerX = 256;
    const centerY = 256;
    const radius = 220;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const angle = (-Math.PI / 2) + ((Math.PI * 2 * i) / 5);
      const x = centerX + (Math.cos(angle) * radius);
      const y = centerY + (Math.sin(angle) * radius);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 14;
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 14;
    ctx.strokeRect(30, 30, 452, 452);
  }

  const text = String(value);
  const fontSize = text.length > 1 ? 210 : 280;
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const yPosition = shape === 'triangle' ? 300 : 276;
  ctx.fillText(text, 256, yPosition);

  const texture = new THREE.CanvasTexture(texCanvas);
  texture.needsUpdate = true;
  return texture;
}

function getFaceShape(sides) {
  if (sides === 4 || sides === 8 || sides === 20) return 'triangle';
  if (sides === 12) return 'pentagon';
  return 'square';
}

function createFaceMaterials(sides, faceCount = sides) {
  const fallbackValues = Array.from({ length: faceCount }, (_, i) => i + 1);
  const values = DIE_FACE_LAYOUTS[sides] || fallbackValues;
  const labelValues = values.length === faceCount
    ? values
    : Array.from({ length: faceCount }, (_, i) => values[i % values.length] || (i + 1));
  const faceShape = getFaceShape(sides);
  return labelValues.map((value) => new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.16,
    roughness: 0.45,
    map: makeFaceTexture(value, faceShape),
  }));
}

function buildFaceLocalGeometry(baseGeometry, expectedFaceCount) {
  const source = baseGeometry.toNonIndexed();
  const posAttr = source.getAttribute('position');
  const triCount = posAttr.count / 3;
  const facesByKey = new Map();
  const precision = 100000;

  const quantize = (value) => Math.round(value * precision) / precision;

  for (let tri = 0; tri < triCount; tri += 1) {
    const a = new THREE.Vector3().fromBufferAttribute(posAttr, tri * 3);
    const b = new THREE.Vector3().fromBufferAttribute(posAttr, (tri * 3) + 1);
    const c = new THREE.Vector3().fromBufferAttribute(posAttr, (tri * 3) + 2);
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const centroid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    const plane = normal.dot(centroid);
    const key = [quantize(normal.x), quantize(normal.y), quantize(normal.z), quantize(plane)].join('|');

    if (!facesByKey.has(key)) {
      facesByKey.set(key, { normal, triangles: [] });
    }
    facesByKey.get(key).triangles.push([a, b, c]);
  }

  const faces = Array.from(facesByKey.values());
  if (faces.length !== expectedFaceCount) {
    console.warn(`Detected ${faces.length} physical faces for d${expectedFaceCount}.`);
  }

  faces.sort((left, right) => {
    if (Math.abs(left.normal.y - right.normal.y) > 0.001) return right.normal.y - left.normal.y;
    return Math.atan2(left.normal.z, left.normal.x) - Math.atan2(right.normal.z, right.normal.x);
  });

  const positions = [];
  const normals = [];
  const uvs = [];
  const geometry = new THREE.BufferGeometry();

  const worldUp = new THREE.Vector3(0, 1, 0);
  const fallbackUp = new THREE.Vector3(0, 0, 1);
  const fallbackUp2 = new THREE.Vector3(1, 0, 0);
  const padding = 0.15;

  geometry.clearGroups();

  let vertexCursor = 0;
  faces.forEach((face, faceIndex) => {
    const allVertices = face.triangles.flat();
    const faceCenter = new THREE.Vector3();
    allVertices.forEach((vertex) => faceCenter.add(vertex));
    faceCenter.multiplyScalar(1 / allVertices.length);

    const up = worldUp.clone().sub(face.normal.clone().multiplyScalar(worldUp.dot(face.normal)));
    if (up.lengthSq() < 1e-6) {
      up.copy(fallbackUp).sub(face.normal.clone().multiplyScalar(fallbackUp.dot(face.normal)));
    }
    if (up.lengthSq() < 1e-6) {
      up.copy(fallbackUp2).sub(face.normal.clone().multiplyScalar(fallbackUp2.dot(face.normal)));
    }
    up.normalize();

    const right = new THREE.Vector3().crossVectors(up, face.normal).normalize();

    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;

    const coords = allVertices.map((vertex) => {
      const rel = new THREE.Vector3().subVectors(vertex, faceCenter);
      const u = rel.dot(right);
      const v = rel.dot(up);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
      return { vertex, u, v };
    });

    const centerU = (minU + maxU) / 2;
    const centerV = (minV + maxV) / 2;
    const isoScale = Math.max(maxU - minU, maxV - minV) || 1;

    coords.forEach(({ vertex, u, v }) => {
      const localU = ((u - centerU) / isoScale) + 0.5;
      const localV = ((v - centerV) / isoScale) + 0.5;
      const paddedU = padding + (localU * (1 - (padding * 2)));
      const paddedV = padding + (localV * (1 - (padding * 2)));

      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(face.normal.x, face.normal.y, face.normal.z);
      uvs.push(paddedU, paddedV);
    });

    const vertexCount = face.triangles.length * 3;
    geometry.addGroup(vertexCursor, vertexCount, faceIndex);
    vertexCursor += vertexCount;
  });

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  return geometry;
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
  if (sideCount === 4) return buildFaceLocalGeometry(new THREE.TetrahedronGeometry(1), 4);
  if (sideCount === 6) return new THREE.BoxGeometry(1.35, 1.35, 1.35);
  if (sideCount === 8) return buildFaceLocalGeometry(new THREE.OctahedronGeometry(1), 8);
  if (sideCount === 12) return buildFaceLocalGeometry(new THREE.DodecahedronGeometry(1), 12);
  if (sideCount === 20) return buildFaceLocalGeometry(new THREE.IcosahedronGeometry(1), 20);
  return new THREE.CylinderGeometry(0.9, 0.9, 1.1, Math.min(sideCount, 64));
}

function ensureFaceGroups(geometry, sideCount) {
  if (geometry.groups.length) {
    return;
  }
  const indexCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  const faces = Math.max(1, Math.floor(indexCount / 3));
  const groupsToUse = Math.min(sideCount, faces);
  const triPerGroup = Math.max(1, Math.floor(faces / groupsToUse));

  let cursor = 0;
  for (let groupIndex = 0; groupIndex < groupsToUse; groupIndex += 1) {
    const isLast = groupIndex === groupsToUse - 1;
    const faceCount = isLast ? (faces - (triPerGroup * groupIndex)) : triPerGroup;
    const count = faceCount * 3;
    geometry.addGroup(cursor, count, groupIndex);
    cursor += count;
  }
}

function createDieMesh(sides) {
  const sideCount = Number.parseInt(sides, 10);
  const geometry = createDieGeometry(sideCount);

  ensureFaceGroups(geometry, sideCount);

  const materialCount = geometry.groups.length || sideCount;
  const materials = createFaceMaterials(sideCount, materialCount);
  return new THREE.Mesh(geometry, materials);
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
