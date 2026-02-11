import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { CardMeshFactory } from './CardMeshFactory.js';
import { CardPicker } from './CardPicker.js';

const canvas = document.getElementById('single-card-canvas');
const canvasContainer = canvas.parentElement;
const statusEl = document.getElementById('single-card-status');
const resetBtn = document.getElementById('single-card-reset');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101522);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 8.2, 4.8);
camera.lookAt(0, 0, 0.4);

const CAMERA_BASE_FOV = 45;
const CAMERA_BASE_Y = 8.2;
const CAMERA_BASE_Z = 4.8;
const CAMERA_LOOK_AT_Y = 0;
const CAMERA_LOOK_AT_Z = 0.4;
const CAMERA_PORTRAIT_FOV_BOOST = 20;
const CAMERA_PORTRAIT_Y_BOOST = 3.2;
const CAMERA_PORTRAIT_Z_BOOST = 1.8;

const HAND_BASE_Z = 3.2;
const HAND_CAMERA_CLOSENESS = 0.45;
const HAND_PORTRAIT_CLOSENESS = 0.35;

const hemiLight = new THREE.HemisphereLight(0xeaf2ff, 0x202938, 0.9);
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
table.position.y = -0.72;
table.receiveShadow = true;
scene.add(table);

const boardArea = new THREE.Mesh(
  new THREE.PlaneGeometry(8.3, 5.8),
  new THREE.MeshStandardMaterial({
    color: 0x243146,
    roughness: 0.85,
    metalness: 0.06,
    transparent: true,
    opacity: 0.45,
  }),
);
boardArea.position.set(0, -0.71, 0.15);
boardArea.rotation.x = -Math.PI / 2;
scene.add(boardArea);

const playerTerritoryArea = new THREE.Mesh(
  new THREE.PlaneGeometry(8.3, 2.9),
  new THREE.MeshStandardMaterial({
    color: 0x2f4c7f,
    roughness: 0.86,
    metalness: 0.08,
    transparent: true,
    opacity: 0.38,
  }),
);
playerTerritoryArea.position.set(0, -0.708, 1.6);
playerTerritoryArea.rotation.x = -Math.PI / 2;
scene.add(playerTerritoryArea);

const opponentTerritoryArea = new THREE.Mesh(
  new THREE.PlaneGeometry(8.3, 2.9),
  new THREE.MeshStandardMaterial({
    color: 0x5a2f4f,
    roughness: 0.86,
    metalness: 0.08,
    transparent: true,
    opacity: 0.26,
  }),
);
opponentTerritoryArea.position.set(0, -0.708, -1.3);
opponentTerritoryArea.rotation.x = -Math.PI / 2;
scene.add(opponentTerritoryArea);

const handArea = new THREE.Mesh(
  new THREE.PlaneGeometry(8.6, 2),
  new THREE.MeshStandardMaterial({
    color: 0x1f2a3f,
    roughness: 0.9,
    metalness: 0.04,
    transparent: true,
    opacity: 0.55,
  }),
);
handArea.position.set(0, -0.71, 3.2);
handArea.rotation.x = -Math.PI / 2;
scene.add(handArea);

const cards = [];
const boardSlots = [];
const deckSlots = [];
const playerBoardSlotMaterial = new THREE.MeshStandardMaterial({
  color: 0x7ca0e7,
  transparent: true,
  opacity: 0.2,
  roughness: 0.85,
  metalness: 0.08,
});

const opponentBoardSlotMaterial = new THREE.MeshStandardMaterial({
  color: 0xd08db1,
  transparent: true,
  opacity: 0.17,
  roughness: 0.9,
  metalness: 0.08,
});

const GRID_COLUMN_SPACING = 2.1;
const GRID_START_X = -3.15;
const GRID_COLUMNS = [
  GRID_START_X,
  GRID_START_X + GRID_COLUMN_SPACING,
  GRID_START_X + GRID_COLUMN_SPACING * 2,
  GRID_START_X + GRID_COLUMN_SPACING * 3,
];

const boardSlotLayout = [
  { x: GRID_COLUMNS[1], z: -1.3, side: 'opponent' },
  { x: GRID_COLUMNS[2], z: -1.3, side: 'opponent' },
  { x: GRID_COLUMNS[3], z: -1.3, side: 'opponent' },
  { x: GRID_COLUMNS[1], z: 1.6, side: 'player' },
  { x: GRID_COLUMNS[2], z: 1.6, side: 'player' },
  { x: GRID_COLUMNS[3], z: 1.6, side: 'player' },
];

const deckSlotLayout = [
  { x: GRID_COLUMNS[0], z: -1.3, side: 'opponent' },
  { x: GRID_COLUMNS[0], z: 1.6, side: 'player' },
];

const PLAYER_SIDE = 'player';

boardSlotLayout.forEach((slot, index) => {
  const slotMaterial = slot.side === PLAYER_SIDE
    ? playerBoardSlotMaterial.clone()
    : opponentBoardSlotMaterial.clone();
  const slotMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.95, 2.65),
    slotMaterial,
  );
  slotMesh.rotation.x = -Math.PI / 2;
  slotMesh.position.set(slot.x, -0.695, slot.z);
  scene.add(slotMesh);
  boardSlots.push({
    index,
    x: slot.x,
    z: slot.z,
    side: slot.side,
    card: null,
    mesh: slotMesh,
  });
});

deckSlotLayout.forEach((slot) => {
  const zoneColor = slot.side === PLAYER_SIDE ? 0x5f83c7 : 0xa06085;
  const slotMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.95, 2.65),
    new THREE.MeshStandardMaterial({
      color: zoneColor,
      transparent: true,
      opacity: 0.26,
      roughness: 0.86,
      metalness: 0.07,
    }),
  );

  slotMesh.rotation.x = -Math.PI / 2;
  slotMesh.position.set(slot.x, -0.694, slot.z);
  scene.add(slotMesh);

  const deck = CardMeshFactory.createCard({
    id: `${slot.side}-deck`,
    width: 1.8,
    height: 2.5,
    thickness: 0.42,
    cornerRadius: 0.15,
    color: slot.side === PLAYER_SIDE ? 0x2e436a : 0x5d3653,
  });

  deck.position.set(slot.x, 0.17, slot.z);
  deck.rotation.set(-Math.PI / 2, 0, 0);
  deck.userData.zone = 'deck';
  deck.userData.owner = slot.side;
  deck.userData.locked = true;
  scene.add(deck);

  deckSlots.push({
    ...slot,
    mesh: slotMesh,
    deck,
  });
});

const initialCards = [
  { id: 'card-alpha', color: 0x5f8dff, zone: 'board', slotIndex: 0, owner: 'opponent' },
  { id: 'card-beta', color: 0x8f6cff, zone: 'board', slotIndex: 1, owner: 'opponent' },
  { id: 'card-gamma', color: 0x2dc6ad, zone: 'board', slotIndex: 3, owner: 'player' },
  { id: 'card-delta', color: 0xf28a65, zone: 'board', slotIndex: 4, owner: 'player' },
  { id: 'card-epsilon', color: 0xf1c965, zone: 'hand' },
  { id: 'card-zeta', color: 0xe76fb9, zone: 'hand' },
];

const picker = new CardPicker({ camera, domElement: canvas, cards });
const raycaster = new THREE.Raycaster();
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const planePoint = new THREE.Vector3();
const pointerNdc = new THREE.Vector2();

const PREVIEW_HOLD_DELAY_MS = 230;
const DRAG_START_DISTANCE_PX = 10;
const CARD_FACE_ROTATION_X = -Math.PI / 2;
const HAND_CARD_BASE_Y = 0.1;
const HAND_CARD_ARC_LIFT = 0.06;
const HAND_CARD_FAN_ROTATION_Z = 0.08;

const state = {
  activePointerId: null,
  pendingCard: null,
  activeCard: null,
  mode: 'idle',
  holdTimer: 0,
  lastPointer: { x: 0, y: 0 },
  pressPointer: { x: 0, y: 0 },
  previewStartedAt: 0,
  dragOrigin: null,
  dropSlotIndex: null,
  activePose: {
    position: new THREE.Vector3(),
    rotation: new THREE.Euler(CARD_FACE_ROTATION_X, 0, 0),
  },
  portraitIntensity: 0,
};

function setActiveCardPose(position, rotationX, rotationY = 0, rotationZ = 0) {
  state.activePose.position.copy(position);
  state.activePose.rotation.set(rotationX, rotationY, rotationZ);
}

function applyHandledCardSway(time) {
  const card = state.activeCard;
  if (!card || (state.mode !== 'preview' && state.mode !== 'drag')) {
    return;
  }

  const elapsed = (time - state.previewStartedAt) * 0.001;
  const basePos = state.activePose.position;
  const baseRot = state.activePose.rotation;

  const swayPosition = state.mode === 'preview'
    ? new THREE.Vector3(
      Math.sin(elapsed * 1.8) * 0.22,
      Math.sin(elapsed * 2.4) * 0.07,
      Math.cos(elapsed * 1.6) * 0.16,
    )
    : new THREE.Vector3(
      Math.sin(elapsed * 3.6) * 0.05,
      Math.sin(elapsed * 5.2) * 0.03,
      Math.cos(elapsed * 4.1) * 0.04,
    );

  card.position.set(
    basePos.x + swayPosition.x,
    basePos.y + swayPosition.y,
    basePos.z + swayPosition.z,
  );

  const swayAmount = state.mode === 'preview' ? 1 : 0.8;
  card.rotation.set(
    baseRot.x + Math.sin(elapsed * 2.2) * 0.04 * swayAmount,
    baseRot.y + Math.sin(elapsed * 1.5) * 0.18 * swayAmount,
    baseRot.z + Math.cos(elapsed * 1.8) * 0.03 * swayAmount,
  );
}

function setStatus(message) {
  statusEl.textContent = message;
}

function updateSize() {
  const parent = canvas.parentElement;
  const width = parent.clientWidth;
  const compactViewport = window.innerWidth <= 900;
  const minHeight = compactViewport ? 320 : 460;
  const height = Math.max(minHeight, window.innerHeight - 140);
  const aspect = width / height;
  const portraitIntensity = THREE.MathUtils.clamp((1 - aspect) / 0.45, 0, 1);
  state.portraitIntensity = portraitIntensity;

  camera.fov = CAMERA_BASE_FOV + portraitIntensity * CAMERA_PORTRAIT_FOV_BOOST;
  camera.position.set(
    0,
    CAMERA_BASE_Y + portraitIntensity * CAMERA_PORTRAIT_Y_BOOST,
    CAMERA_BASE_Z + portraitIntensity * CAMERA_PORTRAIT_Z_BOOST,
  );
  camera.lookAt(0, CAMERA_LOOK_AT_Y, CAMERA_LOOK_AT_Z);

  renderer.setSize(width, height, false);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  handArea.position.z = HAND_BASE_Z + HAND_CAMERA_CLOSENESS + portraitIntensity * HAND_PORTRAIT_CLOSENESS;
  relayoutBoardAndHand();
}

function clearHighlights() {
  for (const slot of boardSlots) {
    slot.mesh.material.opacity = slot.side === PLAYER_SIDE ? 0.2 : 0.17;
  }

  for (const card of cards) {
    card.userData.mesh.material.emissive.setHex(0x000000);
  }
}

function cardWorldPositionForHand(indexInHand, totalInHand) {
  const spread = Math.max(totalInHand - 1, 1);
  const normalizedIndex = spread === 0 ? 0 : indexInHand / spread - 0.5;
  const x = (indexInHand - spread / 2) * 2.0;
  const y = HAND_CARD_BASE_Y + (0.5 - Math.abs(normalizedIndex)) * HAND_CARD_ARC_LIFT;
  const handZ = HAND_BASE_Z + HAND_CAMERA_CLOSENESS + state.portraitIntensity * HAND_PORTRAIT_CLOSENESS;
  const z = handZ + Math.abs(normalizedIndex) * 0.12;

  return new THREE.Vector3(x, y, z);
}

function relayoutBoardAndHand() {
  boardSlots.forEach((slot) => {
    if (!slot.card) {
      return;
    }

    const card = slot.card;
    if (card === state.activeCard && (state.mode === 'drag' || state.mode === 'preview')) {
      return;
    }

    card.userData.zone = 'board';
    card.userData.slotIndex = slot.index;
    card.position.set(slot.x, 0, slot.z);
    card.rotation.set(CARD_FACE_ROTATION_X, 0, 0);
  });

  const handCards = cards.filter((card) => card.userData.zone === 'hand');
  handCards.forEach((card, index) => {
    if (card === state.activeCard && (state.mode === 'drag' || state.mode === 'preview')) {
      return;
    }

    const pos = cardWorldPositionForHand(index, handCards.length);
    card.position.copy(pos);
    const spread = Math.max(handCards.length - 1, 1);
    const normalizedIndex = spread === 0 ? 0 : index / spread - 0.5;
    card.rotation.set(CARD_FACE_ROTATION_X, 0, -normalizedIndex * HAND_CARD_FAN_ROTATION_Z);
    card.userData.slotIndex = null;
  });
}

function setCardAsActive(card, mode) {
  state.activeCard = card;
  state.mode = mode;
  state.previewStartedAt = performance.now();

  card.renderOrder = 10;
  card.userData.mesh.material.emissive.setHex(0x111111);
  card.userData.tiltPivot.rotation.set(0, 0, 0);

  if (mode === 'preview') {
    setActiveCardPose(new THREE.Vector3(0, 1.52, 1.08), -0.68, 0, 0);
  } else {
    setActiveCardPose(card.position, CARD_FACE_ROTATION_X + 0.24, 0, 0);
  }

  setStatus(
    mode === 'drag'
      ? `Dragging ${card.userData.cardId}. Release to commit to a board slot.`
      : `Previewing ${card.userData.cardId}. Move to drag or release to return.`,
  );
}

function clearActiveCard({ restore = true } = {}) {
  if (!state.activeCard) {
    return;
  }

  const card = state.activeCard;
  card.renderOrder = 0;
  card.userData.mesh.material.emissive.setHex(0x000000);
  card.userData.tiltPivot.rotation.set(0, 0, 0);

  if (restore) {
    relayoutBoardAndHand();
  }

  state.activeCard = null;
  state.mode = 'idle';
  state.dropSlotIndex = null;
}

function getPointerDistanceFromPress(event) {
  const dx = event.clientX - state.pressPointer.x;
  const dy = event.clientY - state.pressPointer.y;
  return Math.hypot(dx, dy);
}

function eventToNdc(event) {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pointerToBoardPoint(event) {
  eventToNdc(event);
  raycaster.setFromCamera(pointerNdc, camera);
  if (!raycaster.ray.intersectPlane(boardPlane, planePoint)) {
    return null;
  }
  return planePoint;
}

function findNearestSlot(worldPoint, maxDistance = 1.25) {
  let closest = null;
  let closestDist = Infinity;

  for (const slot of boardSlots) {
    if (slot.side !== PLAYER_SIDE) {
      continue;
    }

    if (slot.card && slot.card !== state.activeCard) {
      continue;
    }

    const d = Math.hypot(worldPoint.x - slot.x, worldPoint.z - slot.z);
    if (d < closestDist) {
      closest = slot;
      closestDist = d;
    }
  }

  if (!closest || closestDist > maxDistance) {
    return null;
  }

  return closest;
}

function updateDragPoseFromPointer(event) {
  const card = state.activeCard;
  if (!card) {
    return;
  }

  const point = pointerToBoardPoint(event);
  if (!point) {
    return;
  }

  setActiveCardPose(point.clone().setY(0.35), CARD_FACE_ROTATION_X + 0.24, 0, 0);

  const slot = findNearestSlot(point);
  state.dropSlotIndex = slot?.index ?? null;

  for (const boardSlot of boardSlots) {
    if (boardSlot.side !== PLAYER_SIDE) {
      boardSlot.mesh.material.opacity = 0.17;
      continue;
    }

    boardSlot.mesh.material.opacity = boardSlot.index === state.dropSlotIndex ? 0.55 : 0.2;
  }
}

function beginDrag(card) {
  if (!card) {
    return;
  }

  if (state.mode === 'idle') {
    setCardAsActive(card, 'drag');
  } else {
    state.mode = 'drag';
    setStatus(`Dragging ${card.userData.cardId}. Release to commit to a board slot.`);
  }

  window.clearTimeout(state.holdTimer);
  state.holdTimer = 0;
}

async function loadCardState() {
  try {
    const response = await fetch('/api/cards');
    if (!response.ok) {
      throw new Error(`Server responded ${response.status}`);
    }
    const payload = await response.json();
    const known = payload.cards?.length ?? 0;
    setStatus(`Ready. Each side has 3 board slots plus a reserved deck slot. You can only play into your side. Server knows ${known} cards.`);
  } catch (error) {
    setStatus(`Ready. Each side has 3 board slots plus a reserved deck slot. You can only play into your side. Server sync unavailable (${error.message}).`);
  }
}

async function sendCardEvent(cardId, action, extra = {}) {
  try {
    const response = await fetch(`/api/cards/${cardId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: Date.now(), ...extra }),
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

function resetDemo() {
  clearHighlights();
  clearActiveCard({ restore: false });
  window.clearTimeout(state.holdTimer);
  state.holdTimer = 0;
  state.activePointerId = null;

  boardSlots.forEach((slot) => {
    slot.card = null;
  });

  for (const card of cards) {
    scene.remove(card);
  }
  cards.length = 0;
  for (const cfg of initialCards) {
    const card = CardMeshFactory.createCard({
      id: cfg.id,
      width: 1.8,
      height: 2.5,
      thickness: 0.08,
      cornerRadius: 0.15,
      color: cfg.color,
    });

    card.userData.zone = cfg.zone;
    card.userData.slotIndex = cfg.slotIndex ?? null;
    card.userData.owner = cfg.owner ?? 'player';
    card.rotation.set(CARD_FACE_ROTATION_X, 0, 0);

    if (cfg.zone === 'board' && Number.isInteger(cfg.slotIndex)) {
      const slot = boardSlots[cfg.slotIndex];
      if (slot) {
        slot.card = card;
        card.position.set(slot.x, 0, slot.z);
      }
    }

    scene.add(card);
    cards.push(card);
  }

  relayoutBoardAndHand();
  picker.setCards(cards);
  setStatus('Demo reset. Each player can place up to 3 cards on their side; deck slots are reserved for future draw flows.');
}

async function handlePointerDown(event) {
  if (state.activePointerId != null) {
    return;
  }

  canvasContainer.setPointerCapture(event.pointerId);
  state.activePointerId = event.pointerId;
  state.pressPointer.x = event.clientX;
  state.pressPointer.y = event.clientY;
  state.lastPointer.x = event.clientX;
  state.lastPointer.y = event.clientY;
  state.dropSlotIndex = null;

  const card = picker.pick(event);
  if (!card) {
    state.activePointerId = null;
    state.pendingCard = null;
    if (canvasContainer.hasPointerCapture(event.pointerId)) {
      canvasContainer.releasePointerCapture(event.pointerId);
    }
    setStatus('No card selected.');
    return;
  }

  if (card.userData.zone === 'board' && card.userData.owner !== PLAYER_SIDE) {
    state.activePointerId = null;
    state.pendingCard = null;
    if (canvasContainer.hasPointerCapture(event.pointerId)) {
      canvasContainer.releasePointerCapture(event.pointerId);
    }
    setStatus('Opponent cards are locked to their side. Drag one of your cards instead.');
    return;
  }

  state.pendingCard = card;
  clearHighlights();
  state.dragOrigin = {
    zone: card.userData.zone,
    slotIndex: card.userData.slotIndex,
  };

  if (card.userData.zone === 'board' && Number.isInteger(card.userData.slotIndex)) {
    boardSlots[card.userData.slotIndex].card = null;
  }

  await sendCardEvent(card.userData.cardId, 'pickup', { zone: state.dragOrigin.zone });

  state.holdTimer = window.setTimeout(() => {
    if (state.activePointerId !== event.pointerId || state.mode !== 'idle') {
      return;
    }
    setCardAsActive(card, 'preview');
  }, PREVIEW_HOLD_DELAY_MS);
}

function handlePointerMove(event) {
  if (state.activePointerId !== event.pointerId) {
    return;
  }

  state.lastPointer.x = event.clientX;
  state.lastPointer.y = event.clientY;

  const distance = getPointerDistanceFromPress(event);
  const card = state.activeCard ?? state.pendingCard;

  if (state.mode === 'idle' && card && distance > DRAG_START_DISTANCE_PX) {
    setCardAsActive(card, 'drag');
    beginDrag(card);
  }

  if (state.mode === 'preview' && distance > DRAG_START_DISTANCE_PX && state.activeCard) {
    beginDrag(state.activeCard);
  }

  if (state.mode === 'drag' && state.activeCard) {
    event.preventDefault();
    updateDragPoseFromPointer(event);
  }
}

async function endPointerInteraction(event, { commitDrop = true } = {}) {
  if (state.activePointerId !== event.pointerId) {
    return;
  }

  if (canvasContainer.hasPointerCapture(event.pointerId)) {
    canvasContainer.releasePointerCapture(event.pointerId);
  }
  window.clearTimeout(state.holdTimer);
  state.holdTimer = 0;

  const card = state.activeCard;
  const prevOrigin = state.dragOrigin;

  if (card && commitDrop && state.mode === 'drag' && state.dropSlotIndex != null) {
    const slot = boardSlots[state.dropSlotIndex];
    slot.card = card;
    card.userData.zone = 'board';
    card.userData.slotIndex = slot.index;
    card.position.set(slot.x, 0, slot.z);
    card.rotation.set(CARD_FACE_ROTATION_X, 0, 0);

    await sendCardEvent(card.userData.cardId, 'putdown', { zone: 'board', slotIndex: slot.index });
    card.userData.owner = PLAYER_SIDE;
    setStatus(`Placed ${card.userData.cardId} into board slot ${slot.index + 1}.`);
  } else if (card) {
    if (prevOrigin?.zone === 'board' && Number.isInteger(prevOrigin.slotIndex)) {
      const slot = boardSlots[prevOrigin.slotIndex];
      slot.card = card;
      card.userData.zone = 'board';
      card.userData.slotIndex = slot.index;
      card.position.set(slot.x, 0, slot.z);
    } else {
      card.userData.zone = 'hand';
      card.userData.slotIndex = null;
    }

    card.rotation.set(CARD_FACE_ROTATION_X, 0, 0);

    await sendCardEvent(card.userData.cardId, 'putdown', {
      zone: card.userData.zone,
      slotIndex: card.userData.slotIndex,
    });

    setStatus(
      state.mode === 'preview'
        ? `Preview closed for ${card.userData.cardId}.`
        : `Returned ${card.userData.cardId} to ${card.userData.zone}.`,
    );
  }

  clearHighlights();
  clearActiveCard({ restore: true });
  relayoutBoardAndHand();

  state.activePointerId = null;
  state.pendingCard = null;
  state.dragOrigin = null;
}

async function handlePointerUp(event) {
  await endPointerInteraction(event, { commitDrop: true });
}

async function handlePointerCancel(event) {
  await endPointerInteraction(event, { commitDrop: false });
}

function animate(time) {
  applyHandledCardSway(time);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

canvasContainer.addEventListener('pointerdown', handlePointerDown);
canvasContainer.addEventListener('pointermove', handlePointerMove);
canvasContainer.addEventListener('pointerup', handlePointerUp);
canvasContainer.addEventListener('pointercancel', handlePointerCancel);
window.addEventListener('resize', updateSize);
resetBtn.addEventListener('click', resetDemo);

updateSize();
resetDemo();
animate();
loadCardState();
