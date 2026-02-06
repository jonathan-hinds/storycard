import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';

const canvas = document.getElementById('die-canvas');
const dieList = document.getElementById('die-list');
const createDieForm = document.getElementById('create-die-form');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
camera.position.set(0, 15, 0.001);
camera.lookAt(0, 0, 0);

const ambient = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambient);

const topLight = new THREE.DirectionalLight(0xffffff, 0.6);
topLight.position.set(0, 8, 2);
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

function makeDieTexture(sides) {
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 512;
  texCanvas.height = 512;
  const ctx = texCanvas.getContext('2d');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 512);

  ctx.translate(256, 256);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(0, 0, 220, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * 170;
    const y = Math.sin(angle) * 170;
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y);
  }

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(22, 20);
  ctx.lineTo(-22, 20);
  ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(texCanvas);
  texture.needsUpdate = true;
  return texture;
}

function createDieMesh(sides) {
  const radius = 0.8;
  const height = 0.35;
  const geometry = new THREE.CylinderGeometry(radius, radius, height, sides);
  const texture = makeDieTexture(sides);

  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x334155 }),
    new THREE.MeshStandardMaterial({ map: texture }),
    new THREE.MeshStandardMaterial({ color: 0x1e293b }),
  ];

  return new THREE.Mesh(geometry, materials);
}

function createConfinedArea(offsetX, offsetZ, areaSize) {
  const group = new THREE.Group();
  group.position.set(offsetX, 0, offsetZ);

  const floorGeom = new THREE.PlaneGeometry(areaSize, areaSize);
  const floor = new THREE.Mesh(
    floorGeom,
    new THREE.MeshStandardMaterial({ color: 0x192031, transparent: true, opacity: 0.6 }),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(areaSize, 0.05, areaSize)),
    new THREE.LineBasicMaterial({ color: 0x94a3b8 }),
  );
  box.position.y = 0.02;
  group.add(box);

  const pointer = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.35, 3),
    new THREE.MeshStandardMaterial({ color: 0xeab308 }),
  );
  pointer.position.set(0, 0.22, -areaSize / 2 + 0.45);
  pointer.rotation.x = Math.PI;
  group.add(pointer);

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
  mesh.position.set(frame.x, 0.23, frame.y);
  mesh.rotation.set(0, -frame.angle, 0);
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
  const group = createConfinedArea(0, 0, die.areaSize);
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
      visual.animation = null;
    }
  }

  if (selectedDieId) {
    const selected = dieVisuals.get(selectedDieId);
    if (selected) {
      camera.position.x += (selected.group.position.x - camera.position.x) * 0.08;
      camera.position.z += (selected.group.position.z + 0.001 - camera.position.z) * 0.08;
      camera.lookAt(selected.group.position.x, 0, selected.group.position.z);
    }
  }

  renderer.render(scene, camera);
}

tick();
refreshDice();
