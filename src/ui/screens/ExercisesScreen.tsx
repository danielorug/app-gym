import { useMemo, useState } from 'react';
import type { Exercise, LoadMode, SlotKind, Unit } from '../../db/types';
import { mergeExercises, updateExercise, updateSlot, useAllHistories, useExercise, useExerciseHistory, useExercises, useLastUsed, useSlotsForExercise } from '../../lib/data';
import { relativeDays } from '../../lib/dates';
import { formatSet, LOAD_LABELS } from '../../lib/format';
import { computeProgress, type Progress } from '../../lib/progress';
import { AutoSaveText, Confirm, Segmented, Topbar, toast } from '../components';
import { ExercisePicker, NewExerciseSheet } from '../ExercisePicker';
import { ProgressView } from '../ProgressView';
import { IconChevronRight, IconPlus, IconSearch } from '../icons';
import { navigate } from '../router';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function ExercisesScreen() {
  const exercises = useExercises();
  const lastUsed = useLastUsed();
  const histories = useAllHistories();
  const progressById = useMemo(() => {
    const map = new Map<string, Progress>();
    if (!exercises || !histories) return map;
    for (const [id, h] of histories) {
      const ex = exercises.get(id);
      if (ex) map.set(id, computeProgress(h, ex.unit));
    }
    return map;
  }, [exercises, histories]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return [...(exercises?.values() ?? [])]
      .filter((e) => (showArchived ? e.archived === 1 : e.archived !== 1))
      .filter((e) => words.every((w) => norm(e.name).includes(w)))
      .sort((a, b) => (lastUsed?.get(b.id) ?? '').localeCompare(lastUsed?.get(a.id) ?? '') || a.name.localeCompare(b.name));
  }, [exercises, lastUsed, q, showArchived]);
  const archivedCount = [...(exercises?.values() ?? [])].filter((e) => e.archived === 1).length;

  return (
    <>
      <Topbar
        title="Ejercicios"
        right={
          <button className="icon-btn" onClick={() => setCreating(true)} aria-label="Nuevo ejercicio" style={{ color: 'var(--accent)' }}>
            <IconPlus />
          </button>
        }
      />
      <div className="page">
        <div className="search" style={{ marginBottom: 12 }}>
          <IconSearch />
          <input className="input" placeholder="Buscar ejercicio" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="list">
          {list.map((e) => (
            <button key={e.id} className="list-item" onClick={() => navigate(`ejercicio/${e.id}`)}>
              <div className="grow">
                <div className="title">{e.name}</div>
                <ExerciseMeta p={progressById.get(e.id)} />
              </div>
              <IconChevronRight className="chevron" />
            </button>
          ))}
          {exercises && list.length === 0 && <div className="empty small">No hay ejercicios.</div>}
        </div>
        {(archivedCount > 0 || showArchived) && (
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Ver ejercicios activos' : `Ver archivados (${archivedCount})`}
          </button>
        )}
      </div>
      {creating && (
        <NewExerciseSheet
          initialName={q}
          onClose={() => setCreating(false)}
          onCreated={(ex) => {
            setCreating(false);
            navigate(`ejercicio/${ex.id}`);
          }}
        />
      )}
    </>
  );
}

export function ExerciseDetailScreen({ id }: { id: string }) {
  const exercise = useExercise(id);
  const history = useExerciseHistory(id);
  const inRoutines = useSlotsForExercise(id);
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Exercise | null>(null);
  const [name, setName] = useState<string | null>(null);

  if (!exercise) {
    return (
      <>
        <Topbar back="ejercicios" />
        {exercise === undefined && history !== undefined && <div className="empty">Este ejercicio ya no existe.</div>}
      </>
    );
  }

  return (
    <>
      <Topbar back="ejercicios" title={exercise.name} />
      <div className="page">
        <ProgressView exercise={exercise} />

        <div className="section-title">Notas</div>
        <AutoSaveText value={exercise.notes} onSave={(notes) => updateExercise(exercise, { notes })} placeholder="Ajustes de máquina, técnica, metas…" />

        <div className="section-title">Ajustes</div>
        <div className="card">
          <label className="field">
            <span>Nombre</span>
            <input
              className="input"
              value={name ?? exercise.name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name != null && name.trim() && name.trim() !== exercise.name) void updateExercise(exercise, { name: name.trim() });
                setName(null);
              }}
            />
          </label>
          <div className="field">
            <span>Unidad por defecto</span>
            <Segmented<Unit>
              value={exercise.unit}
              onChange={(unit) => updateExercise(exercise, { unit })}
              options={[
                { value: 'kg', label: 'kg' },
                { value: 'lb', label: 'lb' },
              ]}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span>Tipo de peso</span>
            <div className="row wrap">
              {(Object.keys(LOAD_LABELS) as LoadMode[]).map((l) => (
                <button key={l} className={`chip${exercise.load === l ? ' active' : ''}`} onClick={() => updateExercise(exercise, { load: l })}>
                  {LOAD_LABELS[l]}
                </button>
              ))}
            </div>
          </div>
          <label className="row" style={{ marginTop: 16, minHeight: 32 }}>
            <span style={{ flex: 1 }}>
              Unilateral
              <span className="faint tiny" style={{ display: 'block' }}>
                Registra las reps de cada lado (izquierda y derecha)
              </span>
            </span>
            <input
              type="checkbox"
              checked={exercise.unilateral === 1}
              onChange={(e) => updateExercise(exercise, { unilateral: e.target.checked ? 1 : 0 })}
              style={{ width: 22, height: 22, accentColor: 'var(--accent)' }}
            />
          </label>
        </div>

        {inRoutines && inRoutines.length > 0 && (
          <>
            <div className="section-title">En tus rutinas</div>
            <div className="card stack">
              {inRoutines.map(({ slot, routineName }) => (
                <div key={slot.id}>
                  <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                    {routineName}
                  </div>
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
              ))}
            </div>
          </>
        )}

        <div className="stack" style={{ marginTop: 16 }}>
          <button className="btn block" onClick={() => setMerging(true)}>
            Unir con otro ejercicio (duplicado)
          </button>
          <button
            className="btn block"
            onClick={async () => {
              await updateExercise(exercise, { archived: exercise.archived ? 0 : 1 });
              toast(exercise.archived ? 'Ejercicio activo de nuevo' : 'Ejercicio archivado');
            }}
          >
            {exercise.archived ? 'Desarchivar' : 'Archivar (ya no lo hago)'}
          </button>
        </div>
      </div>

      {merging && (
        <ExercisePicker
          title="¿Con cuál lo unes?"
          exclude={[exercise.id]}
          onClose={() => setMerging(false)}
          onPick={(target) => {
            setMerging(false);
            setMergeTarget(target);
          }}
        />
      )}
      {mergeTarget && (
        <Confirm
          title={`Unir con “${mergeTarget.name}”`}
          message={`Todo el historial de “${exercise.name}” pasa a “${mergeTarget.name}” y “${exercise.name}” desaparece.`}
          confirmLabel="Unir"
          onClose={() => setMergeTarget(null)}
          onConfirm={async () => {
            await mergeExercises(exercise, mergeTarget);
            toast('Ejercicios unidos');
            navigate(`ejercicio/${mergeTarget.id}`, { replace: true });
          }}
        />
      )}
    </>
  );
}

function ExerciseMeta({ p }: { p: Progress | undefined }) {
  if (!p?.last || !p.bestPoint) return <div className="meta">Sin registros</div>;
  const atBest = p.last.sessionId === p.bestPoint.sessionId;
  const pct = Math.round((p.lastVsBest ?? 0) * 100);
  const label = atBest ? ' · tu mejor' : pct >= 100 ? ' · igual a tu mejor' : ` · ${pct}%`;
  return (
    <>
      <div className="meta">
        Mejor: <span style={{ color: 'var(--good)', fontWeight: 600 }}>{formatSet(p.bestPoint.best)}</span>
      </div>
      <div className="meta">
        Última {relativeDays(p.last.date)}: {formatSet(p.last.best)}
        {label}
      </div>
    </>
  );
}
