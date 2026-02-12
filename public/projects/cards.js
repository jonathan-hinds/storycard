import { CardLibraryScene } from '/public/projects/card-library/CardLibraryScene.js';

const form = document.getElementById('create-card-form');
const status = document.getElementById('create-card-status');
const cardList = document.getElementById('card-list');
const typeSelect = document.getElementById('card-type');
const cardLibraryCanvas = document.getElementById('card-library-canvas');
const cardLibraryStageWrap = cardLibraryCanvas.parentElement;
const gridTuningFields = document.getElementById('cards-grid-tuning-fields');
const gridTuningResetButton = document.getElementById('cards-grid-tuning-reset');

const CARD_LIBRARY_PREVIEW_DEFAULTS = {
  position: {
    x: 0,
    y: -1.65,
  },
  rotation: {
    x: 1.15,
  },
};

const GRID_TUNING_STORAGE_KEY = 'storycard.cards.gridTuning.v1';
const GRID_TUNING_DEFAULTS = Object.freeze({
  columns: 5,
  cardScale: 1,
  columnGap: 1,
  rowGap: 1,
  marginX: 0,
  marginY: 0,
  visibleRows: 2,
  cameraDistanceOffset: 0,
  animationIntensity: 1,
});
const GRID_TUNING_CONTROL_CONFIG = [
  { key: 'columns', label: 'Cards per row', min: 1, max: 8, step: 1, format: (value) => `${value}` },
  { key: 'cardScale', label: 'Card size', min: 0.65, max: 1.8, step: 0.01, format: (value) => `${value.toFixed(2)}x` },
  { key: 'columnGap', label: 'Column spacing', min: 0.8, max: 2.2, step: 0.01, format: (value) => `${value.toFixed(2)}x` },
  { key: 'rowGap', label: 'Row spacing', min: 0.8, max: 2.4, step: 0.01, format: (value) => `${value.toFixed(2)}x` },
  { key: 'marginX', label: 'Grid side margin', min: -1.2, max: 4, step: 0.05, format: (value) => value.toFixed(2) },
  { key: 'marginY', label: 'Grid top/bottom margin', min: -1.2, max: 4, step: 0.05, format: (value) => value.toFixed(2) },
  { key: 'visibleRows', label: 'Visible rows', min: 1, max: 4, step: 1, format: (value) => `${value}` },
  { key: 'cameraDistanceOffset', label: 'Camera distance', min: -3, max: 4, step: 0.05, format: (value) => value.toFixed(2) },
  { key: 'animationIntensity', label: 'Card motion', min: 0, max: 1.6, step: 0.01, format: (value) => `${value.toFixed(2)}x` },
];

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
const gridTuningState = loadGridTuning();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeGridTuning(value = {}) {
  const tuning = {};
  GRID_TUNING_CONTROL_CONFIG.forEach((control) => {
    const nextValue = Number(value[control.key]);
    const fallback = GRID_TUNING_DEFAULTS[control.key];
    const safe = Number.isFinite(nextValue) ? nextValue : fallback;
    const snapped = control.step >= 1 ? Math.round(safe) : safe;
    tuning[control.key] = clamp(snapped, control.min, control.max);
  });
  return tuning;
}

function loadGridTuning() {
  try {
    const raw = window.localStorage.getItem(GRID_TUNING_STORAGE_KEY);
    if (!raw) return { ...GRID_TUNING_DEFAULTS };
    return sanitizeGridTuning({ ...GRID_TUNING_DEFAULTS, ...JSON.parse(raw) });
  } catch {
    return { ...GRID_TUNING_DEFAULTS };
  }
}

function saveGridTuning() {
  window.localStorage.setItem(GRID_TUNING_STORAGE_KEY, JSON.stringify(gridTuningState));
}

function applyGridTuning() {
  cardLibraryScene.setGridTuning(gridTuningState);
}

function updateGridControlOutput(controlKey) {
  const control = GRID_TUNING_CONTROL_CONFIG.find((item) => item.key === controlKey);
  if (!control) return;
  const output = document.querySelector(`[data-grid-output="${controlKey}"]`);
  if (!output) return;
  output.textContent = control.format(gridTuningState[controlKey]);
}

function renderGridTuningControls() {
  gridTuningFields.innerHTML = '';
  GRID_TUNING_CONTROL_CONFIG.forEach((control) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'cards-grid-tuning-field';

    const label = document.createElement('label');
    label.setAttribute('for', `grid-tuning-${control.key}`);
    label.innerHTML = `<span>${control.label}</span><output data-grid-output="${control.key}">${control.format(gridTuningState[control.key])}</output>`;

    const input = document.createElement('input');
    input.type = 'range';
    input.id = `grid-tuning-${control.key}`;
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(gridTuningState[control.key]);

    input.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      gridTuningState[control.key] = control.step >= 1 ? Math.round(value) : value;
      updateGridControlOutput(control.key);
      applyGridTuning();
      saveGridTuning();
    });

    wrapper.append(label, input);
    gridTuningFields.append(wrapper);
  });
}

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
  gridTuning: gridTuningState,
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
  applyGridTuning();
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

gridTuningResetButton.addEventListener('click', () => {
  Object.assign(gridTuningState, GRID_TUNING_DEFAULTS);
  renderGridTuningControls();
  applyGridTuning();
  saveGridTuning();
});

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

renderGridTuningControls();
fetchCards();
window.addEventListener('resize', onWindowResize);

window.addEventListener('beforeunload', () => {
  window.removeEventListener('resize', onWindowResize);
  cardLibraryScene.destroy();
});
