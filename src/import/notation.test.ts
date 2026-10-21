import { describe, expect, it } from 'vitest';
import { expandRow, parseCounts, parseRepsCell, parseWeightToken } from './notation';

const brief = (series: string, peso: string, reps: string, opts?: { bodyweight?: boolean }) => {
  const { sets, issues } = expandRow(series, peso, reps, opts);
  return { sets: sets.map((s) => [s.weight, s.unit, s.load, s.reps, s.weight2, s.reps2]), issues };
};

describe('parseCounts', () => {
  it('lee grupos de series', () => {
    expect(parseCounts('1 - 2 - 1')).toEqual([1, 2, 1]);
    expect(parseCounts('3')).toEqual([3]);
    expect(parseCounts('1-1')).toEqual([1, 1]);
    expect(parseCounts('1 - 1 - ')).toEqual([1, 1]);
  });
  it('rechaza basura', () => {
    expect(parseCounts('10 - ')).toBeNull(); // typo: 10 series no es creíble
    expect(parseCounts('3–4')).toBeNull();
    expect(parseCounts('20 min')).toBeNull();
    expect(parseCounts('50lbs')).toBeNull();
    expect(parseCounts('—')).toBeNull();
  });
});

describe('parseWeightToken', () => {
  it('discos por lado y barra', () => {
    expect(parseWeightToken('2x25')).toMatchObject({ weight: 25, load: 'lado', unit: null });
    expect(parseWeightToken('5x2')).toMatchObject({ weight: 5, load: 'lado' });
    expect(parseWeightToken('2x45lbs')).toMatchObject({ weight: 45, load: 'lado', unit: 'lb' });
    expect(parseWeightToken('Barra')).toMatchObject({ weight: 0, load: 'lado' });
    expect(parseWeightToken('B')).toMatchObject({ weight: 0, load: 'lado' });
  });
  it('unidades, ayuda, dudas y combinadas', () => {
    expect(parseWeightToken('20.2k')).toMatchObject({ weight: 20.2, unit: 'kg' });
    expect(parseWeightToken('23kh')).toMatchObject({ weight: 23, unit: 'kg' });
    expect(parseWeightToken('17.5 lbs')).toMatchObject({ weight: 17.5, unit: 'lb' });
    expect(parseWeightToken('4.5 kg de ayuda')).toMatchObject({ weight: -4.5, unit: 'kg', load: 'corporal' });
    expect(parseWeightToken('Peso corporal')).toMatchObject({ weight: null, load: 'corporal' });
    expect(parseWeightToken('25 kg (creo)')).toMatchObject({ weight: 25, doubtful: true });
    expect(parseWeightToken('40 lbs creo')).toMatchObject({ weight: 40, unit: 'lb', doubtful: true });
    expect(parseWeightToken('32/18kg')).toMatchObject({ weight: 32, weight2: 18, unit: 'kg' });
    expect(parseWeightToken('12.5 lb (c/mano)')).toMatchObject({ weight: 12.5, unit: 'lb', load: 'normal' });
    expect(parseWeightToken('___ kg')).toMatchObject({ placeholder: true, weight: null });
  });
});

describe('parseRepsCell', () => {
  it('reps, combinadas y basura', () => {
    expect(parseRepsCell('12 - 10 - - 9 - 8').map((r) => r.reps)).toEqual([12, 10, 9, 8]);
    expect(parseRepsCell('10 -oh 10 - 9').map((r) => r.reps)).toEqual([10, 10, 9]);
    expect(parseRepsCell('8 (mal hechas) - 10 - 8').map((r) => r.reps)).toEqual([8, 10, 8]);
    expect(parseRepsCell('8/5 -')).toEqual([{ reps: 8, reps2: 5, seconds: null, doubtful: false }]);
    expect(parseRepsCell('7 c/u + 7 ambos')).toEqual([{ reps: 7, reps2: 7, seconds: null, doubtful: false }]);
    expect(parseRepsCell('10 / 8 / 10').map((r) => r.reps)).toEqual([10, 8, 10]);
    expect(parseRepsCell('Al fallo')).toEqual([]);
    expect(parseRepsCell('3 - 3.5 - 3.7').map((r) => r.reps)).toEqual([3, 3.5, 3.7]);
  });
  it('rangos de plantilla y tiempo', () => {
    expect(parseRepsCell('8-10')).toEqual([{ reps: 8, reps2: null, seconds: null, doubtful: true }]);
    expect(parseRepsCell('1 minuto - 30 sgs').map((r) => r.seconds)).toEqual([60, 30]);
    expect(parseRepsCell('40 sgs').map((r) => r.seconds)).toEqual([40]);
    expect(parseRepsCell('15-20 s')).toEqual([{ reps: null, reps2: null, seconds: 15, doubtful: true }]);
  });
});

describe('expandRow (ejemplos de la conversación)', () => {
  it('1 - 1 - 2 | 14kg - 18kg - 23kg | 12 - 10 - 7 - 6', () => {
    expect(brief('1 - 1 - 2', '14kg - 18kg - 23kg', '12 - 10 - 7 - 6')).toEqual({
      sets: [
        [14, 'kg', 'normal', 12, null, null],
        [18, 'kg', 'normal', 10, null, null],
        [23, 'kg', 'normal', 7, null, null],
        [23, 'kg', 'normal', 6, null, null],
      ],
      issues: [],
    });
  });
  it('1 - 1 - 1 - 1 | 14kg - 18kg - 23kg | 12 - 10 - 7 - 6 (el último peso se repite)', () => {
    const r = brief('1 - 1 - 1 - 1', '14kg - 18kg - 23kg', '12 - 10 - 7 - 6');
    expect(r.sets.map((s) => [s[0], s[3]])).toEqual([[14, 12], [18, 10], [23, 7], [23, 6]]);
    expect(r.issues).toEqual([]);
  });
  it('series a medias: 1 - 1 - | B-5x2 - 15x2 | 12 - 12 - 7', () => {
    const r = brief('1 - 1 - ', 'B-5x2 - 15x2', '12 - 12 - 7');
    expect(r.sets).toHaveLength(3);
    expect(r.issues).toEqual([]);
  });
  it('2 - 1 | 45kg - 45kg | 7 - 8 (reps por grupo)', () => {
    expect(brief('2 - 1', '45kg - 45kg', '7 - 8').sets.map((s) => s[3])).toEqual([7, 7, 8]);
  });
  it('1 - 1 - 1 | 27kg | 9 - 8 - 10 (un peso para todas)', () => {
    const r = brief('1 - 1 - 1', '27kg', '9 - 8 - 10');
    expect(r.sets.map((s) => [s[0], s[3]])).toEqual([[27, 9], [27, 8], [27, 10]]);
    expect(r.issues).toEqual([]);
  });
  it('1 - 2 - 1 | Barra - 5x2 - 7.5x2 | 12 - 10 - 7', () => {
    const r = brief('1 - 2 - 1', 'Barra - 5x2 - 7.5x2', '12 - 10 - 7');
    expect(r.sets.map((s) => [s[0], s[2], s[3]])).toEqual([
      [0, 'lado', 12],
      [5, 'lado', 10],
      [5, 'lado', 10],
      [7.5, 'lado', 7],
    ]);
    expect(r.issues).toEqual([]);
  });
  it('2 - 1 | 32/18kg - 25/11kg | 8/4 - 8/6 (juntos / unilateral)', () => {
    expect(brief('2 - 1', '32/18kg - 25/11kg', '8/4 - 8/6').sets).toEqual([
      [32, 'kg', 'normal', 8, 18, 4],
      [32, 'kg', 'normal', 8, 18, 4],
      [25, 'kg', 'normal', 8, 11, 6],
    ]);
  });
  it('3 | 32 kg | 10 (atajo)', () => {
    const r = brief('3', '32 kg', '10');
    expect(r.sets).toHaveLength(3);
    expect(r.sets.every((s) => s[0] === 32 && s[3] === 10)).toBe(true);
  });
  it('2 - 1 - 1 - 1 | 70 lbs - 90 - 110 | 6 - 6 - 5 → hay que revisar', () => {
    const r = brief('2 - 1 - 1 - 1', '70 lbs - 90 - 110', '6 - 6 - 5');
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.sets.every((s) => s[1] === 'lb')).toBe(true);
  });
  it('typo en Series: 10 - | 30lbs - 30 - 32.5 | 10 - 10 - 10', () => {
    const r = brief('10 - ', '30lbs - 30 - 32.5', '10 - 10 - 10');
    expect(r.sets.map((s) => [s[0], s[1], s[3]])).toEqual([
      [30, 'lb', 10],
      [30, 'lb', 10],
      [32.5, 'lb', 10],
    ]);
    expect(r.issues).toEqual([]);
  });
  it('pesos con guion pegado: B-5x2 - 15x2 con 1 - 1 -', () => {
    expect(brief('1 - 1 - ', 'B-5x2 - 15x2', '12 - 12 - 7').sets.map((s) => [s[0], s[3]])).toEqual([
      [0, 12],
      [5, 12],
      [15, 7],
    ]);
  });
  it('peso corporal sin peso anotado', () => {
    expect(brief('2', '-', '3', { bodyweight: true }).sets).toEqual([
      [null, null, 'corporal', 3, null, null],
      [null, null, 'corporal', 3, null, null],
    ]);
  });
  it('formato viejo con " / ": 4 | 5 / 7.5 / 10 / 15 kg | 12', () => {
    expect(brief('4', '5 / 7.5 / 10 / 15 kg', '12').sets.map((s) => [s[0], s[1]])).toEqual([
      [5, 'kg'],
      [7.5, 'kg'],
      [10, 'kg'],
      [15, 'kg'],
    ]);
  });
  it('más reps que series: 1 | 14 kg | 10 - 8', () => {
    const r = brief('1', '14 kg', '10 - 8');
    expect(r.sets.map((s) => s[3])).toEqual([10, 8]);
    expect(r.issues).toContain('Hay más reps que series');
  });
});
