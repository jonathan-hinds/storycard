export const SINGLE_CARD_TEMPLATE = {
  playerSide: 'player',
  boardSlotLayout: [
    { x: -1.05, z: -1.3, side: 'opponent' },
    { x: 1.05, z: -1.3, side: 'opponent' },
    { x: 3.15, z: -1.3, side: 'opponent' },
    { x: -1.05, z: 1.6, side: 'player' },
    { x: 1.05, z: 1.6, side: 'player' },
    { x: 3.15, z: 1.6, side: 'player' },
  ],
  deckSlotLayout: [
    { x: -3.15, z: -1.3, side: 'opponent' },
    { x: -3.15, z: 1.6, side: 'player' },
  ],
  initialCards: [
    { id: 'card-alpha', color: 0x5f8dff, zone: 'board', slotIndex: 0, owner: 'opponent' },
    { id: 'card-beta', color: 0x8f6cff, zone: 'board', slotIndex: 1, owner: 'opponent' },
    { id: 'card-gamma', color: 0x2dc6ad, zone: 'board', slotIndex: 3, owner: 'player' },
    { id: 'card-delta', color: 0xf28a65, zone: 'board', slotIndex: 4, owner: 'player' },
    { id: 'card-epsilon', color: 0xf1c965, zone: 'hand' },
    { id: 'card-zeta', color: 0xe76fb9, zone: 'hand' },
  ],
};
