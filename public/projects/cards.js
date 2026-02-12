import { CardLibraryScene } from '/public/projects/card-library/CardLibraryScene.js';

const form = document.getElementById('create-card-form');
const status = document.getElementById('create-card-status');
const cardList = document.getElementById('card-list');
const typeSelect = document.getElementById('card-type');
const cardLibraryCanvas = document.getElementById('card-library-canvas');
const cardLibraryStageWrap = cardLibraryCanvas.parentElement;
const previewOffsetXInput = document.getElementById('preview-offset-x');
const previewOffsetYInput = document.getElementById('preview-offset-y');
const previewClosenessInput = document.getElementById('preview-closeness');
const previewOffsetXValue = document.getElementById('preview-offset-x-value');
const previewOffsetYValue = document.getElementById('preview-offset-y-value');
const previewClosenessValue = document.getElementById('preview-closeness-value');

const CARD_LIBRARY_PREVIEW_DEFAULTS = {
  position: {
    x: 0,
    y: -1.35,
    z: 4.3,
    desktopZ: 3.75,
  },
  rotation: {
    x: 1.15,
  },
};

const CARD_LIBRARY_COMPACT_BREAKPOINT_PX = 900;
const PREVIEW_Z_CAMERA_PADDING = 1.2;
const PREVIEW_Z_MAX_CAP = 14;
const PREVIEW_Z_RANGE = Object.freeze({
  desktop: { min: 1.5, max: 6 },
  mobile: { min: -2, max: 6 },
});
const PREVIEW_CLOSENESS_RANGE = Object.freeze({
  min: 0,
  max: 100,
});

let previewCloseness = Number.parseFloat(previewClosenessInput.value);

let cardLibraryScene;

function getDynamicPreviewZMax(baseMax) {
  const cameraDistance = cardLibraryScene?.camera?.position?.z;
  if (!Number.isFinite(cameraDistance)) return baseMax;
  return Math.min(PREVIEW_Z_MAX_CAP, Math.max(baseMax, cameraDistance - PREVIEW_Z_CAMERA_PADDING));
}

function getPreviewZBounds() {
  const baseBounds = window.innerWidth <= CARD_LIBRARY_COMPACT_BREAKPOINT_PX
    ? PREVIEW_Z_RANGE.mobile
    : PREVIEW_Z_RANGE.desktop;
  return {
    ...baseBounds,
    max: getDynamicPreviewZMax(baseBounds.max),
  };
}

function applyPreviewZBounds() {
  const bounds = getPreviewZBounds();
  previewCloseness = Math.min(PREVIEW_CLOSENESS_RANGE.max, Math.max(PREVIEW_CLOSENESS_RANGE.min, previewCloseness));
  previewClosenessInput.min = String(PREVIEW_CLOSENESS_RANGE.min);
  previewClosenessInput.max = String(PREVIEW_CLOSENESS_RANGE.max);
  previewClosenessInput.value = String(previewCloseness);
  return bounds;
}

function getPreviewOffsetZFromCloseness(closeness, bounds) {
  const span = bounds.max - bounds.min;
  if (span <= 0) return bounds.min;
  const normalizedCloseness = (closeness - PREVIEW_CLOSENESS_RANGE.min)
    / (PREVIEW_CLOSENESS_RANGE.max - PREVIEW_CLOSENESS_RANGE.min);
  return bounds.min + (normalizedCloseness * span);
}

function getResponsivePreviewPosition() {
  const isCompactViewport = window.innerWidth <= CARD_LIBRARY_COMPACT_BREAKPOINT_PX;
  return {
    x: CARD_LIBRARY_PREVIEW_DEFAULTS.position.x,
    y: CARD_LIBRARY_PREVIEW_DEFAULTS.position.y,
    z: isCompactViewport
      ? CARD_LIBRARY_PREVIEW_DEFAULTS.position.z
      : CARD_LIBRARY_PREVIEW_DEFAULTS.position.desktopZ,
  };
}

cardLibraryScene = new CardLibraryScene({
  canvas: cardLibraryCanvas,
  scrollContainer: cardList,
  previewRotationOffset: { x: CARD_LIBRARY_PREVIEW_DEFAULTS.rotation.x },
  previewPositionOffset: getResponsivePreviewPosition(),
});

function syncPreviewPositionUI(position) {
  previewOffsetXInput.value = String(position.x);
  previewOffsetYInput.value = String(position.y);
  const bounds = getPreviewZBounds();
  const normalizedDepth = (position.z - bounds.min) / Math.max(0.0001, bounds.max - bounds.min);
  previewCloseness = Math.round(
    PREVIEW_CLOSENESS_RANGE.min + (Math.min(1, Math.max(0, normalizedDepth))
      * (PREVIEW_CLOSENESS_RANGE.max - PREVIEW_CLOSENESS_RANGE.min)),
  );
  previewClosenessInput.value = String(previewCloseness);
  previewOffsetXValue.textContent = position.x.toFixed(2);
  previewOffsetYValue.textContent = position.y.toFixed(2);
  previewClosenessValue.textContent = `${previewCloseness.toFixed(0)}%`;
}

function applyPreviewPositionFromControls() {
  previewCloseness = Number.parseFloat(previewClosenessInput.value);
  previewClosenessValue.textContent = `${previewCloseness.toFixed(0)}%`;
  const bounds = getPreviewZBounds();
  const position = {
    x: Number.parseFloat(previewOffsetXInput.value),
    y: Number.parseFloat(previewOffsetYInput.value),
    z: getPreviewOffsetZFromCloseness(previewCloseness, bounds),
  };

  previewOffsetXValue.textContent = position.x.toFixed(2);
  previewOffsetYValue.textContent = position.y.toFixed(2);

  cardLibraryScene.setPreviewDebugOffsets({
    position,
    rotation: { x: CARD_LIBRARY_PREVIEW_DEFAULTS.rotation.x },
  });
}

function onWindowResize() {
  applyPreviewZBounds();
  applyPreviewPositionFromControls();
}

syncPreviewPositionUI(getResponsivePreviewPosition());
applyPreviewZBounds();
applyPreviewPositionFromControls();
previewOffsetXInput.addEventListener('input', applyPreviewPositionFromControls);
previewOffsetYInput.addEventListener('input', applyPreviewPositionFromControls);
previewClosenessInput.addEventListener('input', applyPreviewPositionFromControls);

function renderCards(cards) {
  if (!cards.length) {
    cardLibraryCanvas.hidden = true;
    cardList.innerHTML = '<p class="catalog-empty">No cards yet. Create your first card using the form.</p>';
    return;
  }

  cardList.innerHTML = '';
  cardLibraryStageWrap.append(cardLibraryCanvas);
  cardList.append(cardLibraryStageWrap);
  cardLibraryCanvas.hidden = false;
  cardLibraryScene.setCards(cards);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

async function fetchCards() {
  setStatus('Loading cards...');
  try {
    const response = await fetch('/api/projects/cards');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load cards');
    }

    typeSelect.innerHTML = '';
    payload.cardTypes.forEach((type) => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      typeSelect.append(option);
    });

    renderCards(payload.cards);
    setStatus(`Loaded ${payload.cards.length} card${payload.cards.length === 1 ? '' : 's'}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const cardInput = {
    name: formData.get('name'),
    damage: Number.parseInt(formData.get('damage'), 10),
    health: Number.parseInt(formData.get('health'), 10),
    speed: Number.parseInt(formData.get('speed'), 10),
    type: formData.get('type'),
  };

  setStatus('Saving card...');
  try {
    const response = await fetch('/api/projects/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardInput),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create card');
    }

    form.reset();
    typeSelect.value = payload.card.type;
    setStatus(`Saved "${payload.card.name}".`);
    await fetchCards();
  } catch (error) {
    setStatus(error.message, true);
  }
});

fetchCards();
window.addEventListener('resize', onWindowResize);

window.addEventListener('beforeunload', () => {
  previewOffsetXInput.removeEventListener('input', applyPreviewPositionFromControls);
  previewOffsetYInput.removeEventListener('input', applyPreviewPositionFromControls);
  previewClosenessInput.removeEventListener('input', applyPreviewPositionFromControls);
  window.removeEventListener('resize', onWindowResize);
  cardLibraryScene.destroy();
});
