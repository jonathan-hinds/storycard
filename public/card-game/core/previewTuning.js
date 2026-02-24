const PREVIEW_TUNING_STORAGE_KEY = 'storycard.previewTuning.v2';

export const DEFAULT_PREVIEW_TUNING = Object.freeze({
  rotationX: -1.16,
  previewOffsetX: 0,
  previewOffsetY: 0,
  cameraDistanceOffset: 1.2,
  ambientLightIntensity: 0.9,
  keyLightIntensity: 1.1,
  cardMaterialRoughness: 0.62,
});

const PREVIEW_TUNING_BOUNDS = Object.freeze({
  rotationX: { min: -1.2, max: -0.2 },
  previewOffsetX: { min: -2.5, max: 2.5 },
  previewOffsetY: { min: -2.5, max: 2.5 },
  ambientLightIntensity: { min: 0, max: 3 },
  keyLightIntensity: { min: 0, max: 4 },
  cardMaterialRoughness: { min: 0, max: 1 },
});

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, bounds) {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function sanitizePreviewTuning(input = {}) {
  return {
    rotationX: clamp(
      toNumber(input.rotationX, DEFAULT_PREVIEW_TUNING.rotationX),
      PREVIEW_TUNING_BOUNDS.rotationX,
    ),
    previewOffsetX: clamp(
      toNumber(input.previewOffsetX, DEFAULT_PREVIEW_TUNING.previewOffsetX),
      PREVIEW_TUNING_BOUNDS.previewOffsetX,
    ),
    previewOffsetY: clamp(
      toNumber(input.previewOffsetY, DEFAULT_PREVIEW_TUNING.previewOffsetY),
      PREVIEW_TUNING_BOUNDS.previewOffsetY,
    ),
    cameraDistanceOffset: toNumber(input.cameraDistanceOffset, DEFAULT_PREVIEW_TUNING.cameraDistanceOffset),
    ambientLightIntensity: clamp(
      toNumber(input.ambientLightIntensity, DEFAULT_PREVIEW_TUNING.ambientLightIntensity),
      PREVIEW_TUNING_BOUNDS.ambientLightIntensity,
    ),
    keyLightIntensity: clamp(
      toNumber(input.keyLightIntensity, DEFAULT_PREVIEW_TUNING.keyLightIntensity),
      PREVIEW_TUNING_BOUNDS.keyLightIntensity,
    ),
    cardMaterialRoughness: clamp(
      toNumber(input.cardMaterialRoughness, DEFAULT_PREVIEW_TUNING.cardMaterialRoughness),
      PREVIEW_TUNING_BOUNDS.cardMaterialRoughness,
    ),
  };
}

export function loadPreviewTuning() {
  try {
    const raw = window.localStorage.getItem(PREVIEW_TUNING_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREVIEW_TUNING };
    const parsed = JSON.parse(raw);
    return sanitizePreviewTuning(parsed);
  } catch {
    return { ...DEFAULT_PREVIEW_TUNING };
  }
}

export function savePreviewTuning(tuning) {
  const sanitized = sanitizePreviewTuning(tuning);
  try {
    window.localStorage.setItem(PREVIEW_TUNING_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // no-op if localStorage is unavailable
  }
  return sanitized;
}

export function getPreviewTuningBounds() {
  return PREVIEW_TUNING_BOUNDS;
}
