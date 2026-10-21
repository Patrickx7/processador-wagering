import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Money } from '../domain/money';
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';

@Injectable()
export class WagerTransactionRepository {
  async insert(
    manager: EntityManager,
    tx: WagerTransaction,
    saldo: Money,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO wager_transactions
        (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id,
         round_id, game_id, kind, amount_cents, currency, reference_external_transaction_id,
         reference_transaction_id, status, failure_code, balance_after_cents, next_attempt_at,
         created_at, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
         CASE WHEN $15 = 'PENDING_REFERENCE' THEN now() + interval '5 seconds' END, $18, $19)`,
      [
        tx.id,
        tx.providerId,
        tx.externalTransactionId,
        tx.idempotencyKey,
        tx.payloadHash,
        tx.walletId,
        tx.playerId,
        tx.roundId,
        tx.gameId,
        tx.kind,
        tx.money.getCentavos().toString(),
        tx.money.currency,
        tx.referenceExternalTransactionId ?? null,
        tx.referenceTransactionId ?? null,
        tx.status,
        tx.failureCode ?? null,
        saldo.getCentavos().toString(),
        tx.createdAt,
        tx.processedAt ?? null,
      ],
    );
  }

  async update(
    manager: EntityManager,
    tx: WagerTransaction,
    saldo: Money,
  ): Promise<void> {
    await manager.query(
      `UPDATE wager_transactions
       SET status = $2, reference_transaction_id = $3, failure_code = $4,
           balance_after_cents = $5, processed_at = $6
       WHERE id = $1`,
      [
        tx.id,
        tx.status,
        tx.referenceTransactionId ?? null,
        tx.failureCode ?? null,
        saldo.getCentavos().toString(),
        tx.processedAt ?? null,
      ],
    );
  }

  // espera cada vez mais: 10s, 20s, 40s... ate 5 minutos
  async agendarNovaTentativa(
    manager: EntityManager,
    id: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE wager_transactions
       SET attempts = attempts + 1,
           next_attempt_at = now() + LEAST(5 * power(2, attempts + 1), 300) * interval '1 second'
       WHERE id = $1`,
      [id],
    );
  }

  async findById(manager: EntityManager, id: string) {
    const rows = await manager.query(
      `SELECT * FROM wager_transactions WHERE id = $1`,
      [id],
    );
    return rows.length ? this.converter(rows[0]) : null;
  }

  async findByIdempotencyKey(manager: EntityManager, key: string) {
    const rows = await manager.query(
      `SELECT * FROM wager_transactions WHERE idempotency_key = $1`,
      [key],
    );
    return rows.length ? this.converter(rows[0]) : null;
  }

  async findByExternalId(
    manager: EntityManager,
    providerId: string,
    externalTransactionId: string,
  ) {
    const rows = await manager.query(
      `SELECT * FROM wager_transactions WHERE provider_id = $1 AND external_transaction_id = $2`,
      [providerId, externalTransactionId],
    );
    return rows.length ? this.converter(rows[0]) : null;
  }

  async jaFoiRevertida(
    manager: EntityManager,
    referenceId: string,
    kind: string,
  ): Promise<boolean> {
    const rows = await manager.query(
      `SELECT 1 FROM wager_transactions
       WHERE reference_transaction_id = $1 AND kind = $2 AND status = 'PROCESSED'`,
      [referenceId, kind],
    );
    return rows.length > 0;
  }

  async findPendentes(manager: EntityManager) {
    return manager.query(
      `SELECT id, wallet_id, attempts FROM wager_transactions
       WHERE status = 'PENDING_REFERENCE' AND next_attempt_at <= now()
       ORDER BY next_attempt_at
       LIMIT 20`,
    );
  }

  private converter(row: any) {
    const transaction = WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind as WagerTransactionKind,
      money: Money.fromCentavos(BigInt(row.amount_cents), row.currency),
      referenceExternalTransactionId:
        row.reference_external_transaction_id ?? undefined,
      referenceTransactionId: row.reference_transaction_id ?? undefined,
      status: row.status as WagerTransactionStatus,
      failureCode: (row.failure_code as FailureCode) ?? undefined,
      createdAt: row.created_at,
      processedAt: row.processed_at ?? undefined,
    });

    // saldo da wallet no momento em que a transacao foi feita (usado no replay)
    const saldo = Money.fromCentavos(
      BigInt(row.balance_after_cents ?? 0),
      row.currency,
    );

    return { transaction, saldo };
  }
}
