/** Thin promise wrapper over chrome.storage.local. */

export async function get(key, fallback = null) {
  const data = await chrome.storage.local.get(key);
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
}

export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function remove(key) {
  await chrome.storage.local.remove(key);
}
