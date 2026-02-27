const fs = require('fs/promises');
const path = require('path');
const { ABILITY_BUFFS } = require('../abilities-catalog/mongoStore');

const STORE_PATH = path.join(__dirname, 'buff-icons.json');

function normalizeAssetPath(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!normalized.startsWith('/public/assets/')) {
    throw new Error('assetPath must reference /public/assets');
  }
  return normalized;
}

function normalizeBuffIcons(input = {}) {
  const icons = {};
  ABILITY_BUFFS
    .filter((buffId) => buffId !== 'none')
    .forEach((buffId) => {
      icons[buffId] = normalizeAssetPath(input[buffId]);
    });
  return icons;
}

async function readRawStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function listBuffIcons() {
  const rawStore = await readRawStore();
  return normalizeBuffIcons(rawStore);
}

async function updateBuffIcons(input = {}) {
  const current = await listBuffIcons();
  const next = { ...current };

  Object.entries(input).forEach(([buffId, assetPath]) => {
    if (!ABILITY_BUFFS.includes(buffId) || buffId === 'none') return;
    next[buffId] = normalizeAssetPath(assetPath);
  });

  await fs.writeFile(STORE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

module.exports = {
  listBuffIcons,
  updateBuffIcons,
};
