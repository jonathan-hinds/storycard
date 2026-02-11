import { CARD_ZONE_TYPES } from './zoneFramework.js';

export function createDeckToHandDealHook({
  owner = null,
  durationMs = 900,
  staggerMs = 90,
  arcHeight = 0.85,
  swirlAmplitude = 0.12,
  shouldAnimate = () => true,
} = {}) {
  return (card, context = {}) => {
    if (!shouldAnimate(context)) return null;
    if (card.userData.zone !== CARD_ZONE_TYPES.HAND) return null;
    if (owner && card.userData.owner !== owner) return null;

    const deckSlot = context.deckSlots?.find((slot) => slot.side === card.userData.owner);
    if (!deckSlot) return null;

    const dealOrder = Number.isFinite(card.userData.dealOrder) ? card.userData.dealOrder : 0;

    return {
      fromPosition: { x: deckSlot.x, y: 0.2, z: deckSlot.z },
      fromRotation: { x: -Math.PI / 2, y: 0, z: 0 },
      durationMs,
      delayMs: Math.max(0, dealOrder * staggerMs),
      arcHeight,
      swirlAmplitude,
    };
  };
}
