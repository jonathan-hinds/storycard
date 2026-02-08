import { initDiceModule } from '/public/dice-module.js';

const dieList = document.getElementById('die-list');
const createDieForm = document.getElementById('create-die-form');
const debugPhysicsToggle = document.getElementById('debug-physics');

const debugSliderConfig = [
  {
    key: 'throwHeight', inputId: 'throw-height', outputId: 'throw-height-value', defaultValue: 2.5,
    formatValue: (value) => `${((1.7 + 0.6) * value).toFixed(2)} m/s avg`,
  },
  {
    key: 'throwForward', inputId: 'throw-forward', outputId: 'throw-forward-value', defaultValue: 0,
    formatValue: (value) => `±${(5.1 * value).toFixed(2)} m/s`,
  },
  {
    key: 'throwRotation', inputId: 'throw-rotation', outputId: 'throw-rotation-value', defaultValue: 3.9,
    formatValue: (value) => `±${(7.8 * value).toFixed(2)} rad/s`,
  },
  {
    key: 'dieWeight', inputId: 'die-weight', outputId: 'die-weight-value', defaultValue: 3,
    formatValue: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: 'rotationFriction', inputId: 'rotation-friction', outputId: 'rotation-friction-value', defaultValue: 0.2,
    formatValue: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: 'groundSlipperiness', inputId: 'ground-slipperiness', outputId: 'ground-slipperiness-value', defaultValue: 0,
    formatValue: (value) => `μ ${value.toFixed(2)}`,
  },
  {
    key: 'dieSlipperiness', inputId: 'die-slipperiness', outputId: 'die-slipperiness-value', defaultValue: 1,
    formatValue: (value) => `μ ${value.toFixed(2)}`,
  },
];

const debugTuning = Object.fromEntries(debugSliderConfig.map((cfg) => [cfg.key, cfg.defaultValue]));

function updateDebugTuningValue(config) {
  const input = document.getElementById(config.inputId);
  const output = document.getElementById(config.outputId);
  if (!input || !output) return;
  const value = Number.parseFloat(input.value);
  const safeValue = Number.isFinite(value) ? value : config.defaultValue;
  debugTuning[config.key] = safeValue;
  output.textContent = config.formatValue(safeValue);
}

for (const config of debugSliderConfig) {
  const input = document.getElementById(config.inputId);
  if (!input) continue;
  input.addEventListener('input', () => updateDebugTuningValue(config));
  updateDebugTuningValue(config);
}

const diceModule = initDiceModule({
  dieList,
  debugPhysicsToggle,
  includeTemplateDownload: true,
  rollPayloadFactory: () => ({ tuning: { ...debugTuning } }),
});

createDieForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sides = Number.parseInt(new FormData(createDieForm).get('sides'), 10);
  try {
    await diceModule.createDie(sides);
    await diceModule.refreshDice();
  } catch (error) {
    alert(error.message);
  }
});

diceModule.refreshDice();
