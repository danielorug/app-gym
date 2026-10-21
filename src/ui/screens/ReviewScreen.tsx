import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, save } from '../../db/db';
import { resolveReview } from '../../lib/data';
import { formatShort } from '../../lib/dates';
import { compactSets } from '../../lib/format';
import { Confirm, Topbar, toast } from '../components';
import { navigate } from '../router';

export function ReviewScreen() {
  const items = useLiveQuery(async () => {
    const entries = (await db.entries.where('review').equals(1).toArray()).filter((e) => e.deleted !== 1);
    const [sessions, exercises, sets] = await Promise.all([
      db.sessions.bulkGet([...new Set(entries.map((e) => e.sessionId))]),
      db.exercises.bulkGet([...new Set(entries.map((e) => e.exerciseId))]),
      db.sets.where('entryId').anyOf(entries.map((e) => e.id)).toArray(),
    ]);
    const sessionMap = new Map(sessions.filter(Boolean).map((s) => [s!.id, s!]));
    const exMap = new Map(exercises.filter(Boolean).map((e) => [e!.id, e!]));
    return entries
      .map((entry) => ({
        entry,
        date: sessionMap.get(entry.sessionId)?.date ?? '',
        name: exMap.get(entry.exerciseId)?.name ?? '?',
        sets: sets.filter((s) => s.entryId === entry.id && s.deleted !== 1).sort((a, b) => a.order - b.order),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, []);
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <>
      <Topbar
        back="mas"
        title="Revisar importados"
        right={
          items && items.length > 0 ? (
            <button className="btn ghost" onClick={() => setConfirmAll(true)}>
              Todo bien
            </button>
          ) : undefined
        }
      />
      <div className="page">
        <p className="muted small" style={{ marginTop: 0 }}>
          Renglones de tus notas que no pude leer con total seguridad. Revisa que lo que entendí (en negritas) sea correcto. Puedes corregir los números abriendo el entrenamiento.
        </p>
        {items?.map(({ entry, date, name, sets }) => (
          <div key={entry.id} className="card">
            <div className="row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{name}</div>
                <div className="muted small">{date ? formatShort(date) : ''}</div>
              </div>
            </div>
            {entry.reviewReason && <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>{entry.reviewReason}</div>}
            {entry.raw && <div className="raw" style={{ marginTop: 8 }}>{entry.raw}</div>}
            <div className="small" style={{ marginTop: 8 }}>
              Entendí: <b>{compactSets(sets)}</b>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn small primary" onClick={() => resolveReview(entry, true)}>
                Está bien
              </button>
              <button className="btn small" onClick={() => navigate(`sesion/${entry.sessionId}`)}>
                Corregir
              </button>
              <span className="spacer" />
              <button className="btn small danger" onClick={() => resolveReview(entry, false)}>
                No lo hice
              </button>
            </div>
          </div>
        ))}
        {items && items.length === 0 && <div className="empty">Todo revisado ✓</div>}
      </div>
      {confirmAll && items && (
        <Confirm
          title="¿Marcar todo como correcto?"
          message={`${items.length} registros quedan como están.`}
          confirmLabel="Sí, todo está bien"
          onClose={() => setConfirmAll(false)}
          onConfirm={async () => {
            await save(
              'entries',
              items.map((i) => ({ ...i.entry, review: 0 as const, reviewReason: '' })),
            );
            toast('Listo, todo revisado');
          }}
        />
      )}
    </>
  );
}
