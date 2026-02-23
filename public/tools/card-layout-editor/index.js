import { CardLibraryScene, DEFAULT_CARD_LABEL_LAYOUT } from '/public/projects/card-library/CardLibraryScene.js';

const previewCanvas = document.getElementById('card-layout-editor-canvas');
const previewContainer = document.getElementById('card-layout-preview');
const controlsRoot = document.getElementById('layout-controls');

const defaultCard = {
  id: 'layout-editor-default',
  name: 'Ember Warden',
  type: 'Fire',
  damage: 'D8',
  health: 18,
  speed: 'D6',
  defense: 'D12',
  meshColor: '#000000',
};

const previewCard = { ...defaultCard };
const imageCache = new Map();
let selectedBackgroundImagePath = '/public/assets/CardFront2hole.png';
let selectedArtworkImagePath = '';

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

const updatePreviewBackground = async (assetPath) => {
  selectedBackgroundImagePath = assetPath || '';
  previewCard.backgroundImagePath = selectedBackgroundImagePath || null;

  if (!selectedBackgroundImagePath) {
    delete previewCard.backgroundImage;
    scene.setCards([previewCard]);
    return;
  }

  delete previewCard.backgroundImage;
  scene.setCards([previewCard]);

  try {
    previewCard.backgroundImage = await loadImage(selectedBackgroundImagePath);
    scene.setCards([previewCard]);
  } catch (error) {
    console.warn(error);
  }
};

updatePreviewBackground(selectedBackgroundImagePath);

const updatePreviewArtwork = async (assetPath) => {
  selectedArtworkImagePath = assetPath || '';
  previewCard.artworkImagePath = selectedArtworkImagePath || null;

  if (!selectedArtworkImagePath) {
    delete previewCard.artworkImage;
    scene.setCards([previewCard]);
    return;
  }

  try {
    previewCard.artworkImage = await loadImage(selectedArtworkImagePath);
    scene.setCards([previewCard]);
  } catch (error) {
    console.warn(error);
  }
};

const sections = [
  { key: 'name', label: 'Name', minSize: 18, maxSize: 120, stepSize: 1, supportsTextStyle: true },
  { key: 'type', label: 'Type', minSize: 16, maxSize: 96, stepSize: 1, supportsTextStyle: true },
  { key: 'damage', label: 'Attack', minSize: 0.5, maxSize: 1.7, stepSize: 0.05, supportsStatBoxStyle: true },
  { key: 'health', label: 'Health', minSize: 0.5, maxSize: 1.7, stepSize: 0.05, supportsStatBoxStyle: true },
  { key: 'speed', label: 'Speed', minSize: 0.5, maxSize: 1.7, stepSize: 0.05, supportsStatBoxStyle: true },
  { key: 'defense', label: 'Defense', minSize: 0.5, maxSize: 1.7, stepSize: 0.05, supportsStatBoxStyle: true },
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
    const precision = step < 1 ? 2 : 0;
    valueLabel.textContent = `${label}: ${numericValue.toFixed(precision)}`;
    scene.setCardLabelLayout(editorState);
  };

  input.addEventListener('input', syncValue);
  input.addEventListener('change', syncValue);
  syncValue();

  row.append(valueLabel, input);
  return row;
}

function buildColorControl({ elementKey, label, prop = 'color' }) {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';

  const input = document.createElement('input');
  input.type = 'color';
  input.value = editorState[elementKey][prop];

  const syncValue = () => {
    editorState[elementKey][prop] = input.value;
    valueLabel.textContent = `${label}: ${input.value.toUpperCase()}`;
    scene.setCardLabelLayout(editorState);
  };

  input.addEventListener('input', syncValue);
  input.addEventListener('change', syncValue);
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

function buildExportControls() {
  const group = document.createElement('div');
  group.className = 'tools-export';

  const buttonRow = document.createElement('div');
  buttonRow.className = 'tools-export-buttons';

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.textContent = 'Export Layout JSON';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy JSON';

  const output = document.createElement('textarea');
  output.className = 'tools-export-output';
  output.rows = 8;
  output.readOnly = true;

  const status = document.createElement('p');
  status.className = 'tools-slider-value';

  const getSerializedState = () => JSON.stringify({
    cardLabelLayout: editorState,
    preview: {
      name: previewCard.name,
      type: previewCard.type,
      meshColor: previewCard.meshColor,
      backgroundImagePath: selectedBackgroundImagePath || null,
      artworkImagePath: selectedArtworkImagePath || null,
    },
  }, null, 2);

  exportButton.addEventListener('click', () => {
    const payload = getSerializedState();
    output.value = payload;

    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'card-layout.json';
    anchor.click();
    URL.revokeObjectURL(url);

    status.textContent = 'Exported card-layout.json.';
  });

  copyButton.addEventListener('click', async () => {
    const payload = getSerializedState();
    output.value = payload;

    try {
      await navigator.clipboard.writeText(payload);
      status.textContent = 'Layout JSON copied to clipboard.';
    } catch (_error) {
      status.textContent = 'Could not copy automatically. Copy from the text box below.';
    }
  });

  buttonRow.append(exportButton, copyButton);
  group.append(buttonRow, output, status);

  return group;
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
    updatePreviewBackground(select.value);
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
      select.value = selectedBackgroundImagePath;
      select.disabled = false;
    })
    .catch(() => {
      valueLabel.textContent = 'Background Image (assets unavailable)';
    });

  row.append(valueLabel, select);
  return row;
}

function buildArtworkSelectControl() {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';
  valueLabel.textContent = 'Card Artwork';

  const select = document.createElement('select');
  select.className = 'tools-select';
  select.disabled = true;

  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'None';
  select.append(noneOption);

  select.addEventListener('change', () => {
    updatePreviewArtwork(select.value);
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
      select.value = selectedArtworkImagePath;
      select.disabled = false;
    })
    .catch(() => {
      valueLabel.textContent = 'Card Artwork (assets unavailable)';
    });

  row.append(valueLabel, select);
  return row;
}

function buildMeshColorControl() {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';

  const input = document.createElement('input');
  input.type = 'color';
  input.value = previewCard.meshColor;

  const syncValue = () => {
    previewCard.meshColor = input.value;
    valueLabel.textContent = `Card Mesh Color: ${input.value.toUpperCase()}`;
    scene.setCards([previewCard]);
  };

  input.addEventListener('input', syncValue);
  input.addEventListener('change', syncValue);
  syncValue();

  row.append(valueLabel, input);
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
  buildMeshColorControl(),
  buildBackgroundSelectControl(),
  buildArtworkSelectControl(),
  buildExportControls(),
);

controlsRoot.append(textPreviewGroup);

const artworkGroup = document.createElement('div');
artworkGroup.className = 'card tools-group';
const artworkHeading = document.createElement('h2');
artworkHeading.textContent = 'Artwork';
artworkGroup.append(artworkHeading);
artworkGroup.append(
  buildSlider({ elementKey: 'artwork', prop: 'x', label: 'Left / Right', min: 120, max: 904, step: 1 }),
  buildSlider({ elementKey: 'artwork', prop: 'y', label: 'Up / Down', min: 110, max: 930, step: 1 }),
  buildSlider({ elementKey: 'artwork', prop: 'width', label: 'Width', min: 80, max: 900, step: 1 }),
  buildSlider({ elementKey: 'artwork', prop: 'height', label: 'Height', min: 80, max: 900, step: 1 }),
);
controlsRoot.append(artworkGroup);

sections.forEach(({ key, label, minSize, maxSize, stepSize, supportsTextStyle, supportsStatBoxStyle }) => {
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

  if (supportsStatBoxStyle) {
    group.append(
      buildSlider({ elementKey: key, prop: 'boxWidth', label: 'Box Width', min: 80, max: 420, step: 1 }),
      buildSlider({ elementKey: key, prop: 'boxHeight', label: 'Box Height', min: 80, max: 420, step: 1 }),
      buildSlider({ elementKey: key, prop: 'boxBevel', label: 'Box Bevel', min: 0, max: 210, step: 1 }),
      buildSlider({ elementKey: key, prop: 'backgroundOpacity', label: 'Background Opacity', min: 0, max: 1, step: 0.01 }),
      buildSlider({ elementKey: key, prop: 'labelSize', label: 'Label Text Size', min: 8, max: 96, step: 1 }),
      buildSlider({ elementKey: key, prop: 'valueSize', label: 'Value Text Size', min: 8, max: 160, step: 1 }),
      buildColorControl({ elementKey: key, label: 'Label + Value Color', prop: 'textColor' }),
    );

    if (['damage', 'speed', 'defense'].includes(key)) {
      group.append(
        buildSlider({ elementKey: key, prop: 'iconWidth', label: 'Die Icon Width', min: 16, max: 260, step: 1 }),
        buildSlider({ elementKey: key, prop: 'iconHeight', label: 'Die Icon Height', min: 16, max: 260, step: 1 }),
        buildSlider({ elementKey: key, prop: 'iconOffsetX', label: 'Die Icon Left / Right', min: -220, max: 220, step: 1 }),
        buildSlider({ elementKey: key, prop: 'iconOffsetY', label: 'Die Icon Up / Down', min: -220, max: 220, step: 1 }),
      );
    }
  }

  controlsRoot.append(group);
});

window.addEventListener('beforeunload', () => {
  scene.destroy();
});
