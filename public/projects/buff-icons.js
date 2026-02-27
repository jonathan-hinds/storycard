const formEl = document.getElementById('buff-icon-form');
const statusEl = document.getElementById('buff-icon-status');

let assets = [];
let buffIds = [];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff8a8a' : '#d8e7ff';
}

function buildAssetOptions(selectedValue = null) {
  const options = ['<option value="">None</option>'];
  assets.forEach((asset) => {
    const selected = selectedValue === asset.path ? ' selected' : '';
    options.push(`<option value="${asset.path}"${selected}>${asset.name}</option>`);
  });
  return options.join('');
}

function renderForm(buffIcons = {}) {
  formEl.innerHTML = '';

  buffIds.forEach((buffId) => {
    const label = buffId.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    const wrapper = document.createElement('div');
    wrapper.className = 'buff-icon-row';
    wrapper.innerHTML = `
      <label for="buff-icon-${buffId}">${label}</label>
      <select id="buff-icon-${buffId}" name="${buffId}">
        ${buildAssetOptions(buffIcons[buffId] || null)}
      </select>
    `;
    formEl.append(wrapper);
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.textContent = 'Save Buff Icons';
  formEl.append(saveBtn);
}

async function loadAssets() {
  const response = await fetch('/api/assets');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load assets');
  assets = Array.isArray(payload.assets) ? payload.assets : [];
}

async function loadBuffIcons() {
  const response = await fetch('/api/projects/buff-icons');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load buff icon settings');
  buffIds = Array.isArray(payload.buffIds) ? payload.buffIds : [];
  renderForm(payload.buffIcons || {});
}

async function saveBuffIcons(event) {
  event.preventDefault();
  const formData = new FormData(formEl);
  const buffIcons = {};
  buffIds.forEach((buffId) => {
    const value = formData.get(buffId);
    buffIcons[buffId] = typeof value === 'string' && value.trim() ? value : null;
  });

  const response = await fetch('/api/projects/buff-icons', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buffIcons }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to save buff icon settings');
  setStatus('Buff icon settings saved.');
  renderForm(payload.buffIcons || {});
}

async function init() {
  try {
    await loadAssets();
    await loadBuffIcons();
    formEl.addEventListener('submit', (event) => {
      saveBuffIcons(event).catch((error) => setStatus(error.message, true));
    });
    setStatus('Buff icon settings loaded.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

init();
