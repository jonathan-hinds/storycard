class CardGameServer {
  constructor({ cards = [] } = {}) {
    this.cardStore = new Map(cards.map((card) => [card.id, { ...card }]));
  }

  listCards() {
    return Array.from(this.cardStore.values());
  }

  getCard(cardId) {
    return this.cardStore.get(cardId) ?? null;
  }

  applyCardAction(cardId, action) {
    const card = this.getCard(cardId);
    if (!card) {
      return null;
    }

    card.held = action === 'pickup';
    card.updatedAt = Date.now();
    return card;
  }
}

module.exports = { CardGameServer };
