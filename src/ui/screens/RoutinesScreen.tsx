import { useState } from 'react';
import type { RoutineSlot, SlotKind } from '../../db/types';
import { addSlot, createRoutine, deleteRoutine, moveSlot, removeSlot, updateRoutine, updateSlot, useExercises, useRoutine, useRoutines, useSlots } from '../../lib/data';
import { WEEKDAY_LETTERS, WEEKDAY_NAMES } from '../../lib/dates';
import { Confirm, Segmented, Topbar } from '../components';
import { ExercisePicker } from '../ExercisePicker';
import { IconChevronRight, IconDown, IconPlus, IconUp, IconX } from '../icons';
import { navigate } from '../router';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function RoutinesScreen() {
  const routines = useRoutines();
  return (
    <>
      <Topbar back="mas" title="Rutinas" />
      <div className="page">
        <div className="list">
          {routines?.map((r) => (
            <button key={r.id} className="list-item" onClick={() => navigate(`rutina/${r.id}`)}>
              <div className="grow">
                <div className="title">{r.name}</div>
                <div className="meta">
                  {r.weekdays.length
                    ? DAY_ORDER.filter((d) => r.weekdays.includes(d))
                        .map((d) => WEEKDAY_NAMES[d])
                        .join(', ')
                    : 'Sin día asignado'}
                </div>
              </div>
              <IconChevronRight className="chevron" />
            </button>
          ))}
          {routines?.length === 0 && <div className="empty small">Aún no hay rutinas.</div>}
        </div>
        <button
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const r = await createRoutine('Nueva rutina');
            navigate(`rutina/${r.id}`);
          }}
        >
          <IconPlus size={18} /> Nueva rutina
        </button>
      </div>
    </>
  );
}

export function RoutineEditScreen({ id }: { id: string }) {
  const routine = useRoutine(id);
  const slots = useSlots(id);
  const exercises = useExercises();
  const [name, setName] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | { slot?: RoutineSlot }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!routine || !slots || !exercises) return <Topbar back="rutinas" />;

  return (
    <>
      <Topbar back="rutinas" title={routine.name} />
      <div className="page">
        <label className="field">
          <span>Nombre</span>
          <input
            className="input"
            value={name ?? routine.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name != null && name.trim() && name.trim() !== routine.name) void updateRoutine(routine, { name: name.trim() });
              setName(null);
            }}
          />
        </label>
        <div className="field">
          <span>Días que toca</span>
          <div className="weekdays">
            {DAY_ORDER.map((d) => (
              <button
                key={d}
                className={routine.weekdays.includes(d) ? 'active' : ''}
                aria-label={WEEKDAY_NAMES[d]}
                aria-pressed={routine.weekdays.includes(d)}
                onClick={() =>
                  updateRoutine(routine, {
                    weekdays: routine.weekdays.includes(d) ? routine.weekdays.filter((x) => x !== d) : [...routine.weekdays, d],
                  })
                }
              >
                {WEEKDAY_LETTERS[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="section-title">Ejercicios (en orden)</div>
        {slots.map((slot, i) => (
          <div key={slot.id} className="card" style={{ marginBottom: 10 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="entry-num">{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {slot.exerciseIds.map((exId, vi) => (
                  <div key={exId} className="row" style={{ minHeight: 30 }}>
                    <span style={{ flex: 1, fontWeight: vi === 0 ? 650 : 500, color: vi === 0 ? 'var(--text)' : 'var(--muted)' }}>
                      {vi > 0 && <span className="faint">o </span>}
                      {exercises.get(exId)?.name ?? '?'}
                    </span>
                    {slot.exerciseIds.length > 1 && (
                      <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Quitar variante" onClick={() => updateSlot(slot, { exerciseIds: slot.exerciseIds.filter((x) => x !== exId) })}>
                        <IconX size={16} />
                      </button>
                    )}
                  </div>
                ))}
                <button className="btn ghost small" style={{ paddingLeft: 0 }} onClick={() => setPicker({ slot })}>
                  <IconPlus size={14} /> Variante
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <button className="icon-btn" disabled={i === 0} onClick={() => moveSlot(slots, i, -1)} aria-label="Subir">
                  <IconUp size={18} />
                </button>
                <button className="icon-btn" disabled={i === slots.length - 1} onClick={() => moveSlot(slots, i, 1)} aria-label="Bajar">
                  <IconDown size={18} />
                </button>
              </div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <Segmented<SlotKind>
                  value={slot.kind}
                  onChange={(kind) => updateSlot(slot, { kind })}
                  options={[
                    { value: 'normal', label: 'Normal' },
                    { value: 'opcional', label: 'Opcional' },
                    { value: 'no', label: 'Fuera (NO)' },
                  ]}
                />
              </div>
              <button className="icon-btn" onClick={() => removeSlot(slot)} aria-label="Quitar de la rutina" style={{ color: 'var(--bad)' }}>
                <IconX size={18} />
              </button>
            </div>
          </div>
        ))}
        <p className="faint tiny" style={{ margin: '4px 4px 12px' }}>
          Variantes: se intercambian (ej. Banca o Converging si está ocupada). Al empezar, la app elige la que hiciste más recientemente. “Fuera (NO)” = no está en la rutina pero no quieres perder su récord.
        </p>
        <button className="btn block" onClick={() => setPicker({})}>
          <IconPlus size={18} /> Agregar ejercicio
        </button>
        <button className="btn block danger" style={{ marginTop: 24 }} onClick={() => setConfirmDelete(true)}>
          Borrar rutina
        </button>
      </div>

      {picker && (
        <ExercisePicker
          title={picker.slot ? 'Agregar variante' : 'Agregar a la rutina'}
          exclude={picker.slot?.exerciseIds}
          onClose={() => setPicker(null)}
          onPick={async (ex) => {
            const slot = picker.slot;
            setPicker(null);
            if (slot) await updateSlot(slot, { exerciseIds: [...slot.exerciseIds, ex.id] });
            else await addSlot(routine.id, ex.id);
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          title="¿Borrar rutina?"
          message="Tu historial no se borra, solo la plantilla."
          confirmLabel="Borrar"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteRoutine(routine);
            navigate('rutinas', { replace: true });
          }}
        />
      )}
    </>
  );
}
