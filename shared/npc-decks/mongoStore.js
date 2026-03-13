const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.NPC_DECKS_DB_NAME || process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.NPC_DECKS_COLLECTION_NAME || 'npcDecks';

let clientPromise;

function getMongoClientConstructor() {
  try {
    return require('mongodb');
  } catch (error) {
    throw new Error('MongoDB driver missing. Run `npm install` to install dependencies before using NPC deck APIs.');
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

  const collection = db.collection(COLLECTION_NAME);
  await collection.createIndex({ name: 1 }, { name: 'name_lookup' });
  return collection;
}

function normalizeCardId(cardId) {
  if (typeof cardId === 'string') {
    const normalized = cardId.trim();
    return normalized || null;
  }

  if (cardId && typeof cardId === 'object') {
    if (typeof cardId.toHexString === 'function') {
      return cardId.toHexString();
    }

    if (typeof cardId.$oid === 'string') {
      const normalized = cardId.$oid.trim();
      return normalized || null;
    }

    if (typeof cardId.id === 'string') {
      const normalized = cardId.id.trim();
      return normalized || null;
    }

    if (typeof cardId.cardId === 'string') {
      const normalized = cardId.cardId.trim();
      return normalized || null;
    }
  }

  return null;
}

function normalizeDeck(deck = {}) {
  const cards = Array.isArray(deck.cards)
    ? deck.cards.map(normalizeCardId).filter((cardId) => typeof cardId === 'string')
    : [];

  if (cards.length > 10) {
    throw new Error('deck cannot exceed 10 cards');
  }

  const creatureCount = Number.isInteger(deck.creatureCount) ? deck.creatureCount : 0;
  if (creatureCount !== 3) {
    throw new Error('deck must include exactly 3 creature cards');
  }

  return {
    cards,
    creatureCount: 3,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDeckFromDocument(document = {}) {
  const deckSource = document.deck && typeof document.deck === 'object' && !Array.isArray(document.deck)
    ? document.deck
    : {};

  const cards = Array.isArray(deckSource.cards)
    ? deckSource.cards.map(normalizeCardId).filter((cardId) => typeof cardId === 'string')
    : [];

  return {
    cards,
    creatureCount: Number.isInteger(deckSource.creatureCount) ? deckSource.creatureCount : 0,
    updatedAt: typeof deckSource.updatedAt === 'string' ? deckSource.updatedAt : null,
  };
}

function normalizeDeckName(name) {
  if (typeof name !== 'string') throw new Error('deck name is required');
  const normalized = name.trim();
  if (!normalized) throw new Error('deck name is required');
  if (normalized.length > 64) throw new Error('deck name cannot exceed 64 characters');
  return normalized;
}

function toPublicNpcDeck(document) {
  return {
    id: document._id.toString(),
    name: document.name,
    deck: normalizeDeckFromDocument(document),
    createdAt: document.createdAt || null,
    updatedAt: document.updatedAt || null,
  };
}

async function listNpcDecks() {
  const collection = await getCollection();
  const docs = await collection.find({}).sort({ updatedAt: -1, createdAt: -1 }).toArray();
  return docs.map(toPublicNpcDeck);
}

async function createNpcDeck({ name, deck } = {}) {
  const collection = await getCollection();
  const normalizedDeck = normalizeDeck(deck);
  const normalizedName = normalizeDeckName(name);
  const now = new Date().toISOString();
  const record = {
    name: normalizedName,
    deck: normalizedDeck,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.insertOne(record);
  const created = await collection.findOne({ _id: result.insertedId });
  return toPublicNpcDeck(created);
}

async function updateNpcDeck(deckId, { name, deck } = {}) {
  const { ObjectId } = getMongoClientConstructor();
  if (typeof deckId !== 'string' || !ObjectId.isValid(deckId)) {
    throw new Error('invalid deck id');
  }

  const collection = await getCollection();
  const normalizedDeck = normalizeDeck(deck);
  const normalizedName = normalizeDeckName(name);
  const updatedAt = new Date().toISOString();
  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(deckId) },
    {
      $set: {
        name: normalizedName,
        deck: normalizedDeck,
        updatedAt,
      },
    },
    { returnDocument: 'after' },
  );

  const updatedDeck = result && typeof result === 'object' && 'value' in result
    ? result.value
    : result;

  if (!updatedDeck) {
    throw new Error('deck not found');
  }

  return toPublicNpcDeck(updatedDeck);
}

module.exports = {
  listNpcDecks,
  createNpcDeck,
  updateNpcDeck,
};
