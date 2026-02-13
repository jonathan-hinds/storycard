import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const CARD_LABEL_CANVAS_SIZE = 1024;
const DIE_ICON_PATHS = Object.freeze({
  D6: '/public/assets/D6Icon.png',
  D8: '/public/assets/D8Icon.png',
  D12: '/public/assets/D12Icon.png',
  D20: '/public/assets/D20Icon.png',
});

export const DEFAULT_CARD_LABEL_LAYOUT = Object.freeze({
  name: Object.freeze({ x: 335, y: 110, size: 52, color: '#000000', align: 'left' }),
  type: Object.freeze({ x: 512, y: 644, size: 48, color: '#ffffff', align: 'center' }),
  damage: Object.freeze({ x: 170, y: 802, size: 0.85, boxWidth: 264, boxHeight: 216, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 }),
  health: Object.freeze({ x: 202, y: 114, size: 0.85, boxWidth: 264, boxHeight: 216, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 100, textColor: '#ffffff' }),
  speed: Object.freeze({ x: 512, y: 802, size: 0.85, boxWidth: 266, boxHeight: 217, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 }),
  defense: Object.freeze({ x: 854, y: 802, size: 0.85, boxWidth: 265, boxHeight: 217, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 }),
});

const dieIconCache = new Map();
const dieIconLoadPromises = new Map();

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function normalizeDieValue(value) {
  if (value == null) return null;
  const match = String(value).trim().toUpperCase().match(/^D(6|8|12|20)$/);
  return match ? `D${match[1]}` : null;
}

function ensureDieIconLoaded(dieValue) {
  const iconPath = DIE_ICON_PATHS[dieValue];
  if (!iconPath || dieIconCache.has(dieValue) || dieIconLoadPromises.has(dieValue)) return;

  const imagePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      dieIconCache.set(dieValue, image);
      resolve(image);
    };
    image.onerror = () => reject(new Error(`Unable to load die icon: ${iconPath}`));
    image.src = iconPath;
  })
    .catch(() => {})
    .finally(() => {
      dieIconLoadPromises.delete(dieValue);
    });

  dieIconLoadPromises.set(dieValue, imagePromise);
}

function getDieIcon(dieValue) {
  const normalizedDieValue = normalizeDieValue(dieValue);
  if (!normalizedDieValue) return null;
  ensureDieIconLoaded(normalizedDieValue);
  return dieIconCache.get(normalizedDieValue) ?? null;
}

export function createCardLabelTexture(card, { backgroundImagePath = '/public/assets/CardFront2.png', cardLabelLayout = DEFAULT_CARD_LABEL_LAYOUT } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_LABEL_CANVAS_SIZE;
  canvas.height = CARD_LABEL_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');

  const backgroundImage = new Image();
  backgroundImage.src = card.backgroundImagePath || backgroundImagePath;
  if (backgroundImage.complete && backgroundImage.naturalWidth > 0) {
    ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, CARD_LABEL_CANVAS_SIZE, CARD_LABEL_CANVAS_SIZE);
    gradient.addColorStop(0, '#1f2a44');
    gradient.addColorStop(1, '#0d1321');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let index = 0; index < 14; index += 1) {
      drawRoundedRect(ctx, 42 + index * 8, 42 + index * 8, 940 - index * 16, 940 - index * 16, 28);
      ctx.fill();
    }
  }

  ctx.fillStyle = cardLabelLayout.name.color;
  ctx.textAlign = cardLabelLayout.name.align;
  ctx.font = `bold ${Math.round(cardLabelLayout.name.size)}px Inter, system-ui, sans-serif`;
  ctx.fillText(card.name || 'Unnamed Card', cardLabelLayout.name.x, cardLabelLayout.name.y, 820);

  ctx.fillStyle = cardLabelLayout.type.color;
  ctx.textAlign = cardLabelLayout.type.align;
  ctx.font = `600 ${Math.round(cardLabelLayout.type.size)}px Inter, system-ui, sans-serif`;
  ctx.fillText(card.type || 'unknown', cardLabelLayout.type.x, cardLabelLayout.type.y, 720);

  const stats = [
    { key: 'damage', label: 'DMG', value: card.damage },
    { key: 'health', label: 'HP', value: card.health },
    { key: 'speed', label: 'SPD', value: card.speed },
    { key: 'defense', label: 'DEF', value: card.defense },
  ];

  stats.forEach(({ key, label, value }) => {
    const elementLayout = cardLabelLayout[key];
    const width = elementLayout.boxWidth;
    const height = elementLayout.boxHeight;
    const left = elementLayout.x - width / 2;
    const top = elementLayout.y - height / 2;

    ctx.fillStyle = `rgba(18, 24, 40, ${elementLayout.backgroundOpacity})`;
    drawRoundedRect(ctx, left, top, width, height, elementLayout.boxBevel);
    ctx.fill();

    ctx.fillStyle = elementLayout.textColor;
    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.round(elementLayout.labelSize * elementLayout.size)}px Inter, system-ui, sans-serif`;
    ctx.fillText(label, left + width / 2, top + (88 * elementLayout.size));

    const dieIcon = ['damage', 'speed', 'defense'].includes(key) ? getDieIcon(value) : null;
    if (dieIcon) {
      const iconWidth = elementLayout.iconWidth * elementLayout.size;
      const iconHeight = elementLayout.iconHeight * elementLayout.size;
      const iconX = left + (width / 2) + elementLayout.iconOffsetX - (iconWidth / 2);
      const iconY = top + (188 * elementLayout.size) + elementLayout.iconOffsetY - (iconHeight / 2);
      ctx.drawImage(dieIcon, iconX, iconY, iconWidth, iconHeight);
      return;
    }

    ctx.font = `700 ${Math.round(elementLayout.valueSize * elementLayout.size)}px Inter, system-ui, sans-serif`;
    ctx.fillText(String(value ?? '-'), left + width / 2, top + (188 * elementLayout.size));
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
