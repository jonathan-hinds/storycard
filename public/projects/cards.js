import { CardLibraryScene } from '/public/projects/card-library/CardLibraryScene.js';
import { formatAbilityOptionLabel } from '/public/projects/abilities/abilityControls.js';

const form = document.getElementById('create-card-form');
const status = document.getElementById('create-card-status');
const cardList = document.getElementById('card-list');
const typeSelect = document.getElementById('card-type');
const cardKindSelect = document.getElementById('card-kind');
const damageSelect = document.getElementById('card-damage');
const speedSelect = document.getElementById('card-speed');
const defenseSelect = document.getElementById('card-defense');
const saveCardButton = document.getElementById('save-card-button');
const artworkImageSelect = document.getElementById('card-artwork-image');
const ability1Select = document.getElementById('card-ability-1');
const ability2Select = document.getElementById('card-ability-2');
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
let abilitiesCache = [];

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
    cardKindSelect.value = card.cardKind ?? 'Creature';
    artworkImageSelect.value = card.artworkImagePath ?? '';
    ability1Select.value = card.ability1Id ?? '';
    ability2Select.value = card.ability2Id ?? '';
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


function buildAbilitySelectOptions(abilities = []) {
  const currentAbility1 = ability1Select.value;
  const currentAbility2 = ability2Select.value;

  ability1Select.innerHTML = '';
  ability2Select.innerHTML = '';

  const ability1Placeholder = document.createElement('option');
  ability1Placeholder.value = '';
  ability1Placeholder.textContent = 'Select Ability Slot 1';
  ability1Placeholder.disabled = true;
  ability1Placeholder.selected = true;
  ability1Select.append(ability1Placeholder);

  const ability2None = document.createElement('option');
  ability2None.value = '';
  ability2None.textContent = 'No ability in slot 2';
  ability2Select.append(ability2None);

  abilities.forEach((ability) => {
    const option1 = document.createElement('option');
    option1.value = ability.id;
    option1.textContent = formatAbilityOptionLabel(ability);
    ability1Select.append(option1);

    const option2 = document.createElement('option');
    option2.value = ability.id;
    option2.textContent = formatAbilityOptionLabel(ability);
    ability2Select.append(option2);
  });

  if (currentAbility1 && abilities.some((ability) => ability.id === currentAbility1)) {
    ability1Select.value = currentAbility1;
  }

  if (currentAbility2 && abilities.some((ability) => ability.id === currentAbility2)) {
    ability2Select.value = currentAbility2;
  }
}

async function fetchAbilities() {
  const response = await fetch('/api/projects/abilities');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load abilities');
  abilitiesCache = Array.isArray(payload.abilities) ? payload.abilities : [];
  buildAbilitySelectOptions(abilitiesCache);
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
  ability1Select.value = '';
  ability2Select.value = '';
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

async function fetchCards() {
  setStatus('Loading cards...');
  try {
    await Promise.all([fetchArtworkAssets(), fetchAbilities()]);
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
    buildSelectOptions(cardKindSelect, payload.cardKinds, 'Select a card type');
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
    cardKind: formData.get('cardKind'),
    artworkImagePath: formData.get('artworkImagePath') || null,
    ability1Id: formData.get('ability1Id'),
    ability2Id: formData.get('ability2Id') || null,
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
    cardKindSelect.value = payload.card.cardKind;
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
    cardKind: formData.get('cardKind'),
    artworkImagePath: formData.get('artworkImagePath') || null,
    ability1Id: formData.get('ability1Id'),
    ability2Id: formData.get('ability2Id') || null,
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
      cardKindSelect.value = updatedCard.cardKind;
      artworkImageSelect.value = updatedCard.artworkImagePath ?? '';
      ability1Select.value = updatedCard.ability1Id ?? '';
      ability2Select.value = updatedCard.ability2Id ?? '';
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
