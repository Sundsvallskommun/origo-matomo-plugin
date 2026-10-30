/**
 * OpenID Connect login through origo-server (/origoserver/auth), in the same way as
 * report-issues-frontend. Origo-server holds the client secret and exchanges the code;
 * the page creates and verifies state. The token is stored in sessionStorage and is gone when the tab is closed.
 *
 * Login is configured by origo-server in config.json: auth = { url, client }, where client is
 * the page's name in origo-server's conf.auth.clients.
 */

const sessionKey = 'matomo-dashboard.oidc.session';
const pendingKey = 'matomo-dashboard.oidc.pending';
const loggedOutKey = 'matomo-dashboard.oidc.loggedOut';
const expiryMargin = 60 * 1000; // renew the token one minute before it expires
const freshLogin = 30 * 1000; // a 401 right after login must not cause a login loop

let auth = null;
let refreshing;

function authUrl(path) {
  return `${auth.url.replace(/\/$/, '')}${path}`;
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(sessionKey));
  } catch {
    return null;
  }
}

function randomString(bytes = 32) {
  const value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))));
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The user name (sub) from the id token. The token comes directly from origo-server, so it does not need to be verified here.
function subject(idToken) {
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)))).sub;
  } catch {
    return undefined;
  }
}

// Origo-server responds with { access_token, refresh_token, id_token, expires_at, displayname }
async function tokenRequest(params) {
  let response;
  try {
    response = await fetch(authUrl('/access_token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
  } catch {
    throw new Error('Kunde inte nå inloggningstjänsten.');
  }
  if (!response.ok) throw new Error(`Inloggningen misslyckades (HTTP ${response.status}).`);
  return response.json();
}

function saveSession(tokens, previous = {}) {
  const session = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || previous.refreshToken,
    idToken: tokens.id_token || previous.idToken,
    username: (tokens.id_token && subject(tokens.id_token)) || previous.username,
    displayName: tokens.displayname || previous.displayName,
    expiresAt: tokens.expires_at ? tokens.expires_at * 1000 : Date.now() + 300 * 1000,
    obtainedAt: Date.now()
  };
  sessionStorage.setItem(sessionKey, JSON.stringify(session));
  return session;
}

function refresh(session) {
  refreshing ??= tokenRequest({ refresh_token: session.refreshToken })
    .then((tokens) => saveSession(tokens, session))
    .finally(() => { refreshing = null; });
  return refreshing;
}

// Handles the redirect back from origo-server (?code=…&state=…)
async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') && !params.has('error')) return;

  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(pendingKey));
  } catch {
    // Invalid content is treated as missing
  }
  sessionStorage.removeItem(pendingKey);
  window.history.replaceState(null, '', window.location.pathname + ((pending && pending.returnTo) || ''));

  if (params.has('error')) {
    throw new Error(`Inloggningen misslyckades: ${params.get('error_description') || params.get('error')}`);
  }
  if (!pending || params.get('state') !== pending.state) {
    throw new Error('Inloggningen kunde inte verifieras. Försök igen.');
  }
  saveSession(await tokenRequest({ code: params.get('code') }));
}

export function enabled() {
  return Boolean(auth && auth.url && auth.client);
}

// Sends the user to the login. The promise never resolves since the page is left.
// state = "<client name>.<random value>": origo-server uses the client name to find its way
// back here and passes along the whole state, which is compared with the stored one.
export function login() {
  const state = `${auth.client}.${randomString()}`;
  sessionStorage.removeItem(loggedOutKey);
  sessionStorage.setItem(pendingKey, JSON.stringify({ state, returnTo: window.location.hash }));
  window.location.assign(`${authUrl('/authorize')}?${new URLSearchParams({ state })}`);
  return new Promise(() => {});
}

// Origo-server has no logout, so the session is only cleared here
export function logout() {
  sessionStorage.removeItem(sessionKey);
  sessionStorage.setItem(loggedOutKey, '1');
  window.location.assign(window.location.pathname);
}

// Runs at startup with auth from config.json. Returns { status, user } where status is
// 'disabled' (no login), 'signed-in' or 'signed-out' (the user logged out).
// If the user is not logged in, they are sent to the login.
export async function init(config) {
  auth = config || null;
  if (!enabled()) return { status: 'disabled', user: null };
  await handleCallback();
  const session = readSession();
  if (session) {
    return {
      status: 'signed-in',
      user: { username: session.username, name: session.displayName || session.username || 'Inloggad' }
    };
  }
  if (sessionStorage.getItem(loggedOutKey)) return { status: 'signed-out', user: null };
  return login();
}

// A valid access token, renewed when needed. Returns null when login is disabled.
export async function getAccessToken() {
  if (!enabled()) return null;
  const session = readSession();
  if (session && session.expiresAt - expiryMargin > Date.now()) return session.accessToken;
  if (session && session.refreshToken) {
    try {
      return (await refresh(session)).accessToken;
    } catch {
      // Invalid refresh token, log in again
    }
  }
  return login();
}

// Called when the API has responded 401. Returns a new token to retry with,
// or null if the user just logged in (then it is permission, not login, that is missing).
export async function renewAfterUnauthorized() {
  if (!enabled()) return null;
  const session = readSession();
  if (session && Date.now() - session.obtainedAt < freshLogin) return null;
  if (session && session.refreshToken) {
    try {
      return (await refresh(session)).accessToken;
    } catch {
      // Falls through to a new login
    }
  }
  sessionStorage.removeItem(sessionKey);
  return login();
}
