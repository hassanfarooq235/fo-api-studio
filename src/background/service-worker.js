/**
 * Background service worker: the only code with access to secrets.
 * It exposes a tiny message API to the side panel.
 */

import { MSG } from '../shared/constants.js';
import { toErrorPayload, err } from '../shared/errors.js';
import { sendRequest } from './http.js';
import * as envs from './envs.js';
import { getToken, status, inspect } from './auth.js';

// Open the side panel when the toolbar icon is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function requireEnv(id) {
  const env = id ? await envs.getRaw(id) : null;
  if (!env) throw err('input', 'No environment selected. Pick one in the toolbar or create it in Environments.');
  return env;
}

async function route(msg = {}) {
  const p = msg.payload || {};

  switch (msg.type) {
    case MSG.HTTP_SEND:
      return sendRequest(p);

    case MSG.ENV_LIST:
      return { ok: true, envs: await envs.list(), activeEnvId: await envs.getActiveId() };

    case MSG.ENV_SAVE:
      return { ok: true, env: await envs.save(p) };

    case MSG.ENV_DELETE:
      await envs.remove(p.id);
      return { ok: true };

    case MSG.ENV_ACTIVE_GET:
      return { ok: true, activeEnvId: await envs.getActiveId() };

    case MSG.ENV_ACTIVE_SET:
      await envs.setActiveId(p.id);
      return { ok: true };

    case MSG.AUTH_SIGNIN: {
      const env = await requireEnv(p.id);
      await getToken(env, { force: true });
      return { ok: true, status: await status(env) };
    }

    case MSG.AUTH_TOKEN: {
      const env = await requireEnv(p.id);
      const token = await getToken(env, { force: Boolean(p.force) });
      if (p.reveal) return { ok: true, token };
      const st = await status(env);
      return { ok: true, status: st, note: 'Token fetched and cached in the background process.' };
    }

    case MSG.AUTH_STATUS: {
      const env = await requireEnv(p.id);
      return { ok: true, status: await status(env) };
    }

    case MSG.AUTH_INSPECT: {
      const env = await requireEnv(p.id);
      return { ok: true, ...(await inspect(env)) };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  route(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: toErrorPayload(e) }));
  return true; // keep the channel open for async work
});
