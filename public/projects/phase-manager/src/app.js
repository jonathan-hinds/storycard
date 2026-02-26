import { PhaseManagerClient } from '/public/phase-manager/index.js';

function addControlRow(container, { id, label, min, max, step, valueElId }) {
  const row = document.createElement('div');
  row.className = 'phase-manager-upkeep-slider-row';
  row.innerHTML = `
    <label for="${id}-range">${label}</label>
    <output id="${valueElId}"></output>
    <input id="${id}-range" type="range" min="${min}" max="${max}" step="${step}" />
    <input id="${id}-number" type="number" min="${min}" max="${max}" step="${step}" />
  `;
  container.appendChild(row);
}

const readyControlsContainer = document.getElementById('ready-controls');
const upkeepControlsContainer = document.getElementById('upkeep-controls');

[
  { id: 'ready-x', label: 'Panel X', min: 0, max: 1, step: 0.001, valueElId: 'ready-x-value' },
  { id: 'ready-y', label: 'Panel Y', min: 0, max: 1, step: 0.001, valueElId: 'ready-y-value' },
  { id: 'ready-z', label: 'Panel Z', min: -12, max: -2, step: 0.01, valueElId: 'ready-z-value' },
  { id: 'ready-width', label: 'Panel Width', min: 0.3, max: 4, step: 0.01, valueElId: 'ready-width-value' },
  { id: 'ready-height', label: 'Panel Height', min: 0.2, max: 2, step: 0.01, valueElId: 'ready-height-value' },
  { id: 'ready-text-x', label: 'Text X', min: -1, max: 1, step: 0.01, valueElId: 'ready-text-x-value' },
  { id: 'ready-text-y', label: 'Text Y', min: -1, max: 1, step: 0.01, valueElId: 'ready-text-y-value' },
  { id: 'ready-text-size', label: 'Text Size', min: 0.2, max: 2.5, step: 0.01, valueElId: 'ready-text-size-value' },
].forEach((config) => addControlRow(readyControlsContainer, config));

[
  { id: 'upkeep-x', label: 'Panel X', min: 0, max: 1, step: 0.001, valueElId: 'upkeep-x-value' },
  { id: 'upkeep-y', label: 'Panel Y', min: 0, max: 1, step: 0.001, valueElId: 'upkeep-y-value' },
  { id: 'upkeep-z', label: 'Panel Z', min: -12, max: -2, step: 0.01, valueElId: 'upkeep-z-value' },
  { id: 'upkeep-width', label: 'Panel Width', min: 0.3, max: 4, step: 0.01, valueElId: 'upkeep-width-value' },
  { id: 'upkeep-height', label: 'Panel Height', min: 0.2, max: 2, step: 0.01, valueElId: 'upkeep-height-value' },
  { id: 'upkeep-text-x', label: 'Text X', min: -1, max: 1, step: 0.01, valueElId: 'upkeep-text-x-value' },
  { id: 'upkeep-text-y', label: 'Text Y', min: -1, max: 1, step: 0.01, valueElId: 'upkeep-text-y-value' },
  { id: 'upkeep-text-size', label: 'Text Size', min: 0.2, max: 2.5, step: 0.01, valueElId: 'upkeep-text-size-value' },
].forEach((config) => addControlRow(upkeepControlsContainer, config));

const phaseManager = new PhaseManagerClient({
  elements: {
    canvas: document.getElementById('phase-manager-canvas'),
    statusEl: document.getElementById('phase-manager-status'),
    matchmakingBtn: document.getElementById('phase-manager-matchmaking'),
    readyBtn: document.getElementById('phase-manager-ready'),
    resetBtn: document.getElementById('phase-manager-reset'),
    overlayEl: document.getElementById('phase-manager-turn-overlay'),
    matchLabelEl: document.getElementById('phase-manager-match-label'),
    playerSummaryEl: document.getElementById('phase-manager-player-summary'),
    opponentSummaryEl: document.getElementById('phase-manager-opponent-summary'),
    queueSummaryEl: document.getElementById('phase-manager-queue-summary'),
    readyBackgroundSelect: document.getElementById('ready-background-select'),
    readyXInput: document.getElementById('ready-x-range'),
    readyXNumberInput: document.getElementById('ready-x-number'),
    readyYInput: document.getElementById('ready-y-range'),
    readyYNumberInput: document.getElementById('ready-y-number'),
    readyZInput: document.getElementById('ready-z-range'),
    readyZNumberInput: document.getElementById('ready-z-number'),
    readyWidthInput: document.getElementById('ready-width-range'),
    readyWidthNumberInput: document.getElementById('ready-width-number'),
    readyHeightInput: document.getElementById('ready-height-range'),
    readyHeightNumberInput: document.getElementById('ready-height-number'),
    readyTextXInput: document.getElementById('ready-text-x-range'),
    readyTextXNumberInput: document.getElementById('ready-text-x-number'),
    readyTextYInput: document.getElementById('ready-text-y-range'),
    readyTextYNumberInput: document.getElementById('ready-text-y-number'),
    readyTextSizeInput: document.getElementById('ready-text-size-range'),
    readyTextSizeNumberInput: document.getElementById('ready-text-size-number'),
    readyXValueEl: document.getElementById('ready-x-value'),
    readyYValueEl: document.getElementById('ready-y-value'),
    readyZValueEl: document.getElementById('ready-z-value'),
    readyWidthValueEl: document.getElementById('ready-width-value'),
    readyHeightValueEl: document.getElementById('ready-height-value'),
    readyTextXValueEl: document.getElementById('ready-text-x-value'),
    readyTextYValueEl: document.getElementById('ready-text-y-value'),
    readyTextSizeValueEl: document.getElementById('ready-text-size-value'),
    upkeepBackgroundSelect: document.getElementById('upkeep-background-select'),
    upkeepXInput: document.getElementById('upkeep-x-range'),
    upkeepXNumberInput: document.getElementById('upkeep-x-number'),
    upkeepYInput: document.getElementById('upkeep-y-range'),
    upkeepYNumberInput: document.getElementById('upkeep-y-number'),
    upkeepZInput: document.getElementById('upkeep-z-range'),
    upkeepZNumberInput: document.getElementById('upkeep-z-number'),
    upkeepWidthInput: document.getElementById('upkeep-width-range'),
    upkeepWidthNumberInput: document.getElementById('upkeep-width-number'),
    upkeepHeightInput: document.getElementById('upkeep-height-range'),
    upkeepHeightNumberInput: document.getElementById('upkeep-height-number'),
    upkeepTextXInput: document.getElementById('upkeep-text-x-range'),
    upkeepTextXNumberInput: document.getElementById('upkeep-text-x-number'),
    upkeepTextYInput: document.getElementById('upkeep-text-y-range'),
    upkeepTextYNumberInput: document.getElementById('upkeep-text-y-number'),
    upkeepTextSizeInput: document.getElementById('upkeep-text-size-range'),
    upkeepTextSizeNumberInput: document.getElementById('upkeep-text-size-number'),
    upkeepXValueEl: document.getElementById('upkeep-x-value'),
    upkeepYValueEl: document.getElementById('upkeep-y-value'),
    upkeepZValueEl: document.getElementById('upkeep-z-value'),
    upkeepWidthValueEl: document.getElementById('upkeep-width-value'),
    upkeepHeightValueEl: document.getElementById('upkeep-height-value'),
    upkeepTextXValueEl: document.getElementById('upkeep-text-x-value'),
    upkeepTextYValueEl: document.getElementById('upkeep-text-y-value'),
    upkeepTextSizeValueEl: document.getElementById('upkeep-text-size-value'),
    layoutExportBtn: document.getElementById('phase-manager-export-layout'),
    layoutExportOutputEl: document.getElementById('phase-manager-export-layout-output'),
  },
});

phaseManager.start();
