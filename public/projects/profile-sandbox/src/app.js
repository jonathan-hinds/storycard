import { ProfilePanelScene } from './ProfilePanelScene.js';

const TEST_USERS = [
  {
    id: 'user-rhea',
    username: 'Rhea_Grid',
    metrics: [
      { name: 'Total Games Played', value: 212 },
      { name: 'Total Games Won', value: 137 },
      { name: 'Win Rate Percentage', value: 65 },
      { name: 'Current Ranked Tier', value: 4 },
      { name: 'Longest Win Streak', value: 11 },
      { name: 'Total Cards Collected', value: 489 },
    ],
  },
  {
    id: 'user-kell',
    username: 'Kell_Byte',
    metrics: [
      { name: 'Total Games Played', value: 88 },
      { name: 'Total Games Won', value: 41 },
      { name: 'Win Rate Percentage', value: 47 },
      { name: 'Current Ranked Tier', value: 7 },
      { name: 'Longest Win Streak', value: 5 },
      { name: 'Total Cards Collected', value: 224 },
    ],
  },
  {
    id: 'user-mira',
    username: 'Mira_Zero',
    metrics: [
      { name: 'Total Games Played', value: 342 },
      { name: 'Total Games Won', value: 198 },
      { name: 'Win Rate Percentage', value: 58 },
      { name: 'Current Ranked Tier', value: 2 },
      { name: 'Longest Win Streak', value: 17 },
      { name: 'Total Cards Collected', value: 621 },
    ],
  },
];

const canvas = document.getElementById('profile-sandbox-canvas');
const userSelect = document.getElementById('profile-sandbox-user-select');
const signInBtn = document.getElementById('profile-sandbox-sign-in');
const signOutBtn = document.getElementById('profile-sandbox-sign-out');
const authStatus = document.getElementById('profile-sandbox-auth-status');

const scene = new ProfilePanelScene({
  canvas,
});

function updateAuthStatus(user) {
  authStatus.textContent = user
    ? `Signed in as ${user.username}`
    : 'No user signed in.';
}

function setSignedInUser(user) {
  scene.setProfile(user);
  updateAuthStatus(user);
}

function initializeUserPicker() {
  TEST_USERS.forEach((user) => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.username;
    userSelect.append(option);
  });
}

function getSelectedUser() {
  return TEST_USERS.find((user) => user.id === userSelect.value) || null;
}

initializeUserPicker();
setSignedInUser(getSelectedUser() || TEST_USERS[0]);

signInBtn.addEventListener('click', () => {
  const selectedUser = getSelectedUser();
  if (!selectedUser) return;
  setSignedInUser(selectedUser);
});

signOutBtn.addEventListener('click', () => {
  scene.setProfile({
    username: 'Guest User',
    metrics: [
      { name: 'Total Games Played', value: 0 },
      { name: 'Total Games Won', value: 0 },
      { name: 'Win Rate Percentage', value: 0 },
      { name: 'Current Ranked Tier', value: 0 },
      { name: 'Longest Win Streak', value: 0 },
      { name: 'Total Cards Collected', value: 0 },
    ],
  });
  updateAuthStatus(null);
});

window.addEventListener('beforeunload', () => {
  scene.dispose();
});
