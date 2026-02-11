import { CardGameClient, SINGLE_CARD_TEMPLATE } from '/public/card-game/index.js';

const canvas = document.getElementById('single-card-canvas');
const statusEl = document.getElementById('single-card-status');
const resetBtn = document.getElementById('single-card-reset');
const previewRotationSlider = document.getElementById('preview-rotation-slider');
const previewRotationValue = document.getElementById('preview-rotation-value');
const previewDistanceSlider = document.getElementById('preview-distance-slider');
const previewDistanceValue = document.getElementById('preview-distance-value');

const previewPose = {
  rotationX: Number.parseFloat(previewRotationSlider?.value ?? '-0.68'),
  z: Number.parseFloat(previewDistanceSlider?.value ?? '1.08'),
};

const client = new CardGameClient({
  canvas,
  statusElement: statusEl,
  resetButton: resetBtn,
  template: SINGLE_CARD_TEMPLATE,
  options: {
    previewPose,
  },
});

const syncPreviewTuning = () => {
  if (!previewRotationSlider || !previewDistanceSlider) return;
  const rotationX = Number.parseFloat(previewRotationSlider.value);
  const z = Number.parseFloat(previewDistanceSlider.value);
  if (previewRotationValue) previewRotationValue.value = rotationX.toFixed(2);
  if (previewDistanceValue) previewDistanceValue.value = z.toFixed(2);
  client.setPreviewPoseTuning({ rotationX, z });
};

previewRotationSlider?.addEventListener('input', syncPreviewTuning);
previewDistanceSlider?.addEventListener('input', syncPreviewTuning);
syncPreviewTuning();
