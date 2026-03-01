import { toAbilityInput } from '/public/projects/abilities/abilityControls.js';

const form = document.getElementById('create-ability-form');
const status = document.getElementById('create-ability-status');
const abilityList = document.getElementById('ability-list');
const saveAbilityButton = document.getElementById('save-ability-button');
const abilityKindInput = document.getElementById('ability-kind');
const abilityKindLabel = document.getElementById('ability-kind-label');

const effectSelect = document.getElementById('ability-effect');
const valueSourceTypeSelect = document.getElementById('ability-value-source-type');
const buffSelect = document.getElementById('ability-buff');
const buffTargetSelect = document.getElementById('ability-buff-target');
const valueSourceStatSelect = document.getElementById('ability-value-source-stat');
const valueSourceFixedInput = document.getElementById('ability-value-source-fixed');
const durationTurnsInput = document.getElementById('ability-duration-turns');
const enemyValueSourceStatSelect = document.getElementById('ability-enemy-value-source-stat');

const configuredAbilityKind = document.body?.dataset.abilityKind === 'spell' ? 'Spell' : 'Creature';

let selectedAbilityId = null;
let abilitiesCache = [];
let abilityOptionCatalog = {
  buffs: ['none'],
  buffTargets: ['none'],
  disruptionTargetStats: ['damage', 'speed', 'defense'],
};

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

function toTitle(input = '') {
  return String(input).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function setOptions(selectEl, values = [], fallbackValue = null) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = toTitle(value);
    selectEl.append(option);
  });

  if (fallbackValue && values.includes(fallbackValue)) {
    selectEl.value = fallbackValue;
  } else if (values.length) {
    selectEl.value = values[0];
  }
}

function getAllowedBuffIdsForTarget(target = 'none') {
  if (target === 'enemy') return ['none', 'silence', 'poison', 'fire', 'frostbite'];
  if (target === 'self' || target === 'friendly') return ['none', 'taunt'];
  return ['none'];
}

function getAllowedBuffTargetsForBuff(buffId = 'none') {
  if (buffId === 'taunt') return ['self', 'friendly'];
  if (buffId === 'silence' || buffId === 'poison' || buffId === 'fire' || buffId === 'frostbite') return ['enemy'];
  return ['none'];
}

function syncBuffOptionsForTarget({ preferredBuffId = null, preferredBuffTarget = null } = {}) {
  const target = form?.elements?.target?.value || 'none';
  const allowedBuffIds = getAllowedBuffIdsForTarget(target)
    .filter((buffId) => abilityOptionCatalog.buffs.includes(buffId));
  const nextBuffIds = allowedBuffIds.length ? allowedBuffIds : ['none'];
  const selectedBuffId = preferredBuffId || buffSelect?.value || 'none';
  setOptions(buffSelect, nextBuffIds, selectedBuffId);

  const buffId = buffSelect?.value || 'none';
  const allowedBuffTargets = getAllowedBuffTargetsForBuff(buffId)
    .filter((buffTarget) => abilityOptionCatalog.buffTargets.includes(buffTarget));
  const nextBuffTargets = allowedBuffTargets.length ? allowedBuffTargets : ['none'];
  const selectedBuffTarget = preferredBuffTarget || buffTargetSelect?.value || 'none';
  setOptions(buffTargetSelect, nextBuffTargets, selectedBuffTarget);
}

function updateValueSourceVisibility() {
  const valueSourceType = valueSourceTypeSelect?.value || 'none';
  const showRoll = valueSourceType === 'roll';
  const showFixed = valueSourceType === 'fixed';

  valueSourceStatSelect.hidden = !showRoll;
  valueSourceStatSelect.previousElementSibling.hidden = !showRoll;
  valueSourceFixedInput.hidden = !showFixed;
  valueSourceFixedInput.previousElementSibling.hidden = !showFixed;

  const showDisruptionTargetStat = (effectSelect?.value || 'none') === 'disruption';
  enemyValueSourceStatSelect.hidden = !showDisruptionTargetStat;
  if (enemyValueSourceStatSelect.previousElementSibling) enemyValueSourceStatSelect.previousElementSibling.hidden = !showDisruptionTargetStat;
}

function updateDurationVisibility() {
  const needsDuration = buffSelect?.value === 'taunt'
    || buffSelect?.value === 'silence'
    || buffSelect?.value === 'poison'
    || buffSelect?.value === 'fire'
    || buffSelect?.value === 'frostbite';
  if (!durationTurnsInput) return;
  durationTurnsInput.hidden = !needsDuration;
  if (durationTurnsInput.previousElementSibling) durationTurnsInput.previousElementSibling.hidden = !needsDuration;
  durationTurnsInput.required = needsDuration;
  if (!needsDuration) durationTurnsInput.value = '';
}

function validateAbilityInput(abilityInput) {
  if (abilityInput.target === 'enemy'
    && abilityInput.buffId !== 'none'
    && abilityInput.buffId !== 'silence'
    && abilityInput.buffId !== 'poison'
    && abilityInput.buffId !== 'fire'
    && abilityInput.buffId !== 'frostbite') {
    return 'Enemy-targeting abilities may only use enemy debuffs.';
  }
  if ((abilityInput.target === 'self' || abilityInput.target === 'friendly') && abilityInput.buffId !== 'none' && abilityInput.buffId !== 'taunt') {
    return 'Self/friendly-targeting abilities may only use buffs.';
  }

  if (abilityInput.buffId === 'taunt' && abilityInput.buffTarget !== 'self' && abilityInput.buffTarget !== 'friendly') {
    return 'Taunt buffs must target self or friendly.';
  }

  if ((abilityInput.buffId === 'silence' || abilityInput.buffId === 'poison' || abilityInput.buffId === 'fire' || abilityInput.buffId === 'frostbite') && abilityInput.buffTarget !== 'enemy') {
    return `${toTitle(abilityInput.buffId)} debuffs must target enemy.`;
  }

  if (abilityInput.effectId === 'disruption' && !abilityInput.enemyValueSourceStat) {
    return 'Disruption effects must choose an enemy target stat.';
  }

  if (abilityInput.buffId !== 'taunt'
    && abilityInput.buffId !== 'silence'
    && abilityInput.buffId !== 'poison'
    && abilityInput.buffId !== 'fire'
    && abilityInput.buffId !== 'frostbite') return null;
  const durationTurns = Number(abilityInput.durationTurns);
  if (!Number.isInteger(durationTurns) || durationTurns < 1) {
    return 'Taunt, silence, poison, fire, and frostbite effects must include a duration of at least 1 turn.';
  }
  return null;
}

function resetFormToCreateMode() {
  selectedAbilityId = null;
  saveAbilityButton.disabled = true;
  form.reset();
  abilityKindInput.value = configuredAbilityKind;
  form.elements.target.value = 'none';
  if (effectSelect.options.length) effectSelect.value = effectSelect.options[0].value;
  if (valueSourceTypeSelect.options.length) valueSourceTypeSelect.value = valueSourceTypeSelect.options[0].value;
  syncBuffOptionsForTarget({ preferredBuffId: 'none', preferredBuffTarget: 'none' });
  if (valueSourceStatSelect.options.length) valueSourceStatSelect.value = valueSourceStatSelect.options[0].value;
  valueSourceFixedInput.value = '';
  if (enemyValueSourceStatSelect.options.length) enemyValueSourceStatSelect.value = enemyValueSourceStatSelect.options[0].value;
  if (durationTurnsInput) durationTurnsInput.value = '';
  updateValueSourceVisibility();
  updateDurationVisibility();
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

    const target = document.createElement('p');
    target.className = 'catalog-card-type';
    target.textContent = `Target: ${ability.target || 'none'}`;

    const effect = document.createElement('p');
    effect.className = 'catalog-card-type';
    const valueSource = ability.valueSourceType === 'roll'
      ? `roll ${ability.valueSourceStat || 'damage'}`
      : (ability.valueSourceType === 'fixed' ? `fixed ${ability.valueSourceFixed ?? 0}` : 'none');
    const disruptionTarget = ability.effectId === 'disruption' && ability.enemyValueSourceStat
      ? ` → enemy ${toTitle(ability.enemyValueSourceStat)}`
      : '';
    effect.textContent = `Effect: ${toTitle(ability.effectId || 'none')} (${valueSource}${disruptionTarget})`;

    const buff = document.createElement('p');
    buff.className = 'catalog-card-type';
    const buffDuration = Number.isInteger(ability.durationTurns) ? `, duration ${ability.durationTurns} turn${ability.durationTurns === 1 ? '' : 's'}` : '';
    buff.textContent = `Buff: ${toTitle(ability.buffId || 'none')} (${toTitle(ability.buffTarget || 'none')}${buffDuration})`;

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Edit Ability';
    editButton.addEventListener('click', () => {
      selectedAbilityId = ability.id;
      form.elements.name.value = ability.name ?? '';
      form.elements.cost.value = ability.cost ?? '';
      form.elements.description.value = ability.description ?? '';
      form.elements.target.value = ability.target ?? 'none';
      form.elements.effectId.value = ability.effectId ?? 'none';
      form.elements.valueSourceType.value = ability.valueSourceType ?? 'none';
      syncBuffOptionsForTarget({
        preferredBuffId: ability.buffId ?? 'none',
        preferredBuffTarget: ability.buffTarget ?? 'none',
      });
      form.elements.valueSourceStat.value = ability.valueSourceStat ?? 'damage';
      form.elements.valueSourceFixed.value = Number.isFinite(ability.valueSourceFixed) ? ability.valueSourceFixed : '';
      form.elements.enemyValueSourceStat.value = ability.enemyValueSourceStat ?? 'damage';
      form.elements.durationTurns.value = Number.isInteger(ability.durationTurns) ? ability.durationTurns : '';
      abilityKindInput.value = ability.abilityKind ?? configuredAbilityKind;
      saveAbilityButton.disabled = false;
      updateValueSourceVisibility();
      updateDurationVisibility();
      setStatus(`Editing "${ability.name}".`);
    });

    row.append(heading, description, target, effect, buff, editButton);
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

    abilityOptionCatalog = {
      buffs: payload.abilityBuffs || ['none'],
      buffTargets: payload.abilityBuffTargets || ['none'],
      disruptionTargetStats: payload.abilityDisruptionTargetStats || ['damage', 'speed', 'defense'],
    };

    setOptions(effectSelect, payload.abilityEffects || ['none'], 'none');
    setOptions(valueSourceTypeSelect, payload.abilityValueSourceTypes || ['none'], 'none');
    syncBuffOptionsForTarget({ preferredBuffId: 'none', preferredBuffTarget: 'none' });
    setOptions(valueSourceStatSelect, payload.abilityRollStats || ['damage'], 'damage');
    setOptions(enemyValueSourceStatSelect, abilityOptionCatalog.disruptionTargetStats || ['damage', 'speed', 'defense'], 'damage');
    updateValueSourceVisibility();
    updateDurationVisibility();

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
  const validationError = validateAbilityInput(abilityInput);
  if (validationError) {
    setStatus(validationError, true);
    return;
  }

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
  const validationError = validateAbilityInput(abilityInput);
  if (validationError) {
    setStatus(validationError, true);
    return;
  }

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
      form.elements.target.value = updatedAbility.target ?? 'none';
      form.elements.effectId.value = updatedAbility.effectId ?? 'none';
      form.elements.valueSourceType.value = updatedAbility.valueSourceType ?? 'none';
      syncBuffOptionsForTarget({
        preferredBuffId: updatedAbility.buffId ?? 'none',
        preferredBuffTarget: updatedAbility.buffTarget ?? 'none',
      });
      form.elements.valueSourceStat.value = updatedAbility.valueSourceStat ?? 'damage';
      form.elements.valueSourceFixed.value = Number.isFinite(updatedAbility.valueSourceFixed) ? updatedAbility.valueSourceFixed : '';
      form.elements.enemyValueSourceStat.value = updatedAbility.enemyValueSourceStat ?? 'damage';
      form.elements.durationTurns.value = Number.isInteger(updatedAbility.durationTurns) ? updatedAbility.durationTurns : '';
      abilityKindInput.value = updatedAbility.abilityKind ?? configuredAbilityKind;
      updateValueSourceVisibility();
      updateDurationVisibility();
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

abilityKindInput.value = configuredAbilityKind;
if (abilityKindLabel) {
  abilityKindLabel.textContent = `${configuredAbilityKind} Ability Kind`;
}

form?.elements?.target?.addEventListener('change', () => {
  syncBuffOptionsForTarget();
  updateDurationVisibility();
});
valueSourceTypeSelect?.addEventListener('change', updateValueSourceVisibility);
effectSelect?.addEventListener('change', updateValueSourceVisibility);
buffSelect?.addEventListener('change', () => {
  syncBuffOptionsForTarget();
  updateDurationVisibility();
});
fetchAbilities();
