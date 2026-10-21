import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { isUniqueViolation } from '../database/pg-errors';
import {
  EventContext,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../domain/integration-events';
import { LedgerDirection, WalletLedgerEntry } from '../domain/ledger-entry';
import { Money } from '../domain/money';
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import { Wallet } from '../domain/wallet';
import { OutboxRepository } from '../outbox/outbox.repository';
import { WalletRepository } from '../wallet/wallet.repository';
import { calcularPayloadHash } from './payload-hash';
import { WagerTransactionRepository } from './wager-transaction.repository';
import { SubmeterTransacaoDto } from './wagering.dto';

export interface ResultadoTransacao {
  transactionId: string;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  balance: Money;
  idempotentReplay: boolean;
}

const MAX_TENTATIVAS = 10;

@Injectable()
export class WageringService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly walletRepository: WalletRepository,
    private readonly transactionRepository: WagerTransactionRepository,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async processar(
    idempotencyKey: string,
    dto: SubmeterTransacaoDto,
    ctx: EventContext,
    inbox?: { consumerName: string; messageId: string },
  ): Promise<ResultadoTransacao> {
    const payloadHash = calcularPayloadHash(dto);

    const tx = WagerTransaction.create({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      idempotencyKey,
      payloadHash,
      walletId: dto.walletId,
      playerId: dto.playerId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind as WagerTransactionKind,
      money: Money.from(dto.money),
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
    });

    try {
      return await this.dataSource.transaction(async (manager) => {
        // trava a wallet (FOR UPDATE), quem chegar junto espera aqui
        const wallet = await this.walletRepository.findById(
          manager,
          tx.walletId,
          true,
        );
        if (!wallet) {
          throw new NotFoundException('Wallet não encontrada');
        }

        // veio da fila: registra a mensagem na inbox junto com o resto
        if (inbox) {
          await manager.query(
            `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, processed_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT DO NOTHING`,
            [inbox.consumerName, inbox.messageId, payloadHash],
          );
        }

        // ja recebeu essa key? entao devolve o resultado de antes
        const anterior = await this.transactionRepository.findByIdempotencyKey(
          manager,
          idempotencyKey,
        );
        if (anterior) {
          if (!anterior.transaction.matchesPayload(payloadHash)) {
            throw new ConflictException(
              'Idempotency-Key já usada com outro payload',
            );
          }
          return this.resultado(anterior.transaction, anterior.saldo, true);
        }

        const entry = await this.aplicarRegras(manager, wallet, tx);

        await this.transactionRepository.insert(manager, tx, wallet.balance);
        await this.salvarResultado(manager, wallet, tx, entry, ctx);

        return this.resultado(tx, wallet.balance, false);
      });
    } catch (error) {
      // mesmo externalTransactionId com outra Idempotency-Key
      if (isUniqueViolation(error)) {
        throw new ConflictException('Transação duplicada');
      }
      throw error;
    }
  }

  // chamado pelo worker pra tentar de novo as que estao PENDING_REFERENCE
  async reprocessarPendente(
    transactionId: string,
    walletId: string,
    tentativas: number,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const wallet = await this.walletRepository.findById(
        manager,
        walletId,
        true,
      );
      const salva = await this.transactionRepository.findById(
        manager,
        transactionId,
      );
      if (!wallet || !salva) {
        return;
      }

      const tx = salva.transaction;
      if (tx.status !== WagerTransactionStatus.PendingReference) {
        return;
      }

      let entry: WalletLedgerEntry | undefined;
      if (tentativas >= MAX_TENTATIVAS) {
        tx.reject(FailureCode.ReferenceNotFound);
      } else {
        entry = await this.aplicarRegras(manager, wallet, tx);
      }

      if (tx.status === WagerTransactionStatus.PendingReference) {
        await this.transactionRepository.agendarNovaTentativa(manager, tx.id);
        return;
      }

      await this.transactionRepository.update(manager, tx, wallet.balance);
      await this.salvarResultado(manager, wallet, tx, entry, {
        correlationId: randomUUID(),
        causationId: tx.id,
      });
    });
  }

  async buscar(transactionId: string): Promise<ResultadoTransacao> {
    const salva = await this.transactionRepository.findById(
      this.dataSource.manager,
      transactionId,
    );
    if (!salva) {
      throw new NotFoundException('Transação não encontrada');
    }
    return this.resultado(salva.transaction, salva.saldo, false);
  }

  async buscarPorExternalId(providerId: string, externalTransactionId: string) {
    const salva = await this.transactionRepository.findByExternalId(
      this.dataSource.manager,
      providerId,
      externalTransactionId,
    );
    if (!salva) {
      throw new NotFoundException('Transação não encontrada');
    }
    return this.resultado(salva.transaction, salva.saldo, false);
  }

  // decide o que acontece com a transacao. se mexer no saldo devolve o lancamento
  private async aplicarRegras(
    manager: EntityManager,
    wallet: Wallet,
    tx: WagerTransaction,
  ): Promise<WalletLedgerEntry | undefined> {
    if (wallet.playerId !== tx.playerId) {
      tx.reject(FailureCode.PlayerMismatch);
      return undefined;
    }
    if (wallet.currency !== tx.money.currency) {
      tx.reject(FailureCode.CurrencyMismatch);
      return undefined;
    }

    let referencia: WagerTransaction | undefined;
    if (tx.referenceExternalTransactionId) {
      const encontrada = await this.transactionRepository.findByExternalId(
        manager,
        tx.providerId,
        tx.referenceExternalTransactionId,
      );

      if (encontrada) {
        referencia = encontrada.transaction;
        const erro = await this.validarReferencia(manager, tx, referencia);
        if (erro) {
          tx.reject(erro);
          return undefined;
        }
      } else if (tx.requiresReference()) {
        // a referencia ainda nao chegou, o worker tenta de novo depois
        tx.markPendingReference();
        return undefined;
      }
    }

    // LOSS nao mexe no saldo
    if (!tx.affectsBalance()) {
      tx.markProcessed(referencia?.id, new Date());
      return undefined;
    }

    const direcao = tx.ledgerDirectionFor(referencia);
    if (
      direcao === LedgerDirection.Debit &&
      wallet.balance.isLessThan(tx.money)
    ) {
      if (tx.kind === WagerTransactionKind.Bet) {
        tx.reject(FailureCode.InsufficientFunds);
      } else {
        tx.reject(FailureCode.ReversalInsufficientFunds);
      }
      return undefined;
    }

    const entry =
      direcao === LedgerDirection.Debit
        ? wallet.debit(tx.money, tx.id)
        : wallet.credit(tx.money, tx.id);

    tx.markProcessed(referencia?.id, new Date());
    return entry;
  }

  private async validarReferencia(
    manager: EntityManager,
    tx: WagerTransaction,
    ref: WagerTransaction,
  ): Promise<FailureCode | null> {
    const mesmaRodada =
      ref.playerId === tx.playerId &&
      ref.walletId === tx.walletId &&
      ref.roundId === tx.roundId &&
      ref.money.currency === tx.money.currency;
    if (!mesmaRodada) {
      return FailureCode.InvalidReference;
    }

    // WIN pode apontar pra BET, mas nao desfaz nada
    if (tx.kind === WagerTransactionKind.Win) {
      return ref.kind === WagerTransactionKind.Bet
        ? null
        : FailureCode.InvalidReference;
    }

    // refund so de BET. rollback de BET, WIN ou REFUND
    if (
      tx.kind === WagerTransactionKind.Refund &&
      ref.kind !== WagerTransactionKind.Bet
    ) {
      return FailureCode.InvalidReference;
    }
    if (
      tx.kind === WagerTransactionKind.Rollback &&
      ref.kind === WagerTransactionKind.Loss
    ) {
      return FailureCode.InvalidReference;
    }

    if (
      ref.status !== WagerTransactionStatus.Processed ||
      !ref.money.equals(tx.money)
    ) {
      return FailureCode.InvalidReference;
    }

    if (
      await this.transactionRepository.jaFoiRevertida(manager, ref.id, tx.kind)
    ) {
      return FailureCode.AlreadyReversed;
    }
    return null;
  }

  // grava ledger, saldo e eventos (tudo na mesma transacao do banco)
  private async salvarResultado(
    manager: EntityManager,
    wallet: Wallet,
    tx: WagerTransaction,
    entry: WalletLedgerEntry | undefined,
    ctx: EventContext,
  ) {
    if (entry) {
      await this.walletRepository.insertLedgerEntry(manager, entry);
      await this.walletRepository.update(manager, wallet);
      await this.outboxRepository.add(
        manager,
        new WalletBalanceChanged(wallet, entry, ctx),
      );
    }

    if (tx.status === WagerTransactionStatus.Processed) {
      await this.outboxRepository.add(
        manager,
        new WagerTransactionProcessed(tx, ctx),
      );
    } else if (tx.status === WagerTransactionStatus.Rejected) {
      await this.outboxRepository.add(
        manager,
        new WagerTransactionRejected(tx, ctx),
      );
    } else if (tx.status === WagerTransactionStatus.PendingReference) {
      await this.outboxRepository.add(
        manager,
        new WagerTransactionPendingReference(tx, ctx),
      );
    }
  }

  private resultado(
    tx: WagerTransaction,
    saldo: Money,
    idempotentReplay: boolean,
  ) {
    return {
      transactionId: tx.id,
      status: tx.status,
      failureCode: tx.failureCode,
      balance: saldo,
      idempotentReplay,
    };
  }
}
