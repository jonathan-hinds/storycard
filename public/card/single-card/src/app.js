import {
  CardGameClient,
  SINGLE_CARD_TEMPLATE,
  loadPreviewTuning,
  savePreviewTuning,
  DEFAULT_PREVIEW_TUNING,
  getPreviewTuningBounds,
} from '/public/card-game/index.js';

const canvas = document.getElementById('single-card-canvas');
const statusEl = document.getElementById('single-card-status');
const resetBtn = document.getElementById('single-card-reset');
const previewRotationSlider = document.getElementById('single-card-preview-rotation');
const previewDistanceSlider = document.getElementById('single-card-preview-distance');
const previewRotationValueEl = document.getElementById('single-card-preview-rotation-value');
const previewDistanceValueEl = document.getElementById('single-card-preview-distance-value');
const previewResetBtn = document.getElementById('single-card-preview-reset');

const previewBounds = getPreviewTuningBounds();
let previewTuning = loadPreviewTuning();
let client = null;

function renderPreviewTuningLabels() {
  previewRotationValueEl.textContent = `Rotation: ${previewTuning.rotationX.toFixed(2)} rad`;
  previewDistanceValueEl.textContent = `Distance offset: ${previewTuning.cameraDistanceOffset.toFixed(2)}`;
}

function syncPreviewTuningControls() {
  previewRotationSlider.min = String(previewBounds.rotationX.min);
  previewRotationSlider.max = String(previewBounds.rotationX.max);
  previewRotationSlider.value = String(previewTuning.rotationX);

  previewDistanceSlider.min = String(previewBounds.cameraDistanceOffset.min);
  previewDistanceSlider.max = String(previewBounds.cameraDistanceOffset.max);
  previewDistanceSlider.value = String(previewTuning.cameraDistanceOffset);

  renderPreviewTuningLabels();
}

function updatePreviewTuning(partial) {
  previewTuning = savePreviewTuning({ ...previewTuning, ...partial });
  syncPreviewTuningControls();
  client?.setPreviewTuning(previewTuning);
  statusEl.textContent = 'Preview tuning updated. Press + hold any card to test it.';
}

previewRotationSlider?.addEventListener('input', (event) => {
  updatePreviewTuning({ rotationX: Number(event.target.value) });
});

previewDistanceSlider?.addEventListener('input', (event) => {
  updatePreviewTuning({ cameraDistanceOffset: Number(event.target.value) });
});

previewResetBtn?.addEventListener('click', () => {
  previewTuning = savePreviewTuning(DEFAULT_PREVIEW_TUNING);
  syncPreviewTuningControls();
  client?.setPreviewTuning(previewTuning);
  statusEl.textContent = 'Preview tuning reset to defaults.';
});

syncPreviewTuningControls();

client = new CardGameClient({
  canvas,
  statusElement: statusEl,
  resetButton: resetBtn,
  template: SINGLE_CARD_TEMPLATE,
  options: {
    previewTuning,
  },
});
