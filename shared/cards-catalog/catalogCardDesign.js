const DEFAULT_MESH_COLOR = '#000000';

function normalizeArtworkImagePath(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeCatalogCardDesign(catalogCard = {}) {
  return {
    id: catalogCard.id || null,
    name: catalogCard.name || 'Unnamed Card',
    type: catalogCard.type || 'Unknown',
    damage: catalogCard.damage ?? '-',
    health: catalogCard.health ?? '-',
    speed: catalogCard.speed ?? '-',
    defense: catalogCard.defense ?? '-',
    meshColor: typeof catalogCard.meshColor === 'string' ? catalogCard.meshColor : DEFAULT_MESH_COLOR,
    artworkImagePath: normalizeArtworkImagePath(catalogCard.artworkImagePath),
  };
}

module.exports = {
  DEFAULT_MESH_COLOR,
  normalizeCatalogCardDesign,
};
