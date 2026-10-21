import { useMemo, useState } from 'react';
import type { Exercise, LoadMode, Unit } from '../db/types';
import { createExercise, useExercises, useLastUsed } from '../lib/data';
import { formatDayMonth } from '../lib/dates';
import { LOAD_LABELS } from '../lib/format';
import { Segmented, Sheet } from './components';
import { IconPlus, IconSearch } from './icons';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function ExercisePicker({
  title = 'Elegir ejercicio',
  exclude = [],
  onPick,
  onClose,
}: {
  title?: string;
  exclude?: string[];
  onPick: (ex: Exercise) => void;
  onClose: () => void;
}) {
  const exercises = useExercises();
  const lastUsed = useLastUsed();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => {
    if (!exercises) return [];
    const words = norm(q).split(/\s+/).filter(Boolean);
    return [...exercises.values()]
      .filter((e) => !e.archived && !exclude.includes(e.id))
      .filter((e) => words.every((w) => norm(e.name).includes(w)))
      .sort((a, b) => (lastUsed?.get(b.id) ?? '').localeCompare(lastUsed?.get(a.id) ?? '') || a.name.localeCompare(b.name));
  }, [exercises, lastUsed, q, exclude]);

  if (creating) return <NewExerciseSheet initialName={q} onCancel={() => setCreating(false)} onCreated={onPick} onClose={onClose} />;

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="search" style={{ marginBottom: 12 }}>
        <IconSearch />
        <input className="input" placeholder="Buscar ejercicio" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!('ontouchstart' in window)} />
      </div>
      <button className="btn block" style={{ marginBottom: 12 }} onClick={() => setCreating(true)}>
        <IconPlus size={18} /> {q.trim() ? `Crear “${q.trim()}”` : 'Nuevo ejercicio'}
      </button>
      <div className="list">
        {list.map((e) => (
          <button key={e.id} className="list-item" onClick={() => onPick(e)}>
            <div className="grow">
              <div className="title">{e.name}</div>
              <div className="meta">{lastUsed?.get(e.id) ? `Última vez ${formatDayMonth(lastUsed.get(e.id)!)}` : 'Sin registros'}</div>
            </div>
          </button>
        ))}
        {list.length === 0 && <div className="empty small">No hay ejercicios con ese nombre.</div>}
      </div>
    </Sheet>
  );
}

export function NewExerciseSheet({
  initialName = '',
  onCreated,
  onCancel,
  onClose,
}: {
  initialName?: string;
  onCreated: (ex: Exercise) => void;
  onCancel?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState<Unit>('kg');
  const [load, setLoad] = useState<LoadMode>('normal');
  return (
    <Sheet title="Nuevo ejercicio" onClose={onClose}>
      <label className="field">
        <span>Nombre</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Remo con mancuerna" />
      </label>
      <div className="field">
        <span>Tipo de peso</span>
        <div className="row wrap">
          {(Object.keys(LOAD_LABELS) as LoadMode[]).map((l) => (
            <button key={l} className={`chip${load === l ? ' active' : ''}`} onClick={() => setLoad(l)}>
              {LOAD_LABELS[l]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Unidad</span>
        <Segmented
          value={unit}
          onChange={setUnit}
          options={[
            { value: 'kg', label: 'Kilos (kg)' },
            { value: 'lb', label: 'Libras (lb)' },
          ]}
        />
      </div>
      <div className="stack">
        <button
          className="btn primary block big"
          disabled={!name.trim()}
          onClick={async () => {
            const ex = await createExercise({ name, unit, load });
            onCreated(ex);
          }}
        >
          Crear ejercicio
        </button>
        {onCancel && (
          <button className="btn block" onClick={onCancel}>
            Regresar
          </button>
        )}
      </div>
    </Sheet>
  );
}
