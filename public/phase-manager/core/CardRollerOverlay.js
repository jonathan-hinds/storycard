import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { DieRollerClient } from '/public/die-roller/index.js';

const DEFAULT_PANEL_SIZE_PX = 98;
const DEFAULT_ROLL_DELAY_MS = 260;
const DEFAULT_POST_SETTLE_DELAY_MS = 2000;
const DEFAULT_POST_UPDATE_DELAY_MS = 2000;
const ORTHO_OFFSET_Y = 0.62;

const ROLL_TYPE_TO_STAT_KEY = Object.freeze({
  damage: 'damage',
  speed: 'speed',
  defense: 'defense',
});

const DEFAULT_ROLL_SEQUENCE = Object.freeze(['damage', 'speed', 'defense']);

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
  constructor({
    host,
    cardGameClient,
    rollDelayMs = DEFAULT_ROLL_DELAY_MS,
    postSettleDelayMs = DEFAULT_POST_SETTLE_DELAY_MS,
    postUpdateDelayMs = DEFAULT_POST_UPDATE_DELAY_MS,
  } = {}) {
    if (!host) throw new Error('host is required');
    if (!cardGameClient) throw new Error('cardGameClient is required');
    this.host = host;
    this.cardGameClient = cardGameClient;
    this.rollDelayMs = rollDelayMs;
    this.postSettleDelayMs = postSettleDelayMs;
    this.postUpdateDelayMs = postUpdateDelayMs;
    this.activeRollers = [];
    this.positionTick = 0;

    this.layer = document.createElement('div');
    this.layer.className = 'card-roller-overlay-layer';
    this.host.append(this.layer);
  }

  async pause(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise((resolve) => window.setTimeout(resolve, ms));
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

  getResolvedRollSequence(rollSequence) {
    if (!Array.isArray(rollSequence) || !rollSequence.length) return DEFAULT_ROLL_SEQUENCE;
    return rollSequence;
  }

  createRollerForEntry(entry) {
    if (!entry?.panel) return null;
    if (entry.roller) return entry.roller;

    const roller = new DieRollerClient({ container: entry.panel, assets: {} });
    entry.roller = roller;
    return roller;
  }

  destroyRollerForEntry(entry) {
    if (!entry?.roller) return;
    entry.roller.destroy();
    entry.roller = null;
  }

  applyOutcomeToCard(cardId, rollType, outcome) {
    const statKey = ROLL_TYPE_TO_STAT_KEY[rollType] || rollType;
    if (typeof outcome === 'number') {
      this.cardGameClient?.setCardStatDisplayOverride(cardId, statKey, outcome);
    }
  }

  async rollLocalSequence({ card, attackStep, rollSequence, roller, onAttackRoll }) {
    const outcomes = [];
    for (const rollType of rollSequence) {
      const settled = createDeferred();
      roller.handlers.onSettled = ({ value }) => settled.resolve(value ?? null);
      roller.handlers.onError = (error) => settled.reject(error);

      const { sides, statValue } = this.getRollTypeForCard(card, rollType);
      const payload = await roller.roll({
        dice: [{ id: `${card.userData.cardId}-${rollType}`, sides }],
      });
      const rolled = payload?.results?.[0]?.roll;
      const settledValue = await settled.promise;
      const normalizedOutcome = Number.isFinite(settledValue)
        ? settledValue
        : (Number.isFinite(rolled?.outcome) ? rolled.outcome : null);

      if (rolled && typeof onAttackRoll === 'function') {
        const normalizedRoll = Number.isFinite(normalizedOutcome)
          ? { ...rolled, outcome: normalizedOutcome }
          : rolled;
        await onAttackRoll({
          attack: attackStep,
          rollType,
          sides,
          roll: normalizedRoll,
        });
      }

      await this.pause(this.postSettleDelayMs);
      this.applyOutcomeToCard(card.userData.cardId, rollType, normalizedOutcome);
      await this.pause(this.postUpdateDelayMs);
      outcomes.push({
        cardId: card.userData.cardId,
        attackId: attackStep.id,
        rollType,
        statValue,
        sides,
        outcome: normalizedOutcome,
      });
    }
    return outcomes;
  }

  async rollRemoteSequence({ card, attackStep, rollSequence, roller, waitForRemoteRoll }) {
    const outcomes = [];
    for (const rollType of rollSequence) {
      const settled = createDeferred();
      roller.handlers.onSettled = ({ value }) => settled.resolve(value ?? null);
      roller.handlers.onError = (error) => settled.reject(error);

      const { sides, statValue } = this.getRollTypeForCard(card, rollType);
      const remoteRoll = typeof waitForRemoteRoll === 'function'
        ? await waitForRemoteRoll(attackStep, rollType)
        : null;
      if (!remoteRoll) return outcomes;

      roller.playRoll({ roll: remoteRoll.roll, sides: remoteRoll.sides || sides });
      await settled.promise;
      const authoritativeOutcome = Number.isFinite(remoteRoll?.roll?.outcome) ? remoteRoll.roll.outcome : null;
      await this.pause(this.postSettleDelayMs);
      this.applyOutcomeToCard(card.userData.cardId, rollType, authoritativeOutcome);
      await this.pause(this.postUpdateDelayMs);
      outcomes.push({
        cardId: card.userData.cardId,
        attackId: attackStep.id,
        rollType,
        statValue,
        sides,
        outcome: authoritativeOutcome,
      });
    }
    return outcomes;
  }

  async rollForAttacks(attackPlan = [], {
    rollSequence = DEFAULT_ROLL_SEQUENCE,
    canControlAttack = () => false,
    onAttackRoll = null,
    waitForRemoteRoll = null,
  } = {}) {
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

      const attackRollSequence = this.getResolvedRollSequence(rollSequence);
      const panel = document.createElement('div');
      panel.className = 'card-roller-overlay-panel';
      this.layer.append(panel);

      const entry = {
        panel,
        roller: null,
        globalSlotIndex,
        hasRolled: false,
        removeListeners: null,
      };
      this.activeRollers.push(entry);
      this.positionRollerEntry(entry);

      const controlsAttack = canControlAttack(step);
      if (controlsAttack) {
        panel.title = 'Click to roll';
        panel.dataset.state = 'pending';

        const triggerRoll = async (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          if (entry.hasRolled) return;
          entry.hasRolled = true;
          panel.dataset.state = 'rolling';

          try {
            const roller = this.createRollerForEntry(entry);
            const outcomes = await this.rollLocalSequence({
              card,
              attackStep: step,
              rollSequence: attackRollSequence,
              roller,
              onAttackRoll,
            });
            this.destroyRollerForEntry(entry);
            panel.dataset.state = 'settled';
            return outcomes;
          } catch (error) {
            this.destroyRollerForEntry(entry);
            throw error;
          }
        };

        const triggerPromise = new Promise((resolve, reject) => {
          const removeRollTriggerListeners = (target, handler) => {
            if (!target || !handler) return;
            target.removeEventListener('pointerdown', handler);
            target.removeEventListener('click', handler);
            target.removeEventListener('touchstart', handler);
          };

          const wrappedTrigger = async (event) => {
            try {
              const outcomes = await triggerRoll(event);
              if (Array.isArray(outcomes)) {
                entry.removeListeners?.();
                resolve(outcomes);
              }
            } catch (error) {
              entry.removeListeners?.();
              reject(error);
            }
          };

          entry.removeListeners = () => {
            removeRollTriggerListeners(panel, wrappedTrigger);
            entry.removeListeners = null;
          };

          const addRollTriggerListeners = (target) => {
            if (!target) return;
            target.addEventListener('pointerdown', wrappedTrigger);
            target.addEventListener('click', wrappedTrigger);
            target.addEventListener('touchstart', wrappedTrigger, { passive: false });
          };

          addRollTriggerListeners(panel);
        });

        pendingRolls.push(triggerPromise);
      } else {
        panel.title = 'Waiting for attacker roll';
        panel.dataset.state = 'waiting';

        pendingRolls.push((async () => {
          panel.dataset.state = 'rolling';
          const roller = this.createRollerForEntry(entry);
          const outcomes = await this.rollRemoteSequence({
            card,
            attackStep: step,
            rollSequence: attackRollSequence,
            roller,
            waitForRemoteRoll,
          });
          this.destroyRollerForEntry(entry);
          panel.dataset.state = 'settled';
          return outcomes;
        })());
      }
    }

    if (!pendingRolls.length) {
      this.clear();
      return [];
    }

    if (!this.positionTick) {
      this.positionTick = requestAnimationFrame(this.updatePositions);
    }

    const rollEntries = await Promise.all(pendingRolls);
    const rolls = rollEntries.flat();
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
    this.activeRollers.forEach((entry) => {
      entry.removeListeners?.();
      this.destroyRollerForEntry(entry);
    });
    this.activeRollers = [];
    this.layer.replaceChildren();
  }

  destroy() {
    this.clear();
    if (this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
  }
}
