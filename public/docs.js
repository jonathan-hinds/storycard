import { StorycardDiceApi, mountSingleDieDemo } from '/packages/storycard-dice/browser.js';

const mount = document.getElementById('api-doc-demo');
const api = new StorycardDiceApi('');

mountSingleDieDemo({ mount, api, sides: 6 }).catch((error) => {
  mount.textContent = error.message;
});
