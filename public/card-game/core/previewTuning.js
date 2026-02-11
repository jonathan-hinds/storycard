const PREVIEW_TUNING_STORAGE_KEY = 'storycard.previewTuning.v2';

export const DEFAULT_PREVIEW_TUNING = Object.freeze({
  rotationX: -1.16,
  cameraDistanceOffset: 1.2,
});

const PREVIEW_TUNING_BOUNDS = Object.freeze({
  rotationX: { min: -1.2, max: -0.2 },
  cameraDistanceOffset: { min: -1.2, max: 1.2 },
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
    cameraDistanceOffset: clamp(
      toNumber(input.cameraDistanceOffset, DEFAULT_PREVIEW_TUNING.cameraDistanceOffset),
      PREVIEW_TUNING_BOUNDS.cameraDistanceOffset,
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
