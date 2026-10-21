// Modelo de datos de la app.
// Todas las tablas comparten `id`, `updatedAt` y `deleted` para poder sincronizar
// con Google Sheets (gana el cambio más reciente; nunca se borra físicamente).

export type Unit = 'kg' | 'lb';

/**
 * Cómo se interpreta el peso de una serie:
 * - normal:   el número de la máquina / mancuerna (mancuernas = peso por mano)
 * - lado:     discos por lado + barra ("2x25" → weight = 25). weight 0 = solo barra
 * - corporal: peso corporal. weight = lastre extra (+) o ayuda de máquina (−); null = nada
 */
export type LoadMode = 'normal' | 'lado' | 'corporal';

/** 0/1 en vez de boolean para poder indexar en IndexedDB y guardar en Sheets. */
export type Flag = 0 | 1;

export interface Base {
  id: string;
  updatedAt: number; // ms desde epoch
  deleted: Flag;
  /** 1 = cambio local pendiente de subir a Sheets. Solo existe en el dispositivo. */
  dirty?: Flag;
}

export interface Exercise extends Base {
  name: string;
  unit: Unit; // unidad por defecto
  load: LoadMode; // modo de peso por defecto
  /** Notas que se quedan: ajustes de máquina, técnica, metas. */
  notes: string;
  archived: Flag;
  createdAt: number;
}

/** Un día de la rutina: "Pecho, hombro y tríceps". */
export interface Routine extends Base {
  name: string;
  /** 0=Dom, 1=Lun … 6=Sáb */
  weekdays: number[];
  order: number;
}

/**
 * normal:   se hace siempre
 * opcional: solo si da tiempo
 * no:       no está en la rutina, pero se guarda para no perder el récord
 */
export type SlotKind = 'normal' | 'opcional' | 'no';

/** Un lugar dentro de la rutina, con sus variantes intercambiables. */
export interface RoutineSlot extends Base {
  routineId: string;
  order: number;
  /** Variantes (ej. [Press de banca, Converging Chest Press]). La primera es la principal. */
  exerciseIds: string[];
  kind: SlotKind;
}

export interface Session extends Base {
  date: string; // YYYY-MM-DD
  routineId: string | null;
  title: string;
  notes: string;
  startedAt: number | null;
  finishedAt: number | null;
  source: 'app' | 'notas';
}

/** Un ejercicio dentro de una sesión. */
export interface Entry extends Base {
  sessionId: string;
  exerciseId: string;
  slotId: string | null;
  order: number;
  /** Nota solo de ese día (ej. "Unilateral"). */
  note: string;
  /** Texto original de la nota importada, para revisar. */
  raw: string;
  /** 1 = el importador no estuvo seguro; aparece en "Revisar". */
  review: Flag;
  reviewReason: string;
}

export interface WorkSet extends Base {
  entryId: string;
  sessionId: string;
  exerciseId: string;
  date: string; // copia de session.date para buscar historial rápido
  order: number;
  weight: number | null;
  unit: Unit;
  load: LoadMode;
  reps: number | null; // admite medias reps (5.5)
  /** Segunda parte de la serie con "/" (ej. juntos 32 kg × 8 / unilateral 18 kg × 4). */
  weight2: number | null;
  reps2: number | null;
  /** Para ejercicios por tiempo (colgarse). */
  seconds: number | null;
  done: Flag;
  /** 1 = peso dudoso ("creo") */
  doubtful: Flag;
}

export interface Backup {
  app: 'app-gym';
  version: 1;
  exportedAt: number;
  exercises: Exercise[];
  routines: Routine[];
  slots: RoutineSlot[];
  sessions: Session[];
  entries: Entry[];
  sets: WorkSet[];
}

export type TableName = 'exercises' | 'routines' | 'slots' | 'sessions' | 'entries' | 'sets';

export const TABLES: TableName[] = ['exercises', 'routines', 'slots', 'sessions', 'entries', 'sets'];

export interface RowByTable {
  exercises: Exercise;
  routines: Routine;
  slots: RoutineSlot;
  sessions: Session;
  entries: Entry;
  sets: WorkSet;
}
