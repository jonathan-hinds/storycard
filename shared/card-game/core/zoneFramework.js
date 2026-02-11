const CARD_ZONE_TYPES = Object.freeze({
  HAND: 'hand',
  BOARD: 'board',
  DECK: 'deck',
  DISCARD: 'discard',
  EXILE: 'exile',
  STAGING: 'staging',
  STACK: 'stack',
  RESOLVING: 'resolving',
});

const DEFAULT_ZONE_FRAMEWORK = Object.freeze({
  sides: ['player', 'opponent'],
  zoneTypes: Object.values(CARD_ZONE_TYPES),
});

function isKnownZone(zone, zoneFramework = DEFAULT_ZONE_FRAMEWORK) {
  return zoneFramework.zoneTypes.includes(zone);
}

module.exports = {
  CARD_ZONE_TYPES,
  DEFAULT_ZONE_FRAMEWORK,
  isKnownZone,
};
