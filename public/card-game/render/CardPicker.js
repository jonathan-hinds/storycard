import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js?module';

export class CardPicker {
  constructor({ camera, domElement, cards = [] }) {
    this.camera = camera;
    this.domElement = domElement;
    this.cards = cards;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
  }

  setCards(cards) {
    this.cards = cards;
  }

  pickHit(pointerEvent) {
    if (!this.cards.length) {
      return null;
    }

    const { clientX, clientY } = this.#extractClientPoint(pointerEvent);
    if (typeof clientX !== 'number' || typeof clientY !== 'number') {
      return null;
    }

    const rect = this.domElement.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.ndc, this.camera);

    const targets = this.cards
      .flatMap((card) => [card.userData?.face, card.userData?.mesh])
      .filter((mesh) => mesh && mesh.visible);

    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;

    const firstHit = hits[0];
    return {
      card: firstHit.object?.userData?.cardRoot ?? null,
      hitObject: firstHit.object ?? null,
      uv: firstHit.uv ?? null,
    };
  }

  pick(pointerEvent) {
    return this.pickHit(pointerEvent)?.card ?? null;
  }

  #extractClientPoint(pointerEvent) {
    if (pointerEvent.changedTouches?.length) {
      return pointerEvent.changedTouches[0];
    }

    if (pointerEvent.touches?.length) {
      return pointerEvent.touches[0];
    }

    return pointerEvent;
  }
}
