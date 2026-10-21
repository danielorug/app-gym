import { describe, expect, it } from 'vitest';
import { addDays, isSeparator, parseDateHeading } from './dates';

describe('parseDateHeading', () => {
  it('formatos de la nota', () => {
    expect(parseDateHeading('23 Julio 2026', null)).toEqual({ date: '2026-07-23', label: null });
    expect(parseDateHeading('3 de Agosto', '2026-08-01')).toEqual({ date: '2026-08-03', label: null });
    expect(parseDateHeading('B28 Julio 2026', '2026-07-27')).toEqual({ date: '2026-07-28', label: null });
    expect(parseDateHeading('16 de Oct 2026', '2026-10-15')).toEqual({ date: '2026-10-16', label: null });
    expect(parseDateHeading('6 de octubre 2026', null)?.date).toBe('2026-10-06');
    expect(parseDateHeading('8 de Agosto (Full body)', '2026-08-07')).toEqual({ date: '2026-08-08', label: 'Full body' });
    expect(parseDateHeading('21 de Septiembre', '2026-09-17')?.date).toBe('2026-09-21');
  });
  it('día suelto = mismo mes que la sesión anterior', () => {
    expect(parseDateHeading('15', '2026-10-14')?.date).toBe('2026-10-15');
    expect(parseDateHeading('15', null)).toBeNull();
  });
  it('no confunde texto normal con fechas', () => {
    expect(parseDateHeading('Lunes: espalda y bíceps', null)).toBeNull();
    expect(parseDateHeading('Sábado: Pierna (opcional): Está bien espalda y bicep', null)).toBeNull();
    expect(parseDateHeading('3 series de press', null)).toBeNull();
  });
  it('separadores y suma de días', () => {
    expect(isSeparator('—————————————')).toBe(true);
    expect(isSeparator('23 Julio 2026')).toBe(false);
    expect(addDays('2026-10-16', 1)).toBe('2026-10-17');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
});
