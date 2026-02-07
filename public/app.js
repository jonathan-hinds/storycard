import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';

const dieList = document.getElementById('die-list');
const createDieForm = document.getElementById('create-die-form');

const dieVisuals = new Map();

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
  const faceValues = [3, 4, 1, 6, 2, 5];
  return faceValues.map((value) => new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.16,
    roughness: 0.45,
    map: makeFaceTexture(value),
  }));
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

  return new THREE.Mesh(geometry, material);
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
