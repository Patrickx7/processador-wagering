import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LedgerDirection, WalletLedgerEntry } from '../domain/ledger-entry';
import { Money } from '../domain/money';
import { Wallet } from '../domain/wallet';

@Injectable()
export class WalletRepository {
  async insert(manager: EntityManager, wallet: Wallet): Promise<void> {
    await manager.query(
      `INSERT INTO wallets (id, player_id, currency, balance_cents, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        wallet.id,
        wallet.playerId,
        wallet.currency,
        wallet.balance.getCentavos().toString(),
        wallet.version,
        wallet.createdAt,
        wallet.updatedAt,
      ],
    );
  }

  async update(manager: EntityManager, wallet: Wallet): Promise<void> {
    await manager.query(
      `UPDATE wallets SET balance_cents = $2, version = $3, updated_at = $4 WHERE id = $1`,
      [
        wallet.id,
        wallet.balance.getCentavos().toString(),
        wallet.version,
        wallet.updatedAt,
      ],
    );
  }

  async findById(
    manager: EntityManager,
    id: string,
    comLock = false,
  ): Promise<Wallet | null> {
    const sql =
      `SELECT * FROM wallets WHERE id = $1` + (comLock ? ' FOR UPDATE' : '');
    const rows = await manager.query(sql, [id]);
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency,
      balance: Money.fromCentavos(BigInt(row.balance_cents), row.currency),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  async insertLedgerEntry(
    manager: EntityManager,
    entry: WalletLedgerEntry,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO ledger_entries
        (id, wallet_id, transaction_id, direction, amount_cents, balance_before_cents, balance_after_cents, currency, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.id,
        entry.walletId,
        entry.transactionId,
        entry.direction,
        entry.money.getCentavos().toString(),
        entry.balanceBefore.getCentavos().toString(),
        entry.balanceAfter.getCentavos().toString(),
        entry.money.currency,
        entry.createdAt,
      ],
    );
  }

  async listLedger(
    manager: EntityManager,
    walletId: string,
    depoisDoSeq: string | undefined,
    limit: number,
  ): Promise<{ seq: string; entry: WalletLedgerEntry }[]> {
    const rows = await manager.query(
      `SELECT * FROM ledger_entries
       WHERE wallet_id = $1 AND ($2::bigint IS NULL OR seq > $2::bigint)
       ORDER BY seq
       LIMIT $3`,
      [walletId, depoisDoSeq ?? null, limit],
    );

    return rows.map((row: any) => ({
      seq: row.seq,
      entry: WalletLedgerEntry.rehydrate({
        id: row.id,
        walletId: row.wallet_id,
        transactionId: row.transaction_id,
        direction: row.direction as LedgerDirection,
        money: Money.fromCentavos(BigInt(row.amount_cents), row.currency),
        balanceBefore: Money.fromCentavos(
          BigInt(row.balance_before_cents),
          row.currency,
        ),
        balanceAfter: Money.fromCentavos(
          BigInt(row.balance_after_cents),
          row.currency,
        ),
        createdAt: row.created_at,
      }),
    }));
  }

  // soma todos os creditos e tira os debitos do ledger da wallet
  async somarLedger(manager: EntityManager, walletId: string) {
    const rows = await manager.query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END), 0) AS total,
         COUNT(*) AS quantidade
       FROM ledger_entries
       WHERE wallet_id = $1`,
      [walletId],
    );
    return {
      totalCentavos: BigInt(rows[0].total),
      quantidade: Number(rows[0].quantidade),
    };
  }
}
