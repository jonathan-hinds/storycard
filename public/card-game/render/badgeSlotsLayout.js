import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

const BADGE_SLOT_REFERENCE_CARD = Object.freeze({
  width: 3.06,
  height: 4.25,
  thickness: 0.08,
});


function remapGeometryUvToBounds(geometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return;

  const size = new THREE.Vector3();
  bounds.getSize(size);
  const rangeX = size.x || 1;
  const rangeY = size.y || 1;

  const positions = geometry.attributes.position;
  const uv = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    uv[(index * 2)] = (x - bounds.min.x) / rangeX;
    uv[(index * 2) + 1] = (y - bounds.min.y) / rangeY;
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

function createRoundedRectShape(width, height, radius) {
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(radius, halfW, halfH);
  const shape = new THREE.Shape();

  shape.moveTo(-halfW + r, -halfH);
  shape.lineTo(halfW - r, -halfH);
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
  shape.lineTo(halfW, halfH - r);
  shape.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
  shape.lineTo(-halfW + r, halfH);
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
  shape.lineTo(-halfW, -halfH + r);
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);

  return shape;
}

export function normalizeBadgeSlotsLayout(layout, fallback = {}) {
  return {
    visible: typeof layout?.visible === 'boolean' ? layout.visible : (typeof fallback?.visible === 'boolean' ? fallback.visible : true),
    count: Number.isFinite(layout?.count)
      ? THREE.MathUtils.clamp(Math.round(layout.count), 1, 12)
      : (Number.isFinite(fallback?.count) ? THREE.MathUtils.clamp(Math.round(fallback.count), 1, 12) : 1),
    x: Number.isFinite(layout?.x) ? layout.x : (Number.isFinite(fallback?.x) ? fallback.x : 0),
    y: Number.isFinite(layout?.y) ? layout.y : (Number.isFinite(fallback?.y) ? fallback.y : 0),
    z: Number.isFinite(layout?.z) ? layout.z : (Number.isFinite(fallback?.z) ? fallback.z : 0),
    gap: Number.isFinite(layout?.gap) ? Math.max(0, layout.gap) : (Number.isFinite(fallback?.gap) ? Math.max(0, fallback.gap) : 0),
    size: Number.isFinite(layout?.size) ? Math.max(0.04, layout.size) : (Number.isFinite(fallback?.size) ? Math.max(0.04, fallback.size) : 0.18),
    bevel: Number.isFinite(layout?.bevel) ? Math.max(0, layout.bevel) : (Number.isFinite(fallback?.bevel) ? Math.max(0, fallback.bevel) : 0.03),
    thickness: Number.isFinite(layout?.thickness)
      ? Math.max(0.005, layout.thickness)
      : (Number.isFinite(fallback?.thickness) ? Math.max(0.005, fallback.thickness) : 0.02),
  };
}

export function createBadgeSlotGeometry(layout) {
  const roundedShape = createRoundedRectShape(layout.size, layout.size, layout.bevel);
  const geometry = new THREE.ExtrudeGeometry(roundedShape, {
    depth: layout.thickness,
    bevelEnabled: false,
    curveSegments: 8,
    steps: 1,
  });
  geometry.center();
  remapGeometryUvToBounds(geometry);
  return geometry;
}

export function resolveBadgeSlotsCardLayout(layout, cardMetrics = {}) {
  const referenceWidth = Number.isFinite(cardMetrics.referenceWidth)
    ? Math.max(cardMetrics.referenceWidth, 0.001)
    : BADGE_SLOT_REFERENCE_CARD.width;
  const referenceHeight = Number.isFinite(cardMetrics.referenceHeight)
    ? Math.max(cardMetrics.referenceHeight, 0.001)
    : BADGE_SLOT_REFERENCE_CARD.height;
  const referenceThickness = Number.isFinite(cardMetrics.referenceThickness)
    ? Math.max(cardMetrics.referenceThickness, 0.001)
    : BADGE_SLOT_REFERENCE_CARD.thickness;
  const cardWidth = Number.isFinite(cardMetrics.width) ? Math.max(cardMetrics.width, 0.001) : referenceWidth;
  const cardHeight = Number.isFinite(cardMetrics.height) ? Math.max(cardMetrics.height, 0.001) : referenceHeight;
  const cardThickness = Number.isFinite(cardMetrics.thickness) ? Math.max(cardMetrics.thickness, 0.001) : referenceThickness;

  const widthScale = cardWidth / referenceWidth;
  const heightScale = cardHeight / referenceHeight;
  const depthScale = cardThickness / referenceThickness;
  const planarScale = Math.min(widthScale, heightScale);

  return {
    ...layout,
    x: layout.x * widthScale,
    y: layout.y * heightScale,
    z: layout.z * depthScale,
    gap: layout.gap * planarScale,
    size: layout.size * planarScale,
    bevel: layout.bevel * planarScale,
    thickness: layout.thickness * depthScale,
  };
}

export function createBadgeSlotsGroup(layout, createMaterial, cardMetrics = {}) {
  const cardLayout = resolveBadgeSlotsCardLayout(layout, cardMetrics);
  const badgeRoot = new THREE.Group();
  const spacing = cardLayout.size + cardLayout.gap;
  const totalHeight = (cardLayout.count - 1) * spacing;
  const badgeGeometry = createBadgeSlotGeometry(cardLayout);
  const badges = [];

  for (let badgeIndex = 0; badgeIndex < cardLayout.count; badgeIndex += 1) {
    const badgeMesh = new THREE.Mesh(badgeGeometry.clone(), createMaterial());
    badgeMesh.position.set(0, (totalHeight / 2) - badgeIndex * spacing, 0);
    badgeMesh.castShadow = true;
    badgeMesh.receiveShadow = true;
    badgeRoot.add(badgeMesh);
    badges.push(badgeMesh);
  }

  badgeRoot.position.set(cardLayout.x, cardLayout.y, cardLayout.z);
  badgeRoot.visible = cardLayout.visible;

  return { badgeRoot, badges };
}
