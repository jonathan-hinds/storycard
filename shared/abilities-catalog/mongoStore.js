const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.ABILITIES_COLLECTION_NAME || 'abilities';
const ABILITY_KINDS = ['Creature', 'Spell'];

let clientPromise;
let legacyAbilityKindMigrationPromise;

function getMongoClientConstructor() {
  try {
    return require('mongodb');
  } catch (error) {
    throw new Error('MongoDB driver missing. Run `npm install` to install dependencies before using abilities catalog APIs.');
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

async function assignLegacyAbilitiesToCreature(collection) {
  await collection.updateMany(
    {
      $or: [
        { abilityKind: { $exists: false } },
        { abilityKind: null },
      ],
    },
    {
      $set: {
        abilityKind: 'Creature',
        updatedAt: new Date().toISOString(),
      },
    },
  );
}

async function ensureLegacyAbilityKindsMigrated() {
  if (!legacyAbilityKindMigrationPromise) {
    legacyAbilityKindMigrationPromise = getCollection()
      .then((collection) => assignLegacyAbilitiesToCreature(collection))
      .catch((error) => {
        legacyAbilityKindMigrationPromise = null;
        throw error;
      });
  }

  return legacyAbilityKindMigrationPromise;
}

function toAbilityRecord(document) {
  return {
    id: document._id.toString(),
    name: document.name,
    cost: document.cost,
    description: document.description,
    abilityKind: document.abilityKind || 'Creature',
    createdAt: document.createdAt,
    updatedAt: document.updatedAt ?? null,
  };
}

function normalizeAbilityInput(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const cost = typeof input.cost === 'string' ? input.cost.trim() : String(input.cost ?? '').trim();
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const abilityKind = typeof input.abilityKind === 'string' ? input.abilityKind.trim() : '';

  if (!name) {
    throw new Error('name is required');
  }

  if (!cost) {
    throw new Error('cost is required');
  }

  if (!description) {
    throw new Error('description is required');
  }

  if (!ABILITY_KINDS.includes(abilityKind)) {
    throw new Error(`abilityKind must be one of: ${ABILITY_KINDS.join(', ')}`);
  }

  return { name, cost, description, abilityKind };
}

async function listAbilities({ abilityKind } = {}) {
  await ensureLegacyAbilityKindsMigrated();
  const collection = await getCollection();
  const normalizedAbilityKind = typeof abilityKind === 'string' ? abilityKind.trim() : '';
  if (normalizedAbilityKind && !ABILITY_KINDS.includes(normalizedAbilityKind)) {
    throw new Error(`abilityKind must be one of: ${ABILITY_KINDS.join(', ')}`);
  }

  const query = normalizedAbilityKind ? { abilityKind: normalizedAbilityKind } : {};
  const docs = await collection.find(query).sort({ createdAt: -1, _id: -1 }).toArray();
  return docs.map(toAbilityRecord);
}

async function listAbilitiesByIds(ids = []) {
  await ensureLegacyAbilityKindsMigrated();
  const { ObjectId } = getMongoClientConstructor();
  const validObjectIds = ids
    .filter((id) => typeof id === 'string' && ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (!validObjectIds.length) {
    return [];
  }

  const collection = await getCollection();
  const docs = await collection.find({ _id: { $in: validObjectIds } }).toArray();
  return docs.map(toAbilityRecord);
}

async function createAbility(input = {}) {
  await ensureLegacyAbilityKindsMigrated();
  const collection = await getCollection();
  const validated = normalizeAbilityInput(input);
  const abilityToInsert = {
    ...validated,
    createdAt: new Date().toISOString(),
  };

  const result = await collection.insertOne(abilityToInsert);
  const inserted = await collection.findOne({ _id: result.insertedId });
  return toAbilityRecord(inserted);
}

async function updateAbility(abilityId, input = {}) {
  await ensureLegacyAbilityKindsMigrated();
  const { ObjectId } = getMongoClientConstructor();
  if (!ObjectId.isValid(abilityId)) {
    throw new Error('Ability not found');
  }

  const collection = await getCollection();
  const validated = normalizeAbilityInput(input);

  const updateResult = await collection.updateOne(
    { _id: new ObjectId(abilityId) },
    {
      $set: {
        ...validated,
        updatedAt: new Date().toISOString(),
      },
    },
  );

  if (!updateResult.matchedCount) {
    throw new Error('Ability not found');
  }

  const updated = await collection.findOne({ _id: new ObjectId(abilityId) });
  return toAbilityRecord(updated);
}

module.exports = {
  ABILITY_KINDS,
  listAbilities,
  listAbilitiesByIds,
  createAbility,
  updateAbility,
};
