import { CardLibraryScene } from '/public/projects/card-library/CardLibraryScene.js';

const form = document.getElementById('create-card-form');
const status = document.getElementById('create-card-status');
const cardList = document.getElementById('card-list');
const typeSelect = document.getElementById('card-type');
const cardLibraryCanvas = document.getElementById('card-library-canvas');
const cardLibraryStageWrap = cardLibraryCanvas.parentElement;

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

const cardLibraryScene = new CardLibraryScene({
  canvas: cardLibraryCanvas,
  scrollContainer: cardList,
  previewRotationOffset: { x: CARD_LIBRARY_PREVIEW_DEFAULTS.rotation.x },
  previewPositionOffset: getResponsivePreviewPosition(),
});

function syncResponsivePreviewOffsets() {
  cardLibraryScene.setPreviewDebugOffsets({
    position: getResponsivePreviewPosition(),
    rotation: { x: CARD_LIBRARY_PREVIEW_DEFAULTS.rotation.x },
  });
}

syncResponsivePreviewOffsets();
window.addEventListener('resize', syncResponsivePreviewOffsets);

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

window.addEventListener('beforeunload', () => {
  window.removeEventListener('resize', syncResponsivePreviewOffsets);
  cardLibraryScene.destroy();
});
