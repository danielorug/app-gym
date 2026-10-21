import { useMemo, useState } from 'react';
import type { Exercise, LoadMode, Unit } from '../../db/types';
import { mergeExercises, updateExercise, useExercise, useExerciseHistory, useExercises, useLastUsed, useRecord } from '../../lib/data';
import { formatDayMonth, relativeDays } from '../../lib/dates';
import { compactSets, effectiveWeight, fmtNum, formatSet, LOAD_LABELS } from '../../lib/format';
import { AutoSaveText, Confirm, Segmented, Topbar, toast } from '../components';
import { ExercisePicker, NewExerciseSheet } from '../ExercisePicker';
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
                <div className="meta">{lastUsed?.get(e.id) ? `Última vez ${relativeDays(lastUsed.get(e.id)!)}` : 'Sin registros'}</div>
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
  const record = useRecord(id);
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

  const sessions = history ?? [];
  return (
    <>
      <Topbar back="ejercicios" title={exercise.name} />
      <div className="page">
        <div className="stat-row">
          <div className="stat">
            <div className="label">Récord</div>
            <div className="value">{record ? formatSet(record.set) : '—'}</div>
            {record && <div className="tiny faint">{formatDayMonth(record.date)}</div>}
          </div>
          <div className="stat">
            <div className="label">Veces</div>
            <div className="value">{sessions.length}</div>
            {sessions[0] && <div className="tiny faint">Última {relativeDays(sessions[0].date)}</div>}
          </div>
        </div>

        {sessions.length >= 2 && (
          <>
            <div className="section-title">Progreso (mejor serie)</div>
            <div className="card">
              <ProgressChart points={[...sessions].reverse().map((h) => ({ date: h.date, value: Math.max(...h.sets.map((s) => effectiveWeight(s))) }))} unit={exercise.unit} />
            </div>
          </>
        )}

        <div className="section-title">Notas</div>
        <AutoSaveText value={exercise.notes} onSave={(notes) => updateExercise(exercise, { notes })} placeholder="Ajustes de máquina, técnica, metas…" />

        <div className="section-title">Historial</div>
        <div className="list">
          {sessions.slice(0, 60).map((h) => (
            <button key={h.sessionId} className="list-item" onClick={() => navigate(`sesion/${h.sessionId}`)}>
              <div style={{ width: 54, flex: 'none' }} className="small muted">
                {formatDayMonth(h.date)}
              </div>
              <div className="grow">
                <div className="small" style={{ fontWeight: 550 }}>
                  {compactSets(h.sets)}
                </div>
                {h.note && <div className="meta">{h.note}</div>}
              </div>
            </button>
          ))}
          {sessions.length === 0 && <div className="empty small">Todavía no hay series de este ejercicio.</div>}
        </div>

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
        </div>

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

function ProgressChart({ points, unit }: { points: { date: string; value: number }[]; unit: Unit }) {
  const data = points.slice(-30);
  const W = 320;
  const H = 140;
  const pad = { l: 34, r: 10, t: 12, b: 22 };
  const values = data.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const path = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Progreso del peso de la mejor serie">
      {[min, (min + max) / 2, max].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--faint)">
            {fmtNum(v)}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={i === data.length - 1 ? 4 : 2.5} fill="var(--accent)" />
      ))}
      <text x={pad.l} y={H - 6} fontSize={10} fill="var(--faint)">
        {formatDayMonth(data[0].date)}
      </text>
      <text x={W - pad.r} y={H - 6} fontSize={10} fill="var(--faint)" textAnchor="end">
        {formatDayMonth(data[data.length - 1].date)} · {unit}
      </text>
    </svg>
  );
}
