const makeFrozenLayout = (layout) => Object.freeze(Object.fromEntries(
  Object.entries(layout).map(([key, value]) => [key, Object.freeze({ ...value })]),
));

export const CARD_KINDS = Object.freeze({
  CREATURE: 'Creature',
  SPELL: 'Spell',
});

export const CARD_LAYOUT_FOR = Object.freeze({
  CREATURE: 'creature',
  SPELL: 'spell',
});

export const DEFAULT_CARD_BACKGROUND_IMAGE_PATHS = Object.freeze({
  [CARD_KINDS.CREATURE]: '/public/assets/CardFront2hole.png',
  [CARD_KINDS.SPELL]: '/public/assets/CardFrontSpell.png',
});

const CREATURE_CARD_LABEL_LAYOUT = makeFrozenLayout({
  name: { x: 335, y: 110, size: 52, color: '#000000', align: 'left' },
  artwork: { x: 521, y: 368, width: 900, height: 451 },
  type: { x: 512, y: 644, size: 48, color: '#ffffff', align: 'center' },
  damage: { x: 170, y: 802, size: 0.85, boxWidth: 264, boxHeight: 216, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 },
  health: { x: 202, y: 114, size: 0.85, boxWidth: 264, boxHeight: 216, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 100, textColor: '#ffffff' },
  speed: { x: 512, y: 802, size: 0.85, boxWidth: 266, boxHeight: 217, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 },
  defense: { x: 854, y: 802, size: 0.85, boxWidth: 265, boxHeight: 217, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 },
  abilityBanner: {
    x: 518,
    y: 359,
    size: 1,
    boxWidth: 920,
    boxHeight: 121,
    boxBevel: 0,
    backgroundOpacity: 0.61,
    backgroundColor: '#000000',
    textColor: '#ffffff',
    costSize: 84,
    costOffsetX: -440,
    costOffsetY: 36,
    costAlign: 'left',
    nameSize: 35,
    nameOffsetX: -358,
    nameOffsetY: 0,
    nameAlign: 'left',
    descriptionSize: 27,
    descriptionOffsetX: -358,
    descriptionOffsetY: 30,
    descriptionAlign: 'left',
  },
  ability1: { x: 0, y: 138 },
  ability2: { x: 0, y: 0 },
  badgeSlots: {
    visible: true,
    count: 4,
    x: 0,
    y: 0.45,
    z: 0.07,
    gap: 0.16,
    size: 0.18,
    bevel: 0.03,
    thickness: 0.02,
  },
});

const SPELL_CARD_LABEL_LAYOUT = makeFrozenLayout({
  name: { x: 500, y: 110, size: 52, color: '#000000', align: 'center' },
  artwork: { x: 521, y: 368, width: 900, height: 451 },
  type: { x: 512, y: 644, size: 48, color: '#ffffff', align: 'center' },
  damage: { x: 509, y: 802, size: 0.85, boxWidth: 264, boxHeight: 216, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 },
  health: { x: 202, y: 114, size: 0.85, boxWidth: 264, boxHeight: 216, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 100, textColor: '#ffffff' },
  speed: { x: 512, y: 802, size: 0.85, boxWidth: 266, boxHeight: 217, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 },
  defense: { x: 854, y: 802, size: 0.85, boxWidth: 265, boxHeight: 217, boxBevel: 0, backgroundOpacity: 0, labelSize: 60, valueSize: 120, textColor: '#ffffff', iconWidth: 200, iconHeight: 175, iconOffsetX: 0, iconOffsetY: 0 },
  abilityBanner: {
    x: 518,
    y: 359,
    size: 1,
    boxWidth: 920,
    boxHeight: 121,
    boxBevel: 0,
    backgroundOpacity: 0.61,
    backgroundColor: '#000000',
    textColor: '#ffffff',
    costSize: 84,
    costOffsetX: -440,
    costOffsetY: 36,
    costAlign: 'left',
    nameSize: 35,
    nameOffsetX: -358,
    nameOffsetY: 0,
    nameAlign: 'left',
    descriptionSize: 27,
    descriptionOffsetX: -358,
    descriptionOffsetY: 30,
    descriptionAlign: 'left',
  },
  ability1: { x: 0, y: 138 },
  ability2: { x: 0, y: 0 },
  badgeSlots: {
    visible: false,
    count: 4,
    x: 0,
    y: 0.45,
    z: 0.07,
    gap: 0.16,
    size: 0.18,
    bevel: 0.03,
    thickness: 0.02,
  },
});

export const DEFAULT_CARD_LABEL_LAYOUTS = Object.freeze({
  [CARD_KINDS.CREATURE]: CREATURE_CARD_LABEL_LAYOUT,
  [CARD_KINDS.SPELL]: SPELL_CARD_LABEL_LAYOUT,
});

export const DEFAULT_CARD_LABEL_LAYOUT = DEFAULT_CARD_LABEL_LAYOUTS[CARD_KINDS.CREATURE];
export const DEFAULT_SPELL_CARD_LABEL_LAYOUT = DEFAULT_CARD_LABEL_LAYOUTS[CARD_KINDS.SPELL];
export const DEFAULT_CARD_BACKGROUND_IMAGE_PATH = DEFAULT_CARD_BACKGROUND_IMAGE_PATHS[CARD_KINDS.CREATURE];

export function resolveCardKind(cardKind) {
  if (typeof cardKind !== 'string') return CARD_KINDS.CREATURE;
  const normalizedKind = cardKind.trim().toLowerCase();
  return normalizedKind === CARD_KINDS.SPELL.toLowerCase() || normalizedKind === CARD_LAYOUT_FOR.SPELL
    ? CARD_KINDS.SPELL
    : CARD_KINDS.CREATURE;
}

export function getDefaultCardLabelLayout(cardKind) {
  return DEFAULT_CARD_LABEL_LAYOUTS[resolveCardKind(cardKind)];
}

export function getDefaultCardBackgroundImagePath(cardKind) {
  return DEFAULT_CARD_BACKGROUND_IMAGE_PATHS[resolveCardKind(cardKind)];
}
