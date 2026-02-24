import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js?module';
import {
  DEFAULT_CARD_BACKGROUND_IMAGE_PATH,
  DEFAULT_CARD_LABEL_LAYOUT,
  getDefaultCardBackgroundImagePath,
  getDefaultCardLabelLayout,
  resolveCardKind,
} from './cardStyleConfig.js';

export { DEFAULT_CARD_BACKGROUND_IMAGE_PATH, DEFAULT_CARD_LABEL_LAYOUT };

const CARD_LABEL_CANVAS_SIZE = 1024;

export { CARD_LABEL_CANVAS_SIZE };
const DIE_ICON_PATHS = Object.freeze({
  D6: '/public/assets/D6Icon.png',
  D8: '/public/assets/D8Icon.png',
  D12: '/public/assets/D12Icon.png',
  D20: '/public/assets/D20Icon.png',
});

const dieIconCache = new Map();
const dieIconLoadPromises = new Map();
const backgroundImageCache = new Map();
const backgroundImageLoadPromises = new Map();
const artworkImageCache = new Map();
const artworkImageLoadPromises = new Map();

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

function ensureImageLoaded(cache, pendingCache, key, srcPath) {
  if (!srcPath || cache.has(key) || pendingCache.has(key)) return;

  const imagePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      cache.set(key, image);
      resolve(image);
    };
    image.onerror = () => reject(new Error(`Unable to load image: ${srcPath}`));
    image.src = srcPath;
  })
    .catch(() => {})
    .finally(() => {
      pendingCache.delete(key);
    });

  pendingCache.set(key, imagePromise);
}

function drawGradientFallback(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, CARD_LABEL_CANVAS_SIZE, CARD_LABEL_CANVAS_SIZE);
  gradient.addColorStop(0, '#1f2a44');
  gradient.addColorStop(1, '#0d1321');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_LABEL_CANVAS_SIZE, CARD_LABEL_CANVAS_SIZE);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  for (let index = 0; index < 14; index += 1) {
    drawRoundedRect(ctx, 42 + index * 8, 42 + index * 8, 940 - index * 16, 940 - index * 16, 28);
    ctx.fill();
  }
}

function drawAbilityBanner(ctx, abilityLayout, anchor, ability) {
  if (!ability) return;
  const cost = String(ability.cost ?? '').trim();
  const name = String(ability.name ?? '').trim();
  const description = String(ability.description ?? '').trim();
  if (!cost && !name && !description) return;

  const width = abilityLayout.boxWidth * abilityLayout.size;
  const height = abilityLayout.boxHeight * abilityLayout.size;
  const left = anchor.x - (width / 2);
  const top = anchor.y - (height / 2);

  const bannerColor = abilityLayout.backgroundColor || '#121828';
  const r = Number.parseInt(bannerColor.slice(1, 3), 16);
  const g = Number.parseInt(bannerColor.slice(3, 5), 16);
  const b = Number.parseInt(bannerColor.slice(5, 7), 16);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${abilityLayout.backgroundOpacity})`;
  drawRoundedRect(ctx, left, top, width, height, abilityLayout.boxBevel * abilityLayout.size);
  ctx.fill();

  const drawText = ({ text, size, offsetX, offsetY, align }) => {
    if (!text) return;
    ctx.fillStyle = abilityLayout.textColor;
    ctx.textAlign = align;
    ctx.font = `600 ${Math.round(size * abilityLayout.size)}px Inter, system-ui, sans-serif`;
    const maxWidth = Math.max(120, width - 60);
    ctx.fillText(text, anchor.x + (offsetX * abilityLayout.size), anchor.y + (offsetY * abilityLayout.size), maxWidth);
  };

  drawText({
    text: cost,
    size: abilityLayout.costSize,
    offsetX: abilityLayout.costOffsetX,
    offsetY: abilityLayout.costOffsetY,
    align: abilityLayout.costAlign,
  });
  drawText({
    text: name,
    size: abilityLayout.nameSize,
    offsetX: abilityLayout.nameOffsetX,
    offsetY: abilityLayout.nameOffsetY,
    align: abilityLayout.nameAlign,
  });
  drawText({
    text: description,
    size: abilityLayout.descriptionSize,
    offsetX: abilityLayout.descriptionOffsetX,
    offsetY: abilityLayout.descriptionOffsetY,
    align: abilityLayout.descriptionAlign,
  });
}

export function createCardLabelTexture(card, {
  backgroundImagePath = null,
  cardLabelLayout = null,
  statDisplayOverrides = null,
  abilityOutlineIndices = null,
  selectedAbilityIndex = null,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_LABEL_CANVAS_SIZE;
  canvas.height = CARD_LABEL_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  const cardKind = resolveCardKind(card.cardKind);
  const fallbackBackgroundPath = getDefaultCardBackgroundImagePath(cardKind);
  const resolvedBackgroundPath = card.backgroundImagePath || backgroundImagePath || fallbackBackgroundPath;
  const resolvedCardLabelLayout = cardLabelLayout || getDefaultCardLabelLayout(cardKind);
  const resolvedArtworkPath = typeof card.artworkImagePath === 'string' && card.artworkImagePath.trim()
    ? card.artworkImagePath.trim()
    : null;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const drawCardFace = () => {
    const artworkLayout = resolvedCardLabelLayout.artwork ?? getDefaultCardLabelLayout(cardKind).artwork;
    const artworkImage = card.artworkImage instanceof HTMLImageElement
      ? card.artworkImage
      : (resolvedArtworkPath ? (artworkImageCache.get(resolvedArtworkPath) ?? null) : null);
    const drawArtwork = () => {
      if (!artworkImage || !artworkLayout) return;
      const artworkLeft = artworkLayout.x - (artworkLayout.width / 2);
      const artworkTop = artworkLayout.y - (artworkLayout.height / 2);
      ctx.drawImage(artworkImage, artworkLeft, artworkTop, artworkLayout.width, artworkLayout.height);
    };

    const backgroundImage = card.backgroundImage instanceof HTMLImageElement
      ? card.backgroundImage
      : backgroundImageCache.get(resolvedBackgroundPath) ?? null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!backgroundImage) {
      drawGradientFallback(ctx);
      drawArtwork();
    } else {
      drawArtwork();
      ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
    }

    ctx.fillStyle = resolvedCardLabelLayout.name.color;
    ctx.textAlign = resolvedCardLabelLayout.name.align;
    ctx.font = `bold ${Math.round(resolvedCardLabelLayout.name.size)}px Inter, system-ui, sans-serif`;
    ctx.fillText(card.name || 'Unnamed Card', resolvedCardLabelLayout.name.x, resolvedCardLabelLayout.name.y, 820);

    ctx.fillStyle = resolvedCardLabelLayout.type.color;
    ctx.textAlign = resolvedCardLabelLayout.type.align;
    ctx.font = `600 ${Math.round(resolvedCardLabelLayout.type.size)}px Inter, system-ui, sans-serif`;
    ctx.fillText(card.type || 'unknown', resolvedCardLabelLayout.type.x, resolvedCardLabelLayout.type.y, 720);

    const isSpellCard = cardKind === 'Spell';
    const stats = isSpellCard
      ? [{ key: 'damage', label: 'EFCT', value: card.damage }]
      : [
        { key: 'damage', label: 'DMG', value: card.damage },
        { key: 'health', label: 'HP', value: card.health },
        { key: 'speed', label: 'SPD', value: card.speed },
        { key: 'defense', label: 'DEF', value: card.defense },
      ];

    stats.forEach(({ key, label, value }) => {
      const elementLayout = resolvedCardLabelLayout[key];
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

      const overrideValue = statDisplayOverrides && Object.hasOwn(statDisplayOverrides, key)
        ? statDisplayOverrides[key]
        : undefined;
      const resolvedValue = overrideValue !== undefined ? overrideValue : value;
      const normalizedDieValue = (isSpellCard || ['damage', 'speed', 'defense'].includes(key)) ? normalizeDieValue(resolvedValue) : null;
      const dieIcon = normalizedDieValue ? dieIconCache.get(normalizedDieValue) ?? null : null;

      if (dieIcon) {
        const iconWidth = elementLayout.iconWidth * elementLayout.size;
        const iconHeight = elementLayout.iconHeight * elementLayout.size;
        const iconX = left + (width / 2) + elementLayout.iconOffsetX - (iconWidth / 2);
        const iconY = top + (188 * elementLayout.size) + elementLayout.iconOffsetY - (iconHeight / 2);
        ctx.drawImage(dieIcon, iconX, iconY, iconWidth, iconHeight);
        return;
      }

      const isRollResult = typeof resolvedValue === 'number' && Number.isFinite(resolvedValue);
      ctx.font = `700 ${Math.round(elementLayout.valueSize * elementLayout.size * (isRollResult ? 1.06 : 1))}px Inter, system-ui, sans-serif`;
      if (isRollResult) {
        ctx.lineWidth = Math.max(4, Math.round(11 * elementLayout.size));
        ctx.strokeStyle = '#000000';
        ctx.strokeText(String(resolvedValue), left + width / 2, top + (188 * elementLayout.size));
      }
      ctx.fillText(String(resolvedValue ?? '-'), left + width / 2, top + (188 * elementLayout.size));
    });

    const defaultLayout = getDefaultCardLabelLayout(cardKind);
    const abilityBannerLayout = resolvedCardLabelLayout.abilityBanner ?? defaultLayout.abilityBanner;
    const ability1Offset = resolvedCardLabelLayout.ability1 ?? defaultLayout.ability1;
    const ability2Offset = resolvedCardLabelLayout.ability2 ?? defaultLayout.ability2;
    const abilityAnchors = [
      { x: abilityBannerLayout.x + ability1Offset.x, y: abilityBannerLayout.y + ability1Offset.y, ability: card.ability1 },
      { x: abilityBannerLayout.x + ability2Offset.x, y: abilityBannerLayout.y + ability2Offset.y, ability: card.ability2 },
    ];

    abilityAnchors.forEach(({ x, y, ability }) => drawAbilityBanner(ctx, abilityBannerLayout, { x, y }, ability));

    const outlineIndices = Array.isArray(abilityOutlineIndices) ? new Set(abilityOutlineIndices.filter(Number.isInteger)) : null;
    const width = abilityBannerLayout.boxWidth * abilityBannerLayout.size;
    const height = abilityBannerLayout.boxHeight * abilityBannerLayout.size;
    abilityAnchors.forEach(({ x, y, ability }, index) => {
      if (!ability) return;
      const isOutlined = outlineIndices?.has(index) || selectedAbilityIndex === index;
      if (!isOutlined) return;
      ctx.strokeStyle = selectedAbilityIndex === index ? '#ffe16d' : 'rgba(255, 255, 255, 1)';
      ctx.lineWidth = selectedAbilityIndex === index ? 8 : 5;
      drawRoundedRect(ctx, x - (width / 2), y - (height / 2), width, height, abilityBannerLayout.boxBevel * abilityBannerLayout.size);
      ctx.stroke();
    });

    texture.needsUpdate = true;
  };

  drawCardFace();

  if (resolvedBackgroundPath && !(card.backgroundImage instanceof HTMLImageElement)) {
    ensureImageLoaded(backgroundImageCache, backgroundImageLoadPromises, resolvedBackgroundPath, resolvedBackgroundPath);
    backgroundImageLoadPromises.get(resolvedBackgroundPath)?.then((image) => {
      if (!image) return;
      card.backgroundImage = image;
      drawCardFace();
    });
  }

  if (resolvedArtworkPath && !(card.artworkImage instanceof HTMLImageElement)) {
    ensureImageLoaded(artworkImageCache, artworkImageLoadPromises, resolvedArtworkPath, resolvedArtworkPath);
    artworkImageLoadPromises.get(resolvedArtworkPath)?.then((image) => {
      if (!image) return;
      card.artworkImage = image;
      drawCardFace();
    });
  }

  (cardKind === 'Spell' ? ['damage'] : ['damage', 'speed', 'defense']).forEach((key) => {
    const dieValue = normalizeDieValue(card[key]);
    const iconPath = dieValue ? DIE_ICON_PATHS[dieValue] : null;
    if (!dieValue || !iconPath || dieIconCache.has(dieValue)) return;
    ensureImageLoaded(dieIconCache, dieIconLoadPromises, dieValue, iconPath);
    dieIconLoadPromises.get(dieValue)?.then(() => drawCardFace());
  });

  return texture;
}
