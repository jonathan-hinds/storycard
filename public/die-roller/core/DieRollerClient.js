import {
  createSceneForCanvas,
  applyFrameToMesh,
  downloadDieSkinTemplate,
  getCurrentRollValue,
  resizeRendererToDisplaySize,
  syncCameraToDie,
} from '../render/legacyRenderer.js';
import { DieRollerHttpClient } from '../net/httpClient.js';

export class DieRollerClient {
  constructor({ container, assets, options = {} }) {
    if (!container) throw new Error('container is required');
    this.container = container;
    this.options = options;
    this.assets = assets;
    this.handlers = {
      onResult: options.onResult,
      onStart: options.onStart,
      onSettled: options.onSettled,
      onError: options.onError,
    };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'die-canvas';
    this.container.append(this.canvas);
    this.net = new DieRollerHttpClient(options.net || {});
    this.visual = null;
    this.animationFrame = null;
    this.rollQueue = [];
    this.currentRoll = null;
  }


  ensureVisual(sides = 6) {
    if (this.visual && this.visualSides === sides) return;
    if (this.visual?.renderer) this.visual.renderer.dispose();
    this.visual = createSceneForCanvas(this.canvas, sides);
    this.visualSides = sides;
  }

  renderStaticPreview(sides = 6) {
    this.ensureVisual(sides);
    if (!this.visual) return;
    resizeRendererToDisplaySize(this.visual);
    syncCameraToDie(this.visual);
    this.visual.renderer.render(this.visual.scene, this.visual.camera);
  }

  async roll({ dice, seed, throwProfile } = {}) {
    try {
      this.handlers.onStart?.({ dice, seed, throwProfile });
      const requests = (dice || []).map((die, index) => ({ ...die, id: die.id || `die-${index}` }));
      const results = [];
      for (const die of requests) {
        const roll = await this.net.roll({ id: die.id, sides: die.sides, throwProfile });
        results.push({ id: die.id, sides: die.sides, roll });
      }

      const first = results[0];
      if (first) {
        this.ensureVisual(first.sides);
        this.currentRoll = first.roll;
        this.rollQueue = [...first.roll.frames];
        this.#ensureLoop();
      }

      const payload = {
        results: results.map((entry) => ({ id: entry.id, sides: entry.sides, outcome: entry.roll.outcome, roll: entry.roll })),
      };
      this.handlers.onResult?.(payload);
      return payload;
    } catch (error) {
      this.handlers.onError?.(error);
      throw error;
    }
  }


  playRoll({ roll, sides } = {}) {
    if (!roll || !Array.isArray(roll.frames)) return;
    const resolvedSides = Number.isFinite(sides) ? sides : roll?.sides || 6;
    this.ensureVisual(resolvedSides);
    this.currentRoll = roll;
    this.rollQueue = [...roll.frames];
    this.#ensureLoop();
  }

  #ensureLoop() {
    if (this.animationFrame) return;
    const tick = () => {
      if (this.visual) {
        const frame = this.rollQueue.shift();
        if (frame) {
          applyFrameToMesh(this.visual.mesh, frame);
        } else if (this.currentRoll) {
          const value = getCurrentRollValue(this.visual.mesh, this.visual.faceValueMap);
          this.handlers.onSettled?.({ value, roll: this.currentRoll });
          this.currentRoll = null;
        }
        resizeRendererToDisplaySize(this.visual);
        syncCameraToDie(this.visual);
        this.visual.renderer.render(this.visual.scene, this.visual.camera);
      }
      if (this.currentRoll || this.rollQueue.length > 0) {
        this.animationFrame = requestAnimationFrame(tick);
      } else {
        this.animationFrame = null;
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  destroy() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    if (this.visual?.renderer) this.visual.renderer.dispose();
    this.visual = null;
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }

  downloadTemplateSkin(sides) {
    downloadDieSkinTemplate(sides);
  }
}
