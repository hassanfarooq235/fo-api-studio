/** Messaging helper: every call resolves to {ok, ...} or {ok:false, error}. */

import { MSG } from '../../shared/constants.js';

export async function call(type, payload = {}) {
  try {
    const res = await chrome.runtime.sendMessage({ type, payload });
    return (
      res || {
        ok: false,
        error: { kind: 'internal', message: 'No response from the background process.' },
      }
    );
  } catch (e) {
    return { ok: false, error: { kind: 'internal', message: String(e?.message || e) } };
  }
}

export const httpSend = (spec) => call(MSG.HTTP_SEND, spec);

export const envs = {
  list: () => call(MSG.ENV_LIST),
  save: (env) => call(MSG.ENV_SAVE, env),
  remove: (id) => call(MSG.ENV_DELETE, { id }),
  setActive: (id) => call(MSG.ENV_ACTIVE_SET, { id }),
};

export const auth = {
  signIn: (id) => call(MSG.AUTH_SIGNIN, { id }),
  token: (id, { force = false, reveal = false } = {}) => call(MSG.AUTH_TOKEN, { id, force, reveal }),
  status: (id) => call(MSG.AUTH_STATUS, { id }),
  inspect: (id) => call(MSG.AUTH_INSPECT, { id }),
};
