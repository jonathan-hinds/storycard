import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js?module';

export const PREVIEW_HOLD_DELAY_MS = 230;
export const PREVIEW_TRANSITION_IN_MS = 260;
export const PREVIEW_TRANSITION_OUT_MS = 210;
export const PREVIEW_BASE_POSITION = Object.freeze({ x: 0, y: 1.52, z: 1.08 });

function getSway(mode, elapsed) {
  if (mode === 'preview') {
    return {
      position: new THREE.Vector3(
        Math.sin(elapsed * 1.8) * 0.22,
        Math.sin(elapsed * 2.4) * 0.07,
        Math.cos(elapsed * 1.6) * 0.16,
      ),
      swayMultiplier: 1,
      swayAmount: 1,
    };
  }

  return {
    position: new THREE.Vector3(
      Math.sin(elapsed * 3.6) * 0.05,
      Math.sin(elapsed * 5.2) * 0.03,
      Math.cos(elapsed * 4.1) * 0.04,
    ),
    swayMultiplier: mode === 'preview-return' ? 0.45 : 1,
    swayAmount: 0.8,
  };
}

export function beginPreviewTransition(state, now = performance.now()) {
  state.previewStartedAt = now;
  state.previewTransition.isActive = true;
  state.previewTransition.direction = 'toPreview';
  state.previewTransition.startedAt = now;
  state.previewTransition.durationMs = PREVIEW_TRANSITION_IN_MS;
}

export function beginPreviewReturnTransition(state, now = performance.now()) {
  state.previewStartedAt = now;
  state.previewTransition.isActive = true;
  state.previewTransition.direction = 'fromPreview';
  state.previewTransition.startedAt = now;
  state.previewTransition.durationMs = PREVIEW_TRANSITION_OUT_MS;
}

export function getPreviewPose({
  time,
  mode,
  previewStartedAt,
  previewOriginPose,
  activePose,
  previewTransition,
}) {
  const elapsed = (time - previewStartedAt) * 0.001;
  const shouldTransition = previewTransition.isActive && (mode === 'preview' || mode === 'preview-return');
  const basePos = activePose.position.clone();
  const baseRot = activePose.rotation.clone();
  let transitionCompleted = false;

  if (shouldTransition) {
    const transitionElapsed = time - previewTransition.startedAt;
    const rawProgress = THREE.MathUtils.clamp(transitionElapsed / previewTransition.durationMs, 0, 1);
    const eased = THREE.MathUtils.smootherstep(rawProgress, 0, 1);
    const blend = previewTransition.direction === 'toPreview' ? eased : (1 - eased);

    basePos.lerpVectors(previewOriginPose.position, activePose.position, blend);
    baseRot.set(
      THREE.MathUtils.lerp(previewOriginPose.rotation.x, activePose.rotation.x, blend),
      THREE.MathUtils.lerp(previewOriginPose.rotation.y, activePose.rotation.y, blend),
      THREE.MathUtils.lerp(previewOriginPose.rotation.z, activePose.rotation.z, blend),
    );

    if (rawProgress >= 1) transitionCompleted = true;
  }

  const sway = getSway(mode, elapsed);
  const position = new THREE.Vector3(
    basePos.x + sway.position.x * sway.swayMultiplier,
    basePos.y + sway.position.y * sway.swayMultiplier,
    basePos.z + sway.position.z * sway.swayMultiplier,
  );

  const rotation = new THREE.Euler(
    baseRot.x + Math.sin(elapsed * 2.2) * 0.04 * sway.swayAmount,
    baseRot.y + Math.sin(elapsed * 1.5) * 0.18 * sway.swayAmount,
    baseRot.z + Math.cos(elapsed * 1.8) * 0.03 * sway.swayAmount,
  );

  return { position, rotation, transitionCompleted };
}
