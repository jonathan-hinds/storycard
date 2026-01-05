const statusPanel = document.getElementById('status-panel');
const instructionsPanel = document.getElementById('instructions-panel');
const instructionsContent = document.getElementById('instructions-content');
const buttons = document.querySelectorAll('.button');

let instructionsLoaded = false;

function setStatus(message) {
  statusPanel.textContent = message;
}

async function loadInstructions() {
  if (instructionsLoaded) {
    instructionsPanel.hidden = false;
    return;
  }

  setStatus('Loading rulebook...');
  try {
    const response = await fetch('/api/instructions');
    if (!response.ok) {
      throw new Error('Failed to load instructions');
    }
    const data = await response.json();
    instructionsContent.textContent = data.instructions;
    instructionsPanel.hidden = false;
    instructionsLoaded = true;
    setStatus('Ready to play.');
  } catch (error) {
    setStatus('Could not load instructions.');
    instructionsContent.textContent = 'Error loading instructions. Please try again later.';
    instructionsPanel.hidden = false;
  }
}

function handleAction(action) {
  switch (action) {
    case 'play':
      setStatus('Play mode coming soon.');
      break;
    case 'packs':
      setStatus('Packs browser coming soon.');
      break;
    case 'instructions':
      loadInstructions();
      break;
    case 'close':
      instructionsPanel.hidden = true;
      setStatus('Closed the rulebook.');
      break;
    default:
      setStatus('Ready to play.');
  }
}

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.getAttribute('data-action');
    handleAction(action);
  });
});

setStatus('Ready to play.');
