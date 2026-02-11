const form = document.getElementById('create-card-form');
const status = document.getElementById('create-card-status');
const cardList = document.getElementById('card-list');
const typeSelect = document.getElementById('card-type');

function renderCard(card) {
  const cardItem = document.createElement('article');
  cardItem.className = 'catalog-card';

  const title = document.createElement('h3');
  title.className = 'catalog-card-title';
  title.textContent = card.name;

  const type = document.createElement('p');
  type.className = 'catalog-card-type';
  type.textContent = card.type;

  const stats = document.createElement('dl');
  stats.className = 'catalog-card-stats';
  stats.innerHTML = `
    <div><dt>Damage</dt><dd>${card.damage}</dd></div>
    <div><dt>Health</dt><dd>${card.health}</dd></div>
    <div><dt>Speed</dt><dd>${card.speed}</dd></div>
  `;

  cardItem.append(title, type, stats);
  return cardItem;
}

function renderCards(cards) {
  cardList.innerHTML = '';

  if (!cards.length) {
    const empty = document.createElement('p');
    empty.className = 'catalog-empty';
    empty.textContent = 'No cards yet. Create your first card using the form.';
    cardList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  cards.forEach((card) => {
    fragment.append(renderCard(card));
  });
  cardList.append(fragment);
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
