export class StorycardDiceApi {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async #request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Request failed for ${path}`);
    }
    return data;
  }

  listDice() {
    return this.#request('/api/dice');
  }

  createDie({ sides = 6, areaSize = 8 } = {}) {
    return this.#request('/api/dice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sides, areaSize }),
    });
  }

  rollDie(dieId, { debugPhysics = false, tuning = undefined } = {}) {
    return this.#request(`/api/dice/${dieId}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debugPhysics, tuning }),
    });
  }
}

export async function mountSingleDieDemo({
  mount,
  api = new StorycardDiceApi(),
  sides = 6,
} = {}) {
  if (!mount) throw new Error('mount container is required');

  const card = document.createElement('article');
  card.className = 'die-item api-doc-demo';

  const title = document.createElement('div');
  title.className = 'die-title';
  title.textContent = `API Demo Die (D${sides})`;

  const result = document.createElement('div');
  result.className = 'die-result';
  result.textContent = 'Creating die...';

  const canvas = document.createElement('canvas');
  canvas.className = 'die-canvas';
  canvas.width = 300;
  canvas.height = 300;

  const rollBtn = document.createElement('button');
  rollBtn.textContent = 'Roll via API';

  card.append(title, result, canvas, rollBtn);
  mount.replaceChildren(card);

  const ctx = canvas.getContext('2d');
  const render = (value) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(45, 45, 210, 210);
    ctx.fillStyle = '#111827';
    ctx.font = '700 96px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value ?? '?'), 150, 150);
  };

  const { die } = await api.createDie({ sides });
  render('?');
  result.textContent = `Die created with id ${die.id.slice(0, 8)}...`;

  rollBtn.addEventListener('click', async () => {
    const { roll } = await api.rollDie(die.id);
    render(roll.outcome);
    result.textContent = `Current roll value: ${roll.outcome} | Roll id: ${roll.rollId.slice(0, 8)}...`;
  });
}
