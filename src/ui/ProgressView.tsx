import { useMemo } from 'react';
import type { Exercise, Unit } from '../db/types';
import { useExerciseHistory } from '../lib/data';
import { formatDayMonth, relativeDays } from '../lib/dates';
import { compactSets, fmtNum, formatSet } from '../lib/format';
import { computeProgress, type Metric, type Progress, type SessionPoint } from '../lib/progress';
import { Sheet } from './components';
import { navigate } from './router';

/** Progreso de un ejercicio. `excludeSessionId` = el entrenamiento en curso (para comparar contra lo anterior). */
export function useProgress(exercise: Exercise | undefined, excludeSessionId?: string): Progress | undefined {
  const history = useExerciseHistory(exercise?.id);
  return useMemo(() => {
    if (!exercise || !history) return undefined;
    return computeProgress(
      history.filter((h) => h.sessionId !== excludeSessionId),
      exercise.unit,
    );
  }, [history, exercise, excludeSessionId]);
}

export function formatScore(score: number, metric: Metric, unit: Unit): string {
  if (metric === 'reps') return `${fmtNum(score)} reps`;
  if (metric === 'tiempo') return `${fmtNum(score)} s`;
  return `${fmtNum(Math.round(score * 10) / 10)} ${unit}`;
}

/** Una línea en palabras: qué tan cerca estuvo la última vez de tu mejor. */
export function statusLine(p: Progress): string | null {
  if (!p.last || !p.bestPoint) return null;
  if (p.last.sessionId === p.bestPoint.sessionId) return 'La última vez fue tu mejor marca.';
  const pct = Math.round((p.lastVsBest ?? 0) * 100);
  const pause = p.pauseBeforeLast ? ` Venías de ${p.pauseBeforeLast} días sin hacerlo.` : '';
  if (pct >= 97) return `La última vez estuviste prácticamente en tu mejor (${pct}%).${pause}`;
  return `La última vez estuviste al ${pct}% de tu mejor: ${formatSet(p.bestPoint.best)} el ${formatDayMonth(p.bestPoint.date)}.${pause}`;
}

export function ProgressView({ exercise, excludeSessionId, onOpenSession }: { exercise: Exercise; excludeSessionId?: string; onOpenSession?: (id: string) => void }) {
  const p = useProgress(exercise, excludeSessionId);
  if (!p) return null;
  if (p.points.length === 0) return <div className="empty small">Todavía no hay series de este ejercicio.</div>;
  const status = statusLine(p);
  const strength = p.metric === 'fuerza';

  return (
    <div className="progress-view">
      <div className="stat-grid">
        <div className="stat best">
          <div className="label">Tu mejor serie</div>
          <div className="value">{p.bestPoint ? formatSet(p.bestPoint.best) : '—'}</div>
          {p.bestPoint && <div className="tiny faint">{formatDayMonth(p.bestPoint.date)} · {relativeDays(p.bestPoint.date)}</div>}
        </div>
        <div className="stat">
          <div className="label">Última vez</div>
          <div className="value">{p.last ? formatSet(p.last.best) : '—'}</div>
          {p.last && (
            <div className="tiny faint">
              {formatDayMonth(p.last.date)} · {Math.round((p.lastVsBest ?? 0) * 100)}% de tu mejor
            </div>
          )}
        </div>
        {strength && p.heaviest && (
          <div className="stat">
            <div className="label">Más peso</div>
            <div className="value">{formatSet(p.heaviest.set)}</div>
            <div className="tiny faint">{formatDayMonth(p.heaviest.date)}</div>
          </div>
        )}
        <div className="stat">
          <div className="label">Sesiones</div>
          <div className="value">{p.points.length}</div>
          <div className="tiny faint">desde {formatDayMonth(p.points[0].date)}</div>
        </div>
      </div>

      {status && <p className="progress-status">{status}</p>}

      {p.points.length >= 2 && (
        <>
          <div className="section-title">{strength ? 'Fuerza estimada por sesión' : p.metric === 'reps' ? 'Mejores reps por sesión' : 'Mejor tiempo por sesión'}</div>
          <div className="card">
            <StrengthChart p={p} unit={exercise.unit} />
            {strength && (
              <p className="faint tiny" style={{ margin: '8px 0 0' }}>
                Combina peso y reps de tu mejor serie (el peso que podrías mover una vez). Sirve para comparar días con pesos distintos. Línea punteada = tu mejor; tramo punteado = pausa de 10 días o más.
              </p>
            )}
          </div>
        </>
      )}

      {strength && p.byWeight.length > 0 && (
        <>
          <div className="section-title">Tus mejores reps con cada peso</div>
          <div className="list">
            {p.byWeight.slice(0, 8).map((w) => (
              <div key={w.weight} className="list-item weight-row">
                <div className="grow">
                  <span className="title">{formatSet(w.set).split(' × ')[0]}</span>
                </div>
                <div style={{ fontWeight: 700 }}>{fmtNum(w.reps)} reps</div>
                <div className="faint small" style={{ width: 52, textAlign: 'right' }}>
                  {formatDayMonth(w.date)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Historial</div>
      <HistoryList points={p.points} metric={p.metric} unit={exercise.unit} onOpen={onOpenSession ?? ((id) => navigate(`sesion/${id}`))} />
    </div>
  );
}

function HistoryList({ points, metric, unit, onOpen }: { points: SessionPoint[]; metric: Metric; unit: Unit; onOpen: (id: string) => void }) {
  const rows = [...points].reverse().slice(0, 60);
  const bestScore = Math.max(...points.map((p) => p.score));
  return (
    <div className="list">
      {rows.map((p, i) => {
        const older = rows[i + 1];
        const delta = older ? p.score - older.score : 0;
        const gap = older ? Math.round((new Date(p.date).getTime() - new Date(older.date).getTime()) / 86_400_000) : 0;
        return (
          <div key={p.sessionId}>
            <button className="list-item" onClick={() => onOpen(p.sessionId)}>
              <div style={{ width: 54, flex: 'none' }} className="small muted">
                {formatDayMonth(p.date)}
              </div>
              <div className="grow">
                <div className="small" style={{ fontWeight: 550, whiteSpace: 'normal' }}>
                  {compactSets(p.sets)}
                </div>
                <div className="meta">
                  {formatScore(p.score, metric, unit)}
                  {p.score === bestScore && ' · tu mejor'}
                  {p.note && ` · ${p.note}`}
                </div>
              </div>
              {older && <span className={`delta ${delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'same'}`}>{delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '='}</span>}
            </button>
            {gap >= 10 && <div className="pause-sep">{gap} días sin hacerlo</div>}
          </div>
        );
      })}
    </div>
  );
}

function StrengthChart({ p, unit }: { p: Progress; unit: Unit }) {
  const data = p.points.slice(-30);
  const W = 320;
  const H = 150;
  const pad = { l: 38, r: 12, t: 14, b: 22 };
  const values = data.map((d) => d.score);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = max - min;
  min -= range * 0.08;
  max += range * 0.08;
  const t0 = new Date(data[0].date).getTime();
  const t1 = new Date(data[data.length - 1].date).getTime();
  const x = (date: string) => pad.l + ((new Date(date).getTime() - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const best = p.bestPoint?.score ?? max;
  let runMax = -Infinity;

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Progreso por sesión">
      {[min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--faint)">
            {fmtNum(Math.round(v))}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(best)} y2={y(best)} stroke="var(--good)" strokeWidth={1.2} strokeDasharray="4 4" />
      {data.slice(1).map((d, i) => {
        const prev = data[i];
        const gap = (new Date(d.date).getTime() - new Date(prev.date).getTime()) / 86_400_000;
        return (
          <line
            key={d.sessionId}
            x1={x(prev.date)}
            y1={y(prev.score)}
            x2={x(d.date)}
            y2={y(d.score)}
            stroke="var(--accent)"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeDasharray={gap >= 10 ? '3 5' : undefined}
            opacity={gap >= 10 ? 0.6 : 1}
          />
        );
      })}
      {data.map((d, i) => {
        const isPR = d.score > runMax;
        runMax = Math.max(runMax, d.score);
        const last = i === data.length - 1;
        return (
          <circle key={d.sessionId} cx={x(d.date)} cy={y(d.score)} r={last ? 4.5 : isPR ? 3.6 : 2.6} fill={isPR ? 'var(--good)' : 'var(--accent)'} stroke={last ? 'var(--surface)' : 'none'} strokeWidth={1.5}>
            <title>{`${formatDayMonth(d.date)}: ${formatSet(d.best)} (${formatScore(d.score, p.metric, unit)})`}</title>
          </circle>
        );
      })}
      <text x={pad.l} y={H - 6} fontSize={10} fill="var(--faint)">
        {formatDayMonth(data[0].date)}
      </text>
      <text x={W - pad.r} y={H - 6} fontSize={10} fill="var(--faint)" textAnchor="end">
        {formatDayMonth(data[data.length - 1].date)}
        {p.metric === 'fuerza' ? ` · ${unit}` : ''}
      </text>
    </svg>
  );
}

export function ProgressSheet({ exercise, excludeSessionId, onClose }: { exercise: Exercise; excludeSessionId?: string; onClose: () => void }) {
  return (
    <Sheet
      title={exercise.name}
      onClose={onClose}
      actions={
        <button className="btn ghost small" onClick={() => navigate(`ejercicio/${exercise.id}`)}>
          Ficha
        </button>
      }
    >
      <ProgressView exercise={exercise} excludeSessionId={excludeSessionId} />
    </Sheet>
  );
}
