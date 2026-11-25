import { useSyncExternalStore } from 'react';

// Series "grises" (las de la vez pasada) que quitaste en un entrenamiento, por posición.
// Solo importan mientras entrenas, así que viven en este dispositivo y no se sincronizan.
const KEY = 'app-gym:skipped';
const MAX_KEYS = 200;

let data: Record<string, number[]> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number[]>;
  } catch {
    return {};
  }
})();
const listeners = new Set<() => void>();
const EMPTY: number[] = [];

function emit() {
  const keys = Object.keys(data);
  if (keys.length > MAX_KEYS) for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete data[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* sin almacenamiento: dura mientras la app esté abierta */
  }
  listeners.forEach((l) => l());
}

/** `key` = entrada + ejercicio: si cambias de variante, la lista de la vez pasada es otra. */
export function useSkipped(key: string): number[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => data[key] ?? EMPTY,
  );
}

export function skipRef(key: string, refIndex: number) {
  const list = data[key] ?? [];
  if (list.includes(refIndex)) return;
  data = { ...data, [key]: [...list, refIndex] };
  emit();
}
