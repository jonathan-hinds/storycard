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

const CARD_ZONE_VISIBILITY = Object.freeze({
  [CARD_ZONE_TYPES.HAND]: 'visible',
  [CARD_ZONE_TYPES.BOARD]: 'visible',
  [CARD_ZONE_TYPES.DECK]: 'visible',
  [CARD_ZONE_TYPES.DISCARD]: 'hidden',
  [CARD_ZONE_TYPES.EXILE]: 'hidden',
  [CARD_ZONE_TYPES.STAGING]: 'hidden',
  [CARD_ZONE_TYPES.STACK]: 'hidden',
  [CARD_ZONE_TYPES.RESOLVING]: 'hidden',
});

const DEFAULT_ZONE_FRAMEWORK = Object.freeze({
  sides: ['player', 'opponent'],
  zoneTypes: Object.values(CARD_ZONE_TYPES),
  visibilityByZone: CARD_ZONE_VISIBILITY,
  boardSlotsPerSide: 3,
  deckSlotsPerSide: 1,
});

function summarizeZoneCounts(layout = [], sides = []) {
  const countsBySide = new Map(sides.map((side) => [side, 0]));
  layout.forEach((slot) => {
    if (!countsBySide.has(slot.side)) countsBySide.set(slot.side, 0);
    countsBySide.set(slot.side, countsBySide.get(slot.side) + 1);
  });
  return countsBySide;
}

export function validateZoneTemplate(template, zoneFramework = DEFAULT_ZONE_FRAMEWORK) {
  const boardCounts = summarizeZoneCounts(template.boardSlotLayout, zoneFramework.sides);
  const deckCounts = summarizeZoneCounts(template.deckSlotLayout, zoneFramework.sides);

  for (const side of zoneFramework.sides) {
    const boardCount = boardCounts.get(side) ?? 0;
    const deckCount = deckCounts.get(side) ?? 0;
    if (boardCount !== zoneFramework.boardSlotsPerSide) {
      throw new Error(`Expected exactly ${zoneFramework.boardSlotsPerSide} board slots for ${side}; found ${boardCount}.`);
    }
    if (deckCount !== zoneFramework.deckSlotsPerSide) {
      throw new Error(`Expected exactly ${zoneFramework.deckSlotsPerSide} deck slots for ${side}; found ${deckCount}.`);
    }
  }

  return { boardCounts, deckCounts };
}

export function isKnownZone(zone, zoneFramework = DEFAULT_ZONE_FRAMEWORK) {
  return zoneFramework.zoneTypes.includes(zone);
}

export { CARD_ZONE_TYPES, DEFAULT_ZONE_FRAMEWORK };
