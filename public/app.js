import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';

const canvas = document.getElementById('die-canvas');
const dieList = document.getElementById('die-list');
const createDieForm = document.getElementById('create-die-form');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11131a);

const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
camera.position.set(0, 5.8, 0.001);
camera.lookAt(0, 0, 0);

const ambient = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambient);

const topLight = new THREE.DirectionalLight(0xffffff, 0.75);
topLight.position.set(0, 8, 0.8);
scene.add(topLight);

const dieVisuals = new Map();
let selectedDieId = null;

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
resize();

function makeDieTexture(label) {
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 512;
  texCanvas.height = 512;
  const ctx = texCanvas.getContext('2d');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 14;
  ctx.strokeRect(30, 30, 452, 452);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 180px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 280);

  const texture = new THREE.CanvasTexture(texCanvas);
  texture.needsUpdate = true;
  return texture;
}

function makeFaceTexture(value) {
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 512;
  texCanvas.height = 512;
  const ctx = texCanvas.getContext('2d');

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 14;
  ctx.strokeRect(30, 30, 452, 452);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 280px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), 256, 276);

  const texture = new THREE.CanvasTexture(texCanvas);
  texture.needsUpdate = true;
  return texture;
}

function createD6Materials() {
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const faceValues = [3, 4, 1, 6, 2, 5];
  return faceValues.map((value) => new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.16,
    roughness: 0.45,
    map: makeFaceTexture(value),
  }));
}

function orientSettledOutcome(mesh, sides, outcome) {
  const safeOutcome = Math.max(1, Math.min(sides, outcome || 1));

  if (sides === 6) {
    // Outcome mapping for d6 based on face values in createD6Materials.
    if (safeOutcome === 1) mesh.rotation.set(0, 0, 0);
    else if (safeOutcome === 2) mesh.rotation.set(-Math.PI / 2, 0, 0);
    else if (safeOutcome === 3) mesh.rotation.set(0, 0, Math.PI / 2);
    else if (safeOutcome === 4) mesh.rotation.set(0, 0, -Math.PI / 2);
    else if (safeOutcome === 5) mesh.rotation.set(Math.PI / 2, 0, 0);
    else mesh.rotation.set(Math.PI, 0, 0);
  } else {
    const yaw = ((safeOutcome - 1) / sides) * Math.PI * 2;
    mesh.rotation.set(0, yaw, 0);
  }

  mesh.position.y = 0.23;
}

function createDieMesh(sides) {
  const sideCount = Number.parseInt(sides, 10);
  let geometry;
  if (sideCount === 3) geometry = new THREE.ConeGeometry(0.95, 1.3, 3);
  else if (sideCount === 4) geometry = new THREE.TetrahedronGeometry(1);
  else if (sideCount === 6) geometry = new THREE.BoxGeometry(1.35, 1.35, 1.35);
  else if (sideCount === 8) geometry = new THREE.OctahedronGeometry(1);
  else if (sideCount === 12) geometry = new THREE.DodecahedronGeometry(1);
  else if (sideCount === 20) geometry = new THREE.IcosahedronGeometry(1);
  else geometry = new THREE.CylinderGeometry(0.9, 0.9, 1.1, Math.min(sideCount, 64));

  const material = sideCount === 6
    ? createD6Materials()
    : new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.18,
      roughness: 0.4,
      map: makeDieTexture(`d${sideCount}`),
    });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function createConfinedArea(offsetX, offsetZ, areaSize) {
  const group = new THREE.Group();
  group.position.set(offsetX, 0, offsetZ);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(areaSize, areaSize),
    new THREE.MeshStandardMaterial({ color: 0x202636, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  group.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x3b445e, roughness: 0.8, metalness: 0.1 });
  const wallLength = areaSize;
  const wallHeight = 0.75;
  const wallThickness = 0.2;
  const half = wallLength / 2;

  const northSouth = new THREE.BoxGeometry(wallLength, wallHeight, wallThickness);
  const eastWest = new THREE.BoxGeometry(wallThickness, wallHeight, wallLength);

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

  scene.add(group);
  return group;
}

function layoutDieAreas() {
  const visuals = Array.from(dieVisuals.values());
  const columns = Math.max(1, Math.ceil(Math.sqrt(visuals.length)));
  const spacing = 11;

  visuals.forEach((visual, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = (col - (columns - 1) / 2) * spacing;
    const z = (row - Math.floor((visuals.length - 1) / columns) / 2) * spacing;
    visual.group.position.set(x, 0, z);
  });
}

function applyFrameToMesh(mesh, frame) {
  mesh.position.set(frame.x, frame.y ?? 0.23, frame.z ?? frame.y ?? 0);

  if (typeof frame.qx === 'number') {
    mesh.quaternion.set(frame.qx, frame.qy, frame.qz, frame.qw);
  } else {
    mesh.rotation.set((frame.vz || 0) * 0.1, frame.angle || 0, -(frame.vx || 0) * 0.1);
  }
}

function renderDieList(dice) {
  dieList.innerHTML = '';

  dice.forEach((die) => {
    const item = document.createElement('article');
    item.className = 'die-item';
    if (die.id === selectedDieId) {
      item.style.outline = '2px solid #38bdf8';
    }

    const title = document.createElement('div');
    title.textContent = `Die ${die.sides} sides`;

    const result = document.createElement('div');
    result.textContent = `Last outcome: ${die.lastOutcome ?? '-'} | Rolls: ${die.rolls}`;

    const row = document.createElement('div');
    row.className = 'row';

    const selectBtn = document.createElement('button');
    selectBtn.textContent = 'Focus';
    selectBtn.addEventListener('click', () => {
      selectedDieId = die.id;
      refreshDice();
    });

    const rollBtn = document.createElement('button');
    rollBtn.textContent = 'Roll';
    rollBtn.addEventListener('click', async () => {
      await rollDie(die.id);
      await refreshDice();
    });

    row.append(selectBtn, rollBtn);
    item.append(title, result, row);
    dieList.append(item);
  });
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

  const die = data.die;
  const group = createConfinedArea(0, 0, die.areaSize + 0.3);
  const mesh = createDieMesh(die.sides);
  group.add(mesh);

  dieVisuals.set(die.id, {
    die,
    group,
    mesh,
    animation: null,
  });

  if (!selectedDieId) {
    selectedDieId = die.id;
  }

  layoutDieAreas();
}

function animateRoll(dieId, roll) {
  const visual = dieVisuals.get(dieId);
  if (!visual) return;

  visual.animation = {
    frames: roll.frames,
    index: 0,
    outcome: roll.outcome,
  };
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
    if (!visual.animation) continue;
    const frame = visual.animation.frames[visual.animation.index];
    if (frame) {
      applyFrameToMesh(visual.mesh, frame);
      visual.animation.index += 1;
    } else {
      orientSettledOutcome(visual.mesh, visual.die.sides, visual.animation.outcome);
      visual.animation = null;
    }
  }

  if (selectedDieId) {
    const selected = dieVisuals.get(selectedDieId);
    if (selected) {
      const gp = selected.group.position;
      const mp = selected.mesh.position;
      camera.position.set(gp.x + mp.x * 0.22, 5.8, gp.z + 0.001 + mp.z * 0.22);
      camera.lookAt(gp.x + mp.x * 0.12, 0.25, gp.z + mp.z * 0.12);
    }
  }

  renderer.render(scene, camera);
}

tick();
refreshDice();
