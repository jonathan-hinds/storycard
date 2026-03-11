const assert = require('node:assert/strict');
const { UserMetricsService } = require('../shared/user/service/UserMetricsService');

async function run() {
  const calls = [];
  const service = new UserMetricsService({
    recordBattleMetrics: async (userId, metrics) => {
      calls.push({ userId, metrics });
      return { id: userId, metrics };
    },
  });

  await service.incrementMetric({
    userId: 'user-1',
    metricKey: 'totalSpellsPlayed',
    increment: 1,
  });

  await service.incrementMetrics({
    userId: 'user-1',
    metricIncrements: {
      totalCreaturesKilled: 2,
      totalCreaturesLost: 1,
      invalidKey: 10,
    },
  });

  assert.deepEqual(calls[0], {
    userId: 'user-1',
    metrics: { totalSpellsPlayed: 1 },
  });
  assert.deepEqual(calls[1], {
    userId: 'user-1',
    metrics: {
      totalCreaturesKilled: 2,
      totalCreaturesLost: 1,
    },
  });

  await assert.rejects(
    () => service.incrementMetric({ userId: 'user-1', metricKey: 'badKey', increment: 1 }),
    /invalid metric key/,
  );

  await assert.rejects(
    () => service.incrementMetrics({ userId: 'user-1', metricIncrements: { invalidKey: 2 } }),
    /at least one metric increment is required/,
  );

  console.log('user metrics service checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
