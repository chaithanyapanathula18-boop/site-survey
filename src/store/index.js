// The store the app is currently using: on-device, or the signed-in cloud account.
import { localStore } from './local.js';

let active = localStore;
let unsubscribe = active.subscribe(() => emit());
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

export const stores = {
  get active() {
    return active;
  },
  get local() {
    return localStore;
  },
  setActive(store) {
    if (store === active) return;
    if (unsubscribe) unsubscribe();
    if (active && active !== localStore && active.close) active.close();
    active = store;
    unsubscribe = active.subscribe(() => emit());
    emit();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
