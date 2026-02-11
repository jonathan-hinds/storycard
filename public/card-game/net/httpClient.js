export class CardGameHttpClient {
  constructor({ baseUrl = '' } = {}) {
    this.baseUrl = baseUrl;
  }

  async listCards() {
    const response = await fetch(`${this.baseUrl}/api/cards`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to list cards');
    }
    return payload;
  }

  async cardAction(cardId, action, extra = {}) {
    const response = await fetch(`${this.baseUrl}/api/cards/${cardId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: Date.now(), ...extra }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Failed card action: ${action}`);
    }
    return payload;
  }
}
