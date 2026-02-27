const fs = require('fs/promises');
const path = require('path');
const { ABILITY_BUFFS } = require('../abilities-catalog/mongoStore');

const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.BUFF_ICONS_COLLECTION_NAME || 'buff_icons';
const CONFIG_ID = 'buff-icons-config';
const LEGACY_STORE_PATH = path.join(__dirname, 'buff-icons.json');

let clientPromise;
let legacyImportPromise;

function getMongoClientConstructor() {
  try {
    return require('mongodb');
  } catch (error) {
    throw new Error('MongoDB driver missing. Run `npm install` to install dependencies before using buff icon APIs.');
  }
}

function getClient() {
  if (!clientPromise) {
    const { MongoClient } = getMongoClientConstructor();
    const mongoUri = process.env.MONGO_URI || DEFAULT_MONGO_URI;
    const client = new MongoClient(mongoUri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

async function getCollection() {
  const client = await getClient();
  const db = client.db(DATABASE_NAME);
  const existingCollections = await db.listCollections({ name: COLLECTION_NAME }).toArray();

  if (!existingCollections.length) {
    await db.createCollection(COLLECTION_NAME);
  }

  return db.collection(COLLECTION_NAME);
}

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

async function readLegacyStore() {
  try {
    const raw = await fs.readFile(LEGACY_STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function importLegacyStoreIfNeeded(collection) {
  const existing = await collection.findOne({ _id: CONFIG_ID });
  if (existing) return;

  const legacyStore = await readLegacyStore();
  const normalized = normalizeBuffIcons(legacyStore);

  await collection.insertOne({
    _id: CONFIG_ID,
    icons: normalized,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    source: Object.keys(legacyStore).length ? 'legacy-json-import' : 'mongodb-default',
  });
}

async function ensureLegacyStoreImported() {
  if (!legacyImportPromise) {
    legacyImportPromise = getCollection()
      .then((collection) => importLegacyStoreIfNeeded(collection))
      .catch((error) => {
        legacyImportPromise = null;
        throw error;
      });
  }

  return legacyImportPromise;
}

async function listBuffIcons() {
  await ensureLegacyStoreImported();
  const collection = await getCollection();
  const document = await collection.findOne({ _id: CONFIG_ID });
  return normalizeBuffIcons(document?.icons || {});
}

async function updateBuffIcons(input = {}) {
  await ensureLegacyStoreImported();
  const collection = await getCollection();
  const current = await listBuffIcons();
  const next = { ...current };

  Object.entries(input).forEach(([buffId, assetPath]) => {
    if (!ABILITY_BUFFS.includes(buffId) || buffId === 'none') return;
    next[buffId] = normalizeAssetPath(assetPath);
  });

  await collection.updateOne(
    { _id: CONFIG_ID },
    {
      $set: {
        icons: next,
        updatedAt: new Date().toISOString(),
      },
      $setOnInsert: {
        createdAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );

  return next;
}

module.exports = {
  listBuffIcons,
  updateBuffIcons,
};
