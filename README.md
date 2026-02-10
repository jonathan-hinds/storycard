# Storycard Die Roller Package

## Installation

```bash
npm install
npm start
```

## Client usage

```js
import { DieRollerClient } from '/public/die-roller/index.js';

const roller = new DieRollerClient({
  container: document.getElementById('mount'),
  options: {
    onStart: (payload) => console.log('start', payload),
    onResult: (payload) => console.log('result payload', payload),
    onSettled: (payload) => console.log('settled', payload),
    onError: (err) => console.error(err),
  },
});

await roller.roll({
  dice: [{ sides: 6, id: 'd6a' }],
});

roller.destroy();
```

## Server usage

```js
const { DieRollerServer } = require('./shared/die-roller');
const server = new DieRollerServer();
const roll = server.roll({ dieId: 'abc', sides: 6, areaSize: 8, tuning: {} });
```

## Events

- `onStart`
- `onResult`
- `onSettled`
- `onError`

## Cleanup

Call `destroy()` to dispose renderer resources, remove the canvas, and stop animation.

## Deterministic harness

Use `node scripts/verify-refactor.js` to compare deterministic `simulateRoll` snapshots against the packaged server adapter.
