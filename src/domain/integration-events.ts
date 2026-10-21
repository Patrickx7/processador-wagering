import { randomUUID } from 'crypto';
import { WalletLedgerEntry } from './ledger-entry';
import { MoneyProps } from './money';
import { Wallet } from './wallet';
import { WagerTransaction } from './wager-transaction';

export interface EventContext {
  correlationId: string;
  causationId?: string;
}

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId = randomUUID();
  readonly occurredAt = new Date();
  readonly correlationId: string;
  readonly causationId?: string;

  protected constructor(
    readonly aggregateId: string,
    readonly data: T,
    ctx: EventContext,
  ) {
    this.correlationId = ctx.correlationId;
    this.causationId = ctx.causationId;
  }

  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data,
    };
  }
}

interface DadosTransacao {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  kind: string;
  status: string;
  money: MoneyProps;
  failureCode?: string;
}

function dadosDaTransacao(tx: WagerTransaction): DadosTransacao {
  return {
    transactionId: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    walletId: tx.walletId,
    kind: tx.kind,
    status: tx.status,
    money: tx.money.toJSON(),
    failureCode: tx.failureCode,
  };
}

export class WagerTransactionProcessed extends IntegrationEvent<DadosTransacao> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  constructor(tx: WagerTransaction, ctx: EventContext) {
    super(tx.walletId, dadosDaTransacao(tx), ctx);
  }
}

export class WagerTransactionRejected extends IntegrationEvent<DadosTransacao> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  constructor(tx: WagerTransaction, ctx: EventContext) {
    super(tx.walletId, dadosDaTransacao(tx), ctx);
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<DadosTransacao> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  constructor(tx: WagerTransaction, ctx: EventContext) {
    super(tx.walletId, dadosDaTransacao(tx), ctx);
  }
}

interface DadosSaldo {
  walletId: string;
  transactionId: string;
  direction: string;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<DadosSaldo> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor(wallet: Wallet, entry: WalletLedgerEntry, ctx: EventContext) {
    super(
      wallet.id,
      {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
      ctx,
    );
  }
}
