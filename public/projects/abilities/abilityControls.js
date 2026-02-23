export function formatAbilityOptionLabel(ability = {}) {
  const cost = String(ability.cost ?? '').trim();
  const name = String(ability.name ?? '').trim();
  if (cost && name) return `${cost} - ${name}`;
  return name || cost || 'Unnamed ability';
}

export function toAbilityInput(formData) {
  return {
    name: formData.get('name'),
    cost: formData.get('cost'),
    description: formData.get('description'),
  };
}
