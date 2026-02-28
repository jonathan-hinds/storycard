const CARD_TYPES = ['Nature', 'Fire', 'Water', 'Arcane'];
const CARD_KINDS = ['Creature', 'Spell'];
const CARD_STAT_DICE = ['D6', 'D8', 'D12', 'D20'];
const SPELL_EFFECTIVENESS_NONE_VALUE = 'NONE';
const { listAbilitiesByIds } = require('../abilities-catalog/mongoStore');

const DEFAULT_MONGO_URI = 'mongodb+srv://jonathandhd:Bluecow3@cluster0.fwdtteo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DATABASE_NAME = process.env.CARDS_DB_NAME || 'storycard';
const COLLECTION_NAME = process.env.CARDS_COLLECTION_NAME || 'cards';

let clientPromise;
let legacyStatsMigrationPromise;
let legacyCardKindMigrationPromise;
let spellStatCleanupPromise;

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

async function assignLegacyCardsToCreature(collection) {
  await collection.updateMany(
    {
      $or: [
        { cardKind: { $exists: false } },
        { cardKind: null },
      ],
    },
    {
      $set: {
        cardKind: 'Creature',
        updatedAt: new Date().toISOString(),
      },
    },
  );
}

async function ensureLegacyCardKindsMigrated() {
  if (!legacyCardKindMigrationPromise) {
    legacyCardKindMigrationPromise = getCollection()
      .then((collection) => assignLegacyCardsToCreature(collection))
      .catch((error) => {
        legacyCardKindMigrationPromise = null;
        throw error;
      });
  }

  return legacyCardKindMigrationPromise;
}

async function removeCreatureOnlyStatsFromSpells(collection) {
  await collection.updateMany(
    {
      cardKind: 'Spell',
      $or: [
        { health: { $exists: true } },
        { speed: { $exists: true } },
        { defense: { $exists: true } },
      ],
    },
    {
      $unset: {
        health: '',
        speed: '',
        defense: '',
      },
      $set: {
        updatedAt: new Date().toISOString(),
      },
    },
  );
}

async function ensureSpellStatsAreCleanedUp() {
  if (!spellStatCleanupPromise) {
    spellStatCleanupPromise = getCollection()
      .then((collection) => removeCreatureOnlyStatsFromSpells(collection))
      .catch((error) => {
        spellStatCleanupPromise = null;
        throw error;
      });
  }

  return spellStatCleanupPromise;
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
    cardKind: document.cardKind || 'Creature',
    artworkImagePath: document.artworkImagePath ?? null,
    ability1Id: document.ability1Id ?? null,
    ability2Id: document.ability2Id ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt ?? null,
  };
}

async function hydrateCardAbilities(cardRecords = []) {
  const abilityIds = [
    ...new Set(
      cardRecords
        .flatMap((card) => [card.ability1Id, card.ability2Id])
        .filter((id) => typeof id === 'string' && id.trim()),
    ),
  ];

  if (!abilityIds.length) {
    return cardRecords.map((card) => ({
      ...card,
      ability1: null,
      ability2: null,
    }));
  }

  const abilities = await listAbilitiesByIds(abilityIds);
  const abilityById = new Map(abilities.map((ability) => [ability.id, ability]));

  return cardRecords.map((card) => ({
    ...card,
    ability1: card.ability1Id ? abilityById.get(card.ability1Id) ?? null : null,
    ability2: card.ability2Id ? abilityById.get(card.ability2Id) ?? null : null,
  }));
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

function normalizeSpellEffectiveness(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!normalized || normalized === SPELL_EFFECTIVENESS_NONE_VALUE) {
    return null;
  }

  if (!CARD_STAT_DICE.includes(normalized)) {
    throw new Error(`damage must be one of: ${CARD_STAT_DICE.join(', ')}, ${SPELL_EFFECTIVENESS_NONE_VALUE}`);
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
  const cardKind = typeof input.cardKind === 'string' ? input.cardKind : '';

  if (!name) {
    throw new Error('name is required');
  }

  if (!CARD_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${CARD_TYPES.join(', ')}`);
  }

  if (!CARD_KINDS.includes(cardKind)) {
    throw new Error(`cardKind must be one of: ${CARD_KINDS.join(', ')}`);
  }

  const ability1Id = typeof input.ability1Id === 'string' ? input.ability1Id.trim() : '';
  const ability2Id = typeof input.ability2Id === 'string' ? input.ability2Id.trim() : '';

  const validatedInput = {
    name,
    damage: cardKind === 'Spell'
      ? normalizeSpellEffectiveness(input.damage)
      : normalizeDieValue(input.damage, 'damage'),
    type,
    cardKind,
    artworkImagePath: normalizeArtworkImagePath(input.artworkImagePath),
    ability1Id,
    ability2Id: ability2Id || null,
  };

  if (cardKind === 'Creature') {
    validatedInput.health = normalizeInteger(input.health, 'health');
    validatedInput.speed = normalizeDieValue(input.speed, 'speed');
    validatedInput.defense = normalizeDieValue(input.defense, 'defense');
  }

  return validatedInput;
}

async function validateAbilityReferences(validatedCardInput) {
  if (!validatedCardInput.ability1Id) {
    throw new Error('ability1Id is required');
  }

  if (validatedCardInput.ability2Id && validatedCardInput.ability1Id === validatedCardInput.ability2Id) {
    throw new Error('ability1Id and ability2Id must be different when both are set');
  }

  const requiredAbilityIds = [validatedCardInput.ability1Id, validatedCardInput.ability2Id].filter(Boolean);
  const abilities = await listAbilitiesByIds(requiredAbilityIds);
  const abilityIdSet = new Set(abilities.map((ability) => ability.id));
  const missingIds = requiredAbilityIds.filter((abilityId) => !abilityIdSet.has(abilityId));

  if (missingIds.length) {
    throw new Error(`Unknown abilities: ${missingIds.join(', ')}`);
  }

  const mismatchedAbility = abilities.find((ability) => ability.abilityKind !== validatedCardInput.cardKind);
  if (mismatchedAbility) {
    throw new Error(`Ability ${mismatchedAbility.id} is ${mismatchedAbility.abilityKind} but cardKind is ${validatedCardInput.cardKind}`);
  }
}

async function listCards() {
  await ensureLegacyStatsMigrated();
  await ensureLegacyCardKindsMigrated();
  await ensureSpellStatsAreCleanedUp();
  const collection = await getCollection();
  const docs = await collection.find({}).sort({ createdAt: -1, _id: -1 }).toArray();
  return hydrateCardAbilities(docs.map(toCardRecord));
}

async function createCard(input = {}) {
  await ensureLegacyStatsMigrated();
  await ensureLegacyCardKindsMigrated();
  await ensureSpellStatsAreCleanedUp();
  const collection = await getCollection();
  const validated = validateCardInput(input);
  await validateAbilityReferences(validated);
  const cardToInsert = {
    ...validated,
    createdAt: new Date().toISOString(),
  };

  const result = await collection.insertOne(cardToInsert);
  const inserted = await collection.findOne({ _id: result.insertedId });
  const [hydratedCard] = await hydrateCardAbilities([toCardRecord(inserted)]);
  return hydratedCard;
}

async function updateCard(cardId, input = {}) {
  await ensureLegacyStatsMigrated();
  await ensureLegacyCardKindsMigrated();
  await ensureSpellStatsAreCleanedUp();
  const collection = await getCollection();
  const validated = validateCardInput(input);
  await validateAbilityReferences(validated);
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
  const [hydratedCard] = await hydrateCardAbilities([toCardRecord(updatedCard)]);
  return hydratedCard;
}

module.exports = {
  CARD_TYPES,
  CARD_KINDS,
  CARD_STAT_DICE,
  listCards,
  createCard,
  updateCard,
};
