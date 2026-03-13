import { DeckBuilderScene } from '/public/projects/card-library/DeckBuilderScene.js';

const cardList = document.getElementById('npc-card-list');
const cardLibraryCanvas = document.getElementById('npc-card-library-canvas');
const cardLibraryStage = document.getElementById('npc-card-library-stage');
const deckStatus = document.getElementById('npc-deck-status');
const deckSelect = document.getElementById('npc-deck-select');
const deckNameInput = document.getElementById('npc-deck-name');

let deckBuilderScene;
let pendingSavePromise = null;
let npcDecks = [];
let selectedDeckId = '';

const filterPanelControls = {
  width: 6.5,
  height: 0.96,
  x: 0,
  y: 0,
  fontScale: 1,
  opacity: 0.15,
  checkboxScale: 1.8,
};

function applyFilterPanelControls() {
  deckBuilderScene?.setFilterPanelControls(filterPanelControls);
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

async function refreshNpcDecks() {
  const payload = await getJson('/api/npc-decks');
  npcDecks = Array.isArray(payload.npcDecks) ? payload.npcDecks : [];
}

function renderDeckSelectOptions() {
  deckSelect.innerHTML = '<option value="">New deck</option>';
  npcDecks.forEach((deck) => {
    const option = document.createElement('option');
    option.value = deck.id;
    option.textContent = deck.name;
    deckSelect.appendChild(option);
  });
  deckSelect.value = selectedDeckId;
}

function applySelectedDeckToBuilder() {
  const selectedDeck = npcDecks.find((deck) => deck.id === selectedDeckId);
  deckNameInput.value = selectedDeck?.name || '';
  deckBuilderScene?.setDeckCardIds(Array.isArray(selectedDeck?.deck?.cards) ? selectedDeck.deck.cards : []);
}

function updateDeckStatus(summary) {
  const validity = summary.isValid ? '✅ Deck valid' : '⚠️ Deck invalid';
  const violations = summary.violations.length ? ` — ${summary.violations.join(' ')}` : '';
  deckStatus.textContent = `${validity} (${summary.deckCardIds.length}/10 cards, ${summary.creatureCount} creatures)${violations}`;
  deckStatus.dataset.error = summary.isValid ? 'false' : 'true';
}

async function persistDeck(summary) {
  const payload = {
    name: deckNameInput.value,
    deck: {
      cards: summary.deckCardIds,
      creatureCount: summary.creatureCount,
    },
  };

  const request = selectedDeckId
    ? fetch(`/api/npc-decks/${encodeURIComponent(selectedDeckId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    : fetch('/api/npc-decks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  const response = await request;
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || 'Unable to save NPC deck');
  }

  const savedDeck = body?.npcDeck;
  if (savedDeck?.id) {
    selectedDeckId = savedDeck.id;
  }

  await refreshNpcDecks();
  renderDeckSelectOptions();
}

async function handleSaveDeck() {
  const summary = deckBuilderScene?.getDeckSummary?.();
  if (!summary) return;

  deckStatus.textContent = 'Saving NPC deck...';
  deckStatus.dataset.error = 'false';

  try {
    pendingSavePromise = persistDeck(summary);
    await pendingSavePromise;
    updateDeckStatus(summary);
    deckStatus.textContent = `${deckStatus.textContent} — Saved.`;
  } catch (error) {
    deckStatus.textContent = error.message || 'Unable to save NPC deck.';
    deckStatus.dataset.error = 'true';
  } finally {
    pendingSavePromise = null;
  }
}

function createDeckBuilder(cards) {
  deckBuilderScene?.destroy?.();
  deckBuilderScene = new DeckBuilderScene({
    canvas: cardLibraryCanvas,
    interactionTarget: cardList,
    onDeckChange: updateDeckStatus,
    onSave: handleSaveDeck,
    onBack: () => {
      window.location.href = '/';
    },
    filterPanelControls,
  });

  deckBuilderScene.setCards(cards);
  applySelectedDeckToBuilder();
  applyFilterPanelControls();
}

async function loadCardsAndDecks() {
  const cardsPayload = await getJson('/api/projects/cards');
  await refreshNpcDecks();
  renderDeckSelectOptions();

  const cards = Array.isArray(cardsPayload.cards) ? cardsPayload.cards : [];
  if (!cards.length) {
    cardLibraryCanvas.hidden = true;
    if (cardLibraryStage) cardLibraryStage.hidden = true;
    cardList.insertAdjacentHTML('beforeend', '<p id="npc-card-list-empty" class="catalog-empty">No cards found in the catalog.</p>');
    return;
  }

  createDeckBuilder(cards);
}

deckSelect.addEventListener('change', () => {
  selectedDeckId = deckSelect.value;
  applySelectedDeckToBuilder();
});

deckNameInput.addEventListener('input', () => {
  if (deckStatus.dataset.error !== 'true') {
    deckStatus.textContent = 'Deck name updated. Save to persist changes.';
  }
});

loadCardsAndDecks().catch((error) => {
  if (cardLibraryStage) cardLibraryStage.hidden = true;
  cardList.insertAdjacentHTML('beforeend', `<p class="catalog-empty">${error.message || 'Unable to load NPC deck builder.'}</p>`);
});
