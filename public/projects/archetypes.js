const form = document.getElementById('create-archetype-form');
const status = document.getElementById('create-archetype-status');
const listContainer = document.getElementById('archetype-list');
const damageSelect = document.getElementById('archetype-damage');
const speedSelect = document.getElementById('archetype-speed');
const defenseSelect = document.getElementById('archetype-defense');
const saveButton = document.getElementById('save-archetype-button');

let selectedArchetypeId = null;
let archetypesCache = [];

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

function buildDieSelectOptions(values = []) {
  [damageSelect, speedSelect, defenseSelect].forEach((select) => {
    const currentValue = select.value;
    select.innerHTML = '';

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = 'Select a die';
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    select.append(placeholderOption);

    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    });

    if (values.includes(currentValue)) {
      select.value = currentValue;
    }
  });
}

function renderArchetypeList(archetypes = []) {
  archetypesCache = archetypes;
  if (!archetypes.length) {
    listContainer.innerHTML = '<p class="catalog-empty">No archetypes yet. Create your first archetype.</p>';
    return;
  }

  listContainer.innerHTML = '';
  archetypes.forEach((archetype) => {
    const article = document.createElement('article');
    article.className = 'catalog-card';
    article.innerHTML = `
      <h3 class="catalog-card-title">${archetype.name}</h3>
      <dl class="catalog-card-stats">
        <div><dt>HP</dt><dd>${archetype.health}</dd></div>
        <div><dt>DMG</dt><dd>${archetype.damage}</dd></div>
        <div><dt>SPD</dt><dd>${archetype.speed}</dd></div>
        <div><dt>DEF</dt><dd>${archetype.defense}</dd></div>
      </dl>
      <button type="button" data-archetype-id="${archetype.id}">Edit</button>
    `;
    listContainer.append(article);
  });
}

function resetForm() {
  selectedArchetypeId = null;
  saveButton.disabled = true;
  form.reset();
}

async function fetchArchetypes() {
  setStatus('Loading archetypes...');
  try {
    const response = await fetch('/api/projects/archetypes');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load archetypes');
    }

    renderArchetypeList(payload.archetypes || []);
    buildDieSelectOptions(payload.cardStatDice || []);
    setStatus(`Loaded ${(payload.archetypes || []).length} archetype${(payload.archetypes || []).length === 1 ? '' : 's'}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function buildArchetypeInput(formData) {
  return {
    name: formData.get('name'),
    health: Number.parseInt(formData.get('health'), 10),
    damage: formData.get('damage'),
    speed: formData.get('speed'),
    defense: formData.get('defense'),
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const archetypeInput = buildArchetypeInput(new FormData(form));

  setStatus('Saving archetype...');

  try {
    const response = await fetch('/api/projects/archetypes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(archetypeInput),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create archetype');
    }

    resetForm();
    setStatus(`Saved "${payload.archetype.name}".`);
    await fetchArchetypes();
  } catch (error) {
    setStatus(error.message, true);
  }
});

saveButton.addEventListener('click', async () => {
  if (!selectedArchetypeId) {
    setStatus('Select an archetype before saving changes.', true);
    return;
  }

  const archetypeInput = buildArchetypeInput(new FormData(form));
  setStatus('Updating archetype...');

  try {
    const response = await fetch(`/api/projects/archetypes/${selectedArchetypeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(archetypeInput),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to update archetype');
    }

    setStatus(`Updated "${payload.archetype.name}".`);
    await fetchArchetypes();
  } catch (error) {
    setStatus(error.message, true);
  }
});

listContainer.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-archetype-id]');
  if (!button) return;

  const archetype = archetypesCache.find((entry) => entry.id === button.dataset.archetypeId);
  if (!archetype) return;

  selectedArchetypeId = archetype.id;
  saveButton.disabled = false;
  form.elements.name.value = archetype.name;
  form.elements.health.value = archetype.health;
  form.elements.damage.value = archetype.damage;
  form.elements.speed.value = archetype.speed;
  form.elements.defense.value = archetype.defense;
  setStatus(`Editing "${archetype.name}".`);
});

fetchArchetypes();
