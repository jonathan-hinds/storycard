import { CardLibraryScene, DEFAULT_CARD_LABEL_LAYOUT } from '/public/projects/card-library/CardLibraryScene.js';

const previewCanvas = document.getElementById('card-layout-editor-canvas');
const previewContainer = document.getElementById('card-layout-preview');
const controlsRoot = document.getElementById('layout-controls');

const defaultCard = {
  id: 'layout-editor-default',
  name: 'Ember Warden',
  type: 'Tank',
  damage: 7,
  health: 18,
  speed: 4,
};

const previewCard = { ...defaultCard };
const imageCache = new Map();

const editorState = structuredClone(DEFAULT_CARD_LABEL_LAYOUT);

const scene = new CardLibraryScene({
  canvas: previewCanvas,
  scrollContainer: previewContainer,
  layoutTuning: {
    cardsPerRow: 1,
    cardScale: 0.6,
    rowPadding: 0,
    columnPadding: 0,
    gridMargin: 0.8,
  },
  previewRotationOffset: { x: 1.15 },
  previewPositionOffset: { x: 0, y: -1.65, z: 3.6 },
  cardLabelLayout: editorState,
});

scene.setCards([previewCard]);

const sections = [
  { key: 'name', label: 'Name', minSize: 18, maxSize: 120, stepSize: 1, supportsTextStyle: true },
  { key: 'type', label: 'Type', minSize: 16, maxSize: 96, stepSize: 1, supportsTextStyle: true },
  { key: 'damage', label: 'Damage', minSize: 0.5, maxSize: 1.7, stepSize: 0.05 },
  { key: 'health', label: 'Health', minSize: 0.5, maxSize: 1.7, stepSize: 0.05 },
  { key: 'speed', label: 'Speed', minSize: 0.5, maxSize: 1.7, stepSize: 0.05 },
];

function buildSlider({ elementKey, prop, label, min, max, step }) {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(editorState[elementKey][prop]);

  const syncValue = () => {
    const numericValue = Number(input.value);
    editorState[elementKey][prop] = numericValue;
    valueLabel.textContent = `${label}: ${numericValue.toFixed(prop === 'size' && elementKey !== 'name' && elementKey !== 'type' ? 2 : 0)}`;
    scene.setCardLabelLayout(editorState);
  };

  input.addEventListener('input', syncValue);
  syncValue();

  row.append(valueLabel, input);
  return row;
}

function buildColorControl({ elementKey, label }) {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';

  const input = document.createElement('input');
  input.type = 'color';
  input.value = editorState[elementKey].color;

  const syncValue = () => {
    editorState[elementKey].color = input.value;
    valueLabel.textContent = `${label}: ${input.value.toUpperCase()}`;
    scene.setCardLabelLayout(editorState);
  };

  input.addEventListener('input', syncValue);
  syncValue();

  row.append(valueLabel, input);
  return row;
}

function buildAlignmentControl({ elementKey, label }) {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';
  valueLabel.textContent = label;

  const select = document.createElement('select');
  select.className = 'tools-select';

  [
    { value: 'left', text: 'Left' },
    { value: 'center', text: 'Center' },
    { value: 'right', text: 'Right' },
  ].forEach((optionDef) => {
    const option = document.createElement('option');
    option.value = optionDef.value;
    option.textContent = optionDef.text;
    select.append(option);
  });

  select.value = editorState[elementKey].align;
  select.addEventListener('change', () => {
    editorState[elementKey].align = select.value;
    scene.setCardLabelLayout(editorState);
  });

  row.append(valueLabel, select);
  return row;
}

function buildTextInputControl({ cardProp, label }) {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';
  valueLabel.textContent = label;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = previewCard[cardProp];
  input.placeholder = `Enter ${label.toLowerCase()}`;

  input.addEventListener('input', () => {
    previewCard[cardProp] = input.value || defaultCard[cardProp];
    scene.setCards([previewCard]);
  });

  row.append(valueLabel, input);
  return row;
}

function loadImage(assetPath) {
  if (!assetPath) return Promise.resolve(null);
  if (imageCache.has(assetPath)) return imageCache.get(assetPath);

  const imagePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load background image: ${assetPath}`));
    image.src = assetPath;
  });

  imageCache.set(assetPath, imagePromise);
  return imagePromise;
}

function buildBackgroundSelectControl() {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';
  valueLabel.textContent = 'Background Image';

  const select = document.createElement('select');
  select.className = 'tools-select';
  select.disabled = true;

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Default gradient';
  select.append(defaultOption);

  select.addEventListener('change', async () => {
    try {
      const selectedPath = select.value;
      if (!selectedPath) {
        delete previewCard.backgroundImage;
        scene.setCards([previewCard]);
        return;
      }

      previewCard.backgroundImage = await loadImage(selectedPath);
      scene.setCards([previewCard]);
    } catch (error) {
      console.warn(error);
    }
  });

  fetch('/api/assets')
    .then((response) => response.json())
    .then(({ assets = [] }) => {
      assets.forEach((asset) => {
        const option = document.createElement('option');
        option.value = asset.path;
        option.textContent = asset.name;
        select.append(option);
      });
      select.disabled = false;
    })
    .catch(() => {
      valueLabel.textContent = 'Background Image (assets unavailable)';
    });

  row.append(valueLabel, select);
  return row;
}

const textPreviewGroup = document.createElement('div');
textPreviewGroup.className = 'card tools-group';

const textPreviewHeading = document.createElement('h2');
textPreviewHeading.textContent = 'Preview Text';
textPreviewGroup.append(textPreviewHeading);
textPreviewGroup.append(
  buildTextInputControl({ cardProp: 'name', label: 'Name Text' }),
  buildTextInputControl({ cardProp: 'type', label: 'Type Text' }),
  buildBackgroundSelectControl(),
);

controlsRoot.append(textPreviewGroup);

sections.forEach(({ key, label, minSize, maxSize, stepSize, supportsTextStyle }) => {
  const group = document.createElement('div');
  group.className = 'card tools-group';

  const heading = document.createElement('h2');
  heading.textContent = label;
  group.append(heading);

  group.append(
    buildSlider({ elementKey: key, prop: 'x', label: 'Left / Right', min: 120, max: 904, step: 1 }),
    buildSlider({ elementKey: key, prop: 'y', label: 'Up / Down', min: 110, max: 930, step: 1 }),
    buildSlider({ elementKey: key, prop: 'size', label: 'Size', min: minSize, max: maxSize, step: stepSize }),
  );

  if (supportsTextStyle) {
    group.append(
      buildColorControl({ elementKey: key, label: 'Text Color' }),
      buildAlignmentControl({ elementKey: key, label: 'Text Alignment' }),
    );
  }

  controlsRoot.append(group);
});

window.addEventListener('beforeunload', () => {
  scene.destroy();
});
