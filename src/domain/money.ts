export class MoneyError extends Error {}

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly centavos: bigint,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (!/^[A-Z]{3}$/.test(props.currency)) {
      throw new MoneyError('Moeda inválida');
    }
    if (!/^\d+(\.\d{1,2})?$/.test(props.amount)) {
      throw new MoneyError('Valor inválido');
    }

    const [parteInteira, parteDecimal = ''] = props.amount.split('.');
    const centavos =
      BigInt(parteInteira) * 100n + BigInt(parteDecimal.padEnd(2, '0'));

    return new Money(centavos, props.currency);
  }

  static fromCentavos(centavos: bigint, currency: string): Money {
    return new Money(centavos, currency);
  }

  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  add(outro: Money): Money {
    this.garantirMesmaMoeda(outro);
    return new Money(this.centavos + outro.centavos, this.currency);
  }

  subtract(outro: Money): Money {
    this.garantirMesmaMoeda(outro);
    return new Money(this.centavos - outro.centavos, this.currency);
  }

  negate(): Money {
    return new Money(-this.centavos, this.currency);
  }

  isZero(): boolean {
    return this.centavos === 0n;
  }

  isPositive(): boolean {
    return this.centavos > 0n;
  }

  isNegative(): boolean {
    return this.centavos < 0n;
  }

  isLessThan(outro: Money): boolean {
    this.garantirMesmaMoeda(outro);
    return this.centavos < outro.centavos;
  }

  equals(outro: Money): boolean {
    return this.currency === outro.currency && this.centavos === outro.centavos;
  }

  getCentavos(): bigint {
    return this.centavos;
  }

  toString(): string {
    const negativo = this.centavos < 0n;
    const valor = negativo ? -this.centavos : this.centavos;
    const reais = valor / 100n;
    const resto = (valor % 100n).toString().padStart(2, '0');
    return `${negativo ? '-' : ''}${reais}.${resto}`;
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  private garantirMesmaMoeda(outro: Money): void {
    if (this.currency !== outro.currency) {
      throw new MoneyError('Não é possível operar moedas diferentes');
    }
  }
}
