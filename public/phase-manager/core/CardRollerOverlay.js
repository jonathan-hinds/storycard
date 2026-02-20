import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { DieRollerClient } from '/public/die-roller/index.js';

const DEFAULT_PANEL_SIZE_PX = 98;
const DEFAULT_ROLL_DELAY_MS = 260;
const ORTHO_OFFSET_Y = 0.62;
const COMMIT_ROLL_TYPES = ['damage', 'speed', 'defense'];
const MIN_PANEL_SIZE_PX = 46;
const COLUMN_GAP_PX = 6;

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
    const maxColumnHeight = this.host.clientWidth <= 760
      ? this.host.clientHeight * 0.32
      : this.host.clientHeight * 0.24;
    const panelSize = Math.max(
      MIN_PANEL_SIZE_PX,
      Math.min(
        DEFAULT_PANEL_SIZE_PX,
        this.host.clientWidth * 0.125,
        (maxColumnHeight - (COLUMN_GAP_PX * (COMMIT_ROLL_TYPES.length - 1))) / COMMIT_ROLL_TYPES.length,
      ),
    );
    const columnHeight = (panelSize * COMMIT_ROLL_TYPES.length) + (COLUMN_GAP_PX * (COMMIT_ROLL_TYPES.length - 1));

    entry.column.style.width = `${panelSize}px`;
    entry.column.style.height = `${columnHeight}px`;
    entry.column.style.transform = `translate(${x - panelSize / 2}px, ${y - columnHeight / 2}px)`;

    for (const panel of entry.panels) {
      panel.style.width = `${panelSize}px`;
      panel.style.height = `${panelSize}px`;
    }
  }

  updatePositions = () => {
    if (!this.activeRollers.length) {
      this.positionTick = 0;
      return;
    }
    this.activeRollers.forEach((entry) => this.positionRollerEntry(entry));
    this.positionTick = requestAnimationFrame(this.updatePositions);
  };

  async rollForAttacks(attackPlan = [], {
    rollTypes = COMMIT_ROLL_TYPES,
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

      const resolvedRollTypes = Array.isArray(rollTypes) && rollTypes.length ? rollTypes : COMMIT_ROLL_TYPES;
      const column = document.createElement('div');
      column.className = 'card-roller-overlay-column';
      this.layer.append(column);

      const diceEntries = resolvedRollTypes.map((rollType) => {
        const { sides, statValue } = this.getRollTypeForCard(card, rollType);
        const panel = document.createElement('button');
        panel.type = 'button';
        panel.className = 'card-roller-overlay-panel';
        panel.dataset.rollType = rollType;
        panel.ariaLabel = `${rollType} d${sides}`;
        column.append(panel);

        const roller = new DieRollerClient({
          container: panel,
          assets: {},
        });
        roller.renderStaticPreview(sides);

        const settled = createDeferred();
        roller.handlers.onSettled = ({ value }) => settled.resolve(value ?? null);
        roller.handlers.onError = (error) => settled.reject(error);

        return {
          panel,
          roller,
          settled,
          rollType,
          sides,
          statValue,
        };
      });

      const entry = {
        column,
        panels: diceEntries.map((die) => die.panel),
        diceEntries,
        globalSlotIndex,
        hasRolled: false,
      };
      this.activeRollers.push(entry);
      this.positionRollerEntry(entry);

      const controlsAttack = canControlAttack(step);
      if (controlsAttack) {
        for (const die of diceEntries) {
          die.panel.title = `Click to roll ${die.rollType}`;
          die.panel.dataset.state = 'pending';
        }
        const triggerRoll = async (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          if (entry.hasRolled) return;
          entry.hasRolled = true;
          for (const die of diceEntries) die.panel.dataset.state = 'rolling';
          try {
            for (const die of diceEntries) {
              const payload = await die.roller.roll({
                dice: [{ id: `${card.userData.cardId}-${die.rollType}`, sides: die.sides }],
              });
              const rolled = payload?.results?.[0]?.roll;
              if (rolled && typeof onAttackRoll === 'function') {
                await onAttackRoll({
                  attack: step,
                  rollType: die.rollType,
                  sides: die.sides,
                  roll: rolled,
                });
              }
            }
          } catch (error) {
            for (const die of diceEntries) die.settled.reject(error);
          }
        };

        const addRollTriggerListeners = (target) => {
          if (!target) return;
          target.addEventListener('pointerdown', triggerRoll);
          target.addEventListener('click', triggerRoll);
          target.addEventListener('touchstart', triggerRoll, { passive: false });
        };

        for (const die of diceEntries) {
          addRollTriggerListeners(die.panel);
          addRollTriggerListeners(die.roller.canvas);
        }
      } else {
        for (const die of diceEntries) {
          die.panel.title = `Waiting for attacker ${die.rollType} roll`;
          die.panel.dataset.state = 'waiting';
          pendingRolls.push((async () => {
            const remoteRoll = typeof waitForRemoteRoll === 'function'
              ? await waitForRemoteRoll(step, die.rollType)
              : null;
            if (!remoteRoll) {
              die.settled.resolve(null);
              return null;
            }
            die.panel.dataset.state = 'rolling';
            die.roller.playRoll({ roll: remoteRoll.roll, sides: remoteRoll.sides || die.sides });
            return die.settled.promise;
          })().then((outcome) => ({
            cardId: card.userData.cardId,
            attackId: step.id,
            rollType: die.rollType,
            statValue: die.statValue,
            sides: die.sides,
            outcome,
          })));
        }
        continue;
      }

      for (const die of diceEntries) {
        pendingRolls.push(die.settled.promise.then((outcome) => {
          die.panel.dataset.state = 'settled';
          return {
            cardId: card.userData.cardId,
            attackId: step.id,
            rollType: die.rollType,
            statValue: die.statValue,
            sides: die.sides,
            outcome,
          };
        }));
      }
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
    this.activeRollers.forEach((entry) => {
      entry.diceEntries.forEach((die) => die.roller.destroy());
    });
    this.activeRollers = [];
    this.layer.replaceChildren();
  }

  destroy() {
    this.clear();
    if (this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
  }
}
