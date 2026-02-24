export function formatAbilityOptionLabel(ability = {}) {
  const cost = String(ability.cost ?? '').trim();
  const name = String(ability.name ?? '').trim();
  if (cost && name) return `${cost} - ${name}`;
  return name || cost || 'Unnamed ability';
}

export function toAbilityInput(formData, defaultAbilityKind = 'Creature') {
  const abilityKind = formData.get('abilityKind') || defaultAbilityKind;
  const valueSourceType = String(formData.get('valueSourceType') || 'none').toLowerCase();
  const rawFixed = formData.get('valueSourceFixed');

  return {
    name: formData.get('name'),
    cost: formData.get('cost'),
    description: formData.get('description'),
    abilityKind,
    target: formData.get('target') || 'none',
    effectId: formData.get('effectId') || 'none',
    valueSourceType,
    valueSourceStat: valueSourceType === 'roll' ? (formData.get('valueSourceStat') || null) : null,
    valueSourceFixed: valueSourceType === 'fixed' ? rawFixed : null,
  };
}
