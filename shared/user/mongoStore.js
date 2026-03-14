const crypto = require('crypto');

const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.USERS_DB_NAME || process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.USERS_COLLECTION_NAME || 'users';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,24}$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_KEY_LENGTH = 64;

let clientPromise;

function getMongoClientConstructor() {
  try {
    return require('mongodb');
  } catch (error) {
    throw new Error('MongoDB driver missing. Run `npm install` to install dependencies before using user APIs.');
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
  await collection.createIndex({ username: 1 }, { unique: true, name: 'username_unique' });
  return collection;
}

function normalizeUsername(username) {
  if (typeof username !== 'string') throw new Error('username is required');
  const normalized = username.trim();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error('username must be 3-24 chars and only contain letters, numbers, or underscores');
  }
  return normalized;
}

function normalizePassword(password) {
  if (typeof password !== 'string') throw new Error('password is required');
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`);
  }
  return password;
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt);
  return {
    passwordHash: derivedKey.toString('hex'),
    passwordSalt: salt,
  };
}

async function verifyPassword(password, passwordHash, passwordSalt) {
  const derivedKey = await scryptAsync(password, passwordSalt);
  const storedKey = Buffer.from(passwordHash, 'hex');
  if (storedKey.length != derivedKey.length) return false;
  return crypto.timingSafeEqual(storedKey, derivedKey);
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

function normalizeDeckFromDocument(document = {}) {
  const legacyCards = Array.isArray(document.deck)
    ? document.deck
    : Array.isArray(document.deckCardIds)
      ? document.deckCardIds
      : Array.isArray(document.cards)
        ? document.cards
        : [];

  const deckSource = document.deck && typeof document.deck === 'object' && !Array.isArray(document.deck)
    ? document.deck
    : {};

  const cardsSource = Array.isArray(deckSource.cards) ? deckSource.cards : legacyCards;
  const cards = cardsSource.map(normalizeCardId).filter((cardId) => typeof cardId === 'string');

  const creatureCount = Number.isInteger(deckSource.creatureCount)
    ? deckSource.creatureCount
    : Number.isInteger(document.deckCreatureCount)
      ? document.deckCreatureCount
      : 0;

  const updatedAt = typeof deckSource.updatedAt === 'string'
    ? deckSource.updatedAt
    : typeof document.deckUpdatedAt === 'string'
      ? document.deckUpdatedAt
      : null;

  return {
    cards,
    creatureCount,
    updatedAt,
  };
}

function createDefaultPlayerMetrics() {
  return {
    totalGamesPlayed: 0,
    totalWins: 0,
    totalLosses: 0,
    totalCreaturesKilled: 0,
    totalCreaturesLost: 0,
    totalSpellsPlayed: 0,
    updatedAt: null,
  };
}

function hasPersistedMetricsObject(userDocument = {}) {
  return Boolean(
    userDocument.metrics
      && typeof userDocument.metrics === 'object'
      && !Array.isArray(userDocument.metrics),
  );
}

async function ensureUserHasMetricsObject(collection, userDocument) {
  if (!userDocument?._id || hasPersistedMetricsObject(userDocument)) {
    return;
  }

  const now = new Date().toISOString();
  await collection.updateOne(
    { _id: userDocument._id },
    {
      $set: {
        metrics: {
          ...createDefaultPlayerMetrics(),
          updatedAt: now,
        },
      },
    },
  );

  userDocument.metrics = {
    ...createDefaultPlayerMetrics(),
    updatedAt: now,
  };
}

function normalizePlayerMetricsFromDocument(document = {}) {
  const source = document?.metrics && typeof document.metrics === 'object'
    ? document.metrics
    : {};
  const defaults = createDefaultPlayerMetrics();
  const normalized = { ...defaults };

  Object.keys(defaults).forEach((key) => {
    if (key === 'updatedAt') {
      normalized.updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : null;
      return;
    }
    const rawValue = Number(source[key]);
    normalized[key] = Number.isFinite(rawValue) ? Math.max(0, Math.floor(rawValue)) : 0;
  });

  return normalized;
}

function toPublicUser(document) {
  const deck = normalizeDeckFromDocument(document);
  const metrics = normalizePlayerMetricsFromDocument(document);
  return {
    id: document._id.toString(),
    username: document.username,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt ?? null,
    deck,
    metrics,
    avatarImagePath: normalizeAvatarImagePath(document.avatarImagePath),
  };
}

function normalizeAvatarImagePath(avatarImagePath) {
  if (avatarImagePath == null) return null;
  if (typeof avatarImagePath !== 'string') {
    throw new Error('avatarImagePath must be a string');
  }
  const normalized = avatarImagePath.trim();
  if (!normalized) return null;
  if (!/^\/public\/assets\/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp|gif)$/i.test(normalized)) {
    throw new Error('avatarImagePath must reference an image in /public/assets');
  }
  return normalized;
}

async function createUser(input = {}) {
  const username = normalizeUsername(input.username);
  const password = normalizePassword(input.password);
  const collection = await getCollection();
  const now = new Date().toISOString();
  const { passwordHash, passwordSalt } = await hashPassword(password);

  try {
    const result = await collection.insertOne({
      username,
      passwordHash,
      passwordSalt,
      deck: {
        cards: [],
        creatureCount: 0,
        updatedAt: now,
      },
      metrics: {
        ...createDefaultPlayerMetrics(),
        updatedAt: now,
      },
      avatarImagePath: null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await collection.findOne({ _id: result.insertedId });
    return toPublicUser(created);
  } catch (error) {
    if (error?.code === 11000) {
      throw new Error('username is already taken');
    }
    throw error;
  }
}

async function loginUser(input = {}) {
  const username = normalizeUsername(input.username);
  const password = normalizePassword(input.password);

  const collection = await getCollection();
  const user = await collection.findOne({ username });
  if (!user) {
    throw new Error('invalid username or password');
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!isValidPassword) {
    throw new Error('invalid username or password');
  }

  await ensureUserHasMetricsObject(collection, user);

  return toPublicUser(user);
}

function normalizeDeck(deck = {}) {
  const cards = Array.isArray(deck.cards)
    ? deck.cards
      .map((cardId) => {
        if (typeof cardId === 'string') {
          const normalized = cardId.trim();
          return normalized || null;
        }
        if (cardId && typeof cardId === 'object' && typeof cardId.toHexString === 'function') {
          return cardId.toHexString();
        }
        if (cardId && typeof cardId === 'object' && typeof cardId.$oid === 'string') {
          const normalized = cardId.$oid.trim();
          return normalized || null;
        }
        return null;
      })
      .filter((cardId) => typeof cardId === 'string')
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

async function updateUserDeck(userId, deck = {}) {
  const { ObjectId } = getMongoClientConstructor();
  if (typeof userId !== 'string' || !ObjectId.isValid(userId)) {
    throw new Error('invalid user id');
  }
  const collection = await getCollection();
  const normalizedDeck = normalizeDeck(deck);
  const updatedAt = new Date().toISOString();
  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(userId) },
    {
      $set: {
        deck: normalizedDeck,
        updatedAt,
      },
    },
    { returnDocument: 'after' },
  );
  const updatedUser = result && typeof result === 'object' && 'value' in result
    ? result.value
    : result;
  if (!updatedUser) {
    throw new Error('user not found');
  }
  return toPublicUser(updatedUser);
}

async function getUserById(userId) {
  const { ObjectId } = getMongoClientConstructor();
  if (typeof userId !== 'string' || !ObjectId.isValid(userId)) {
    throw new Error('invalid user id');
  }

  const collection = await getCollection();
  const user = await collection.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    throw new Error('user not found');
  }

  return toPublicUser(user);
}

async function updateUserAvatar(userId, avatarImagePath = null) {
  const { ObjectId } = getMongoClientConstructor();
  if (typeof userId !== 'string' || !ObjectId.isValid(userId)) {
    throw new Error('invalid user id');
  }
  const normalizedAvatarImagePath = normalizeAvatarImagePath(avatarImagePath);
  const collection = await getCollection();
  const updatedAt = new Date().toISOString();
  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(userId) },
    {
      $set: {
        avatarImagePath: normalizedAvatarImagePath,
        updatedAt,
      },
    },
    { returnDocument: 'after' },
  );
  const updatedUser = result && typeof result === 'object' && 'value' in result
    ? result.value
    : result;
  if (!updatedUser) {
    throw new Error('user not found');
  }
  return toPublicUser(updatedUser);
}

function normalizeBattleMetricsInput(metrics = {}) {
  const coerce = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  };
  return {
    totalGamesPlayed: coerce(metrics.totalGamesPlayed),
    totalWins: coerce(metrics.totalWins),
    totalLosses: coerce(metrics.totalLosses),
    totalCreaturesKilled: coerce(metrics.totalCreaturesKilled),
    totalCreaturesLost: coerce(metrics.totalCreaturesLost),
    totalSpellsPlayed: coerce(metrics.totalSpellsPlayed),
  };
}

async function recordBattleMetrics(userId, metrics = {}) {
  const { ObjectId } = getMongoClientConstructor();
  if (typeof userId !== 'string') {
    throw new Error('invalid user id');
  }

  const collection = await getCollection();
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error('invalid user id');
  }

  const identifierQuery = ObjectId.isValid(normalizedUserId)
    ? { _id: new ObjectId(normalizedUserId) }
    : { username: normalizedUserId };

  const existingUser = await collection.findOne(
    identifierQuery,
    { projection: { _id: 1, metrics: 1 } },
  );
  if (!existingUser) {
    throw new Error('user not found');
  }
  const objectId = existingUser._id;

  await ensureUserHasMetricsObject(collection, existingUser);

  const increments = normalizeBattleMetricsInput(metrics);
  const now = new Date().toISOString();
  let result;
  try {
    result = await collection.findOneAndUpdate(
      { _id: objectId },
      {
        $inc: {
          'metrics.totalGamesPlayed': increments.totalGamesPlayed,
          'metrics.totalWins': increments.totalWins,
          'metrics.totalLosses': increments.totalLosses,
          'metrics.totalCreaturesKilled': increments.totalCreaturesKilled,
          'metrics.totalCreaturesLost': increments.totalCreaturesLost,
          'metrics.totalSpellsPlayed': increments.totalSpellsPlayed,
        },
        $set: {
          'metrics.updatedAt': now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
  } catch (error) {
    console.error('Failed to record battle metrics', {
      userId: normalizedUserId,
      metrics: increments,
      error: error?.message || 'unknown error',
    });
    throw error;
  }

  const updatedUser = result && typeof result === 'object' && 'value' in result
    ? result.value
    : result;
  if (!updatedUser) {
    throw new Error('user not found');
  }

  return toPublicUser(updatedUser);
}

module.exports = {
  createUser,
  getUserById,
  loginUser,
  normalizeDeckFromDocument,
  normalizeCardId,
  normalizePlayerMetricsFromDocument,
  normalizeAvatarImagePath,
  recordBattleMetrics,
  updateUserDeck,
  updateUserAvatar,
  normalizeUsername,
  normalizePassword,
  __testables: {
    hasPersistedMetricsObject,
    ensureUserHasMetricsObject,
    createDefaultPlayerMetrics,
  },
};
