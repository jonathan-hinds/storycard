# storycard-dice package

## Server usage

```js
const { createDiceApi } = require('./packages/storycard-dice/serverApi');
const diceApi = createDiceApi();
```

Use `diceApi.createDie`, `diceApi.listDice`, `diceApi.getDie`, and `diceApi.rollDie` inside your route handlers.

## Browser usage

```js
import { StorycardDiceApi, mountSingleDieDemo } from '/packages/storycard-dice/browser.js';

const api = new StorycardDiceApi('');
await mountSingleDieDemo({ mount: document.getElementById('api-doc-demo'), api, sides: 6 });
```

See `/public/docs.html` for full end-to-end setup and live API demo.
