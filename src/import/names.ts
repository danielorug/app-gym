// Nombres de ejercicios: unifica las distintas formas en que se escribieron en Notas.

export type Group = 'push' | 'pull' | 'legs';
export type Muscle = 'pecho' | 'hombro' | 'triceps' | 'espalda' | 'biceps' | 'pierna' | 'core';

interface Canon {
  name: string;
  muscle: Muscle;
  aliases?: string[];
}

const MUSCLE_GROUP: Record<Muscle, Group> = {
  pecho: 'push',
  hombro: 'push',
  triceps: 'push',
  espalda: 'pull',
  biceps: 'pull',
  pierna: 'legs',
  core: 'legs',
};

// Nombre canónico (como lo escribe ahora) + otras formas que aparecen en la nota.
// Los alias se comparan sin acentos, mayúsculas ni signos de puntuación.
const CANON: Canon[] = [
  { name: 'Converging Chest Press', muscle: 'pecho', aliases: ['Convering chest', 'Convering chest press'] },
  { name: 'Chest Press', muscle: 'pecho' },
  { name: 'Press de banca', muscle: 'pecho' },
  { name: 'Press inclinado con barra', muscle: 'pecho', aliases: ['Press inclinado', 'Press de banca inclinado', 'Press banca inclinado', 'Press inclinado en banca'] },
  { name: 'Press inclinado con mancuernas', muscle: 'pecho', aliases: ['Mancuernas'] },
  { name: 'Peck Deck', muscle: 'pecho' },
  { name: 'Lagartijas inclinadas', muscle: 'pecho' },
  { name: 'Converging Shoulder Press', muscle: 'hombro' },
  { name: 'Shoulder Press sentado (mancuernas)', muscle: 'hombro' },
  { name: 'Elevación de hombros con mancuernas', muscle: 'hombro', aliases: ['Extensión de hombros'] },
  { name: 'Elevación de hombros en máquina', muscle: 'hombro' },
  { name: 'Extensión de tríceps en polea', muscle: 'triceps', aliases: ['Extensión de tríceps'] },
  { name: 'Extensión tríceps katana', muscle: 'triceps', aliases: ['Extensión de tríceps katana'] },
  { name: 'Extensión tríceps katana unilateral', muscle: 'triceps' },
  { name: 'Fondos', muscle: 'triceps' },
  { name: 'Fondos asistidos', muscle: 'triceps', aliases: ['Fondos asistidos (Dip Assist)'] },
  { name: 'Seated Dip', muscle: 'triceps' },
  { name: 'Jalón al pecho', muscle: 'espalda', aliases: ['Jalón para espalda'] },
  { name: 'Jalón unilateral', muscle: 'espalda', aliases: ['Jalón unilateral (cable)'] },
  { name: 'Jalón máquina (prono)', muscle: 'espalda' },
  { name: 'Jalón máquina (neutro)', muscle: 'espalda' },
  { name: 'Jalón máquina (supino)', muscle: 'espalda' },
  { name: 'Remo sentado', muscle: 'espalda', aliases: ['Remo sentado (agarre triangular)'] },
  { name: 'Remo sentado unilateral', muscle: 'espalda' },
  { name: 'Remo T en máquina', muscle: 'espalda', aliases: ['Remo en T'] },
  { name: 'Hammer T', muscle: 'espalda' },
  { name: 'Remo con barra', muscle: 'espalda' },
  { name: 'Remo a un brazo', muscle: 'espalda' },
  { name: 'Reverse Peck Deck', muscle: 'espalda' },
  { name: 'Dominadas', muscle: 'espalda' },
  { name: 'Chin ups', muscle: 'espalda', aliases: ['Chin-ups'] },
  { name: 'Chin ups asistidas', muscle: 'espalda', aliases: ['Chin-ups Assist', 'Chin Assist'] },
  { name: 'Colgarse', muscle: 'espalda', aliases: ['Colgarse de barra'] },
  { name: 'Curl de bíceps en máquina', muscle: 'biceps', aliases: ['Curl en máquina', 'Curl de bíceps sentado (máquina roja)', 'Arm Curl sentado'] },
  { name: 'Curl de bíceps con mancuernas', muscle: 'biceps' },
  { name: 'Curl martillo con mancuernas sentado', muscle: 'biceps', aliases: ['Curl martillo con mancuernas', 'Curl martillo sentado'] },
  { name: 'Peso muerto', muscle: 'pierna', aliases: ['Peso muerto. Barra +'] },
  { name: 'Peso muerto rumano', muscle: 'pierna' },
  { name: 'Sentadilla con barra', muscle: 'pierna', aliases: ['Sentadilla'] },
  { name: 'Sentadilla con mancuerna', muscle: 'pierna', aliases: ['o sentadilla con mancuerna'] },
  { name: 'Hack Squat', muscle: 'pierna', aliases: ['Hack Squat o sentadilla'] },
  { name: 'Prensa de pierna', muscle: 'pierna', aliases: ['Prensa'] },
  { name: 'Extensión de pierna', muscle: 'pierna', aliases: ['Leg Extension'] },
  { name: 'Seated Leg curl', muscle: 'pierna', aliases: ['Curl femoral sentado o acostado'] },
  { name: 'Prone Leg Curl', muscle: 'pierna' },
  { name: 'Hip Adduction', muscle: 'pierna' },
  { name: 'Abducción de piernas', muscle: 'pierna', aliases: ['Máquina de abductores (opcional)', 'Máquina de abductores'] },
  { name: 'Calf press', muscle: 'pierna', aliases: ['Elevación de pantorrillas', 'Elevación de pantorrillas (máquina)'] },
  { name: 'Pantorrilla parado', muscle: 'pierna' },
  { name: 'Abdominal crunch', muscle: 'core' },
  { name: 'Rotatory torso unilateral', muscle: 'core' },
];

/** Alias que no son 100% seguros: se listan en el reporte para que los confirme. */
export const UNSURE_ALIASES = new Set(
  [
    'Extensión de hombros',
    'Jalón para espalda',
    'Remo sentado (agarre triangular)',
    'Curl de bíceps sentado (máquina roja)',
    'Arm Curl sentado',
    'Sentadilla',
    'Curl femoral sentado o acostado',
    'Elevación de pantorrillas',
    'Elevación de pantorrillas (máquina)',
  ].map((s) => nameKey(s)),
);

/** Filas que no son ejercicios a registrar (calentamientos, cardio, etc.). */
const SKIP_PATTERNS = [/calentamiento/, /estiramiento/, /caminadora/, /caminata/, /basquet/, /^final$/, /lagartijas \+ press ligero/, /^dominadas fondos$/];

export function nameKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”"'.,:;()¿?¡!]/g, ' ')
    .replace(/[-–—+/]/g, (c) => (c === '+' ? ' + ' : ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const BY_KEY = new Map<string, Canon>();
for (const c of CANON) {
  BY_KEY.set(nameKey(c.name), c);
  for (const a of c.aliases ?? []) BY_KEY.set(nameKey(a), c);
}

export function isSkippedName(raw: string): boolean {
  const k = nameKey(raw);
  return SKIP_PATTERNS.some((re) => re.test(k));
}

export interface Resolved {
  name: string;
  muscle: Muscle | null;
  known: boolean;
}

/** Nombre canónico para un nombre tal como está escrito en la nota. */
export function canonicalName(raw: string): Resolved {
  const c = BY_KEY.get(nameKey(raw));
  if (c) return { name: c.name, muscle: c.muscle, known: true };
  // Desconocido: se respeta como está escrito (sin punto final ni espacios de más).
  const name = raw.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
  return { name, muscle: null, known: false };
}

export function muscleOf(name: string): Muscle | null {
  return BY_KEY.get(nameKey(name))?.muscle ?? null;
}

export function groupOf(name: string): Group | null {
  const m = muscleOf(name);
  return m ? MUSCLE_GROUP[m] : null;
}

/** Ejercicios de peso corporal (sin peso registrado se guardan como "corporal"). */
export function isBodyweightName(name: string): boolean {
  return /^(dominadas|chin ups|fondos|lagartijas|colgarse)/.test(nameKey(name));
}

export function slugify(s: string): string {
  return nameKey(s)
    .replace(/\+/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
