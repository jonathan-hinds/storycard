import { DieRollerClient } from './die-roller/index.js';

const dieList = document.getElementById('die-list');
const createDieForm = document.getElementById('create-die-form');

const clients = new Map();

function renderDieCard({ id, sides }) {
  const item = document.createElement('article');
  item.className = 'die-item';

  const title = document.createElement('div');
  title.className = 'die-title';
  title.textContent = `Die ${sides} sides`;

  const result = document.createElement('div');
  result.className = 'die-result';
  result.textContent = 'Current roll value: -';

  const mount = document.createElement('div');

  const rollBtn = document.createElement('button');
  rollBtn.textContent = 'Roll';

  const client = new DieRollerClient({
    container: mount,
    options: {
      onSettled: ({ value }) => {
        result.textContent = `Current roll value: ${value ?? '-'}`;
      },
    },
  });

  rollBtn.addEventListener('click', async () => {
    await client.roll({ dice: [{ sides, id }] });
  });

  clients.set(id, client);
  item.append(title, result, mount, rollBtn);
  return item;
}

createDieForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sides = Number.parseInt(new FormData(createDieForm).get('sides'), 10);
  const id = `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dieList.append(renderDieCard({ id, sides }));
});
