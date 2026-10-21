import { describe, expect, it } from 'bun:test';
import { Money, MoneyError } from './money';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('Money', () => {
  it('cria a partir de string com 2 casas', () => {
    expect(brl('25.50').toString()).toBe('25.50');
    expect(brl('10.5').toString()).toBe('10.50');
    expect(brl('7').toString()).toBe('7.00');
  });

  it('rejeita valores inválidos', () => {
    const invalidos = [
      '',
      'abc',
      'NaN',
      'Infinity',
      '1e3',
      '-10.00',
      '1.999',
      ' 10.00',
      '10.',
    ];

    for (const valor of invalidos) {
      expect(() => brl(valor)).toThrow(MoneyError);
    }
  });

  it('rejeita moeda inválida', () => {
    expect(() => Money.from({ amount: '1.00', currency: 'brl' })).toThrow(
      MoneyError,
    );
    expect(() => Money.from({ amount: '1.00', currency: 'REAL' })).toThrow(
      MoneyError,
    );
  });

  it('soma e subtrai sem erro de arredondamento', () => {
    expect(brl('0.10').add(brl('0.20')).toString()).toBe('0.30');
    expect(brl('100.00').subtract(brl('80.00')).toString()).toBe('20.00');
  });

  it('não altera o valor original', () => {
    const a = brl('10.00');
    a.add(brl('5.00'));

    expect(a.toString()).toBe('10.00');
  });

  it('não deixa operar moedas diferentes', () => {
    const dolar = Money.from({ amount: '1.00', currency: 'USD' });

    expect(() => brl('1.00').add(dolar)).toThrow(MoneyError);
    expect(() => brl('1.00').subtract(dolar)).toThrow(MoneyError);
    expect(() => brl('1.00').isLessThan(dolar)).toThrow(MoneyError);
  });

  it('faz as comparações', () => {
    expect(Money.zero('BRL').isZero()).toBe(true);
    expect(brl('1.00').isPositive()).toBe(true);
    expect(brl('1.00').subtract(brl('2.00')).isNegative()).toBe(true);
    expect(brl('1.00').isLessThan(brl('2.00'))).toBe(true);
    expect(brl('5.00').equals(brl('5.00'))).toBe(true);
    expect(
      brl('5.00').equals(Money.from({ amount: '5.00', currency: 'USD' })),
    ).toBe(false);
  });

  it('negate e toJSON', () => {
    expect(brl('25.00').negate().toString()).toBe('-25.00');
    expect(brl('25.00').toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
  });
});
