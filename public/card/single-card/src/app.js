import { CardGameClient, SINGLE_CARD_TEMPLATE } from '/public/card-game/index.js';

const canvas = document.getElementById('single-card-canvas');
const statusEl = document.getElementById('single-card-status');
const resetBtn = document.getElementById('single-card-reset');

new CardGameClient({
  canvas,
  statusElement: statusEl,
  resetButton: resetBtn,
  template: SINGLE_CARD_TEMPLATE,
});
