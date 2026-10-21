import { describe, expect, it } from 'vitest';
import type { SetLike } from './format';
import { bestSet, compactSets, deltaVs, formatSet, formatWeight, parseNum, toNotation } from './format';

const s = (weight: number | null, reps: number | null, extra: Partial<SetLike> = {}): SetLike => ({
  weight,
  reps,
  unit: 'kg',
  load: 'normal',
  weight2: null,
  reps2: null,
  seconds: null,
  ...extra,
});

describe('parseNum', () => {
  it('acepta coma decimal del teclado en español', () => {
    expect(parseNum('17,5')).toBe(17.5);
    expect(parseNum(' 23 ')).toBe(23);
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
  });
});

describe('formatWeight', () => {
  it('formatea cada modo de peso', () => {
    expect(formatWeight(s(23, 7))).toBe('23 kg');
    expect(formatWeight(s(25, 6, { load: 'lado', unit: 'lb' }))).toBe('2×25 lb');
    expect(formatWeight(s(0, 12, { load: 'lado', unit: 'lb' }))).toBe('Barra');
    expect(formatWeight(s(null, 5, { load: 'corporal' }))).toBe('Corporal');
    expect(formatWeight(s(-4.5, 5, { load: 'corporal' }))).toBe('Corporal −4.5 kg');
    expect(formatSet(s(32, 8, { weight2: 18, reps2: 4 }))).toBe('32/18 kg × 8/4');
  });
});

describe('compactSets / toNotation', () => {
  const shoulder = [s(14, 12), s(18, 10), s(23, 7), s(23, 6)];
  it('agrupa series idénticas seguidas', () => {
    expect(compactSets([s(23, 7), s(23, 7), s(23, 6)])).toBe('23 kg × 7 (2 series) · 23 kg × 6');
    const plates = { load: 'lado' as const, unit: 'lb' as const };
    expect(compactSets([s(0, 12, plates), s(5, 10, plates), s(5, 10, plates)])).toBe('Barra × 12 · 2×5 lb × 10 (2 series)');
    expect(compactSets(shoulder)).toBe('14 kg × 12 · 18 kg × 10 · 23 kg × 7 · 23 kg × 6');
  });
  it('genera la notación de las notas', () => {
    expect(toNotation([s(45, 7), s(45, 7), s(45, 8)])).toEqual({ series: '2 - 1', peso: '45 kg - 45 kg', reps: '7 - 8' });
    expect(toNotation(shoulder)).toEqual({ series: '1 - 1 - 1 - 1', peso: '14 kg - 18 kg - 23 kg - 23 kg', reps: '12 - 10 - 7 - 6' });
  });
});

describe('récords y comparación', () => {
  it('elige la mejor serie por peso y luego reps', () => {
    expect(bestSet([s(14, 12), s(23, 6), s(23, 7), s(18, 10)])).toEqual(s(23, 7));
  });
  it('compara barra con discos usando el peso total', () => {
    const bench = s(25, 6, { load: 'lado', unit: 'lb' });
    expect(deltaVs(s(30, 5, { load: 'lado', unit: 'lb' }), bench)).toBe('up');
    expect(deltaVs(s(25, 6, { load: 'lado', unit: 'lb' }), bench)).toBe('same');
    expect(deltaVs(s(25, 5, { load: 'lado', unit: 'lb' }), bench)).toBe('down');
    expect(deltaVs(s(25, 5), undefined)).toBeNull();
  });
});
