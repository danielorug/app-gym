import { useMemo, useState } from 'react';
import { db } from '../../db/db';
import type { Routine, Session } from '../../db/types';
import { deleteSession, startSession, useExercises, useOpenSession, useReviewEntries, useRoutines, useSessionList } from '../../lib/data';
import { capitalize, formatLong, relativeDays, todayISO, WEEKDAY_NAMES, weekdayOf } from '../../lib/dates';
import { useLiveQuery } from 'dexie-react-hooks';
import { Confirm } from '../components';
import { IconChevronRight, IconWarn } from '../icons';
import { navigate } from '../router';
import { SyncPill } from '../SyncPill';

export function TodayScreen() {
  const routines = useRoutines();
  const open = useOpenSession();
  const sessions = useSessionList();
  const review = useReviewEntries();
  const today = todayISO();
  const weekday = weekdayOf(today);

  const suggested = useMemo(() => routines?.find((r) => r.weekdays.includes(weekday)) ?? null, [routines, weekday]);
  const doneToday = sessions?.find((s) => s.session.date === today && (s.session.finishedAt || s.session.source === 'notas') && s.setCount > 0);
  const lastByRoutine = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions ?? []) if (s.session.routineId && s.setCount > 0 && !map.has(s.session.routineId)) map.set(s.session.routineId, s.session.date);
    return map;
  }, [sessions]);

  const begin = async (routine: Routine | null) => navigate(`sesion/${await startSession(routine)}`);

  if (routines === undefined || open === undefined) return null;

  return (
    <div className="page" style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}>
      <div className="row">
        <div className="muted small" style={{ flex: 1 }}>
          {capitalize(formatLong(today))}
        </div>
        <SyncPill />
      </div>
      <h1 className="big-title">{open ? 'En curso' : suggested ? suggested.name : 'Hoy'}</h1>

      {review && review.length > 0 && (
        <button className="card row" style={{ width: '100%', textAlign: 'left', margin: '12px 0', borderColor: 'color-mix(in srgb, var(--warn) 40%, var(--border))' }} onClick={() => navigate('revisar')}>
          <IconWarn style={{ color: 'var(--warn)', flex: 'none' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{review.length} registros importados por revisar</div>
            <div className="muted small">Cosas de tus notas que no supe leer con seguridad</div>
          </div>
          <IconChevronRight className="chevron" />
        </button>
      )}

      {open ? (
        <OpenSessionCard session={open} />
      ) : (
        <>
          {doneToday && (
            <button className="card row" style={{ width: '100%', textAlign: 'left', marginTop: 12 }} onClick={() => navigate(`sesion/${doneToday.session.id}`)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>✓ Ya entrenaste hoy: {doneToday.session.title}</div>
                <div className="muted small">{doneToday.setCount} series</div>
              </div>
              <IconChevronRight className="chevron" />
            </button>
          )}
          {suggested ? (
            <RoutineHero routine={suggested} last={lastByRoutine.get(suggested.id)} onStart={() => begin(suggested)} />
          ) : (
            <p className="subtitle">
              {routines.length === 0 ? 'Todavía no tienes rutinas. Créalas en Más → Rutinas, o importa tu historial.' : `No tienes rutina asignada para el ${WEEKDAY_NAMES[weekday]}.`}
            </p>
          )}
        </>
      )}

      <div className="section-title">{open ? 'Otras rutinas' : suggested ? 'Hacer otra rutina' : 'Rutinas'}</div>
      <div className="list">
        {routines
          .filter((r) => r.id !== suggested?.id || open)
          .map((r) => (
            <button key={r.id} className="list-item" onClick={() => begin(r)} disabled={!!open}>
              <div className="grow">
                <div className="title">{r.name}</div>
                <div className="meta">{lastByRoutine.get(r.id) ? `Última vez ${relativeDays(lastByRoutine.get(r.id)!)}` : 'Sin registros'}</div>
              </div>
              {!open && <IconChevronRight className="chevron" />}
            </button>
          ))}
        <button className="list-item" onClick={() => begin(null)} disabled={!!open}>
          <div className="grow">
            <div className="title">Entrenamiento libre</div>
            <div className="meta">Elige los ejercicios sobre la marcha (ej. con un amigo)</div>
          </div>
          {!open && <IconChevronRight className="chevron" />}
        </button>
      </div>
      {open && <p className="faint tiny" style={{ margin: '8px 4px' }}>Termina el entrenamiento en curso para empezar otro.</p>}
    </div>
  );
}

function RoutineHero({ routine, last, onStart }: { routine: Routine; last?: string; onStart: () => void }) {
  const exercises = useExercises();
  const slots = useLiveQuery(async () => (await db.slots.where('routineId').equals(routine.id).toArray()).filter((s) => s.deleted !== 1).sort((a, b) => a.order - b.order), [routine.id]);
  const names = (slots ?? [])
    .filter((s) => s.kind !== 'no')
    .map((s) => s.exerciseIds.map((id) => exercises?.get(id)?.name).filter(Boolean).join(' / '))
    .filter(Boolean);
  return (
    <div className="card card-hero" style={{ marginTop: 12 }}>
      <div className="muted small">{last ? `Última vez ${relativeDays(last)}` : 'Toca hoy'}</div>
      <ol style={{ margin: '8px 0 14px', paddingLeft: 20, color: 'var(--muted)', fontSize: 14 }}>
        {names.map((n, i) => (
          <li key={i} style={{ margin: '2px 0' }}>
            {n}
          </li>
        ))}
      </ol>
      <button className="btn primary block big" onClick={onStart}>
        Empezar
      </button>
    </div>
  );
}

function OpenSessionCard({ session }: { session: Session }) {
  const [confirm, setConfirm] = useState(false);
  const stats = useLiveQuery(async () => {
    const sets = (await db.sets.where('sessionId').equals(session.id).toArray()).filter((s) => s.deleted !== 1 && s.done === 1);
    return { sets: sets.length, exercises: new Set(sets.map((s) => s.entryId)).size };
  }, [session.id]);
  return (
    <div className="card card-hero" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 650, fontSize: 18 }}>{session.title}</div>
      <div className="muted small" style={{ margin: '4px 0 14px' }}>
        {stats ? `${stats.exercises} ejercicios · ${stats.sets} series hasta ahora` : ' '}
      </div>
      <button className="btn primary block big" onClick={() => navigate(`sesion/${session.id}`)}>
        Continuar
      </button>
      <button className="btn ghost block" style={{ marginTop: 6 }} onClick={() => setConfirm(true)}>
        Descartar
      </button>
      {confirm && (
        <Confirm
          title="¿Descartar este entrenamiento?"
          message={stats?.sets ? `Se borran las ${stats.sets} series que llevas.` : 'No tiene series registradas, así que no se pierde nada.'}
          confirmLabel="Descartar"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={() => deleteSession(session)}
        />
      )}
    </div>
  );
}
