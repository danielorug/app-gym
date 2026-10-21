import { useSyncExternalStore } from 'react';

// Preferencias de este dispositivo (no se sincronizan).
export interface Prefs {
  restSeconds: number;
  restSound: boolean;
  keepAwake: boolean;
}

const KEY = 'app-gym:prefs';
const DEFAULTS: Prefs = { restSeconds: 180, restSound: true, keepAwake: true };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let prefs = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* almacenamiento bloqueado: solo dura esta sesión */
  }
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => prefs,
  );
}
