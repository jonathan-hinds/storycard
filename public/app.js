const statusPanel = document.getElementById('status-panel');
const instructionsPanel = document.getElementById('instructions-panel');
const instructionsContent = document.getElementById('instructions-content');
const buttons = document.querySelectorAll('.button');

const packPanel = document.getElementById('pack-panel');
const packName = document.getElementById('pack-name');
const cardCounter = document.getElementById('card-counter');
const filterStatus = document.getElementById('filter-status');
const filterType = document.getElementById('filter-type');
const filterTag = document.getElementById('filter-tag');
const filterMap = document.getElementById('filter-map');
const navButtons = document.querySelectorAll('.carousel .nav');
const carouselTrack = document.getElementById('carousel-track');
const cardTemplate = document.getElementById('card-template');
const cardPosition = document.getElementById('card-position');
const cardMapHint = document.getElementById('card-map-hint');

let instructionsLoaded = false;
let packLoaded = false;
let packData = null;
let filteredCards = [];
let carouselIndex = 0;

function setStatus(message) {
  statusPanel.textContent = message;
}

async function loadInstructions() {
  if (instructionsLoaded) {
    instructionsPanel.hidden = false;
    return;
  }

  setStatus('Loading rulebook...');
  try {
    const response = await fetch('/api/instructions');
    if (!response.ok) {
      throw new Error('Failed to load instructions');
    }
    const data = await response.json();
    instructionsContent.textContent = data.instructions;
    instructionsPanel.hidden = false;
    instructionsLoaded = true;
    setStatus('Ready to play.');
  } catch (error) {
    setStatus('Could not load instructions.');
    instructionsContent.textContent = 'Error loading instructions. Please try again later.';
    instructionsPanel.hidden = false;
  }
}

function buildOptions(select, label, items) {
  const fragment = document.createDocumentFragment();
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = `All ${label}`;
  fragment.appendChild(defaultOption);

  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item;
    option.textContent = item;
    fragment.appendChild(option);
  });

  select.replaceChildren(fragment);
}

function deriveFilters(pack) {
  const types = pack.cardTypes || [];
  const tags = pack.sharedBeatTagPool || [];
  const beats = pack.beats || [];

  buildOptions(filterType, 'types', types);
  buildOptions(filterTag, 'tags', tags);
  buildOptions(filterMap, 'beats', beats);
}

function summarizeFilters() {
  const active = [];
  if (filterType.value) active.push(`Type: ${filterType.value}`);
  if (filterTag.value) active.push(`Tag: ${filterTag.value}`);
  if (filterMap.value) active.push(`Beat: ${filterMap.value}`);
  return active.length ? active.join(' • ') : 'No filters';
}

function updateCounter() {
  if (!packData) return;
  cardCounter.textContent = `${filteredCards.length} / ${packData.cards.length} cards`;
  filterStatus.textContent = summarizeFilters();
  if (filteredCards.length === 0) {
    cardPosition.textContent = '0 / 0';
    return;
  }
  cardPosition.textContent = `${carouselIndex + 1} / ${filteredCards.length}`;
}

function formatMap(map) {
  if (!map || !map.length) return 'Beat lanes: —';
  return `Beat lanes: ${map.join(' • ')}`;
}

function createCardElement(card, index) {
  const cardNode = cardTemplate.content.firstElementChild.cloneNode(true);
  cardNode.dataset.index = index;

  cardNode.querySelector('[data-field="title"]').textContent = card.name;
  cardNode.querySelector('[data-field="type"]').textContent = card.type;
  cardNode.querySelector('[data-field="tag"]').textContent = card.tag || '—';
  cardNode.querySelector('[data-field="description"]').textContent = card.description;
  cardNode.querySelector('[data-field="map"]').textContent = formatMap(card.map);

  return cardNode;
}

function renderEmptyState(message) {
  carouselTrack.replaceChildren();
  const placeholderCard = createCardElement(
    {
      name: 'No results',
      type: '—',
      tag: '—',
      description: message,
      map: ['—'],
    },
    0,
  );

  placeholderCard.classList.add('empty');
  carouselTrack.appendChild(placeholderCard);

  cardMapHint.textContent = 'Adjust filters to see cards.';
  cardPosition.textContent = '0 / 0';
  navButtons.forEach((btn) => {
    btn.disabled = true;
  });
}

function updateCarouselPositions() {
  const cards = Array.from(carouselTrack.children);
  if (!cards.length) return;

  const total = filteredCards.length;
  cards.forEach((cardEl) => {
    const idx = Number(cardEl.dataset.index);
    let delta = idx - carouselIndex;

    if (delta > total / 2) delta -= total;
    if (delta < -total / 2) delta += total;

    const clamped = Math.max(-4, Math.min(4, delta));
    const scale = 1 - Math.abs(clamped) * 0.1;
    const opacity = Math.max(0.25, 1 - Math.abs(clamped) * 0.18);
    const blur = Math.max(0, Math.abs(clamped) - 0.5) * 1.3;

    cardEl.style.setProperty('--offset', clamped);
    cardEl.style.setProperty('--scale', scale.toFixed(2));
    cardEl.style.setProperty('--rotate', `${clamped * -7}deg`);
    cardEl.style.setProperty('--blur', `${blur}px`);
    cardEl.style.setProperty('--opacity', opacity.toFixed(2));
    cardEl.style.zIndex = 10 - Math.abs(clamped);
    cardEl.classList.toggle('active', clamped === 0);
  });

  const activeCard = filteredCards[carouselIndex];
  if (activeCard) {
    cardMapHint.textContent = `Playable on: ${activeCard.map.join(' • ')}`;
  }
}

function renderCarousel() {
  carouselTrack.replaceChildren();

  filteredCards.forEach((card, index) => {
    const cardNode = createCardElement(card, index);
    carouselTrack.appendChild(cardNode);
  });

  updateCarouselPositions();
}

function showCardAt(index) {
  if (!filteredCards.length) {
    renderEmptyState('No cards match these filters.');
    return;
  }

  carouselIndex = (index + filteredCards.length) % filteredCards.length;
  updateCounter();
  updateCarouselPositions();
  navButtons.forEach((btn) => {
    btn.disabled = filteredCards.length < 2;
  });
}

function applyFilters() {
  if (!packData) return;
  const typeValue = filterType.value;
  const tagValue = filterTag.value;
  const beatValue = filterMap.value;

  filteredCards = packData.cards.filter((card) => {
    if (typeValue && card.type !== typeValue) return false;
    if (tagValue && card.tag !== tagValue) return false;
    if (beatValue && !card.map.includes(beatValue)) return false;
    return true;
  });

  carouselIndex = 0;
  if (filteredCards.length === 0) {
    updateCounter();
    renderEmptyState('No cards match these filters.');
    return;
  }

  renderCarousel();
  showCardAt(carouselIndex);
}

async function loadPack() {
  if (packLoaded) {
    packPanel.hidden = false;
    updateCounter();
    return;
  }

  setStatus('Loading pack...');
  try {
    const response = await fetch('/api/pack');
    if (!response.ok) {
      throw new Error('Failed to load pack');
    }
    const data = await response.json();
    packData = data.pack;
    packLoaded = true;
    packName.textContent = packData.name || 'Pack';
    deriveFilters(packData);
    packPanel.hidden = false;
    applyFilters();
    setStatus('Pack ready. Browse away.');
  } catch (error) {
    packPanel.hidden = false;
    renderEmptyState('Could not load pack data.');
    setStatus('Could not load pack.');
  }
}

function handleAction(action) {
  switch (action) {
    case 'play':
      setStatus('Play mode coming soon.');
      break;
    case 'packs':
      loadPack();
      break;
    case 'instructions':
      loadInstructions();
      break;
    case 'close':
      instructionsPanel.hidden = true;
      setStatus('Closed the rulebook.');
      break;
    default:
      setStatus('Ready to play.');
  }
}

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.getAttribute('data-action');
    handleAction(action);
  });
});

[filterType, filterTag, filterMap].forEach((select) => {
  select.addEventListener('change', applyFilters);
});

navButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const direction = Number(button.getAttribute('data-direction'));
    showCardAt(carouselIndex + direction);
  });
});

carouselTrack.addEventListener('click', (event) => {
  const shell = event.target.closest('.card-shell');
  if (!shell || !filteredCards.length) return;
  const idx = Number(shell.dataset.index);
  showCardAt(idx);
});

setStatus('Ready to play.');
