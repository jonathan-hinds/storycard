const CARD_TYPES = ['Nature', 'Fire', 'Water', 'Arcane'];
const CARD_STAT_DICE = ['D6', 'D8', 'D12', 'D20'];

const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.CARDS_COLLECTION_NAME || 'cards';

let clientPromise;
let legacyStatsMigrationPromise;

function getMongoClientConstructor() {
  try {
    return require('mongodb');
  } catch (error) {
    throw new Error('MongoDB driver missing. Run `npm install` to install dependencies before using cards catalog APIs.');
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

async function clearLegacyNumericStatValues(collection) {
  const migrationQuery = {
    $or: [
      { damage: { $type: 'number' } },
      { speed: { $type: 'number' } },
      { defense: { $type: 'number' } },
    ],
  };

  await collection.updateMany(
    migrationQuery,
    {
      $set: {
        damage: null,
        speed: null,
        defense: null,
        updatedAt: new Date().toISOString(),
      },
    },
  );
}

async function ensureLegacyStatsMigrated() {
  if (!legacyStatsMigrationPromise) {
    legacyStatsMigrationPromise = getCollection()
      .then((collection) => clearLegacyNumericStatValues(collection))
      .catch((error) => {
        legacyStatsMigrationPromise = null;
        throw error;
      });
  }

  return legacyStatsMigrationPromise;
}

function toCardRecord(document) {
  return {
    id: document._id.toString(),
    name: document.name,
    damage: document.damage,
    health: document.health,
    speed: document.speed,
    defense: document.defense,
    type: document.type,
    artworkImagePath: document.artworkImagePath ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt ?? null,
  };
}

function normalizeInteger(value, fieldName) {
  const normalized = Number.parseInt(value, 10);

  if (!Number.isFinite(normalized)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  return normalized;
}

function normalizeDieValue(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';

  if (!CARD_STAT_DICE.includes(normalized)) {
    throw new Error(`${fieldName} must be one of: ${CARD_STAT_DICE.join(', ')}`);
  }

  return normalized;
}


function normalizeArtworkImagePath(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('artworkImagePath must be a string path or null');
  }

  const normalized = value.trim();
  if (!normalized) return null;
  if (!normalized.startsWith('/public/assets/')) {
    throw new Error('artworkImagePath must reference /public/assets');
  }

  return normalized;
}

function validateCardInput(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const type = typeof input.type === 'string' ? input.type : '';

  if (!name) {
    throw new Error('name is required');
  }

  if (!CARD_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${CARD_TYPES.join(', ')}`);
  }

  return {
    name,
    damage: normalizeDieValue(input.damage, 'damage'),
    health: normalizeInteger(input.health, 'health'),
    speed: normalizeDieValue(input.speed, 'speed'),
    defense: normalizeDieValue(input.defense, 'defense'),
    type,
    artworkImagePath: normalizeArtworkImagePath(input.artworkImagePath),
  };
}

async function listCards() {
  await ensureLegacyStatsMigrated();
  const collection = await getCollection();
  const docs = await collection.find({}).sort({ createdAt: -1, _id: -1 }).toArray();
  return docs.map(toCardRecord);
}

async function createCard(input = {}) {
  await ensureLegacyStatsMigrated();
  const collection = await getCollection();
  const validated = validateCardInput(input);
  const cardToInsert = {
    ...validated,
    createdAt: new Date().toISOString(),
  };

  const result = await collection.insertOne(cardToInsert);
  const inserted = await collection.findOne({ _id: result.insertedId });
  return toCardRecord(inserted);
}

async function updateCard(cardId, input = {}) {
  await ensureLegacyStatsMigrated();
  const collection = await getCollection();
  const validated = validateCardInput(input);
  const { ObjectId } = getMongoClientConstructor();

  if (!ObjectId.isValid(cardId)) {
    throw new Error('Card not found');
  }

  const updateResult = await collection.updateOne(
    { _id: new ObjectId(cardId) },
    {
      $set: {
        ...validated,
        updatedAt: new Date().toISOString(),
      },
    },
  );

  if (!updateResult.matchedCount) {
    throw new Error('Card not found');
  }

  const updatedCard = await collection.findOne({ _id: new ObjectId(cardId) });
  return toCardRecord(updatedCard);
}

module.exports = {
  CARD_TYPES,
  CARD_STAT_DICE,
  listCards,
  createCard,
  updateCard,
};
