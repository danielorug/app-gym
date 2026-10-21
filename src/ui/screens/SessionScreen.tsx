import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, Exercise, LoadMode, RoutineSlot, Session, Unit, WorkSet } from '../../db/types';
import {
  addEntry,
  addSet,
  deleteSession,
  deleteSet,
  finishSession,
  moveEntry,
  removeEntry,
  updateEntry,
  updateExercise,
  updateSession,
  updateSet,
  updateSlot,
  useEntries,
  useExercises,
  useLastTime,
  useRecord,
  useSession,
  useSessionSets,
  useSlots,
} from '../../lib/data';
import { capitalize, formatDayMonth, formatLong } from '../../lib/dates';
import { bestSet, compactSets, compareSets, deltaVs, fmtNum, formatSet, LOAD_LABELS, parseNum, toNotation, type SetLike } from '../../lib/format';
import { AutoSaveText, Confirm, Segmented, Sheet, Topbar, toast } from '../components';
import { ExercisePicker } from '../ExercisePicker';
import { IconCheck, IconMore, IconPlus, IconTrophy } from '../icons';
import { usePrefs } from '../prefs';
import { primeAudio, startRest, stopRest } from '../rest';
import { navigate } from '../router';

export function SessionScreen({ id }: { id: string }) {
  const session = useSession(id);
  const entries = useEntries(id);
  const setsMap = useSessionSets(id);
  const exercises = useExercises();
  const slots = useSlots(session?.routineId);
  const [view, setView] = useState<'cards' | 'tabla'>('cards');
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const prefs = usePrefs();

  const live = !!session && !session.finishedAt && session.source === 'app';
  const editable = live || editing;
  useWakeLock(live && prefs.keepAwake);

  if (session === undefined || entries === undefined || setsMap === undefined || exercises === undefined) return <Topbar back="" />;
  if (session === null) {
    return (
      <>
        <Topbar back="" title="Entrenamiento" />
        <div className="empty">Este entrenamiento ya no existe.</div>
      </>
    );
  }

  const slotMap = new Map((slots ?? []).map((s) => [s.id, s]));
  const doneCount = [...setsMap.values()].flat().filter((s) => s.done === 1).length;
  const visible = editable ? entries : entries.filter((e) => (setsMap.get(e.id) ?? []).some((s) => s.done === 1));
  const outside = live ? (slots ?? []).filter((s) => s.kind === 'no' && !entries.some((e) => e.slotId === s.id)) : [];

  return (
    <>
      <Topbar
        back={live ? '' : 'historial'}
        title={session.title}
        right={
          live ? (
            <button className="btn primary small" onClick={() => setConfirmFinish(true)}>
              Terminar
            </button>
          ) : (
            <button className="btn ghost" onClick={() => setEditing(!editing)}>
              {editing ? 'Listo' : 'Editar'}
            </button>
          )
        }
      />
      <div className="page">
        <SessionHeader session={session} editable={editable} doneCount={doneCount} />

        {!live && visible.length > 0 && (
          <div style={{ margin: '12px 0' }}>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'cards', label: 'Detalle' },
                { value: 'tabla', label: 'Como en mis notas' },
              ]}
            />
          </div>
        )}

        {view === 'tabla' && !live ? (
          <NotationTable entries={visible} setsMap={setsMap} exercises={exercises} />
        ) : (
          <div style={{ marginTop: 12 }}>
            {visible.map((entry, i) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                index={i}
                entries={entries}
                exercise={exercises.get(entry.exerciseId)}
                exercises={exercises}
                sets={setsMap.get(entry.id) ?? []}
                session={session}
                slot={entry.slotId ? slotMap.get(entry.slotId) : undefined}
                editable={editable}
                live={live}
              />
            ))}
            {visible.length === 0 && <div className="empty">{editable ? 'Agrega tu primer ejercicio.' : 'Sin series registradas.'}</div>}
          </div>
        )}

        {editable && view === 'cards' && (
          <button className="btn block" onClick={() => setPicker(true)}>
            <IconPlus size={18} /> Agregar ejercicio
          </button>
        )}

        {outside.length > 0 && (
          <>
            <div className="section-title">Fuera de rutina</div>
            <div className="list">
              {outside.map((slot) => {
                const ex = exercises.get(slot.exerciseIds[0]);
                return (
                  <div key={slot.id} className="list-item">
                    <div className="grow">
                      <div className="title">{ex?.name ?? '?'}</div>
                      {ex?.notes && <div className="meta">{ex.notes}</div>}
                    </div>
                    <button className="btn small" onClick={() => addEntry(session.id, slot.exerciseIds[0], slot.id)}>
                      Hacer hoy
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {(editing || live) && (
          <button className="btn block danger" style={{ marginTop: 24 }} onClick={() => setConfirmDelete(true)}>
            {live ? 'Descartar entrenamiento' : 'Borrar entrenamiento'}
          </button>
        )}
      </div>

      {picker && (
        <ExercisePicker
          title="Agregar ejercicio"
          onClose={() => setPicker(false)}
          onPick={async (ex) => {
            setPicker(false);
            await addEntry(session.id, ex.id);
            setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
          }}
        />
      )}
      {confirmFinish && (
        <Confirm
          title="¿Terminar entrenamiento?"
          message={
            doneCount === 0
              ? 'No palomeaste ninguna serie, así que no se guarda nada.'
              : `${doneCount} ${doneCount === 1 ? 'serie palomeada' : 'series palomeadas'}. Las series sin palomear no se guardan.`
          }
          confirmLabel="Terminar"
          onClose={() => setConfirmFinish(false)}
          onConfirm={async () => {
            stopRest();
            if (doneCount === 0) {
              await deleteSession(session);
              navigate('', { replace: true });
              return;
            }
            await finishSession(session);
            window.scrollTo(0, 0);
            toast('¡Buen entrenamiento! 💪');
          }}
        />
      )}
      {confirmDelete && (
        <Confirm
          title={live ? '¿Descartar este entrenamiento?' : '¿Borrar este entrenamiento?'}
          message={live && doneCount === 0 ? 'No tiene series registradas, así que no se pierde nada.' : 'Se borran todas sus series. No se puede deshacer.'}
          confirmLabel={live ? 'Descartar' : 'Borrar'}
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            stopRest();
            await deleteSession(session);
            navigate(live ? '' : 'historial', { replace: true });
          }}
        />
      )}
    </>
  );
}

function SessionHeader({ session, editable, doneCount }: { session: Session; editable: boolean; doneCount: number }) {
  const [now, setNow] = useState(Date.now());
  const live = !session.finishedAt;
  useEffect(() => {
    if (!live || !session.startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [live, session.startedAt]);
  const end = session.finishedAt ?? now;
  const minutes = session.startedAt ? Math.round((end - session.startedAt) / 60_000) : null;
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <div className="muted small">
          {capitalize(formatLong(session.date))}
        </div>
        <div className="faint tiny">
          {doneCount} series{minutes != null && minutes > 0 && minutes < 600 ? ` · ${minutes} min` : ''}
          {session.source === 'notas' ? ' · importado de Notas' : ''}
        </div>
      </div>
      {editable && (
        <input
          type="date"
          className="input"
          style={{ width: 'auto', padding: '6px 10px', fontSize: 14 }}
          value={session.date}
          onChange={(e) => e.target.value && updateSession(session, { date: e.target.value })}
          aria-label="Fecha del entrenamiento"
        />
      )}
    </div>
  );
}

// ───────────────────────── Tarjeta de ejercicio ─────────────────────────

function EntryCard({
  entry,
  index,
  entries,
  exercise,
  exercises,
  sets,
  session,
  slot,
  editable,
  live,
}: {
  entry: Entry;
  index: number;
  entries: Entry[];
  exercise: Exercise | undefined;
  exercises: Map<string, Exercise>;
  sets: WorkSet[];
  session: Session;
  slot: RoutineSlot | undefined;
  editable: boolean;
  live: boolean;
}) {
  const last = useLastTime(entry.exerciseId, session.date, session.id);
  const record = useRecord(entry.exerciseId, session.date);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<null | 'notes' | 'dayNote' | 'change' | 'variant' | 'remove'>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  if (!exercise) return null;
  const refSets = last?.sets ?? [];
  const ghostCount = live ? Math.max(0, refSets.length - sets.length) : 0;
  const doneSets = sets.filter((s) => s.done === 1);
  const todayBest = bestSet(doneSets);
  const isPR = !!todayBest && !!record && compareSets(todayBest, record.set) > 0;
  const complete = sets.length > 0 && ghostCount === 0 && sets.every((s) => s.done === 1);
  const maxOrder = sets.reduce((m, s) => Math.max(m, s.order), -1);
  const variants = slot && slot.exerciseIds.length > 1 ? slot.exerciseIds.map((id) => exercises.get(id)).filter((e): e is Exercise => !!e) : [];
  const total = sets.length + ghostCount;

  const addEmptySet = async () => {
    const prev = sets[sets.length - 1] ?? refSets[refSets.length - 1];
    await addSet(entry, session.date, maxOrder + 1, {
      weight: prev?.weight ?? null,
      reps: prev?.reps ?? null,
      unit: prev?.unit ?? exercise.unit,
      load: prev?.load ?? exercise.load,
      weight2: prev?.weight2 ?? null,
      reps2: prev?.reps2 ?? null,
      seconds: prev?.seconds ?? null,
      done: 0,
    });
  };

  return (
    <div className={`entry${complete ? ' complete' : ''}`}>
      <div className="entry-head">
        <div className="entry-num">{complete ? <IconCheck size={14} /> : index + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button className="entry-name" onClick={() => navigate(`ejercicio/${exercise.id}`)}>
            {exercise.name}
          </button>
          {(slot?.kind === 'opcional' || entry.note || isPR || entry.review === 1) && (
            <div className="row wrap" style={{ marginTop: 4, gap: 6 }}>
              {slot?.kind === 'opcional' && <span className="badge">Opcional</span>}
              {entry.note && <span className="badge accent">{entry.note}</span>}
              {isPR && (
                <span className="badge good">
                  <IconTrophy size={12} style={{ marginRight: 3 }} /> Récord
                </span>
              )}
              {entry.review === 1 && <span className="badge warn">Revisar</span>}
            </div>
          )}
        </div>
        {editable && (
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Opciones del ejercicio">
            <IconMore />
          </button>
        )}
      </div>

      {editable && variants.length > 0 && (
        <div className="variants">
          {variants.map((v) => (
            <button key={v.id} className={`chip${v.id === entry.exerciseId ? ' active' : ''}`} onClick={() => v.id !== entry.exerciseId && updateEntry(entry, { exerciseId: v.id })}>
              {v.name}
            </button>
          ))}
        </div>
      )}

      <div className="entry-body">
        {exercise.notes && (
          <button className={`ex-notes${notesOpen ? '' : ' clamped'}`} onClick={() => setNotesOpen(!notesOpen)}>
            {exercise.notes}
          </button>
        )}

        <div className="last-time">
          {last ? (
            <>
              Última vez · {formatDayMonth(last.date)}
              {last.note ? ` (${last.note})` : ''}: <b>{compactSets(last.sets)}</b>
            </>
          ) : (
            <>Primera vez con este ejercicio</>
          )}
        </div>
        {record && (
          <div className="faint tiny" style={{ marginTop: 3 }}>
            Récord: {formatSet(record.set)} · {formatDayMonth(record.date)}
          </div>
        )}
        {entry.review === 1 && entry.raw && <div className="raw" style={{ marginTop: 8 }}>{entry.reviewReason ? `${entry.reviewReason}\n` : ''}{entry.raw}</div>}

        {total > 0 && (
          <div className="sets">
            <div className="sets-head">
              <span style={{ textAlign: 'center' }}>Serie</span>
              <span style={{ textAlign: 'center' }}>Peso</span>
              <span style={{ textAlign: 'center' }}>Reps</span>
              <span />
            </div>
            {Array.from({ length: total }, (_, i) => (
              <SetRow
                key={`row-${i}`}
                index={i}
                set={sets[i]}
                reference={refSets[i]}
                fallback={sets[i - 1] ?? refSets[refSets.length - 1]}
                order={i < sets.length ? sets[i].order : maxOrder + 1 + (i - sets.length)}
                entry={entry}
                session={session}
                exercise={exercise}
                editable={editable}
              />
            ))}
          </div>
        )}

        {editable && (
          <button className="btn block small add-set" onClick={addEmptySet}>
            <IconPlus size={16} /> Serie
          </button>
        )}
      </div>

      {menu && (
        <Sheet title={exercise.name} onClose={() => setMenu(false)}>
          <MenuButton label={entry.note ? `Nota del día: ${entry.note}` : 'Nota del día (ej. Unilateral)'} onClick={() => (setMenu(false), setSheet('dayNote'))} />
          <MenuButton label="Editar notas del ejercicio" onClick={() => (setMenu(false), setSheet('notes'))} />
          <MenuButton label="Cambiar por otro ejercicio" onClick={() => (setMenu(false), setSheet('change'))} />
          {slot && <MenuButton label="Agregar una variante a la rutina" onClick={() => (setMenu(false), setSheet('variant'))} />}
          <MenuButton label="Mover arriba" disabled={index === 0} onClick={() => (setMenu(false), moveEntry(entries, entries.indexOf(entry), -1))} />
          <MenuButton label="Mover abajo" disabled={index === entries.length - 1} onClick={() => (setMenu(false), moveEntry(entries, entries.indexOf(entry), 1))} />
          <MenuButton label="Quitar de este entrenamiento" danger onClick={() => (setMenu(false), sets.length ? setSheet('remove') : removeEntry(entry))} />
        </Sheet>
      )}
      {sheet === 'notes' && (
        <Sheet title="Notas del ejercicio" onClose={() => setSheet(null)}>
          <p className="muted small" style={{ marginTop: 0 }}>
            Se guardan en el ejercicio y aparecen cada vez: ajustes de la máquina, técnica, metas.
          </p>
          <AutoSaveText value={exercise.notes} onSave={(notes) => updateExercise(exercise, { notes })} placeholder="Ej. Asiento en el hoyo 4. Bajar lento." rows={5} />
          <button className="btn primary block" style={{ marginTop: 12 }} onClick={() => setSheet(null)}>
            Listo
          </button>
        </Sheet>
      )}
      {sheet === 'dayNote' && <DayNoteSheet entry={entry} onClose={() => setSheet(null)} />}
      {sheet === 'change' && (
        <ExercisePicker
          title="Cambiar ejercicio"
          exclude={[entry.exerciseId]}
          onClose={() => setSheet(null)}
          onPick={async (ex) => {
            setSheet(null);
            await updateEntry(entry, { exerciseId: ex.id });
          }}
        />
      )}
      {sheet === 'variant' && slot && (
        <ExercisePicker
          title="Nueva variante"
          exclude={slot.exerciseIds}
          onClose={() => setSheet(null)}
          onPick={async (ex) => {
            setSheet(null);
            await updateSlot(slot, { exerciseIds: [...slot.exerciseIds, ex.id] });
            await updateEntry(entry, { exerciseId: ex.id });
            toast(`${ex.name} agregado como variante`);
          }}
        />
      )}
      {sheet === 'remove' && (
        <Confirm
          title="¿Quitar ejercicio?"
          message={`Se borran sus ${sets.length} series de hoy.`}
          confirmLabel="Quitar"
          danger
          onClose={() => setSheet(null)}
          onConfirm={() => removeEntry(entry)}
        />
      )}
    </div>
  );
}

function MenuButton({ label, onClick, danger, disabled }: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button className={`menu-item${danger ? ' danger' : ''}`} onClick={onClick} disabled={disabled} style={disabled ? { opacity: 0.4 } : undefined}>
      {label}
    </button>
  );
}

function DayNoteSheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [text, setText] = useState(entry.note);
  const presets = ['Unilateral', 'Agarre abierto', 'Agarre cerrado', 'Con pausa', 'Máquina ocupada'];
  const done = async (value: string) => {
    await updateEntry(entry, { note: value.trim() });
    onClose();
  };
  return (
    <Sheet title="Nota del día" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Solo para hoy. La próxima vez verás “Última vez (Unilateral)” para tenerlo en cuenta.
      </p>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej. Unilateral" />
      <div className="row wrap" style={{ margin: '12px 0' }}>
        {presets.map((p) => (
          <button key={p} className="chip" onClick={() => done(p)}>
            {p}
          </button>
        ))}
      </div>
      <div className="row">
        {entry.note && (
          <button className="btn" onClick={() => done('')}>
            Quitar nota
          </button>
        )}
        <button className="btn primary" style={{ flex: 1 }} onClick={() => done(text)}>
          Guardar
        </button>
      </div>
    </Sheet>
  );
}

// ───────────────────────── Fila de serie ─────────────────────────

interface Texts {
  w: string;
  r: string;
  w2: string;
  r2: string;
  sec: string;
}

const toText = (n: number | null | undefined) => (n == null ? '' : fmtNum(n));

function textsFrom(set: SetLike | undefined): Texts {
  return { w: toText(set?.weight), r: toText(set?.reps), w2: toText(set?.weight2), r2: toText(set?.reps2), sec: toText(set?.seconds) };
}

function SetRow({
  index,
  set,
  reference,
  fallback,
  order,
  entry,
  session,
  exercise,
  editable,
}: {
  index: number;
  set: WorkSet | undefined;
  reference: WorkSet | undefined;
  fallback: SetLike | undefined;
  order: number;
  entry: Entry;
  session: Session;
  exercise: Exercise;
  editable: boolean;
}) {
  const source: SetLike | undefined = reference ?? fallback;
  const [texts, setTexts] = useState<Texts>(() => textsFrom(set));
  const [menu, setMenu] = useState(false);
  const [extra, setExtra] = useState<{ part2?: boolean; time?: boolean; unit?: Unit; load?: LoadMode }>({});
  const focused = useRef(false);
  const created = useRef<WorkSet | null>(null);
  const pending = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (set) created.current = null;
    if (!focused.current) setTexts(textsFrom(set));
  }, [set?.id, set?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Las filas van por posición: si se borra una serie de arriba, esta fila pasa a mostrar otra.
  // Los ajustes temporales (unidad, "/", tiempo) eran de la serie anterior, así que se limpian.
  const prevSetId = useRef(set?.id);
  useEffect(() => {
    if (prevSetId.current && prevSetId.current !== set?.id) setExtra({});
    prevSetId.current = set?.id;
  }, [set?.id]);

  const current = set ?? created.current ?? undefined;
  const unit: Unit = extra.unit ?? current?.unit ?? source?.unit ?? exercise.unit;
  const load: LoadMode = extra.load ?? current?.load ?? source?.load ?? exercise.load;
  const part2 = extra.part2 ?? (current ? current.weight2 != null || current.reps2 != null : source?.weight2 != null || source?.reps2 != null);
  const shape = current ?? source;
  const timeMode = extra.time ?? (shape ? shape.seconds != null && shape.reps == null : false);
  const done = current?.done === 1;
  const delta = done && current ? deltaVs(current, reference) : null;

  const placeholder = (field: 'weight' | 'reps' | 'weight2' | 'reps2' | 'seconds') => {
    const v = source?.[field];
    if (field === 'weight' && load === 'lado' && v === 0) return 'Barra';
    if (field === 'weight' && load === 'corporal' && v == null) return '—';
    return v == null ? '' : fmtNum(v);
  };

  /** Guarda la fila completa. Con `markDone`, lo vacío se llena con lo de la vez pasada. */
  const persist = async (next: Texts, doneFlag?: 0 | 1, overrides: Partial<WorkSet> = {}) => {
    const fill = doneFlag === 1;
    const pick = (text: string, ph: number | null | undefined) => {
      const n = parseNum(text);
      return n != null ? n : fill ? (ph ?? null) : null;
    };
    const values = {
      weight: pick(next.w, source?.weight ?? (load === 'lado' ? 0 : null)),
      reps: timeMode ? null : pick(next.r, source?.reps),
      weight2: part2 ? pick(next.w2, source?.weight2) : null,
      reps2: part2 && !timeMode ? pick(next.r2, source?.reps2) : null,
      seconds: timeMode ? pick(next.sec, source?.seconds) : null,
      unit,
      load,
      ...overrides,
    };
    if (pending.current) await pending.current;
    const cur = set ?? created.current;
    if (cur) {
      await updateSet(cur, { ...values, done: doneFlag ?? cur.done });
    } else {
      const typed = Object.values(next).some((t) => t.trim() !== '');
      if (!typed && doneFlag !== 1 && Object.keys(overrides).length === 0) return;
      const job = addSet(entry, session.date, order, { ...values, done: doneFlag ?? 0 }).then((s) => {
        created.current = s;
      });
      pending.current = job;
      await job;
      pending.current = null;
    }
    if (fill) setTexts(textsFrom(values));
  };

  const onBlur = () => {
    focused.current = false;
    const before = textsFrom(current);
    if (JSON.stringify(before) !== JSON.stringify(texts)) void persist(texts);
  };

  const toggleDone = async () => {
    if (!editable) return;
    primeAudio(); // tiene que ir antes de cualquier await (regla de iOS)
    if (done) {
      await persist(texts, 0);
      return;
    }
    await persist(texts, 1);
    if (!session.finishedAt) startRest(exercise.name);
  };

  const field = (key: keyof Texts, ph: string, opts: { prefix?: string; suffix?: React.ReactNode; label: string }) => (
    <label className="num-field">
      {opts.prefix && <span className="affix">{opts.prefix}</span>}
      <input
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        value={texts[key]}
        placeholder={ph}
        disabled={!editable}
        aria-label={opts.label}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => setTexts({ ...texts, [key]: e.target.value })}
        onBlur={onBlur}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {opts.suffix}
    </label>
  );

  const unitButton = (
    <button
      className="affix"
      type="button"
      disabled={!editable}
      onClick={(e) => {
        e.preventDefault();
        const nu: Unit = unit === 'kg' ? 'lb' : 'kg';
        setExtra({ ...extra, unit: nu });
        if (current) void updateSet(current, { unit: nu });
      }}
      aria-label={`Unidad: ${unit}. Tocar para cambiar`}
    >
      {unit}
    </button>
  );

  const weightPrefix = load === 'lado' ? '2×' : load === 'corporal' ? 'Corp ±' : undefined;

  return (
    <>
      <div className={`set-row${done ? ' done' : ''}${current ? '' : ' ghost'}`}>
        <button className="set-num" onClick={() => editable && current && setMenu(true)} aria-label={`Serie ${index + 1}, opciones`}>
          {index + 1}
          {delta && <span className={`delta ${delta}`}>{delta === 'up' ? '▲' : delta === 'down' ? '▼' : '='}</span>}
        </button>
        {field('w', placeholder('weight'), { prefix: weightPrefix, suffix: unitButton, label: `Peso serie ${index + 1}` })}
        {timeMode
          ? field('sec', placeholder('seconds'), { suffix: <span className="affix">s</span>, label: `Segundos serie ${index + 1}` })
          : field('r', placeholder('reps'), { label: `Reps serie ${index + 1}` })}
        <button className={`check${done ? ' on' : ''}`} onClick={toggleDone} disabled={!editable} aria-label={done ? 'Desmarcar serie' : 'Palomear serie'}>
          <IconCheck size={20} />
        </button>
      </div>
      {part2 && (
        <div className={`set-row${done ? ' done' : ''}`}>
          <span className="part2-label">luego /</span>
          {field('w2', placeholder('weight2'), { prefix: weightPrefix, suffix: <span className="affix">{unit}</span>, label: `Peso parte 2 serie ${index + 1}` })}
          {timeMode ? <span /> : field('r2', placeholder('reps2'), { label: `Reps parte 2 serie ${index + 1}` })}
          <span />
        </div>
      )}

      {menu && current && (
        <Sheet title={`Serie ${index + 1}`} onClose={() => setMenu(false)}>
          <MenuButton
            label={part2 ? 'Quitar segunda parte ( / )' : 'Agregar segunda parte ( / ) — ej. juntos y luego unilateral'}
            onClick={() => {
              setMenu(false);
              setExtra({ ...extra, part2: !part2 });
              if (part2) void updateSet(current, { weight2: null, reps2: null });
            }}
          />
          <MenuButton
            label={timeMode ? 'Registrar por repeticiones' : 'Registrar por tiempo (segundos)'}
            onClick={() => {
              setMenu(false);
              setExtra({ ...extra, time: !timeMode });
              void updateSet(current, timeMode ? { seconds: null } : { reps: null, reps2: null });
            }}
          />
          <div className="section-title" style={{ marginTop: 12 }}>Tipo de peso</div>
          {(Object.keys(LOAD_LABELS) as LoadMode[]).map((l) => (
            <MenuButton
              key={l}
              label={`${l === load ? '✓ ' : ''}${LOAD_LABELS[l]}`}
              onClick={() => {
                setMenu(false);
                setExtra({ ...extra, load: l });
                void updateSet(current, { load: l });
              }}
            />
          ))}
          <div style={{ height: 8 }} />
          <MenuButton
            label="Borrar serie"
            danger
            onClick={() => {
              setMenu(false);
              void deleteSet(current);
            }}
          />
        </Sheet>
      )}
    </>
  );
}

// ───────────────────────── Vista tipo Notas ─────────────────────────

function NotationTable({ entries, setsMap, exercises }: { entries: Entry[]; setsMap: Map<string, WorkSet[]>; exercises: Map<string, Exercise> }) {
  const rows = useMemo(
    () =>
      entries.map((e, i) => {
        const done = (setsMap.get(e.id) ?? []).filter((s) => s.done === 1);
        return { i, entry: e, name: exercises.get(e.exerciseId)?.name ?? '?', ...toNotation(done) };
      }),
    [entries, setsMap, exercises],
  );
  return (
    <div className="table-scroll" style={{ marginTop: 12 }}>
      <table className="notation">
        <thead>
          <tr>
            <th>#</th>
            <th>Ejercicio</th>
            <th>Series</th>
            <th>Peso</th>
            <th>Reps</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entry.id}>
              <td>{r.i + 1}</td>
              <td>{r.name}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.series}</td>
              <td>{r.peso}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.reps}</td>
              <td>{r.entry.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Mantiene la pantalla encendida durante el entrenamiento (si el navegador lo permite).
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) void lock.release();
      } catch {
        /* no disponible */
      }
    };
    void request();
    const onVisible = () => document.visibilityState === 'visible' && void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [active]);
}
