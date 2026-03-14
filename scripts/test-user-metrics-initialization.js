const assert = require('node:assert/strict');
const { __testables } = require('../shared/user/mongoStore');

async function run() {
  const { hasPersistedMetricsObject, ensureUserHasMetricsObject, createDefaultPlayerMetrics } = __testables;

  assert.equal(hasPersistedMetricsObject({ metrics: null }), false);
  assert.equal(hasPersistedMetricsObject({ metrics: [] }), false);
  assert.equal(hasPersistedMetricsObject({ metrics: {} }), true);

  const updates = [];
  const fakeCollection = {
    async updateOne(query, update) {
      updates.push({ query, update });
    },
  };

  const withoutMetrics = { _id: 'user-1' };
  await ensureUserHasMetricsObject(fakeCollection, withoutMetrics);
  assert.equal(updates.length, 1);
  assert.deepEqual(
    Object.keys(updates[0].update.$set.metrics).sort(),
    Object.keys(createDefaultPlayerMetrics()).sort(),
  );
  assert.equal(withoutMetrics.metrics.totalGamesPlayed, 0);

  await ensureUserHasMetricsObject(fakeCollection, withoutMetrics);
  assert.equal(updates.length, 1);

  const withExistingMetrics = { _id: 'user-2', metrics: { totalGamesPlayed: 11 } };
  await ensureUserHasMetricsObject(fakeCollection, withExistingMetrics);
  assert.equal(updates.length, 1);
  assert.equal(withExistingMetrics.metrics.totalGamesPlayed, 11);

  console.log('user metrics initialization checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
