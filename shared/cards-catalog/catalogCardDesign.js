const DEFAULT_MESH_COLOR = '#000000';

function normalizeArtworkImagePath(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeCatalogCardDesign(catalogCard = {}) {
  const normalizeAbility = (ability) => {
    if (!ability || typeof ability !== 'object') return null;
    const cost = String(ability.cost ?? '').trim();
    const name = String(ability.name ?? '').trim();
    const description = String(ability.description ?? '').trim();
    if (!cost && !name && !description) return null;
    return {
      id: ability.id || null,
      cost,
      name,
      description,
    };
  };

  return {
    id: catalogCard.id || null,
    name: catalogCard.name || 'Unnamed Card',
    type: catalogCard.type || 'Unknown',
    damage: catalogCard.damage ?? '-',
    health: catalogCard.health ?? '-',
    speed: catalogCard.speed ?? '-',
    defense: catalogCard.defense ?? '-',
    ability1: normalizeAbility(catalogCard.ability1),
    ability2: normalizeAbility(catalogCard.ability2),
    meshColor: typeof catalogCard.meshColor === 'string' ? catalogCard.meshColor : DEFAULT_MESH_COLOR,
    artworkImagePath: normalizeArtworkImagePath(catalogCard.artworkImagePath),
  };
}

module.exports = {
  DEFAULT_MESH_COLOR,
  normalizeCatalogCardDesign,
};
