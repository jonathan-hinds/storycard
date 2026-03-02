import { DeckBuilderScene } from '/public/projects/card-library/DeckBuilderScene.js';

const USER_SESSION_KEY = 'storycard-user-session';

const cardList = document.getElementById('user-card-list');
const cardLibraryCanvas = document.getElementById('user-card-library-canvas');
const cardLibraryStage = document.getElementById('user-card-library-stage');
const deckStatus = document.getElementById('user-deck-status');
const previewExportOutput = document.getElementById('preview-export-output');
const previewExportCopyButton = document.getElementById('preview-export-copy');
const previewExportDownloadButton = document.getElementById('preview-export-download');
let deckBuilderScene;

const previewControls = {
  x: 0,
  y: 0.01,
  z: 8,
  tiltX: 0,
};

function getPreviewControlsJson() {
  return JSON.stringify(previewControls, null, 2);
}

function syncPreviewControlsView() {
  if (previewExportOutput) previewExportOutput.value = getPreviewControlsJson();
}

function applyPreviewControls() {
  deckBuilderScene?.setPreviewControls(previewControls);
  syncPreviewControlsView();
}

previewExportCopyButton?.addEventListener('click', async () => {
  const json = getPreviewControlsJson();
  previewExportOutput.value = json;
  try {
    await navigator.clipboard.writeText(json);
    previewExportCopyButton.textContent = 'Copied!';
    window.setTimeout(() => {
      previewExportCopyButton.textContent = 'Copy JSON';
    }, 1200);
  } catch {
    previewExportCopyButton.textContent = 'Copy failed';
    window.setTimeout(() => {
      previewExportCopyButton.textContent = 'Copy JSON';
    }, 1200);
  }
});

previewExportDownloadButton?.addEventListener('click', () => {
  const blob = new Blob([getPreviewControlsJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'deck-preview-tuning.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

syncPreviewControlsView();

function loadSession() {
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(session));
}

function ensureSession() {
  const session = loadSession();
  if (!session) {
    window.location.replace('/public/projects/user/index.html');
    return null;
  }
  return session;
}

let session = ensureSession();

function updateDeckStatus(summary) {
  const validity = summary.isValid ? '✅ Deck valid' : '⚠️ Deck invalid';
  const violations = summary.violations.length ? ` — ${summary.violations.join(' ')}` : '';
  deckStatus.textContent = `${validity} (${summary.deckCardIds.length}/10 cards, ${summary.creatureCount} creatures)${violations}`;
  deckStatus.dataset.error = summary.isValid ? 'false' : 'true';

  session.user.deck = {
    cards: summary.deckCardIds,
    creatureCount: summary.creatureCount,
    updatedAt: new Date().toISOString(),
  };
  saveSession(session);
}

function renderCards(cards) {
  if (!cards.length) {
    cardLibraryCanvas.hidden = true;
    if (cardLibraryStage) cardLibraryStage.hidden = true;
    const emptyState = document.getElementById('user-card-list-empty');
    if (emptyState) emptyState.remove();
    cardList.insertAdjacentHTML('beforeend', '<p id="user-card-list-empty" class="catalog-empty">No cards found in the catalog.</p>');
    return;
  }

  const emptyState = document.getElementById('user-card-list-empty');
  if (emptyState) emptyState.remove();
  if (cardLibraryStage) cardLibraryStage.hidden = false;
  cardLibraryCanvas.hidden = false;

  deckBuilderScene?.destroy?.();
  deckBuilderScene = new DeckBuilderScene({
    canvas: cardLibraryCanvas,
    interactionTarget: cardList,
    onDeckChange: updateDeckStatus,
    previewControls,
  });
  deckBuilderScene.setCards(cards);
  deckBuilderScene.setDeckCardIds(session.user.deck?.cards || []);
}

async function loadCards() {
  const response = await fetch('/api/projects/cards');
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load cards');
  }
  renderCards(Array.isArray(payload.cards) ? payload.cards : []);
}

loadCards().catch((error) => {
  if (cardLibraryStage) cardLibraryStage.hidden = true;
  const emptyState = document.getElementById('user-card-list-empty');
  if (emptyState) emptyState.remove();
  cardList.insertAdjacentHTML('beforeend', `<p id="user-card-list-empty" class="catalog-empty">${error.message || 'Unable to load cards.'}</p>`);
});
