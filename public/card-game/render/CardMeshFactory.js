import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';

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

export class CardMeshFactory {
  static createCard({
    id,
    width = 1.8,
    height = 2.5,
    thickness = 0.06,
    cornerRadius = 0.16,
    color = 0x4f8ef7,
    faceTexture = null,
  } = {}) {
    const root = new THREE.Group();
    const tiltPivot = new THREE.Group();
    const dragPivot = new THREE.Group();

    root.userData.cardId = id;
    root.name = `card-root-${id ?? 'unknown'}`;
    tiltPivot.name = `card-tilt-${id ?? 'unknown'}`;
    dragPivot.name = `card-drag-${id ?? 'unknown'}`;

    const roundedShape = createRoundedRectShape(width, height, cornerRadius);
    const geometry = new THREE.ExtrudeGeometry(roundedShape, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 12,
      steps: 1,
    });

    geometry.center();

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      metalness: 0.08,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cardRoot = root;

    dragPivot.add(mesh);
    tiltPivot.add(dragPivot);
    root.add(tiltPivot);

    root.userData.tiltPivot = tiltPivot;
    root.userData.dragPivot = dragPivot;
    root.userData.mesh = mesh;
    root.userData.params = { width, height, thickness, cornerRadius };

    if (faceTexture) {
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.96, height * 0.96),
        new THREE.MeshStandardMaterial({
          map: faceTexture,
          transparent: true,
          roughness: 0.48,
          metalness: 0.08,
        }),
      );
      face.position.set(0, 0, (thickness / 2) + 0.002);
      face.userData.cardRoot = root;
      dragPivot.add(face);
      root.userData.face = face;
    }

    return root;
  }
}
