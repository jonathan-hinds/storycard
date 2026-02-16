import { CardLibraryScene } from '/public/projects/card-library/CardLibraryScene.js';

const form = document.getElementById('create-card-form');
const status = document.getElementById('create-card-status');
const cardList = document.getElementById('card-list');
const typeSelect = document.getElementById('card-type');
const damageSelect = document.getElementById('card-damage');
const speedSelect = document.getElementById('card-speed');
const defenseSelect = document.getElementById('card-defense');
const saveCardButton = document.getElementById('save-card-button');
const artworkImageSelect = document.getElementById('card-artwork-image');
const cardLibraryCanvas = document.getElementById('card-library-canvas');
const cardLibraryStageWrap = cardLibraryCanvas.parentElement;
const GRID_LAYOUT_DEFAULTS = Object.freeze({
  cardsPerRow: 3,
  cardScale: 0.5,
  rowPadding: 1.8,
  columnPadding: 1.45,
  gridMargin: 0,
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
let selectedCardId = null;
let cardsCache = [];

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
  onCardSelect: (card) => {
    if (!card) return;
    selectedCardId = card.id;
    form.elements.name.value = card.name ?? '';
    form.elements.damage.value = card.damage ?? '';
    form.elements.health.value = card.health ?? 0;
    form.elements.speed.value = card.speed ?? '';
    form.elements.defense.value = card.defense ?? '';
    typeSelect.value = card.type;
    artworkImageSelect.value = card.artworkImagePath ?? '';
    saveCardButton.disabled = false;
    setStatus(`Editing "${card.name}". Update fields and click Save Card.`);
  },
});


function buildArtworkSelectOptions(assets = []) {
  const currentValue = artworkImageSelect.value;
  artworkImageSelect.innerHTML = '';

  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'No artwork';
  artworkImageSelect.append(noneOption);

  assets.forEach((asset) => {
    const option = document.createElement('option');
    option.value = asset.path;
    option.textContent = asset.name;
    artworkImageSelect.append(option);
  });

  if (currentValue && !assets.some((asset) => asset.path === currentValue)) {
    const fallbackOption = document.createElement('option');
    fallbackOption.value = currentValue;
    fallbackOption.textContent = `${currentValue} (missing)`;
    artworkImageSelect.append(fallbackOption);
  }

  artworkImageSelect.value = currentValue;
}

async function fetchArtworkAssets() {
  const response = await fetch('/api/assets');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load artwork assets');
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  buildArtworkSelectOptions(assets);
}

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
  cardsCache = cards;
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

function resetFormToCreateMode() {
  selectedCardId = null;
  saveCardButton.disabled = true;
  form.reset();
  artworkImageSelect.value = '';
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

async function fetchCards() {
  setStatus('Loading cards...');
  try {
    await fetchArtworkAssets();
    const response = await fetch('/api/projects/cards');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load cards');
    }

    const buildSelectOptions = (select, values, placeholder) => {
      select.innerHTML = '';
      const placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = placeholder;
      placeholderOption.disabled = true;
      placeholderOption.selected = true;
      select.append(placeholderOption);

      values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      });
    };

    buildSelectOptions(typeSelect, payload.cardTypes, 'Select a type');
    buildSelectOptions(damageSelect, payload.cardStatDice, 'Select a die');
    buildSelectOptions(speedSelect, payload.cardStatDice, 'Select a die');
    buildSelectOptions(defenseSelect, payload.cardStatDice, 'Select a die');

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
    damage: formData.get('damage'),
    health: Number.parseInt(formData.get('health'), 10),
    speed: formData.get('speed'),
    defense: formData.get('defense'),
    type: formData.get('type'),
    artworkImagePath: formData.get('artworkImagePath') || null,
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

    resetFormToCreateMode();
    typeSelect.value = payload.card.type;
    setStatus(`Saved "${payload.card.name}".`);
    await fetchCards();
  } catch (error) {
    setStatus(error.message, true);
  }
});

saveCardButton.addEventListener('click', async () => {
  if (!selectedCardId) {
    setStatus('Select a card in the library before saving changes.', true);
    return;
  }

  const formData = new FormData(form);
  const cardInput = {
    name: formData.get('name'),
    damage: formData.get('damage'),
    health: Number.parseInt(formData.get('health'), 10),
    speed: formData.get('speed'),
    defense: formData.get('defense'),
    type: formData.get('type'),
    artworkImagePath: formData.get('artworkImagePath') || null,
  };

  setStatus('Updating card...');

  try {
    const response = await fetch(`/api/projects/cards/${selectedCardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardInput),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to update card');
    }

    setStatus(`Updated "${payload.card.name}".`);
    await fetchCards();
    const updatedCard = cardsCache.find((card) => card.id === selectedCardId);
    if (updatedCard) {
      form.elements.name.value = updatedCard.name ?? '';
      form.elements.damage.value = updatedCard.damage ?? '';
      form.elements.health.value = updatedCard.health ?? 0;
      form.elements.speed.value = updatedCard.speed ?? '';
      form.elements.defense.value = updatedCard.defense ?? '';
      typeSelect.value = updatedCard.type;
      artworkImageSelect.value = updatedCard.artworkImagePath ?? '';
    }
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
