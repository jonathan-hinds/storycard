import { CardLibraryScene } from '/public/projects/card-library/CardLibraryScene.js';

const USER_SESSION_KEY = 'storycard-user-session';
const CARD_LIBRARY_COMPACT_BREAKPOINT_PX = 900;
const PREVIEW_Z_CAMERA_PADDING = 1.2;
const PREVIEW_Z_MAX_CAP = 14;

const PREVIEW_Z_RANGE = Object.freeze({
  desktop: { min: 1.5, max: 6 },
  mobile: { min: -2, max: 6 },
});

const PREVIEW_CLOSENESS_BY_VIEWPORT = Object.freeze({
  desktop: 28,
  mobile: 100,
});

const PREVIEW_CLOSENESS_RANGE = Object.freeze({
  min: 0,
  max: 100,
});

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

const cardList = document.getElementById('user-card-list');
const cardLibraryCanvas = document.getElementById('user-card-library-canvas');
const cardLibraryStageWrap = cardLibraryCanvas.parentElement;

function ensureSession() {
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY);
    if (!raw) throw new Error('missing session');
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) throw new Error('missing session');
  } catch (error) {
    window.location.replace('/public/projects/user/index.html');
  }
}

ensureSession();

const cardLibraryScene = new CardLibraryScene({
  canvas: cardLibraryCanvas,
  scrollContainer: cardList,
  previewRotationOffset: { x: CARD_LIBRARY_PREVIEW_DEFAULTS.rotation.x },
  previewPositionOffset: getResponsivePreviewPosition(),
  layoutTuning: GRID_LAYOUT_DEFAULTS,
  onCardSelect: () => {},
});

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

function applyResponsivePreviewPosition() {
  cardLibraryScene.setPreviewDebugOffsets({
    position: getResponsivePreviewPosition(),
    rotation: { x: CARD_LIBRARY_PREVIEW_DEFAULTS.rotation.x },
  });
}

function onWindowResize() {
  applyResponsivePreviewPosition();
}

function renderCards(cards) {
  if (!cards.length) {
    cardLibraryCanvas.hidden = true;
    cardList.innerHTML = '<p class="catalog-empty">No cards found in the catalog.</p>';
    return;
  }

  cardList.innerHTML = '';
  cardLibraryStageWrap.append(cardLibraryCanvas);
  cardList.append(cardLibraryStageWrap);
  cardLibraryCanvas.hidden = false;
  cardLibraryScene.setCards(cards);
}

async function loadCards() {
  const response = await fetch('/api/projects/cards');
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load cards');
  }

  renderCards(Array.isArray(payload.cards) ? payload.cards : []);
}

applyResponsivePreviewPosition();
window.addEventListener('resize', onWindowResize);

loadCards().catch((error) => {
  cardList.innerHTML = `<p class="catalog-empty">${error.message || 'Unable to load cards.'}</p>`;
});
