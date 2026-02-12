import { CardLibraryScene } from '/public/projects/card-library/CardLibraryScene.js';

const form = document.getElementById('create-card-form');
const status = document.getElementById('create-card-status');
const cardList = document.getElementById('card-list');
const typeSelect = document.getElementById('card-type');
const cardLibraryCanvas = document.getElementById('card-library-canvas');
const cardLibraryStageWrap = cardLibraryCanvas.parentElement;
const gridSliders = Array.from(document.querySelectorAll('[data-grid-slider]'));
const gridValueDisplays = new Map(
  Array.from(document.querySelectorAll('[data-grid-value]')).map((node) => [node.dataset.gridValue, node]),
);

const GRID_LAYOUT_DEFAULTS = Object.freeze({
  cardsPerRow: 5,
  cardScale: 1,
  rowPadding: 0,
  columnPadding: 0,
  gridMargin: 0,
});

const GRID_LAYOUT_FORMATTERS = Object.freeze({
  cardsPerRow: (value) => `${Math.round(value)}`,
  cardScale: (value) => value.toFixed(2),
  rowPadding: (value) => value.toFixed(2),
  columnPadding: (value) => value.toFixed(2),
  gridMargin: (value) => value.toFixed(2),
});

const CARD_LIBRARY_PREVIEW_DEFAULTS = {
  position: {
    x: 0,
    y: -1.65,
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

const PREVIEW_CLOSENESS_BY_VIEWPORT = Object.freeze({
  desktop: 28,
  mobile: 100,
});

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

function getPreviewOffsetZFromCloseness(closeness, bounds) {
  const span = bounds.max - bounds.min;
  if (span <= 0) return bounds.min;
  const normalizedCloseness = (closeness - PREVIEW_CLOSENESS_RANGE.min)
    / (PREVIEW_CLOSENESS_RANGE.max - PREVIEW_CLOSENESS_RANGE.min);
  return bounds.min + (normalizedCloseness * span);
}

function getResponsivePreviewPosition() {
  const isCompactViewport = window.innerWidth <= CARD_LIBRARY_COMPACT_BREAKPOINT_PX;
  const bounds = getPreviewZBounds();
  const closeness = isCompactViewport
    ? PREVIEW_CLOSENESS_BY_VIEWPORT.mobile
    : PREVIEW_CLOSENESS_BY_VIEWPORT.desktop;
  return {
    x: CARD_LIBRARY_PREVIEW_DEFAULTS.position.x,
    y: CARD_LIBRARY_PREVIEW_DEFAULTS.position.y,
    z: getPreviewOffsetZFromCloseness(closeness, bounds),
  };
}

cardLibraryScene = new CardLibraryScene({
  canvas: cardLibraryCanvas,
  scrollContainer: cardList,
  previewRotationOffset: { x: CARD_LIBRARY_PREVIEW_DEFAULTS.rotation.x },
  previewPositionOffset: getResponsivePreviewPosition(),
  layoutTuning: GRID_LAYOUT_DEFAULTS,
});

function applyResponsivePreviewPosition() {
  const position = getResponsivePreviewPosition();
  cardLibraryScene.setPreviewDebugOffsets({
    position,
    rotation: { x: CARD_LIBRARY_PREVIEW_DEFAULTS.rotation.x },
  });
}

function onWindowResize() {
  applyResponsivePreviewPosition();
}

applyResponsivePreviewPosition();

function updateGridDisplay(name, value) {
  const display = gridValueDisplays.get(name);
  if (!display) return;
  const formatValue = GRID_LAYOUT_FORMATTERS[name] ?? ((nextValue) => `${nextValue}`);
  display.textContent = formatValue(value);
}

function applyGridTuningFromSliders() {
  const layoutTuning = gridSliders.reduce((accumulator, slider) => {
    const key = slider.dataset.gridSlider;
    const parsed = Number.parseFloat(slider.value);
    accumulator[key] = key === 'cardsPerRow' ? Math.round(parsed) : parsed;
    return accumulator;
  }, {});

  cardLibraryScene.setLayoutTuning(layoutTuning);
  Object.entries(layoutTuning).forEach(([name, value]) => updateGridDisplay(name, value));
}

function initializeGridTuningSliders() {
  gridSliders.forEach((slider) => {
    const key = slider.dataset.gridSlider;
    const defaultValue = GRID_LAYOUT_DEFAULTS[key];
    if (!Number.isFinite(defaultValue)) return;
    slider.value = `${defaultValue}`;
    updateGridDisplay(key, defaultValue);
    slider.addEventListener('input', applyGridTuningFromSliders);
    slider.addEventListener('change', applyGridTuningFromSliders);
  });
  applyGridTuningFromSliders();
}

initializeGridTuningSliders();

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
  window.removeEventListener('resize', onWindowResize);
  cardLibraryScene.destroy();
});
