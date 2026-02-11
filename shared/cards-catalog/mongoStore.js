const CARD_TYPES = ['Nature', 'Fire', 'Water', 'Arcane'];

const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.CARDS_COLLECTION_NAME || 'cards';

let clientPromise;

function getMongoClientConstructor() {
  try {
    return require('mongodb').MongoClient;
  } catch (error) {
    throw new Error('MongoDB driver missing. Run `npm install` to install dependencies before using cards catalog APIs.');
  }
}

function getClient() {
  if (!clientPromise) {
    const MongoClient = getMongoClientConstructor();
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

function toCardRecord(document) {
  return {
    id: document._id.toString(),
    name: document.name,
    damage: document.damage,
    health: document.health,
    speed: document.speed,
    type: document.type,
    createdAt: document.createdAt,
  };
}

function normalizeInteger(value, fieldName) {
  const normalized = Number.parseInt(value, 10);

  if (!Number.isFinite(normalized)) {
    throw new Error(`${fieldName} must be an integer`);
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
    damage: normalizeInteger(input.damage, 'damage'),
    health: normalizeInteger(input.health, 'health'),
    speed: normalizeInteger(input.speed, 'speed'),
    type,
  };
}

async function listCards() {
  const collection = await getCollection();
  const docs = await collection.find({}).sort({ createdAt: -1, _id: -1 }).toArray();
  return docs.map(toCardRecord);
}

async function createCard(input = {}) {
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

module.exports = {
  CARD_TYPES,
  listCards,
  createCard,
};
