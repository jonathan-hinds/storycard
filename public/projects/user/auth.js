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

const form = document.getElementById('user-auth-form');
const registerButton = document.getElementById('register-button');
const loginButton = document.getElementById('login-button');
const status = document.getElementById('user-auth-status');

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

function getCredentials() {
  const formData = new FormData(form);
  return {
    username: formData.get('username'),
    password: formData.get('password'),
  };
}

function setLoading(isLoading) {
  registerButton.disabled = isLoading;
  loginButton.disabled = isLoading;
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

async function submitAuth(url) {
  setLoading(true);
  setStatus('Working...');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getCredentials()),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to complete request');
    }

    saveUserSession(payload.user);
    window.location.href = '/public/projects/user/home.html';
  } catch (error) {
    setStatus(error.message || 'Unable to complete request', true);
  } finally {
    setLoading(false);
  }
}

registerButton.addEventListener('click', () => {
  submitAuth('/api/users/register');
});

loginButton.addEventListener('click', () => {
  submitAuth('/api/users/login');
});
