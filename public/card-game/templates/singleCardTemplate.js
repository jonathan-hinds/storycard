import { CARD_ZONE_TYPES, DEFAULT_ZONE_FRAMEWORK } from '../core/zoneFramework.js';

export const SINGLE_CARD_TEMPLATE = {
  playerSide: 'player',
  zoneFramework: DEFAULT_ZONE_FRAMEWORK,
  boardSlotLayout: [
    { x: -1.05, z: -1.3, side: 'opponent', zone: CARD_ZONE_TYPES.BOARD },
    { x: 1.05, z: -1.3, side: 'opponent', zone: CARD_ZONE_TYPES.BOARD },
    { x: 3.15, z: -1.3, side: 'opponent', zone: CARD_ZONE_TYPES.BOARD },
    { x: -1.05, z: 1.6, side: 'player', zone: CARD_ZONE_TYPES.BOARD },
    { x: 1.05, z: 1.6, side: 'player', zone: CARD_ZONE_TYPES.BOARD },
    { x: 3.15, z: 1.6, side: 'player', zone: CARD_ZONE_TYPES.BOARD },
  ],
  deckSlotLayout: [
    { x: -3.15, z: -1.3, side: 'opponent', zone: CARD_ZONE_TYPES.DECK },
    { x: -3.15, z: 1.6, side: 'player', zone: CARD_ZONE_TYPES.DECK },
  ],
  hiddenZoneLayout: [
    { side: 'player', zone: CARD_ZONE_TYPES.DISCARD },
    { side: 'player', zone: CARD_ZONE_TYPES.EXILE },
    { side: 'player', zone: CARD_ZONE_TYPES.STAGING },
    { side: 'player', zone: CARD_ZONE_TYPES.STACK },
    { side: 'player', zone: CARD_ZONE_TYPES.RESOLVING },
    { side: 'opponent', zone: CARD_ZONE_TYPES.DISCARD },
    { side: 'opponent', zone: CARD_ZONE_TYPES.EXILE },
    { side: 'opponent', zone: CARD_ZONE_TYPES.STAGING },
    { side: 'opponent', zone: CARD_ZONE_TYPES.STACK },
    { side: 'opponent', zone: CARD_ZONE_TYPES.RESOLVING },
  ],
  initialCards: [
    { id: 'card-alpha', color: 0x5f8dff, zone: CARD_ZONE_TYPES.BOARD, slotIndex: 0, owner: 'opponent' },
    { id: 'card-beta', color: 0x8f6cff, zone: CARD_ZONE_TYPES.BOARD, slotIndex: 1, owner: 'opponent' },
    { id: 'card-gamma', color: 0x2dc6ad, zone: CARD_ZONE_TYPES.BOARD, slotIndex: 3, owner: 'player' },
    { id: 'card-delta', color: 0xf28a65, zone: CARD_ZONE_TYPES.BOARD, slotIndex: 4, owner: 'player' },
    { id: 'card-epsilon', color: 0xf1c965, zone: CARD_ZONE_TYPES.HAND, owner: 'player' },
    { id: 'card-zeta', color: 0xe76fb9, zone: CARD_ZONE_TYPES.HAND, owner: 'player' },
  ],
};
