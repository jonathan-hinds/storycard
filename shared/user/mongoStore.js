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

function toPublicUser(document) {
  return {
    id: document._id.toString(),
    username: document.username,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt ?? null,
  };
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

  return toPublicUser(user);
}

module.exports = {
  createUser,
  loginUser,
  normalizeUsername,
  normalizePassword,
};
