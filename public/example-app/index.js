import { DieRollerClient } from '../die-roller/index.js';

const mount = document.getElementById('example-mount');
const button = document.getElementById('example-roll');
const output = document.getElementById('example-output');

const roller = new DieRollerClient({
  container: mount,
  options: {
    onSettled: ({ value }) => {
      output.textContent = `Settled: ${value}`;
    },
  },
});

button.addEventListener('click', () => {
  roller.roll({ dice: [{ sides: 6, id: 'example-d6' }] });
});
