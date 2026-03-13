import { ProfilePanelScene } from './ProfilePanelScene.js';

const USER_SESSION_KEY = 'storycard-user-session';

const canvas = document.getElementById('profile-sandbox-canvas');
const usernameInput = document.getElementById('profile-sandbox-username');
const passwordInput = document.getElementById('profile-sandbox-password');
const signInBtn = document.getElementById('profile-sandbox-sign-in');
const signOutBtn = document.getElementById('profile-sandbox-sign-out');
const authStatus = document.getElementById('profile-sandbox-auth-status');

const scene = new ProfilePanelScene({
  canvas,
});

const guestProfile = {
  username: 'Guest User',
  metrics: [
    { name: 'Total Games Played', value: 0 },
    { name: 'Total Games Won', value: 0 },
    { name: 'Total Games Lost', value: 0 },
    { name: 'Creatures Killed', value: 0 },
    { name: 'Creatures Lost', value: 0 },
    { name: 'Spells Played', value: 0 },
  ],
};

function setStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.dataset.error = isError ? 'true' : 'false';
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch (error) {
    return null;
  }
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function saveUserSession(user) {
  const serialized = JSON.stringify({ user });
  const sessionStorageRef = getSessionStorage();
  if (sessionStorageRef) {
    sessionStorageRef.setItem(USER_SESSION_KEY, serialized);
  }

  const localStorageRef = getLocalStorage();
  if (localStorageRef) {
    localStorageRef.removeItem(USER_SESSION_KEY);
  }
}

function clearUserSession() {
  const sessionStorageRef = getSessionStorage();
  if (sessionStorageRef) {
    sessionStorageRef.removeItem(USER_SESSION_KEY);
  }

  const localStorageRef = getLocalStorage();
  if (localStorageRef) {
    localStorageRef.removeItem(USER_SESSION_KEY);
  }
}

function normalizeMetrics(user) {
  const metrics = user?.metrics || {};
  const totalGamesPlayed = Number.isFinite(Number(metrics.totalGamesPlayed)) ? Number(metrics.totalGamesPlayed) : 0;
  const totalWins = Number.isFinite(Number(metrics.totalWins)) ? Number(metrics.totalWins) : 0;
  const totalLosses = Number.isFinite(Number(metrics.totalLosses)) ? Number(metrics.totalLosses) : 0;
  const totalCreaturesKilled = Number.isFinite(Number(metrics.totalCreaturesKilled)) ? Number(metrics.totalCreaturesKilled) : 0;
  const totalCreaturesLost = Number.isFinite(Number(metrics.totalCreaturesLost)) ? Number(metrics.totalCreaturesLost) : 0;
  const totalSpellsPlayed = Number.isFinite(Number(metrics.totalSpellsPlayed)) ? Number(metrics.totalSpellsPlayed) : 0;
  return [
    { name: 'Total Games Played', value: totalGamesPlayed },
    { name: 'Total Games Won', value: totalWins },
    { name: 'Total Games Lost', value: totalLosses },
    { name: 'Creatures Killed', value: totalCreaturesKilled },
    { name: 'Creatures Lost', value: totalCreaturesLost },
    { name: 'Spells Played', value: totalSpellsPlayed },
  ];
}

function setSignedInUser(user) {
  scene.setProfile({
    username: user.username,
    metrics: normalizeMetrics(user),
  });
  setStatus(`Signed in as ${user.username}`);
}

function setSignedOutUser() {
  scene.setProfile(guestProfile);
  setStatus('No user signed in.');
}

async function signIn() {
  const username = String(usernameInput.value || '').trim();
  const password = String(passwordInput.value || '');
  if (!username || !password) {
    setStatus('Username and password are required.', true);
    return;
  }

  signInBtn.disabled = true;
  signOutBtn.disabled = true;
  setStatus('Signing in...');

  try {
    const response = await fetch('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to sign in');
    }

    saveUserSession(payload.user);
    setSignedInUser(payload.user);
  } catch (error) {
    setStatus(error.message || 'Unable to sign in', true);
  } finally {
    signInBtn.disabled = false;
    signOutBtn.disabled = false;
  }
}

signInBtn.addEventListener('click', () => {
  signIn();
});

passwordInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  signIn();
});

signOutBtn.addEventListener('click', () => {
  clearUserSession();
  setSignedOutUser();
});

setSignedOutUser();

window.addEventListener('beforeunload', () => {
  scene.dispose();
});
