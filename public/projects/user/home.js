const USER_SESSION_KEY = 'storycard-user-session';

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

const decksButton = document.getElementById('decks-button');
const welcomeTitle = document.getElementById('welcome-title');
const findMatchButton = document.getElementById('find-match-button');
let matchmakingPollTimer = 0;

function loadSession() {
  try {
    const sessionStorageRef = getSessionStorage();
    const localStorageRef = getLocalStorage();
    const raw = sessionStorageRef?.getItem(USER_SESSION_KEY) || localStorageRef?.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.username) return null;
    if (sessionStorageRef) {
      sessionStorageRef.setItem(USER_SESSION_KEY, raw);
    }
    if (localStorageRef) {
      localStorageRef.removeItem(USER_SESSION_KEY);
    }
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

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function getJson(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function stopPolling() {
  if (!matchmakingPollTimer) return;
  window.clearInterval(matchmakingPollTimer);
  matchmakingPollTimer = 0;
}

function updateFindMatchButton(status) {
  if (status === 'searching') {
    findMatchButton.disabled = true;
    findMatchButton.textContent = 'Searching...';
    return;
  }

  findMatchButton.disabled = false;
  findMatchButton.textContent = 'Find Match';
}

async function pollMatchStatusUntilMatched() {
  if (!session?.user?.id) return;

  try {
    const status = await getJson(`/api/phase-manager/matchmaking/status?playerId=${encodeURIComponent(session.user.id)}`);
    if (status?.status === 'matched') {
      stopPolling();
      window.location.href = '/public/projects/user/match.html';
      return;
    }

    updateFindMatchButton(status?.status);
  } catch (error) {
    stopPolling();
    updateFindMatchButton('idle');
  }
}

function ensurePolling() {
  if (matchmakingPollTimer) return;
  matchmakingPollTimer = window.setInterval(() => {
    pollMatchStatusUntilMatched();
  }, 1500);
}

findMatchButton.addEventListener('click', () => {
  if (!session?.user?.id) return;

  findMatchButton.disabled = true;
  findMatchButton.textContent = 'Searching...';

  postJson('/api/phase-manager/matchmaking/find', {
    playerId: session.user.id,
    deckCardIds: Array.isArray(session.user.deck?.cards) ? session.user.deck.cards : [],
  })
    .then((status) => {
      if (status?.status === 'matched') {
        window.location.href = '/public/projects/user/match.html';
        return;
      }

      updateFindMatchButton(status?.status);
      ensurePolling();
      pollMatchStatusUntilMatched();
    })
    .catch(() => {
      updateFindMatchButton('idle');
      stopPolling();
    });
});

pollMatchStatusUntilMatched();
