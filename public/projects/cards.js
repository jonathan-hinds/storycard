import { CardLibraryScene } from '/public/projects/card-library/CardLibraryScene.js';

const form = document.getElementById('create-card-form');
const status = document.getElementById('create-card-status');
const cardList = document.getElementById('card-list');
const typeSelect = document.getElementById('card-type');
const cardLibraryCanvas = document.getElementById('card-library-canvas');
const cardLibraryStageWrap = cardLibraryCanvas.parentElement;

const previewDebugInputs = {
  offsetX: document.getElementById('preview-offset-x'),
  offsetY: document.getElementById('preview-offset-y'),
  offsetZ: document.getElementById('preview-offset-z'),
  tiltX: document.getElementById('preview-tilt-x'),
};

const previewDebugOutputs = {
  offsetX: document.getElementById('preview-offset-x-value'),
  offsetY: document.getElementById('preview-offset-y-value'),
  offsetZ: document.getElementById('preview-offset-z-value'),
  tiltX: document.getElementById('preview-tilt-x-value'),
};

function getPreviewDebugValues() {
  return {
    position: {
      x: Number.parseFloat(previewDebugInputs.offsetX.value),
      y: Number.parseFloat(previewDebugInputs.offsetY.value),
      z: Number.parseFloat(previewDebugInputs.offsetZ.value),
    },
    rotation: {
      x: Number.parseFloat(previewDebugInputs.tiltX.value),
    },
  };
}

function renderPreviewDebugValues() {
  previewDebugOutputs.offsetX.textContent = Number.parseFloat(previewDebugInputs.offsetX.value).toFixed(2);
  previewDebugOutputs.offsetY.textContent = Number.parseFloat(previewDebugInputs.offsetY.value).toFixed(2);
  previewDebugOutputs.offsetZ.textContent = Number.parseFloat(previewDebugInputs.offsetZ.value).toFixed(2);
  previewDebugOutputs.tiltX.textContent = Number.parseFloat(previewDebugInputs.tiltX.value).toFixed(2);
}

const initialPreviewDebugValues = getPreviewDebugValues();

const cardLibraryScene = new CardLibraryScene({
  canvas: cardLibraryCanvas,
  scrollContainer: cardList,
  previewRotationOffset: { x: initialPreviewDebugValues.rotation.x },
  previewPositionOffset: initialPreviewDebugValues.position,
});

function applyPreviewDebugValues() {
  renderPreviewDebugValues();
  cardLibraryScene.setPreviewDebugOffsets(getPreviewDebugValues());
}

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

Object.values(previewDebugInputs).forEach((input) => {
  input.addEventListener('input', applyPreviewDebugValues);
});

applyPreviewDebugValues();
fetchCards();

window.addEventListener('beforeunload', () => {
  cardLibraryScene.destroy();
});
