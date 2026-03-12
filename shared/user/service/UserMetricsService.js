class UserMetricsService {
  constructor(options = {}) {
    this.recordBattleMetrics = options.recordBattleMetrics;
    if (typeof this.recordBattleMetrics !== 'function') {
      throw new Error('UserMetricsService requires a recordBattleMetrics handler');
    }
    this.allowedMetricKeys = new Set([
      'totalGamesPlayed',
      'totalWins',
      'totalLosses',
      'totalCreaturesKilled',
      'totalCreaturesLost',
      'totalSpellsPlayed',
    ]);
  }

  normalizeUserId(userId) {
    if (typeof userId === 'string') return userId.trim();
    if (userId && typeof userId.toString === 'function') {
      const normalized = userId.toString().trim();
      return normalized === '[object Object]' ? '' : normalized;
    }
    return '';
  }

  normalizeIncrement(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  normalizeMetricIncrements(metricIncrements = {}) {
    const normalized = {};
    for (const [key, value] of Object.entries(metricIncrements || {})) {
      if (!this.allowedMetricKeys.has(key)) continue;
      const increment = this.normalizeIncrement(value);
      if (increment > 0) {
        normalized[key] = increment;
      }
    }
    return normalized;
  }

  async incrementMetrics({ userId, metricIncrements } = {}) {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      throw new Error('invalid user id');
    }

    const normalizedIncrements = this.normalizeMetricIncrements(metricIncrements);
    if (!Object.keys(normalizedIncrements).length) {
      throw new Error('at least one metric increment is required');
    }

    return this.recordBattleMetrics(normalizedUserId, normalizedIncrements);
  }

  async incrementMetric({ userId, metricKey, increment = 1 } = {}) {
    if (typeof metricKey !== 'string' || !this.allowedMetricKeys.has(metricKey)) {
      throw new Error('invalid metric key');
    }

    return this.incrementMetrics({
      userId,
      metricIncrements: {
        [metricKey]: increment,
      },
    });
  }
}

module.exports = {
  UserMetricsService,
};
