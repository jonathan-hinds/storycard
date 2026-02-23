import { toAbilityInput } from '/public/projects/abilities/abilityControls.js';

const form = document.getElementById('create-ability-form');
const status = document.getElementById('create-ability-status');
const abilityList = document.getElementById('ability-list');
const saveAbilityButton = document.getElementById('save-ability-button');
const abilityKindInput = document.getElementById('ability-kind');
const abilityKindLabel = document.getElementById('ability-kind-label');

const configuredAbilityKind = document.body?.dataset.abilityKind === 'spell' ? 'Spell' : 'Creature';

let selectedAbilityId = null;
let abilitiesCache = [];

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

function resetFormToCreateMode() {
  selectedAbilityId = null;
  saveAbilityButton.disabled = true;
  form.reset();
  abilityKindInput.value = configuredAbilityKind;
}

function renderAbilities(abilities) {
  abilitiesCache = abilities;

  if (!abilities.length) {
    abilityList.innerHTML = `<p class="catalog-empty">No ${configuredAbilityKind.toLowerCase()} abilities yet. Create your first ability using the form.</p>`;
    return;
  }

  abilityList.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'cards-list-grid';

  abilities.forEach((ability) => {
    const row = document.createElement('article');
    row.className = 'catalog-card';

    const heading = document.createElement('h3');
    heading.className = 'catalog-card-title';
    heading.textContent = `${ability.cost} • ${ability.name}`;

    const description = document.createElement('p');
    description.className = 'catalog-card-type';
    description.textContent = ability.description;

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Edit Ability';
    editButton.addEventListener('click', () => {
      selectedAbilityId = ability.id;
      form.elements.name.value = ability.name ?? '';
      form.elements.cost.value = ability.cost ?? '';
      form.elements.description.value = ability.description ?? '';
      abilityKindInput.value = ability.abilityKind ?? configuredAbilityKind;
      saveAbilityButton.disabled = false;
      setStatus(`Editing "${ability.name}".`);
    });

    row.append(heading, description, editButton);
    list.append(row);
  });

  abilityList.append(list);
}

async function fetchAbilities() {
  setStatus(`Loading ${configuredAbilityKind.toLowerCase()} abilities...`);

  try {
    const response = await fetch(`/api/projects/abilities?abilityKind=${encodeURIComponent(configuredAbilityKind)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load abilities');
    }

    renderAbilities(Array.isArray(payload.abilities) ? payload.abilities : []);
    setStatus(`Loaded ${payload.abilities.length} ${configuredAbilityKind.toLowerCase()} abilit${payload.abilities.length === 1 ? 'y' : 'ies'}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const abilityInput = toAbilityInput(formData, configuredAbilityKind);

  setStatus('Saving ability...');

  try {
    const response = await fetch('/api/projects/abilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(abilityInput),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create ability');
    }

    resetFormToCreateMode();
    setStatus(`Saved "${payload.ability.name}".`);
    await fetchAbilities();
  } catch (error) {
    setStatus(error.message, true);
  }
});

saveAbilityButton.addEventListener('click', async () => {
  if (!selectedAbilityId) {
    setStatus('Select an ability in the library before saving changes.', true);
    return;
  }

  const formData = new FormData(form);
  const abilityInput = toAbilityInput(formData, configuredAbilityKind);

  setStatus('Updating ability...');

  try {
    const response = await fetch(`/api/projects/abilities/${selectedAbilityId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(abilityInput),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to update ability');
    }

    setStatus(`Updated "${payload.ability.name}".`);
    await fetchAbilities();

    const updatedAbility = abilitiesCache.find((ability) => ability.id === selectedAbilityId);
    if (updatedAbility) {
      form.elements.name.value = updatedAbility.name ?? '';
      form.elements.cost.value = updatedAbility.cost ?? '';
      form.elements.description.value = updatedAbility.description ?? '';
      abilityKindInput.value = updatedAbility.abilityKind ?? configuredAbilityKind;
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

abilityKindInput.value = configuredAbilityKind;
if (abilityKindLabel) {
  abilityKindLabel.textContent = `${configuredAbilityKind} Ability Kind`;
}

fetchAbilities();
