const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.ABILITIES_COLLECTION_NAME || 'abilities';
const ABILITY_KINDS = ['Creature', 'Spell'];
const ABILITY_TARGETS = ['self', 'enemy', 'friendly', 'none'];
const ABILITY_EFFECTS = ['none', 'damage_enemy', 'heal_target', 'retaliation_bonus'];
const ABILITY_VALUE_SOURCE_TYPES = ['none', 'roll', 'fixed'];
const ABILITY_ROLL_STATS = ['damage', 'speed', 'defense', 'efct'];
const ABILITY_ROLL_STATS_BY_KIND = Object.freeze({
  Creature: ['damage', 'speed', 'defense'],
  Spell: ['efct'],
});

let clientPromise;
let legacyAbilityMigrationPromise;

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

async function migrateLegacyAbilities(collection) {
  const now = new Date().toISOString();

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
        updatedAt: now,
      },
    },
  );

  await collection.updateMany(
    {
      $or: [
        { target: { $exists: false } },
        { target: null },
      ],
    },
    {
      $set: {
        target: 'none',
        updatedAt: now,
      },
    },
  );

  await collection.updateMany(
    {
      $or: [
        { effectId: { $exists: false } },
        { effectId: null },
      ],
      abilityKind: 'Creature',
    },
    {
      $set: {
        effectId: 'damage_enemy',
        valueSourceType: 'roll',
        valueSourceStat: 'damage',
        valueSourceFixed: null,
        updatedAt: now,
      },
    },
  );

  await collection.updateMany(
    {
      $or: [
        { effectId: { $exists: false } },
        { effectId: null },
      ],
      abilityKind: 'Spell',
    },
    {
      $set: {
        effectId: 'none',
        valueSourceType: 'none',
        valueSourceStat: null,
        valueSourceFixed: null,
        updatedAt: now,
      },
    },
  );
}

async function ensureLegacyAbilitiesMigrated() {
  if (!legacyAbilityMigrationPromise) {
    legacyAbilityMigrationPromise = getCollection()
      .then((collection) => migrateLegacyAbilities(collection))
      .catch((error) => {
        legacyAbilityMigrationPromise = null;
        throw error;
      });
  }

  return legacyAbilityMigrationPromise;
}

function toAbilityRecord(document) {
  return {
    id: document._id.toString(),
    name: document.name,
    cost: document.cost,
    description: document.description,
    abilityKind: document.abilityKind || 'Creature',
    target: document.target || 'none',
    effectId: document.effectId || 'none',
    valueSourceType: document.valueSourceType || 'none',
    valueSourceStat: document.valueSourceStat || null,
    valueSourceFixed: Number.isFinite(document.valueSourceFixed) ? document.valueSourceFixed : null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt ?? null,
  };
}

function normalizeAbilityInput(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const cost = typeof input.cost === 'string' ? input.cost.trim() : String(input.cost ?? '').trim();
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const abilityKind = typeof input.abilityKind === 'string' ? input.abilityKind.trim() : '';
  const target = typeof input.target === 'string' ? input.target.trim().toLowerCase() : '';
  const effectId = typeof input.effectId === 'string' ? input.effectId.trim().toLowerCase() : 'none';
  const valueSourceType = typeof input.valueSourceType === 'string' ? input.valueSourceType.trim().toLowerCase() : 'none';
  const valueSourceStat = typeof input.valueSourceStat === 'string' ? input.valueSourceStat.trim().toLowerCase() : null;
  const fixedRaw = input.valueSourceFixed;
  const valueSourceFixed = fixedRaw === '' || fixedRaw == null ? null : Number(fixedRaw);

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

  if (!ABILITY_TARGETS.includes(target)) {
    throw new Error(`target must be one of: ${ABILITY_TARGETS.join(', ')}`);
  }

  if (!ABILITY_EFFECTS.includes(effectId)) {
    throw new Error(`effectId must be one of: ${ABILITY_EFFECTS.join(', ')}`);
  }

  if (!ABILITY_VALUE_SOURCE_TYPES.includes(valueSourceType)) {
    throw new Error(`valueSourceType must be one of: ${ABILITY_VALUE_SOURCE_TYPES.join(', ')}`);
  }

  const allowedRollStats = ABILITY_ROLL_STATS_BY_KIND[abilityKind] || ABILITY_ROLL_STATS;
  if (valueSourceType === 'roll' && !allowedRollStats.includes(valueSourceStat || '')) {
    throw new Error(`valueSourceStat must be one of: ${allowedRollStats.join(', ')}`);
  }

  if (valueSourceType === 'fixed') {
    if (!Number.isFinite(valueSourceFixed)) {
      throw new Error('valueSourceFixed must be a number when valueSourceType is fixed');
    }
    if (valueSourceFixed < 0) {
      throw new Error('valueSourceFixed must be 0 or greater');
    }
  }

  return {
    name,
    cost,
    description,
    abilityKind,
    target,
    effectId,
    valueSourceType,
    valueSourceStat: valueSourceType === 'roll' ? valueSourceStat : null,
    valueSourceFixed: valueSourceType === 'fixed' ? valueSourceFixed : null,
  };
}

async function listAbilities({ abilityKind } = {}) {
  await ensureLegacyAbilitiesMigrated();
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
  await ensureLegacyAbilitiesMigrated();
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
  await ensureLegacyAbilitiesMigrated();
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
  await ensureLegacyAbilitiesMigrated();
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
  ABILITY_TARGETS,
  ABILITY_EFFECTS,
  ABILITY_VALUE_SOURCE_TYPES,
  ABILITY_ROLL_STATS,
  ABILITY_ROLL_STATS_BY_KIND,
  listAbilities,
  listAbilitiesByIds,
  createAbility,
  updateAbility,
};
