import { DieRollerClient } from './die-roller/index.js';

const dieList = document.getElementById('die-list');
const createDieForm = document.getElementById('create-die-form');

const clients = new Map();

const VISUAL_TUNING_SLIDERS = [
  {
    key: 'ambientLightIntensity',
    label: 'Ambient light brightness',
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: 1,
    format: (value) => value.toFixed(2),
  },
  {
    key: 'topLightIntensity',
    label: 'Top light brightness',
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: 0.75,
    format: (value) => value.toFixed(2),
  },
  {
    key: 'dieRoughness',
    label: 'Die roughness',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.82,
    format: (value) => value.toFixed(2),
  },
];

function createVisualTuningControls(client) {
  const controls = document.createElement('div');
  controls.className = 'tools-slider-grid die-tuning-controls';

  VISUAL_TUNING_SLIDERS.forEach((sliderConfig) => {
    const row = document.createElement('label');
    row.className = 'tools-slider-row';

    const label = document.createElement('span');
    label.textContent = sliderConfig.label;

    const value = document.createElement('span');
    value.className = 'tools-slider-value';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(sliderConfig.min);
    input.max = String(sliderConfig.max);
    input.step = String(sliderConfig.step);
    input.value = String(sliderConfig.defaultValue);

    const update = () => {
      const parsed = Number.parseFloat(input.value);
      const safeValue = Number.isFinite(parsed) ? parsed : sliderConfig.defaultValue;
      value.textContent = sliderConfig.format(safeValue);
      client.setRenderTuning({ [sliderConfig.key]: safeValue });
    };

    input.addEventListener('input', update);
    update();

    row.append(label, value, input);
    controls.append(row);
  });

  return controls;
}

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

  const actions = document.createElement('div');
  actions.className = 'die-actions';

  const rollBtn = document.createElement('button');
  rollBtn.textContent = 'Roll';

  const downloadSkinBtn = document.createElement('button');
  downloadSkinBtn.type = 'button';
  downloadSkinBtn.textContent = 'Download skin template';

  const client = new DieRollerClient({
    container: mount,
    options: {
      onSettled: ({ value }) => {
        result.textContent = `Current roll value: ${value ?? '-'}`;
      },
    },
  });

  const visualTuningControls = createVisualTuningControls(client);

  rollBtn.addEventListener('click', async () => {
    await client.roll({ dice: [{ sides, id }] });
  });

  downloadSkinBtn.addEventListener('click', () => {
    client.downloadTemplateSkin(sides);
  });

  clients.set(id, client);
  actions.append(rollBtn, downloadSkinBtn);
  item.append(title, result, mount, visualTuningControls, actions);
  return item;
}

createDieForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sides = Number.parseInt(new FormData(createDieForm).get('sides'), 10);
  const id = `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dieList.append(renderDieCard({ id, sides }));
});
