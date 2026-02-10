import { DEFAULT_THROW_PARAMS } from '../util/defaults.js';

export class DieRollerHttpClient {
  constructor({ baseUrl = '' } = {}) {
    this.baseUrl = baseUrl;
    this.dieIdsByRef = new Map();
  }

  async ensureDie({ id, sides }) {
    if (this.dieIdsByRef.has(id)) return this.dieIdsByRef.get(id);
    const response = await fetch(`${this.baseUrl}/api/dice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sides }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to create die');
    this.dieIdsByRef.set(id, data.die.id);
    return data.die.id;
  }

  async roll({ id, sides, throwProfile }) {
    const dieId = await this.ensureDie({ id, sides });
    const response = await fetch(`${this.baseUrl}/api/dice/${dieId}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tuning: { ...DEFAULT_THROW_PARAMS, ...(throwProfile || {}) } }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to roll die');
    return data.roll;
  }
}
