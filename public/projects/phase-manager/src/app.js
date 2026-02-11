import { CardGameClient, SINGLE_CARD_TEMPLATE } from '/public/card-game/index.js';

const canvas = document.getElementById('phase-manager-canvas');
const statusEl = document.getElementById('phase-manager-status');
const resetBtn = document.getElementById('phase-manager-reset');

new CardGameClient({
  canvas,
  statusElement: statusEl,
  resetButton: resetBtn,
  template: SINGLE_CARD_TEMPLATE,
});
