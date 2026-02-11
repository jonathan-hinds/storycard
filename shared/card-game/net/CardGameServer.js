const { CARD_ZONE_TYPES, isKnownZone } = require('../core/zoneFramework');

class CardGameServer {
  constructor({ cards = [] } = {}) {
    this.cardStore = new Map(cards.map((card) => {
      const normalizedZone = isKnownZone(card.zone) ? card.zone : CARD_ZONE_TYPES.HAND;
      return [card.id, { ...card, zone: normalizedZone, slotIndex: card.slotIndex ?? null }];
    }));
  }

  listCards() {
    return Array.from(this.cardStore.values());
  }

  getCard(cardId) {
    return this.cardStore.get(cardId) ?? null;
  }

  applyCardAction(cardId, action, payload = {}) {
    const card = this.getCard(cardId);
    if (!card) {
      return null;
    }

    card.held = action === 'pickup';
    card.updatedAt = Date.now();

    if (action === 'pickup') {
      card.previousZone = isKnownZone(payload.zone) ? payload.zone : card.zone;
      card.previousSlotIndex = Number.isInteger(payload.slotIndex) ? payload.slotIndex : card.slotIndex;
      card.zone = CARD_ZONE_TYPES.STAGING;
      card.slotIndex = null;
      return card;
    }

    if (action === 'putdown') {
      const nextZone = isKnownZone(payload.zone) ? payload.zone : (card.previousZone || CARD_ZONE_TYPES.HAND);
      card.zone = nextZone;
      card.slotIndex = Number.isInteger(payload.slotIndex) ? payload.slotIndex : null;
      return card;
    }

    return card;
  }
}

module.exports = { CardGameServer };
