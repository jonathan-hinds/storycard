import { initDiceModule } from '/public/dice-module.js';

const setupSnippet = `// server.js
node server.js

// index.html
<script type="module">
  import { initDiceModule } from '/public/dice-module.js';
  const module = initDiceModule({
    dieList: document.getElementById('die-list'),
    includeTemplateDownload: false,
  });

  await module.createDie(6); // D6
  await module.refreshDice();
</script>`;

const rollSnippet = `const dieId = selectedDieId;
const result = await module.rollDie(dieId);
console.log('rolled value', result?.roll?.outcome);`;

const saveSnippet = `const history = JSON.parse(localStorage.getItem('dice-rolls') || '[]');
history.push({ dieId, value: roll.outcome, createdAt: roll.createdAt });
localStorage.setItem('dice-rolls', JSON.stringify(history));`;

const gameSnippet = `const [p1, p2] = await Promise.all([
  module.createDie(6),
  module.createDie(6),
]);
const r1 = await module.rollDie(playerOneId);
const r2 = await module.rollDie(playerTwoId);
const winner = r1.roll.outcome === r2.roll.outcome ? 'Tie' : (r1.roll.outcome > r2.roll.outcome ? 'Player 1' : 'Player 2');`;

document.getElementById('setup-snippet').textContent = setupSnippet;
document.getElementById('roll-snippet').textContent = rollSnippet;
document.getElementById('save-snippet').textContent = saveSnippet;
document.getElementById('game-snippet').textContent = gameSnippet;

let latestRoll = null;
let gameDice = { p1: null, p2: null };

const module = initDiceModule({
  dieList: document.getElementById('die-list'),
  includeTemplateDownload: false,
  onRollFinished: ({ dieId, roll }) => {
    latestRoll = { dieId, ...roll };
  },
});

async function getDice() {
  const response = await fetch('/api/dice');
  const data = await response.json();
  return data.dice || [];
}

async function syncDieSelect() {
  const select = document.getElementById('roll-die-id');
  const dice = await getDice();
  select.innerHTML = '';
  for (const die of dice) {
    const option = document.createElement('option');
    option.value = die.id;
    option.textContent = `${die.id.slice(0, 8)}... (D${die.sides})`;
    select.append(option);
  }
}

document.getElementById('create-starter').addEventListener('click', async () => {
  const existing = await getDice();
  if (existing.length === 0) {
    for (const sides of [6, 8, 12, 20]) {
      await module.createDie(sides);
    }
  }
  await module.refreshDice();
  await syncDieSelect();
});

document.getElementById('roll-selected').addEventListener('click', async () => {
  const dieId = document.getElementById('roll-die-id').value;
  if (!dieId) return;
  await module.rollDie(dieId);
  await module.refreshDice();
  document.getElementById('roll-result').textContent = latestRoll
    ? `Die ${dieId.slice(0, 8)} rolled ${latestRoll.outcome}`
    : 'Roll complete';
});

document.getElementById('save-latest').addEventListener('click', () => {
  if (!latestRoll) {
    document.getElementById('save-status').textContent = 'Roll a die first.';
    return;
  }
  const history = JSON.parse(localStorage.getItem('dice-rolls') || '[]');
  history.push({ dieId: latestRoll.dieId, value: latestRoll.outcome, createdAt: latestRoll.createdAt });
  localStorage.setItem('dice-rolls', JSON.stringify(history));
  document.getElementById('saved-json').textContent = JSON.stringify(history, null, 2);
  document.getElementById('save-status').textContent = `Saved ${history.length} roll entries.`;
});

document.getElementById('start-game').addEventListener('click', async () => {
  await module.createDie(6);
  await module.createDie(6);
  const dice = await getDice();
  const d6 = dice.filter((die) => die.sides === 6).slice(-2);
  if (d6.length === 2) {
    gameDice = { p1: d6[0].id, p2: d6[1].id };
  }
  await module.refreshDice();
  await syncDieSelect();
  document.getElementById('game-result').textContent = 'Player dice ready. Click play round.';
});

document.getElementById('play-round').addEventListener('click', async () => {
  if (!gameDice.p1 || !gameDice.p2) {
    document.getElementById('game-result').textContent = 'Setup player dice first.';
    return;
  }
  await module.rollDie(gameDice.p1);
  const r1 = latestRoll?.outcome;
  await module.rollDie(gameDice.p2);
  const r2 = latestRoll?.outcome;
  await module.refreshDice();

  let winner = 'Tie';
  if (r1 > r2) winner = 'Player 1';
  if (r2 > r1) winner = 'Player 2';
  document.getElementById('game-result').textContent = `Player 1: ${r1} vs Player 2: ${r2} → ${winner}`;
});

await module.refreshDice();
await syncDieSelect();
