/**
 * Shared constants used by BOTH the side panel and the background service worker.
 * Keep this file dependency-free.
 */

/** Message types for chrome.runtime messaging. */
export const MSG = Object.freeze({
  HTTP_SEND: 'http.send',

  ENV_LIST: 'env.list',
  ENV_SAVE: 'env.save',
  ENV_DELETE: 'env.delete',
  ENV_ACTIVE_GET: 'env.active.get',
  ENV_ACTIVE_SET: 'env.active.set',

  AUTH_SIGNIN: 'auth.signin',
  AUTH_TOKEN: 'auth.token',
  AUTH_STATUS: 'auth.status',
  AUTH_INSPECT: 'auth.inspect',
});

/** Authentication modes supported per environment. */
export const AUTH_MODES = Object.freeze({
  SESSION: 'session', // reuse the signed-in browser session (zero config)
  INTERACTIVE: 'interactive', // Entra ID auth-code + PKCE (no client secret)
  CLIENT: 'clientCredentials', // Entra ID app-only (client secret)
  MANUAL: 'manual', // user pasted bearer token
});

/** chrome.storage.local keys. */
export const STORAGE = Object.freeze({
  // Background-owned (the side panel must NOT read these directly — secrets live here).
  ENVS: 'envs',
  ACTIVE: 'activeEnvId',
  TOKENS: 'tokens',
  // Panel-owned (no secrets required to render; user variables may be flagged secret).
  GLOBALS: 'globals',
  COLLECTIONS: 'collections',
  HISTORY: 'history',
  SETTINGS: 'settings',
  META_CACHE: 'metaCache',
  // The in-progress request, so reopening the panel picks up where you left off.
  DRAFT: 'draft',
});

export const DEFAULT_SETTINGS = Object.freeze({
  timeoutMs: 30000,
  maxHistory: 100,
});

export const APP = Object.freeze({
  VERSION: '0.1.0',
  STORAGE_FORMAT: 1,
});
