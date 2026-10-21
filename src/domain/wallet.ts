import { DomainError } from './domain-error';
import { LedgerDirection, WalletLedgerEntry } from './ledger-entry';
import { Money } from './money';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: { id: string; playerId: string; initialBalance: Money }): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new DomainError('INVALID_AMOUNT', 'Saldo inicial não pode ser negativo');
    }

    const agora = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      agora,
      agora,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(valor: Money, transactionId: string): WalletLedgerEntry {
    this.garantirMesmaMoeda(valor);
    if (this._balance.isLessThan(valor)) {
      throw new DomainError('INSUFFICIENT_FUNDS', 'Saldo insuficiente');
    }
    return this.movimentar(LedgerDirection.Debit, valor, transactionId);
  }

  credit(valor: Money, transactionId: string): WalletLedgerEntry {
    this.garantirMesmaMoeda(valor);
    return this.movimentar(LedgerDirection.Credit, valor, transactionId);
  }

  private movimentar(
    direction: LedgerDirection,
    valor: Money,
    transactionId: string,
  ): WalletLedgerEntry {
    if (!valor.isPositive()) {
      throw new DomainError('INVALID_AMOUNT', 'Valor precisa ser maior que zero');
    }

    const saldoAntes = this._balance;
    const saldoDepois =
      direction === LedgerDirection.Debit ? saldoAntes.subtract(valor) : saldoAntes.add(valor);

    const entry = WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction,
      money: valor,
      balanceBefore: saldoAntes,
      balanceAfter: saldoDepois,
    });

    this._balance = saldoDepois;
    this._version++;
    this._updatedAt = new Date();

    return entry;
  }

  private garantirMesmaMoeda(valor: Money): void {
    if (valor.currency !== this.currency) {
      throw new DomainError('CURRENCY_MISMATCH', 'Moeda diferente da moeda da wallet');
    }
  }
}