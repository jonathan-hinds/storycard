const PREVIEW_TUNING_STORAGE_KEY = 'storycard.previewTuning.v2';

export const DEFAULT_PREVIEW_TUNING = Object.freeze({
  rotationX: -1.16,
  previewOffsetX: 0,
  previewOffsetY: 0,
  cameraDistanceOffset: 1.2,
  previewOffsetDesktop: Object.freeze({ x: 0, y: 0, z: 1.2 }),
  previewOffsetMobile: Object.freeze({ x: 0, y: 0, z: 1.2 }),
  ambientLightIntensity: 0.9,
  keyLightIntensity: 1.1,
  cardMaterialRoughness: 0.62,
});

const PREVIEW_TUNING_BOUNDS = Object.freeze({
  rotationX: { min: -1.2, max: -0.2 },
  previewOffsetX: { min: -2.5, max: 2.5 },
  previewOffsetY: { min: -2.5, max: 2.5 },
  previewOffsetYMobile: { min: -2.5, max: 7.5 },
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

function sanitizeVariantOffsets(input = {}, fallback = {}, yBounds = PREVIEW_TUNING_BOUNDS.previewOffsetY) {
  return {
    x: clamp(
      toNumber(input.x, fallback.x),
      PREVIEW_TUNING_BOUNDS.previewOffsetX,
    ),
    y: clamp(
      toNumber(input.y, fallback.y),
      yBounds,
    ),
    z: toNumber(input.z, fallback.z),
  };
}

export function sanitizePreviewTuning(input = {}) {
  const desktopFallback = {
    x: toNumber(input.previewOffsetX, DEFAULT_PREVIEW_TUNING.previewOffsetDesktop.x),
    y: toNumber(input.previewOffsetY, DEFAULT_PREVIEW_TUNING.previewOffsetDesktop.y),
    z: toNumber(input.cameraDistanceOffset, DEFAULT_PREVIEW_TUNING.previewOffsetDesktop.z),
  };
  const desktop = sanitizeVariantOffsets(input.previewOffsetDesktop, desktopFallback);
  const mobile = sanitizeVariantOffsets(input.previewOffsetMobile, desktop, PREVIEW_TUNING_BOUNDS.previewOffsetYMobile);

  return {
    rotationX: clamp(
      toNumber(input.rotationX, DEFAULT_PREVIEW_TUNING.rotationX),
      PREVIEW_TUNING_BOUNDS.rotationX,
    ),
    previewOffsetX: desktop.x,
    previewOffsetY: desktop.y,
    cameraDistanceOffset: desktop.z,
    previewOffsetDesktop: desktop,
    previewOffsetMobile: mobile,
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
