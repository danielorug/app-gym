import { useSyncExternalStore } from 'react';
import { todayISO } from '../lib/dates';

// Preferencias de este dispositivo (no se sincronizan).
export interface Prefs {
  restSeconds: number;
  /** Sonido al terminar el descanso, por defecto (lo que aplica si hoy no lo cambiaste). */
  restSound: boolean;
  /** Cambio solo por un día (ej. hoy traes audífonos): vuelve al valor por defecto al día siguiente. */
  soundDay: { date: string; on: boolean } | null;
  /** Sonar aunque el iPhone esté en silencio. */
  forceSound: boolean;
  keepAwake: boolean;
}

const KEY = 'app-gym:prefs';
const DEFAULTS: Prefs = { restSeconds: 180, restSound: true, soundDay: null, forceSound: true, keepAwake: true };

/** ¿Suena el descanso hoy? */
export function restSoundOn(p: Prefs = prefs): boolean {
  return p.soundDay && p.soundDay.date === todayISO() ? p.soundDay.on : p.restSound;
}

export function setRestSoundToday(on: boolean) {
  setPrefs({ soundDay: { date: todayISO(), on } });
}

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
