const CARD_STAT_DICE = ['D6', 'D8', 'D12', 'D20'];

const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.ARCHETYPES_COLLECTION_NAME || 'archetypes';

let clientPromise;

function getMongoClientConstructor() {
  try {
    return require('mongodb');
  } catch (error) {
    throw new Error('MongoDB driver missing. Run `npm install` to install dependencies before using archetypes catalog APIs.');
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

function validateArchetypeInput(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';

  if (!name) {
    throw new Error('name is required');
  }

  return {
    name,
    health: normalizeInteger(input.health, 'health'),
    damage: normalizeDieValue(input.damage, 'damage'),
    speed: normalizeDieValue(input.speed, 'speed'),
    defense: normalizeDieValue(input.defense, 'defense'),
  };
}

function toArchetypeRecord(document) {
  return {
    id: document._id.toString(),
    name: document.name,
    health: document.health,
    damage: document.damage,
    speed: document.speed,
    defense: document.defense,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt ?? null,
  };
}

async function listArchetypes() {
  const collection = await getCollection();
  const docs = await collection.find({}).sort({ createdAt: -1, _id: -1 }).toArray();
  return docs.map(toArchetypeRecord);
}

async function listArchetypesByIds(ids = []) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id.trim()))];
  if (!uniqueIds.length) return [];

  const { ObjectId } = getMongoClientConstructor();
  const validObjectIds = uniqueIds
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (!validObjectIds.length) return [];

  const collection = await getCollection();
  const docs = await collection.find({ _id: { $in: validObjectIds } }).toArray();
  return docs.map(toArchetypeRecord);
}

async function createArchetype(input = {}) {
  const collection = await getCollection();
  const validated = validateArchetypeInput(input);
  const toInsert = {
    ...validated,
    createdAt: new Date().toISOString(),
  };

  const result = await collection.insertOne(toInsert);
  const inserted = await collection.findOne({ _id: result.insertedId });
  return toArchetypeRecord(inserted);
}

async function updateArchetype(archetypeId, input = {}) {
  const collection = await getCollection();
  const validated = validateArchetypeInput(input);
  const { ObjectId } = getMongoClientConstructor();

  if (!ObjectId.isValid(archetypeId)) {
    throw new Error('Archetype not found');
  }

  const updateResult = await collection.updateOne(
    { _id: new ObjectId(archetypeId) },
    {
      $set: {
        ...validated,
        updatedAt: new Date().toISOString(),
      },
    },
  );

  if (!updateResult.matchedCount) {
    throw new Error('Archetype not found');
  }

  const updated = await collection.findOne({ _id: new ObjectId(archetypeId) });
  return toArchetypeRecord(updated);
}

module.exports = {
  CARD_STAT_DICE,
  listArchetypes,
  listArchetypesByIds,
  createArchetype,
  updateArchetype,
};
