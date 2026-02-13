import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { DieRollerClient } from '/public/die-roller/index.js';

const DEFAULT_PANEL_SIZE_PX = 98;
const DEFAULT_ROLL_DELAY_MS = 260;
const ORTHO_OFFSET_Y = 0.62;

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function parseSidesFromStat(value, fallbackSides = 6) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 2) {
    return Math.max(2, Math.floor(value));
  }

  if (typeof value !== 'string') return fallbackSides;
  const match = value.trim().match(/d\s*(\d+)/i);
  if (!match) return fallbackSides;

  const sides = Number.parseInt(match[1], 10);
  if (!Number.isFinite(sides) || sides < 2) return fallbackSides;
  return sides;
}

export class CardRollerOverlay {
  constructor({ host, cardGameClient, rollDelayMs = DEFAULT_ROLL_DELAY_MS } = {}) {
    if (!host) throw new Error('host is required');
    if (!cardGameClient) throw new Error('cardGameClient is required');
    this.host = host;
    this.cardGameClient = cardGameClient;
    this.rollDelayMs = rollDelayMs;
    this.activeRollers = [];
    this.positionTick = 0;

    this.layer = document.createElement('div');
    this.layer.className = 'card-roller-overlay-layer';
    this.host.append(this.layer);
  }

  getRollTypeForCard(card, rollType = 'damage') {
    const catalogCard = card?.userData?.catalogCard;
    const statValue = catalogCard?.[rollType];
    const sides = parseSidesFromStat(statValue, 6);
    return { sides, statValue };
  }

  getCardForBoardSlot(slotIndex) {
    if (!Number.isInteger(slotIndex)) return null;
    const slot = this.cardGameClient.boardSlots?.[slotIndex];
    return slot?.card || null;
  }

  projectWorldToHost(worldPosition) {
    const camera = this.cardGameClient.camera;
    const renderer = this.cardGameClient.renderer;
    if (!camera || !renderer) return { x: 0, y: 0 };

    const projected = worldPosition.clone().project(camera);
    const size = renderer.getSize(new THREE.Vector2());
    const x = (projected.x * 0.5 + 0.5) * size.x;
    const y = (-projected.y * 0.5 + 0.5) * size.y;
    return { x, y };
  }

  positionRollerEntry(entry) {
    const slot = this.cardGameClient.boardSlots?.[entry.globalSlotIndex];
    if (!slot) return;

    const worldTarget = new THREE.Vector3(slot.x, ORTHO_OFFSET_Y, slot.z);
    const { x, y } = this.projectWorldToHost(worldTarget);
    const panelSize = Math.max(72, Math.min(DEFAULT_PANEL_SIZE_PX, this.host.clientWidth * 0.14));

    entry.panel.style.width = `${panelSize}px`;
    entry.panel.style.height = `${panelSize}px`;
    entry.panel.style.transform = `translate(${x - panelSize / 2}px, ${y - panelSize / 2}px)`;
  }

  updatePositions = () => {
    if (!this.activeRollers.length) {
      this.positionTick = 0;
      return;
    }
    this.activeRollers.forEach((entry) => this.positionRollerEntry(entry));
    this.positionTick = requestAnimationFrame(this.updatePositions);
  };

  async rollForAttacks(attackPlan = [], { rollType = 'damage' } = {}) {
    if (!Array.isArray(attackPlan) || !attackPlan.length) return [];

    const boardSlotsPerSide = Math.floor((this.cardGameClient.boardSlots?.length || 0) / 2);
    const pendingRolls = [];
    this.layer.dataset.active = 'true';

    for (const step of attackPlan) {
      const attackerSide = step?.attackerSide === 'opponent' ? 'opponent' : 'player';
      const globalSlotIndex = attackerSide === 'opponent'
        ? step.attackerSlotIndex
        : boardSlotsPerSide + step.attackerSlotIndex;
      const card = this.getCardForBoardSlot(globalSlotIndex);
      if (!card) continue;

      const { sides, statValue } = this.getRollTypeForCard(card, rollType);
      const panel = document.createElement('div');
      panel.className = 'card-roller-overlay-panel';
      this.layer.append(panel);

      const roller = new DieRollerClient({
        container: panel,
        assets: {},
      });
      roller.renderStaticPreview(sides);

      const settled = createDeferred();
      roller.handlers.onSettled = ({ value }) => settled.resolve(value ?? null);
      roller.handlers.onError = (error) => settled.reject(error);

      const entry = {
        panel,
        roller,
        globalSlotIndex,
        hasRolled: false,
      };
      this.activeRollers.push(entry);
      this.positionRollerEntry(entry);

      panel.title = 'Click to roll';
      panel.dataset.state = 'pending';
      const triggerRoll = async (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (entry.hasRolled) return;
        entry.hasRolled = true;
        panel.dataset.state = 'rolling';
        try {
          await roller.roll({
            dice: [{ id: `${card.userData.cardId}-${rollType}`, sides }],
          });
        } catch (error) {
          settled.reject(error);
        }
      };

      const addRollTriggerListeners = (target) => {
        if (!target) return;
        target.addEventListener('pointerdown', triggerRoll);
        target.addEventListener('click', triggerRoll);
        target.addEventListener('touchstart', triggerRoll, { passive: false });
      };

      addRollTriggerListeners(panel);
      addRollTriggerListeners(roller.canvas);

      pendingRolls.push(settled.promise.then((outcome) => {
        panel.dataset.state = 'settled';
        return {
          cardId: card.userData.cardId,
          rollType,
          statValue,
          sides,
          outcome,
        };
      }));
    }

    if (!pendingRolls.length) {
      this.clear();
      return [];
    }

    if (!this.positionTick) {
      this.positionTick = requestAnimationFrame(this.updatePositions);
    }

    const rolls = await Promise.all(pendingRolls);
    await new Promise((resolve) => window.setTimeout(resolve, this.rollDelayMs));
    this.clear();
    return rolls;
  }

  clear() {
    this.layer.removeAttribute('data-active');
    if (this.positionTick) {
      cancelAnimationFrame(this.positionTick);
      this.positionTick = 0;
    }
    this.activeRollers.forEach((entry) => entry.roller.destroy());
    this.activeRollers = [];
    this.layer.replaceChildren();
  }

  destroy() {
    this.clear();
    if (this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
  }
}
