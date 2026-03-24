// ══════════════════════════════════════════
// STORE — Estado global com pub/sub
// ══════════════════════════════════════════

const state = {};
const listeners = {};

export function set(key, val) {
  state[key] = val;
  (listeners[key] || []).forEach(cb => cb(val));
}

export function get(key) {
  return state[key];
}

export function subscribe(key, cb) {
  if (!listeners[key]) listeners[key] = [];
  listeners[key].push(cb);
  // Retorna unsubscribe
  return () => {
    listeners[key] = listeners[key].filter(fn => fn !== cb);
  };
}
