const PROFILE_METRIC_FIELDS = [
  { key: 'totalGamesPlayed', label: 'Total Games Played' },
  { key: 'totalWins', label: 'Total Games Won' },
  { key: 'totalLosses', label: 'Total Games Lost' },
  { key: 'totalCreaturesKilled', label: 'Creatures Killed' },
  { key: 'totalCreaturesLost', label: 'Creatures Lost' },
  { key: 'totalSpellsPlayed', label: 'Spells Played' },
];

export function normalizeBattleMetrics(metricsInput = null) {
  const metrics = metricsInput && typeof metricsInput === 'object' ? metricsInput : {};
  return PROFILE_METRIC_FIELDS.reduce((accumulator, metric) => {
    const numericValue = Number(metrics[metric.key]);
    accumulator[metric.key] = Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
    return accumulator;
  }, {});
}

export function toProfilePanelMetrics(metricsInput = null) {
  const normalized = normalizeBattleMetrics(metricsInput);
  return PROFILE_METRIC_FIELDS.map((metric) => ({
    name: metric.label,
    value: normalized[metric.key],
  }));
}
