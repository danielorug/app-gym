import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatClock } from '../lib/dates';
import { IconTimer, IconX } from './icons';
import { getPrefs } from './prefs';

// Temporizador de descanso. Se guarda la hora de término (no un contador),
// así sigue siendo correcto aunque el iPhone pause la app en segundo plano.
interface RestState {
  endsAt: number;
  total: number;
  label: string;
}

const KEY = 'app-gym:rest';
let state: RestState | null = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as RestState) : null;
    return s && s.endsAt > Date.now() - 60_000 ? s : null;
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();
let audio: AudioContext | null = null;
let beeped = false;

function emit() {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento */
  }
  listeners.forEach((l) => l());
}

/**
 * iOS solo deja activar el sonido dentro del toque mismo (antes de cualquier `await`).
 * Llamar al inicio del manejador del clic; después ya se puede sonar en cualquier momento.
 */
export function primeAudio() {
  if (!getPrefs().restSound) return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}

export function startRest(label: string, seconds = getPrefs().restSeconds) {
  primeAudio();
  beeped = false;
  state = { endsAt: Date.now() + seconds * 1000, total: seconds, label };
  emit();
}

export function adjustRest(deltaSeconds: number) {
  if (!state) return;
  state = { ...state, endsAt: state.endsAt + deltaSeconds * 1000, total: Math.max(15, state.total + deltaSeconds) };
  if (state.endsAt > Date.now()) beeped = false;
  emit();
}

export function stopRest() {
  state = null;
  emit();
}

export function useRest(): RestState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

function beep() {
  if (!audio || !getPrefs().restSound) return;
  const t = audio.currentTime;
  [0, 0.25, 0.5].forEach((offset) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, t + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.2);
  });
}

export function RestBar() {
  const rest = useRest();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!rest) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [rest]);

  const remaining = rest ? (rest.endsAt - now) / 1000 : 0;
  const finished = !!rest && remaining <= 0;

  useEffect(() => {
    if (finished && !beeped) {
      beeped = true;
      beep();
      navigator.vibrate?.([200, 100, 200]);
    }
    // Se oculta solo un rato después de terminar.
    if (finished && remaining < -45) stopRest();
  }, [finished, remaining]);

  if (!rest) return null;
  const pct = Math.min(100, Math.max(0, (1 - remaining / rest.total) * 100));
  return (
    <div className={`rest-bar${finished ? ' finished' : ''}`} role="timer" aria-live="polite">
      <IconTimer size={20} style={{ color: finished ? 'var(--good)' : 'var(--accent)', flex: 'none' }} />
      <div className="rest-time">{finished ? '¡Va!' : formatClock(Math.ceil(remaining))}</div>
      <div className="grow small muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {finished ? 'Siguiente serie' : rest.label}
      </div>
      {!finished && (
        <>
          <button className="btn small" onClick={() => adjustRest(-15)} aria-label="Quitar 15 segundos">
            −15
          </button>
          <button className="btn small" onClick={() => adjustRest(15)} aria-label="Agregar 15 segundos">
            +15
          </button>
        </>
      )}
      <button className="icon-btn" onClick={stopRest} aria-label="Cerrar temporizador">
        <IconX size={18} />
      </button>
      <div className="progress" style={{ width: `${pct}%` }} />
    </div>
  );
}
