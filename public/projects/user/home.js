const USER_SESSION_KEY = 'storycard-user-session';

const decksButton = document.getElementById('decks-button');
const welcomeTitle = document.getElementById('welcome-title');

function loadSession() {
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.username) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

const session = loadSession();
if (!session) {
  window.location.replace('/public/projects/user/index.html');
} else {
  welcomeTitle.textContent = `Welcome, ${session.user.username}`;
}

decksButton.addEventListener('click', () => {
  window.location.href = '/public/projects/user/decks.html';
});
