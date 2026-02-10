import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { CardMeshFactory } from './CardMeshFactory.js';
import { CardPicker } from './CardPicker.js';

const canvas = document.getElementById('single-card-canvas');
const statusEl = document.getElementById('single-card-status');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101522);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 4.4, 7.2);
camera.lookAt(0, 0, 0);

const hemiLight = new THREE.HemisphereLight(0xeaf2ff, 0x202938, 0.85);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(4, 8, 6);
keyLight.castShadow = true;
scene.add(keyLight);

const table = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x1c2434, roughness: 0.95, metalness: 0.03 }),
);
table.rotation.x = -Math.PI / 2;
table.position.y = -0.7;
table.receiveShadow = true;
scene.add(table);

const cards = [];
const cardConfigs = [
  { id: 'card-alpha', color: 0x5f8dff, x: -2.4, z: -0.4 },
  { id: 'card-beta', color: 0x8f6cff, x: -0.8, z: 0.2 },
  { id: 'card-gamma', color: 0x2dc6ad, x: 0.9, z: -0.1 },
  { id: 'card-delta', color: 0xf28a65, x: 2.5, z: 0.4 },
];

for (const config of cardConfigs) {
  const card = CardMeshFactory.createCard({
    id: config.id,
    width: 1.8,
    height: 2.5,
    thickness: 0.08,
    cornerRadius: 0.15,
    color: config.color,
  });
  card.position.set(config.x, 0, config.z);
  scene.add(card);
  cards.push(card);
}

const picker = new CardPicker({ camera, domElement: canvas, cards });

const state = {
  activePointerId: null,
  pickedCard: null,
  pointerNdc: new THREE.Vector2(),
};

const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragPoint = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

function setStatus(message) {
  statusEl.textContent = message;
}

function updateSize() {
  const parent = canvas.parentElement;
  const width = parent.clientWidth;
  const height = Math.max(380, window.innerHeight - 140);

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function eventToNdc(event) {
  const rect = canvas.getBoundingClientRect();
  state.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}


async function loadCardState() {
  try {
    const response = await fetch('/api/cards');
    if (!response.ok) {
      throw new Error(`Server responded ${response.status}`);
    }
    const payload = await response.json();
    const known = payload.cards?.length ?? 0;
    setStatus(`Ready: click/touch a card to pick it up. Server knows ${known} cards.`);
  } catch (error) {
    setStatus(`Ready: click/touch a card to pick it up. Server sync unavailable (${error.message}).`);
  }
}

async function sendCardEvent(cardId, action) {
  try {
    const response = await fetch(`/api/cards/${cardId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: Date.now() }),
    });
    if (!response.ok) {
      throw new Error(`Server responded ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    setStatus(`Server comms error: ${error.message}`);
    return null;
  }
}

async function handlePointerDown(event) {
  canvas.setPointerCapture(event.pointerId);
  state.activePointerId = event.pointerId;

  const card = picker.pick(event);
  if (!card) {
    setStatus('No card selected.');
    return;
  }

  cards.forEach((entry) => {
    entry.userData.mesh.material.emissive.setHex(0x000000);
  });

  state.pickedCard = card;
  const { mesh, tiltPivot } = card.userData;
  mesh.material.emissive.setHex(0x111111);
  tiltPivot.rotation.x = -0.25;

  card.position.y = 0.45;
  card.renderOrder = 10;

  await sendCardEvent(card.userData.cardId, 'pickup');
  setStatus(`Picked up ${card.userData.cardId}. Drag and release to put it down.`);
}

async function handlePointerMove(event) {
  if (state.activePointerId !== event.pointerId || !state.pickedCard) {
    return;
  }

  eventToNdc(event);
  raycaster.setFromCamera(state.pointerNdc, camera);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
    return;
  }

  const card = state.pickedCard;
  card.position.x = dragPoint.x;
  card.position.z = dragPoint.z;

  const { tiltPivot } = card.userData;
  tiltPivot.rotation.y = THREE.MathUtils.clamp((dragPoint.x - card.position.x) * 0.5, -0.2, 0.2);
}

async function handlePointerUp(event) {
  if (state.activePointerId !== event.pointerId) {
    return;
  }

  canvas.releasePointerCapture(event.pointerId);

  if (!state.pickedCard) {
    state.activePointerId = null;
    return;
  }

  const card = state.pickedCard;
  const { mesh, tiltPivot } = card.userData;

  card.position.y = 0;
  card.renderOrder = 0;
  tiltPivot.rotation.set(0, 0, 0);
  mesh.material.emissive.setHex(0x000000);

  await sendCardEvent(card.userData.cardId, 'putdown');
  setStatus(`Put down ${card.userData.cardId}.`);

  state.activePointerId = null;
  state.pickedCard = null;
}

function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointercancel', handlePointerUp);
window.addEventListener('resize', updateSize);

updateSize();
animate();
loadCardState();
