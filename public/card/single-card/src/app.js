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

const slots = [];
const cards = [];
const cardConfigs = [
  { id: 'card-alpha', color: 0x5f8dff, x: -1.5, z: -1.15 },
  { id: 'card-beta', color: 0x8f6cff, x: 1.5, z: -1.15 },
  { id: 'card-gamma', color: 0x2dc6ad, x: -1.5, z: 1.15 },
  { id: 'card-delta', color: 0xf28a65, x: 1.5, z: 1.15 },
];

const BOARD_Y = -0.54;
const PICKUP_Y = 0.85;
const RESTING_ROTATION_X = -Math.PI / 2;

for (const config of cardConfigs) {
  const slot = new THREE.Mesh(
    new THREE.PlaneGeometry(2.05, 2.8),
    new THREE.MeshStandardMaterial({
      color: 0x162132,
      roughness: 0.98,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
    }),
  );
  slot.rotation.x = -Math.PI / 2;
  slot.position.set(config.x, -0.69, config.z);
  slot.receiveShadow = true;
  scene.add(slot);
  slots.push(slot);

  const card = CardMeshFactory.createCard({
    id: config.id,
    width: 1.8,
    height: 2.5,
    thickness: 0.08,
    cornerRadius: 0.15,
    color: config.color,
  });

  card.position.set(config.x, BOARD_Y, config.z);
  card.rotation.set(RESTING_ROTATION_X, 0, 0);
  card.userData.home = {
    position: new THREE.Vector3(config.x, BOARD_Y, config.z),
    rotation: new THREE.Euler(RESTING_ROTATION_X, 0, 0),
  };

  scene.add(card);
  cards.push(card);
}

const picker = new CardPicker({ camera, domElement: canvas, cards });

const state = {
  activePointerId: null,
  pickedCard: null,
  pointerNdc: new THREE.Vector2(),
};

const focusCardPosition = new THREE.Vector3(0, PICKUP_Y, 2.4);
const focusCardRotation = new THREE.Euler(-0.34, 0, 0);
const clock = new THREE.Clock();

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

async function loadCardState() {
  try {
    const response = await fetch('/api/cards');
    if (!response.ok) {
      throw new Error(`Server responded ${response.status}`);
    }
    const payload = await response.json();
    const known = payload.cards?.length ?? 0;
    setStatus(`Ready: hold a card to zoom it. Server knows ${known} cards.`);
  } catch (error) {
    setStatus(`Ready: hold a card to zoom it. Server sync unavailable (${error.message}).`);
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

function resetVisualState(card) {
  const { mesh, tiltPivot } = card.userData;
  tiltPivot.rotation.set(0, 0, 0);
  mesh.material.emissive.setHex(0x000000);
  card.renderOrder = 0;
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
  card.userData.mesh.material.emissive.setHex(0x111111);
  card.renderOrder = 10;

  await sendCardEvent(card.userData.cardId, 'pickup');
  setStatus(`Holding ${card.userData.cardId}. Release to return it to its slot.`);
}

function handlePointerMove(event) {
  if (state.activePointerId !== event.pointerId || !state.pickedCard) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  state.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
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
  await sendCardEvent(card.userData.cardId, 'putdown');
  setStatus(`Returned ${card.userData.cardId} to the board.`);

  state.activePointerId = null;
  state.pickedCard = null;
}

function animateCards(timeSeconds) {
  for (const card of cards) {
    const { home, tiltPivot } = card.userData;
    const isPicked = state.pickedCard === card;

    if (isPicked) {
      const orbitX = Math.sin(timeSeconds * 1.4) * 0.24;
      const orbitY = Math.cos(timeSeconds * 1.8) * 0.08;

      const targetPosition = new THREE.Vector3(
        focusCardPosition.x + orbitX,
        focusCardPosition.y + orbitY,
        focusCardPosition.z,
      );
      card.position.lerp(targetPosition, 0.15);

      const lookTiltY = THREE.MathUtils.clamp(state.pointerNdc.x * 0.2, -0.2, 0.2);
      const lookTiltX = THREE.MathUtils.clamp(state.pointerNdc.y * 0.16, -0.16, 0.16);

      card.rotation.x = THREE.MathUtils.lerp(card.rotation.x, focusCardRotation.x, 0.13);
      card.rotation.y = THREE.MathUtils.lerp(card.rotation.y, focusCardRotation.y, 0.13);
      card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, focusCardRotation.z, 0.13);

      tiltPivot.rotation.x = THREE.MathUtils.lerp(tiltPivot.rotation.x, 0.08 + lookTiltX, 0.2);
      tiltPivot.rotation.y = THREE.MathUtils.lerp(tiltPivot.rotation.y, lookTiltY, 0.2);
      tiltPivot.rotation.z = THREE.MathUtils.lerp(tiltPivot.rotation.z, Math.sin(timeSeconds * 2.5) * 0.05, 0.18);
      continue;
    }

    card.position.lerp(home.position, 0.2);
    card.rotation.x = THREE.MathUtils.lerp(card.rotation.x, home.rotation.x, 0.2);
    card.rotation.y = THREE.MathUtils.lerp(card.rotation.y, home.rotation.y, 0.2);
    card.rotation.z = THREE.MathUtils.lerp(card.rotation.z, home.rotation.z, 0.2);

    if (state.pickedCard !== card) {
      resetVisualState(card);
    }
  }
}

function animate() {
  const elapsed = clock.getElapsedTime();
  animateCards(elapsed);
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
