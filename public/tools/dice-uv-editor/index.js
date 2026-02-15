import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';

const UV_PRECISION = 10000;

const controlsRoot = document.getElementById('dice-uv-controls');
const canvas = document.getElementById('dice-uv-canvas');
const ctx = canvas.getContext('2d');

const state = {
  dieId: '',
  sides: 6,
  texturePath: '',
  textureImage: null,
  faces: [],
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  viewBox: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  viewCenter: { x: 0, y: 0 },
  zoom: 1,
  drag: null,
  pan: null,
  status: 'Loading die + assets...',
};

const controls = {
  dieSelect: null,
  sidesSelect: null,
  textureSelect: null,
  zoomInput: null,
  zoomLabel: null,
  output: null,
  status: null,
};

buildUi();
await initialize();

function buildUi() {
  controls.dieSelect = buildSelectControl('Die', []);
  controls.sidesSelect = buildSelectControl('Sides', [3, 4, 6, 8, 12, 20].map((value) => ({ value: String(value), text: `D${value}` })));
  controls.textureSelect = buildSelectControl('Texture Asset', []);

  controls.sidesSelect.select.value = String(state.sides);
  controls.sidesSelect.select.addEventListener('change', async () => {
    state.sides = Number.parseInt(controls.sidesSelect.select.value, 10) || 6;
    state.dieId = '';
    rebuildFaces();
    await syncTexture();
    updateExportOutput();
    draw();
  });

  controls.dieSelect.select.addEventListener('change', async () => {
    const option = controls.dieSelect.select.selectedOptions[0];
    state.dieId = controls.dieSelect.select.value;
    const sides = Number.parseInt(option?.dataset?.sides || '', 10);
    if (sides) {
      state.sides = sides;
      controls.sidesSelect.select.value = String(sides);
      rebuildFaces();
      await syncTexture();
      updateExportOutput();
      draw();
    }
  });

  controls.textureSelect.select.addEventListener('change', async () => {
    state.texturePath = controls.textureSelect.select.value;
    await syncTexture();
    updateExportOutput();
    draw();
  });

  const zoomRow = document.createElement('label');
  zoomRow.className = 'tools-slider-row';

  controls.zoomLabel = document.createElement('span');
  controls.zoomLabel.className = 'tools-slider-value';
  controls.zoomLabel.textContent = 'Zoom (1.0x)';

  controls.zoomInput = document.createElement('input');
  controls.zoomInput.type = 'range';
  controls.zoomInput.min = '1';
  controls.zoomInput.max = '8';
  controls.zoomInput.step = '0.1';
  controls.zoomInput.value = String(state.zoom);
  controls.zoomInput.addEventListener('input', () => {
    setZoom(Number.parseFloat(controls.zoomInput.value));
  });

  zoomRow.append(controls.zoomLabel, controls.zoomInput);

  const buttons = document.createElement('div');
  buttons.className = 'tools-export-buttons';

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.textContent = 'Export UV JSON';
  exportButton.addEventListener('click', () => {
    const payload = JSON.stringify(buildExportPayload(), null, 2);
    controls.output.value = payload;

    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dice-uv-${state.dieId || `d${state.sides}`}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    setStatus('Exported UV JSON.');
  });

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy JSON';
  copyButton.addEventListener('click', async () => {
    const payload = JSON.stringify(buildExportPayload(), null, 2);
    controls.output.value = payload;
    try {
      await navigator.clipboard.writeText(payload);
      setStatus('Copied UV JSON to clipboard.');
    } catch (_error) {
      setStatus('Clipboard unavailable. Copy JSON from the text area.');
    }
  });

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset Net';
  resetButton.addEventListener('click', async () => {
    rebuildFaces();
    await syncTexture();
    updateExportOutput();
    draw();
    setStatus('Reset to generated unwrap.');
  });

  const resetZoomButton = document.createElement('button');
  resetZoomButton.type = 'button';
  resetZoomButton.textContent = 'Reset Zoom';
  resetZoomButton.addEventListener('click', () => {
    setZoom(1);
  });

  buttons.append(exportButton, copyButton, resetButton, resetZoomButton);

  controls.output = document.createElement('textarea');
  controls.output.className = 'tools-export-output';
  controls.output.rows = 10;
  controls.output.readOnly = true;

  controls.status = document.createElement('p');
  controls.status.className = 'tools-slider-value';

  const exportGroup = document.createElement('div');
  exportGroup.className = 'tools-export';
  exportGroup.append(buttons, controls.output, controls.status);

  controlsRoot.append(
    controls.dieSelect.row,
    controls.sidesSelect.row,
    controls.textureSelect.row,
    zoomRow,
    exportGroup
  );

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
}

async function initialize() {
  await Promise.all([loadDiceOptions(), loadAssetOptions()]);

  rebuildFaces();
  await syncTexture();
  updateExportOutput();
  draw();
  setStatus('Drag UV points to line up faces on the texture.');
}

async function loadDiceOptions() {
  const fallback = [
    { id: 'manual-d6', sides: 6 },
    { id: 'manual-d8', sides: 8 },
    { id: 'manual-d12', sides: 12 },
    { id: 'manual-d20', sides: 20 },
  ];

  let dice = fallback;
  try {
    const response = await fetch('/api/dice');
    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload.dice) && payload.dice.length > 0) {
        dice = payload.dice;
      }
    }
  } catch (_error) {
    setStatus('Dice API unavailable, using fallback die list.');
  }

  controls.dieSelect.select.innerHTML = '';

  const manualOption = document.createElement('option');
  manualOption.value = '';
  manualOption.textContent = 'No die selected (use Sides only)';
  controls.dieSelect.select.append(manualOption);

  dice.forEach((die) => {
    const option = document.createElement('option');
    option.value = die.id;
    option.dataset.sides = String(die.sides);
    option.textContent = `${die.id} (D${die.sides})`;
    controls.dieSelect.select.append(option);
  });
}

async function loadAssetOptions() {
  controls.textureSelect.select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No texture (show net only)';
  controls.textureSelect.select.append(none);

  try {
    const response = await fetch('/api/assets');
    const payload = await response.json();
    const imageAssets = (payload.assets || []).filter((asset) => /\.(png|jpe?g|webp)$/i.test(asset.name));

    imageAssets.forEach((asset) => {
      const option = document.createElement('option');
      option.value = asset.path;
      option.textContent = asset.name;
      controls.textureSelect.select.append(option);
    });

    if (imageAssets.length > 0) {
      state.texturePath = imageAssets[0].path;
      controls.textureSelect.select.value = state.texturePath;
    }
  } catch (_error) {
    setStatus('Assets API unavailable, texture dropdown is empty.');
  }
}

function rebuildFaces() {
  const geometry = createDieGeometry(state.sides);
  const faces = generateUnwrappedNet(geometry, state.sides);
  geometry.dispose();

  state.faces = faces.map((face) => ({
    value: face.value,
    points: face.points.map((point) => ({ x: point.x, y: point.y })),
  }));

  updateViewBox();
}

async function syncTexture() {
  if (!state.texturePath) {
    state.textureImage = null;
    return;
  }

  state.textureImage = await loadImage(state.texturePath).catch(() => null);
}

function updateViewBox({ recenter = true } = {}) {
  const allPoints = state.faces.flatMap((face) => face.points);
  if (allPoints.length === 0) return;

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const pad = 0.2;
  state.bounds = {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };

  if (recenter) {
    state.viewCenter = {
      x: (state.bounds.minX + state.bounds.maxX) / 2,
      y: (state.bounds.minY + state.bounds.maxY) / 2,
    };
  }

  recomputeViewBox();
}

function recomputeViewBox() {
  const width = (state.bounds.maxX - state.bounds.minX) / state.zoom;
  const height = (state.bounds.maxY - state.bounds.minY) / state.zoom;

  state.viewBox = {
    minX: state.viewCenter.x - (width / 2),
    maxX: state.viewCenter.x + (width / 2),
    minY: state.viewCenter.y - (height / 2),
    maxY: state.viewCenter.y + (height / 2),
  };
}

function setZoom(nextZoom, anchorPointer = null) {
  const safeZoom = Number.isFinite(nextZoom) ? Math.min(8, Math.max(1, nextZoom)) : 1;
  const anchorWorldBefore = anchorPointer ? canvasToWorld(anchorPointer) : null;

  state.zoom = safeZoom;
  controls.zoomInput.value = safeZoom.toFixed(1);
  controls.zoomLabel.textContent = `Zoom (${safeZoom.toFixed(1)}x)`;

  recomputeViewBox();

  if (anchorWorldBefore) {
    const anchorWorldAfter = canvasToWorld(anchorPointer);
    state.viewCenter.x += anchorWorldBefore.x - anchorWorldAfter.x;
    state.viewCenter.y += anchorWorldBefore.y - anchorWorldAfter.y;
    recomputeViewBox();
  }

  draw();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state.textureImage) {
    const topLeft = worldToCanvas({ x: 0, y: 1 });
    const bottomRight = worldToCanvas({ x: 1, y: 0 });
    const drawX = Math.min(topLeft.x, bottomRight.x);
    const drawY = Math.min(topLeft.y, bottomRight.y);
    const drawWidth = Math.abs(bottomRight.x - topLeft.x);
    const drawHeight = Math.abs(bottomRight.y - topLeft.y);

    ctx.save();
    ctx.globalAlpha = 0.96;
    ctx.drawImage(state.textureImage, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0d111b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  state.faces.forEach((face) => {
    const polygon = face.points.map((point) => worldToCanvas(point));

    ctx.beginPath();
    polygon.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(2, 132, 199, 0.14)';
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.stroke();

    const centroid = getCentroid(polygon);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 18px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(face.value), centroid.x, centroid.y);

    polygon.forEach((point, pointIndex) => {
      const isActive = state.drag && state.drag.faceIndex === state.faces.indexOf(face) && state.drag.pointIndex === pointIndex;
      ctx.beginPath();
      ctx.arc(point.x, point.y, isActive ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#f97316' : '#facc15';
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  });
}

function onPointerDown(event) {
  if (event.button === 1) {
    event.preventDefault();
    state.pan = {
      pointerStart: getPointer(event),
      centerStart: { ...state.viewCenter },
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (event.button !== 0) return;

  const pointer = getPointer(event);
  const nearest = findNearestPoint(pointer);
  if (!nearest || nearest.distance > 18) return;

  state.drag = {
    faceIndex: nearest.faceIndex,
    pointIndex: nearest.pointIndex,
  };

  canvas.setPointerCapture(event.pointerId);
  draw();
}

function onPointerMove(event) {
  if (state.pan) {
    const pointer = getPointer(event);
    const width = state.viewBox.maxX - state.viewBox.minX;
    const height = state.viewBox.maxY - state.viewBox.minY;
    const dx = ((pointer.x - state.pan.pointerStart.x) / canvas.width) * width;
    const dy = ((pointer.y - state.pan.pointerStart.y) / canvas.height) * height;

    state.viewCenter.x = state.pan.centerStart.x - dx;
    state.viewCenter.y = state.pan.centerStart.y + dy;
    recomputeViewBox();
    draw();
    return;
  }

  if (!state.drag) return;
  const pointer = getPointer(event);
  const world = canvasToWorld(pointer);
  const face = state.faces[state.drag.faceIndex];
  if (!face) return;
  face.points[state.drag.pointIndex] = world;

  updateViewBox({ recenter: false });
  updateExportOutput();
  draw();
}

function onWheel(event) {
  event.preventDefault();
  const direction = Math.sign(event.deltaY);
  const delta = direction > 0 ? -0.2 : 0.2;
  setZoom(state.zoom + delta, getPointer(event));
}

function onPointerUp(event) {
  if (state.pan) {
    state.pan = null;
    canvas.style.cursor = '';
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    return;
  }

  if (!state.drag) return;
  state.drag = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  draw();
}

function findNearestPoint(pointer) {
  let winner = null;

  state.faces.forEach((face, faceIndex) => {
    face.points.forEach((point, pointIndex) => {
      const canvasPoint = worldToCanvas(point);
      const dx = pointer.x - canvasPoint.x;
      const dy = pointer.y - canvasPoint.y;
      const distance = Math.sqrt((dx * dx) + (dy * dy));

      if (!winner || distance < winner.distance) {
        winner = { faceIndex, pointIndex, distance };
      }
    });
  });

  return winner;
}

function worldToCanvas(point) {
  const width = state.viewBox.maxX - state.viewBox.minX;
  const height = state.viewBox.maxY - state.viewBox.minY;
  const x = ((point.x - state.viewBox.minX) / width) * canvas.width;
  const y = canvas.height - (((point.y - state.viewBox.minY) / height) * canvas.height);
  return { x, y };
}

function canvasToWorld(point) {
  const width = state.viewBox.maxX - state.viewBox.minX;
  const height = state.viewBox.maxY - state.viewBox.minY;
  const x = state.viewBox.minX + ((point.x / canvas.width) * width);
  const y = state.viewBox.minY + (((canvas.height - point.y) / canvas.height) * height);
  return { x, y };
}

function getPointer(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function updateExportOutput() {
  controls.output.value = JSON.stringify(buildExportPayload(), null, 2);
}

function buildExportPayload() {
  return {
    dieId: state.dieId || null,
    sides: state.sides,
    texturePath: state.texturePath || null,
    exportedAt: new Date().toISOString(),
    faces: state.faces.map((face) => ({
      value: face.value,
      points: face.points.map((point) => ({ x: roundNumber(point.x), y: roundNumber(point.y) })),
    })),
  };
}

function roundNumber(value) {
  return Math.round(value * 100000) / 100000;
}

function setStatus(message) {
  state.status = message;
  controls.status.textContent = message;
}

function buildSelectControl(label, options) {
  const row = document.createElement('label');
  row.className = 'tools-slider-row';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'tools-slider-value';
  valueLabel.textContent = label;

  const select = document.createElement('select');
  select.className = 'tools-select';
  options.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.text;
    select.append(option);
  });

  row.append(valueLabel, select);
  return { row, select };
}

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${path}`));
    image.src = path;
  });
}

function getCentroid(points) {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function roundKey(value) {
  return Math.round(value * 10000) / 10000;
}

function roundUv(value) {
  return Math.round(value * UV_PRECISION) / UV_PRECISION;
}

function vertexKey(vertex) {
  return `${roundUv(vertex.x)}:${roundUv(vertex.y)}:${roundUv(vertex.z)}`;
}

function edgeKey(a, b) {
  const keyA = vertexKey(a);
  const keyB = vertexKey(b);
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

function getFaceFrame(normal) {
  const worldUp = Math.abs(normal.y) > 0.9
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, normal).normalize();
  const up = new THREE.Vector3().crossVectors(normal, right).normalize();
  return { right, up };
}

function selectNumberedFaces(faces, sides) {
  if (sides === 6) return faces.filter((face) => face.points2D.length === 4);
  if (sides === 8 || sides === 20 || sides === 4) return faces.filter((face) => face.points2D.length === 3);
  if (sides === 12) return faces.filter((face) => face.points2D.length === 5);
  return faces;
}

function extractFacePolygons3D(geometry, sides) {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const positions = nonIndexed.attributes.position;
  const groups = new Map();

  for (let i = 0; i < positions.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, i);
    const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
    const normal = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b, a),
      new THREE.Vector3().subVectors(c, a)
    ).normalize();

    if (normal.dot(a) < 0) normal.multiplyScalar(-1);

    const planeDistance = normal.dot(a);
    const key = `${roundKey(normal.x)}:${roundKey(normal.y)}:${roundKey(normal.z)}:${roundKey(planeDistance)}`;

    if (!groups.has(key)) {
      groups.set(key, { normal: normal.clone(), vertices: new Map() });
    }

    const group = groups.get(key);
    [a, b, c].forEach((vertex) => {
      group.vertices.set(vertexKey(vertex), vertex.clone());
    });
  }

  const faces = [...groups.values()].map((face, index) => {
    const vertices = [...face.vertices.values()];
    const center = vertices.reduce((acc, vertex) => acc.add(vertex), new THREE.Vector3()).multiplyScalar(1 / vertices.length);
    const { right, up } = getFaceFrame(face.normal);
    const ordered = vertices
      .map((vertex) => {
        const local = vertex.clone().sub(center);
        return { vertex, point2D: new THREE.Vector2(local.dot(right), local.dot(up)) };
      })
      .sort((first, second) => Math.atan2(first.point2D.y, first.point2D.x) - Math.atan2(second.point2D.y, second.point2D.x));

    return {
      id: index,
      center,
      points3D: ordered.map((entry) => entry.vertex),
      points2D: ordered.map((entry) => entry.point2D),
    };
  });

  return selectNumberedFaces(faces, sides)
    .sort((a, b) => {
      if (Math.abs(a.center.y - b.center.y) > 1e-4) return b.center.y - a.center.y;
      return Math.atan2(a.center.z, a.center.x) - Math.atan2(b.center.z, b.center.x);
    })
    .map((face, index) => ({ ...face, id: index }));
}

function signedDistanceToLine(point, a, b) {
  const edge = new THREE.Vector2().subVectors(b, a);
  const rel = new THREE.Vector2().subVectors(point, a);
  return (edge.x * rel.y) - (edge.y * rel.x);
}

function projectNeighborFace(points, sourceA, sourceB, targetA, targetB, reverse) {
  const srcA = reverse ? sourceB : sourceA;
  const srcB = reverse ? sourceA : sourceB;
  const sourceEdge = new THREE.Vector2().subVectors(srcB, srcA);
  const targetEdge = new THREE.Vector2().subVectors(targetB, targetA);
  const angle = Math.atan2(targetEdge.y, targetEdge.x) - Math.atan2(sourceEdge.y, sourceEdge.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return points.map((point) => {
    const local = point.clone().sub(srcA);
    const rotated = new THREE.Vector2(
      (local.x * cos) - (local.y * sin),
      (local.x * sin) + (local.y * cos)
    );
    return rotated.add(targetA);
  });
}

function getPolygonCentroid(points) {
  return points.reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y,
  }), { x: 0, y: 0 },)
  ;
}

function finalizeCentroid(centroid, count) {
  return new THREE.Vector2(centroid.x / count, centroid.y / count);
}

function generateUnwrappedNet(geometry, sideCount) {
  const faces = extractFacePolygons3D(geometry, sideCount);
  const edgeToFaces = new Map();
  const neighborMap = new Map();

  faces.forEach((face) => {
    for (let i = 0; i < face.points3D.length; i += 1) {
      const a = face.points3D[i];
      const b = face.points3D[(i + 1) % face.points3D.length];
      const key = edgeKey(a, b);
      if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
      edgeToFaces.get(key).push({ faceId: face.id, edgeIndex: i });
    }
  });

  edgeToFaces.forEach((entries, key) => {
    if (entries.length !== 2) return;
    const [first, second] = entries;
    if (!neighborMap.has(first.faceId)) neighborMap.set(first.faceId, []);
    if (!neighborMap.has(second.faceId)) neighborMap.set(second.faceId, []);
    neighborMap.get(first.faceId).push({ faceId: second.faceId, edgeKey: key });
    neighborMap.get(second.faceId).push({ faceId: first.faceId, edgeKey: key });
  });

  const placements = new Map();
  const queue = [];
  placements.set(faces[0].id, faces[0].points2D.map((point) => point.clone()));
  queue.push(faces[0].id);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentPlacement = placements.get(currentId);
    const neighbors = neighborMap.get(currentId) || [];

    neighbors.forEach((neighborInfo) => {
      if (placements.has(neighborInfo.faceId)) return;
      const neighborFace = faces.find((face) => face.id === neighborInfo.faceId);
      const sharedEntries = edgeToFaces.get(neighborInfo.edgeKey);
      if (!sharedEntries || sharedEntries.length !== 2) return;

      const currentEntry = sharedEntries.find((entry) => entry.faceId === currentId);
      const neighborEntry = sharedEntries.find((entry) => entry.faceId === neighborInfo.faceId);
      if (!currentEntry || !neighborEntry) return;

      const curA = currentPlacement[currentEntry.edgeIndex];
      const curB = currentPlacement[(currentEntry.edgeIndex + 1) % currentPlacement.length];
      const neighA = neighborFace.points2D[neighborEntry.edgeIndex];
      const neighB = neighborFace.points2D[(neighborEntry.edgeIndex + 1) % neighborFace.points2D.length];

      const candidateA = projectNeighborFace(neighborFace.points2D, neighA, neighB, curA, curB, false);
      const candidateB = projectNeighborFace(neighborFace.points2D, neighA, neighB, curA, curB, true);

      const currentCentroid = finalizeCentroid(getPolygonCentroid(currentPlacement), currentPlacement.length);
      const signCurrent = signedDistanceToLine(currentCentroid, curA, curB);
      const centroidA = finalizeCentroid(getPolygonCentroid(candidateA), candidateA.length);
      const signA = signedDistanceToLine(centroidA, curA, curB);

      placements.set(neighborInfo.faceId, signA * signCurrent < 0 ? candidateA : candidateB);
      queue.push(neighborInfo.faceId);
    });
  }

  return faces.map((face, index) => ({
    value: index + 1,
    points: (placements.get(face.id) || face.points2D).map((point) => ({ x: point.x, y: point.y })),
  }));
}

function createD3Geometry() {
  const radius = 1;
  const halfHeight = 0.5;

  const points = [
    new THREE.Vector3(radius, halfHeight, 0),
    new THREE.Vector3(radius * Math.cos((2 * Math.PI) / 3), halfHeight, radius * Math.sin((2 * Math.PI) / 3)),
    new THREE.Vector3(radius * Math.cos((4 * Math.PI) / 3), halfHeight, radius * Math.sin((4 * Math.PI) / 3)),
  ];
  const bottom = points.map((point) => new THREE.Vector3(point.x, -halfHeight, point.z));

  const positions = [];
  const normals = [];
  const uvs = [];

  const addVertex = (vertex, normal, u, v) => {
    positions.push(vertex.x, vertex.y, vertex.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(u, v);
  };

  const addFace = (topA, topB, bottomA, bottomB) => {
    const edge = new THREE.Vector3().subVectors(topB, topA);
    const down = new THREE.Vector3().subVectors(bottomA, topA);
    const normal = new THREE.Vector3().crossVectors(edge, down).normalize();

    addVertex(topA, normal, 0, 1);
    addVertex(bottomA, normal, 0, 0);
    addVertex(topB, normal, 1, 1);

    addVertex(topB, normal, 1, 1);
    addVertex(bottomA, normal, 0, 0);
    addVertex(bottomB, normal, 1, 0);
  };

  for (let i = 0; i < 3; i += 1) {
    const next = (i + 1) % 3;
    addFace(points[i], points[next], bottom[i], bottom[next]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

function createDieGeometry(sideCount) {
  if (sideCount === 3) return createD3Geometry();
  if (sideCount === 4) return new THREE.TetrahedronGeometry(1);
  if (sideCount === 6) return new THREE.BoxGeometry(1.35, 1.35, 1.35);
  if (sideCount === 8) return new THREE.OctahedronGeometry(1);
  if (sideCount === 12) return new THREE.DodecahedronGeometry(1);
  if (sideCount === 20) return new THREE.IcosahedronGeometry(1);
  return new THREE.CylinderGeometry(0.9, 0.9, 1.1, Math.min(sideCount, 64));
}
