import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, Exercise, LoadMode, RoutineSlot, Session, Unit, WorkSet } from '../../db/types';
import {
  addEntry,
  addSet,
  addSlot,
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
  makeUnilateralVariant,
  saveEntryOrder,
  useEntries,
  useExercises,
  useLastTime,
  useSession,
  useSessionSets,
  useSlots,
} from '../../lib/data';
import { capitalize, formatDayMonth, formatLong } from '../../lib/dates';
import { compactSets, deltaVs, fmtNum, formatSet, formatWeight, LOAD_LABELS, parseNum, toNotation, type SetLike } from '../../lib/format';
import { bestAtLastWeight, scoreSet } from '../../lib/progress';
import { AutoSaveText, Confirm, Segmented, Sheet, Topbar, toast } from '../components';
import { ExercisePicker } from '../ExercisePicker';
import { ProgressSheet, useProgress } from '../ProgressView';
import { ReorderList } from '../Reorder';
import { IconBell, IconBellOff, IconChart, IconCheck, IconGrip, IconMore, IconPlus, IconTrophy } from '../icons';
import { restSoundOn, setRestSoundToday, usePrefs } from '../prefs';
import { primeAudio, startRest, stopRest } from '../rest';
import { navigate } from '../router';
import { skipRef, useSkipped } from '../skipped';

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
  const [addChoice, setAddChoice] = useState<Exercise | null>(null);
  const [ordering, setOrdering] = useState(false);
  const prefs = usePrefs();
  const soundOn = restSoundOn(prefs);

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

  const addAndScroll = async (exerciseId: string, slotId: string | null) => {
    await addEntry(session.id, exerciseId, slotId);
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
  };
  const chooseAdd = async (kind: 'normal' | 'opcional' | null) => {
    const ex = addChoice!;
    setAddChoice(null);
    const slot = kind && session.routineId ? await addSlot(session.routineId, ex.id, kind) : null;
    await addAndScroll(ex.id, slot?.id ?? null);
    if (kind) toast(kind === 'opcional' ? 'Agregado a la rutina como opcional' : 'Agregado a la rutina');
  };

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
            <>
              <button
                className="icon-btn"
                style={{ color: soundOn ? 'var(--accent)' : 'var(--faint)' }}
                aria-label={soundOn ? 'Sonido del descanso encendido hoy. Tocar para apagar' : 'Sonido del descanso apagado hoy. Tocar para encender'}
                onClick={() => {
                  setRestSoundToday(!soundOn);
                  if (!soundOn) primeAudio();
                  toast(soundOn ? 'Sonido del descanso apagado (solo hoy)' : 'Sonido del descanso encendido (solo hoy)');
                }}
              >
                {soundOn ? <IconBell /> : <IconBellOff />}
              </button>
              <button className="btn primary small" onClick={() => setConfirmFinish(true)}>
                Terminar
              </button>
            </>
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
            {editable && entries.length > 1 && (
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
                <button className="btn ghost small" onClick={() => setOrdering(true)}>
                  <IconGrip size={16} /> Ordenar
                </button>
              </div>
            )}
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
            // En una rutina, preguntar si es solo por hoy o si se queda en la rutina (normal u opcional).
            if (session.routineId && live) setAddChoice(ex);
            else await addAndScroll(ex.id, null);
          }}
        />
      )}
      {ordering && (
        <OrderSheet entries={entries} exercises={exercises} routineSlots={session.routineId ? slots : undefined} onClose={() => setOrdering(false)} />
      )}
      {addChoice && session.routineId && (
        <Sheet title={addChoice.name} onClose={() => setAddChoice(null)}>
          <p className="muted small" style={{ marginTop: 0 }}>
            ¿Lo agrego solo a este entrenamiento o también a tu rutina?
          </p>
          <MenuButton label="Solo hoy" onClick={() => void chooseAdd(null)} />
          <MenuButton label="Hoy y en la rutina" onClick={() => void chooseAdd('normal')} />
          <MenuButton label="Hoy y en la rutina como opcional" onClick={() => void chooseAdd('opcional')} />
        </Sheet>
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

function OrderSheet({
  entries,
  exercises,
  routineSlots,
  onClose,
}: {
  entries: Entry[];
  exercises: Map<string, Exercise>;
  routineSlots: RoutineSlot[] | undefined;
  onClose: () => void;
}) {
  const [alsoRoutine, setAlsoRoutine] = useState(false);
  // El último orden que arrastraste (la lista de la base puede tardar un instante en actualizarse).
  const latest = useRef<Entry[] | null>(null);
  return (
    <Sheet title="Ordenar ejercicios" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Arrastra ☰ para mover un ejercicio.
      </p>
      <ReorderList
        items={entries}
        keyOf={(e) => e.id}
        label={(e) => exercises.get(e.exerciseId)?.name ?? '?'}
        onReorder={(next) => {
          latest.current = next;
          void saveEntryOrder(next);
        }}
        render={(e) => <div style={{ fontWeight: 600 }}>{exercises.get(e.exerciseId)?.name ?? '?'}</div>}
      />
      {routineSlots && (
        <label className="row" style={{ margin: '14px 2px 4px', minHeight: 32 }}>
          <span style={{ flex: 1 }}>Guardar este orden también en la rutina</span>
          <input type="checkbox" checked={alsoRoutine} onChange={(e) => setAlsoRoutine(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} />
        </label>
      )}
      <button
        className="btn primary block"
        style={{ marginTop: 10 }}
        onClick={async () => {
          if (alsoRoutine && routineSlots) {
            await saveEntryOrder(latest.current ?? entries, routineSlots);
            toast('Orden guardado en la rutina');
          }
          onClose();
        }}
      >
        Listo
      </button>
    </Sheet>
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
  const progress = useProgress(exercise, session.id);
  const [showProgress, setShowProgress] = useState(false);
  const skipKey = `${entry.id}:${entry.exerciseId}`;
  const skipped = useSkipped(skipKey);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<null | 'notes' | 'dayNote' | 'change' | 'variant' | 'remove'>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  if (!exercise) return null;
  const refSets = last?.sets ?? [];
  // Series de la vez pasada que siguen "planeadas" hoy (las que quitaste deslizando ya no cuentan).
  const refs = refSets.map((s, k) => ({ s, k })).filter((r) => !skipped.includes(r.k));
  const ghostCount = live ? Math.max(0, refs.length - sets.length) : 0;
  const doneSets = sets.filter((s) => s.done === 1);
  // "Récord" = hoy superaste tu mejor serie de siempre (peso y reps combinados).
  const bestBefore = progress?.bestPoint?.score;
  const todayScore = progress ? Math.max(0, ...doneSets.map((s) => scoreSet(s, progress.metric, exercise.unit))) : 0;
  const isPR = bestBefore != null && todayScore > bestBefore + 1e-6;
  const hint = progress ? bestAtLastWeight(progress, exercise.unit) : null;
  const complete = sets.length > 0 && ghostCount === 0 && sets.every((s) => s.done === 1);
  const maxOrder = sets.reduce((m, s) => Math.max(m, s.order), -1);
  const variants = slot && slot.exerciseIds.length > 1 ? slot.exerciseIds.map((id) => exercises.get(id)).filter((e): e is Exercise => !!e) : [];
  const total = sets.length + ghostCount;
  const unilateral = exercise.unilateral === 1;

  const addEmptySet = async () => {
    const prev = sets[sets.length - 1] ?? refs[refs.length - 1]?.s ?? refSets[refSets.length - 1];
    await addSet(entry, session.date, maxOrder + 1, {
      weight: prev?.weight ?? null,
      reps: prev?.reps ?? null,
      repsR: unilateral ? (prev?.repsR ?? prev?.reps ?? null) : null,
      unit: prev?.unit ?? exercise.unit,
      load: prev?.load ?? exercise.load,
      weight2: prev?.weight2 ?? null,
      reps2: prev?.reps2 ?? null,
      seconds: prev?.seconds ?? null,
      done: 0,
    });
  };

  /** Quitar la fila i: si es una serie de hoy se borra; en ambos casos esa serie de la vez pasada deja de estar planeada. */
  const removeRow = async (i: number) => {
    if (refs[i]) skipRef(skipKey, refs[i].k);
    if (i < sets.length) await deleteSet(sets[i]);
  };

  return (
    <div className={`entry${complete ? ' complete' : ''}`}>
      <div className="entry-head">
        <div className="entry-num">{complete ? <IconCheck size={14} /> : index + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button className="entry-name" onClick={() => setShowProgress(true)} aria-label={`${exercise.name}: ver progreso`}>
            {exercise.name}
            <span className="chart-hint">
              <IconChart size={16} />
            </span>
          </button>
          {(slot?.kind === 'opcional' || entry.note || isPR || entry.review === 1 || unilateral) && (
            <div className="row wrap" style={{ marginTop: 4, gap: 6 }}>
              {slot?.kind === 'opcional' && <span className="badge">Opcional</span>}
              {unilateral && <span className="badge">Izq / Der</span>}
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
        {progress?.bestPoint && (
          <div className="best-line">
            Tu mejor · {formatDayMonth(progress.bestPoint.date)}: <b>{formatSet(progress.bestPoint.best)}</b>
            {progress.last && progress.last.sessionId !== progress.bestPoint.sessionId && progress.lastVsBest != null && (
              <span className="faint"> · la última vez, {Math.round(progress.lastVsBest * 100)}%</span>
            )}
          </div>
        )}
        {hint && (
          <div className="best-hint">
            Con {formatWeight(hint.set)} ya has hecho {fmtNum(hint.reps)} reps ({formatDayMonth(hint.date)})
          </div>
        )}
        {entry.review === 1 && entry.raw && <div className="raw" style={{ marginTop: 8 }}>{entry.reviewReason ? `${entry.reviewReason}\n` : ''}{entry.raw}</div>}

        {total > 0 && (
          <div className="sets">
            <div className={`sets-head${unilateral ? ' uni' : ''}`}>
              <span style={{ textAlign: 'center' }}>Serie</span>
              <span style={{ textAlign: 'center' }}>Peso</span>
              <span style={{ textAlign: 'center' }}>{unilateral ? 'Reps izq · der' : 'Reps'}</span>
              <span />
            </div>
            {Array.from({ length: total }, (_, i) => (
              <SetRow
                key={`row-${i}`}
                index={i}
                set={sets[i]}
                reference={refs[i]?.s}
                fallback={sets[i - 1] ?? refs[refs.length - 1]?.s ?? refSets[refSets.length - 1]}
                order={i < sets.length ? sets[i].order : maxOrder + 1 + (i - sets.length)}
                entry={entry}
                session={session}
                exercise={exercise}
                editable={editable}
                onRemove={() => removeRow(i)}
              />
            ))}
            {editable && total > 0 && <div className="faint tiny swipe-hint">Desliza una serie a la izquierda para quitarla</div>}
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
          <MenuButton label={entry.note ? `Nota del día: ${entry.note}` : 'Nota del día (ej. Agarre abierto)'} onClick={() => (setMenu(false), setSheet('dayNote'))} />
          <MenuButton label="Editar notas del ejercicio" onClick={() => (setMenu(false), setSheet('notes'))} />
          {!unilateral && (
            <MenuButton
              label="Hacerlo unilateral (variante con izquierda y derecha)"
              onClick={async () => {
                setMenu(false);
                const v = await makeUnilateralVariant(entry, exercise, slot);
                toast(slot ? `${v.name} quedó como variante` : `Cambiado a ${v.name}`);
              }}
            />
          )}
          <MenuButton label="Cambiar por otro ejercicio" onClick={() => (setMenu(false), setSheet('change'))} />
          {slot && <MenuButton label="Agregar una variante a la rutina" onClick={() => (setMenu(false), setSheet('variant'))} />}
          {slot && slot.kind !== 'no' && (
            <MenuButton
              label={slot.kind === 'opcional' ? 'Quitar “opcional” (hacerlo siempre)' : 'Marcar como opcional en la rutina'}
              onClick={async () => {
                setMenu(false);
                const kind = slot.kind === 'opcional' ? 'normal' : 'opcional';
                await updateSlot(slot, { kind });
                toast(kind === 'opcional' ? 'Ahora es opcional en la rutina' : 'Ya no es opcional');
              }}
            />
          )}
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
      {showProgress && <ProgressSheet exercise={exercise} excludeSessionId={session.id} onClose={() => setShowProgress(false)} />}
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
  rR: string;
  w2: string;
  r2: string;
  sec: string;
}

const toText = (n: number | null | undefined) => (n == null ? '' : fmtNum(n));

function textsFrom(set: SetLike | undefined): Texts {
  return { w: toText(set?.weight), r: toText(set?.reps), rR: toText(set?.repsR), w2: toText(set?.weight2), r2: toText(set?.reps2), sec: toText(set?.seconds) };
}

const SWIPE_DELETE_AT = -70;

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
  onRemove,
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
  onRemove: () => Promise<void>;
}) {
  const source: SetLike | undefined = reference ?? fallback;
  const [texts, setTexts] = useState<Texts>(() => textsFrom(set));
  const [menu, setMenu] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
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
  const unilateral = !timeMode && (exercise.unilateral === 1 || current?.repsR != null);
  const done = current?.done === 1;
  const delta = done && current ? deltaVs(current, reference) : null;
  const ghost = !current;

  const placeholder = (field: 'weight' | 'reps' | 'repsR' | 'weight2' | 'reps2' | 'seconds') => {
    const v = field === 'repsR' ? (source?.repsR ?? source?.reps) : source?.[field];
    if (field === 'weight' && load === 'lado' && v === 0) return 'Barra';
    if (field === 'weight' && load === 'corporal' && v == null) return '—';
    return v == null ? '' : fmtNum(v);
  };

  /** Guarda la fila completa. Con `doneFlag` = 1, lo vacío se llena con lo de la vez pasada. */
  const persist = async (next: Texts, doneFlag?: 0 | 1, overrides: Partial<WorkSet> = {}) => {
    const fill = doneFlag === 1;
    const pick = (text: string, ph: number | null | undefined) => {
      const n = parseNum(text);
      return n != null ? n : fill ? (ph ?? null) : null;
    };
    const values = {
      weight: pick(next.w, source?.weight ?? (load === 'lado' ? 0 : null)),
      reps: timeMode ? null : pick(next.r, source?.reps),
      repsR: unilateral ? pick(next.rR, source?.repsR ?? source?.reps) : null,
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

  // ── Deslizar a la izquierda para quitar (siempre pide confirmación) ──
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const gesture = useRef<{ x: number; y: number; id: number; horizontal: boolean } | null>(null);
  const justSwiped = useRef(false);
  const moveTo = (v: number) => {
    dxRef.current = v;
    setDx(v);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || e.button > 0) return;
    gesture.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const ddx = e.clientX - g.x;
    const ddy = e.clientY - g.y;
    if (!g.horizontal) {
      if (Math.abs(ddy) > 10 && Math.abs(ddy) > Math.abs(ddx)) {
        gesture.current = null; // es scroll vertical
        return;
      }
      if (Math.abs(ddx) < 12 || Math.abs(ddx) < Math.abs(ddy) * 1.3) return;
      g.horizontal = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    moveTo(Math.max(-130, Math.min(0, ddx)));
  };
  const onPointerEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.horizontal) return;
    justSwiped.current = true;
    setTimeout(() => (justSwiped.current = false), 350);
    if (dxRef.current <= SWIPE_DELETE_AT) {
      moveTo(-90);
      setConfirmRemove(true);
    } else {
      moveTo(0);
    }
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
  const n = index + 1;

  const repsCell = timeMode ? (
    field('sec', placeholder('seconds'), { suffix: <span className="affix">s</span>, label: `Segundos serie ${n}` })
  ) : unilateral ? (
    <div className="uni-reps">
      {field('r', placeholder('reps'), { prefix: 'I', label: `Reps izquierda serie ${n}` })}
      {field('rR', placeholder('repsR'), { prefix: 'D', label: `Reps derecha serie ${n}` })}
    </div>
  ) : (
    field('r', placeholder('reps'), { label: `Reps serie ${n}` })
  );

  return (
    <>
      <div className={`swipe${dx < 0 ? ' swiping' : ''}`}>
        <div className="swipe-bg" aria-hidden="true">
          {ghost ? 'Quitar' : 'Borrar'}
        </div>
        <div
          className="swipe-fg"
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClickCapture={(e) => {
            if (justSwiped.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <div className={`set-row${unilateral ? ' uni' : ''}${done ? ' done' : ''}${ghost ? ' ghost' : ''}`}>
            <button className="set-num" onClick={() => editable && setMenu(true)} aria-label={`Serie ${n}, opciones`}>
              {n}
              {delta && <span className={`delta ${delta}`}>{delta === 'up' ? '▲' : delta === 'down' ? '▼' : '='}</span>}
            </button>
            {field('w', placeholder('weight'), { prefix: weightPrefix, suffix: unitButton, label: `Peso serie ${n}` })}
            {repsCell}
            <button className={`check${done ? ' on' : ''}`} onClick={toggleDone} disabled={!editable} aria-label={done ? 'Desmarcar serie' : 'Palomear serie'}>
              <IconCheck size={20} />
            </button>
          </div>
          {part2 && (
            <div className={`set-row${done ? ' done' : ''}`}>
              <span className="part2-label">luego /</span>
              {field('w2', placeholder('weight2'), { prefix: weightPrefix, suffix: <span className="affix">{unit}</span>, label: `Peso parte 2 serie ${n}` })}
              {timeMode ? <span /> : field('r2', placeholder('reps2'), { label: `Reps parte 2 serie ${n}` })}
              <span />
            </div>
          )}
        </div>
      </div>

      {menu && (
        <Sheet title={`Serie ${n}`} onClose={() => setMenu(false)}>
          {current && (
            <>
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
                  void updateSet(current, timeMode ? { seconds: null } : { reps: null, repsR: null, reps2: null });
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
            </>
          )}
          <MenuButton
            label={ghost ? 'Quitar esta serie (solo hoy)' : 'Borrar serie'}
            danger
            onClick={() => {
              setMenu(false);
              setConfirmRemove(true);
            }}
          />
        </Sheet>
      )}
      {confirmRemove && (
        <Confirm
          title={ghost ? `¿Quitar la serie ${n}?` : `¿Borrar la serie ${n}?`}
          message={
            ghost
              ? 'Solo para hoy: no se guarda nada. La próxima vez verás las series que sí hagas.'
              : `${formatSet(current!)} se borra de este entrenamiento.`
          }
          confirmLabel={ghost ? 'Quitar' : 'Borrar'}
          danger
          onClose={() => {
            setConfirmRemove(false);
            moveTo(0);
          }}
          onConfirm={async () => {
            await onRemove();
            moveTo(0);
          }}
        />
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
