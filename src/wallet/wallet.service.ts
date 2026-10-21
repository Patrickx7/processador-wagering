import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { isUniqueViolation } from '../database/pg-errors';
import { LedgerDirection, WalletLedgerEntry } from '../domain/ledger-entry';
import { Money } from '../domain/money';
import { Wallet } from '../domain/wallet';
import { CriarWalletDto } from './wallet.dto';
import { WalletRepository } from './wallet.repository';

@Injectable()
export class WalletService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly walletRepository: WalletRepository,
  ) {}

  async criar(dto: CriarWalletDto): Promise<Wallet> {
    const saldoInicial = Money.from(dto.initialBalance);
    const wallet = Wallet.open({
      id: randomUUID(),
      playerId: dto.playerId,
      initialBalance: saldoInicial,
    });

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.walletRepository.insert(manager, wallet);

        if (saldoInicial.isPositive()) {
          const transactionId = randomUUID();
          await manager.query(
            `INSERT INTO wager_transactions
              (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id,
               round_id, game_id, kind, amount_cents, currency, status, balance_after_cents, processed_at)
             VALUES ($1, 'internal', $2, $2, '-', $3, $4, '-', '-', 'OPENING', $5, $6, 'PROCESSED', $5, now())`,
            [
              transactionId,
              `opening:${wallet.id}`,
              wallet.id,
              wallet.playerId,
              saldoInicial.getCentavos().toString(),
              wallet.currency,
            ],
          );

          const entry = WalletLedgerEntry.create({
            walletId: wallet.id,
            transactionId,
            direction: LedgerDirection.Credit,
            money: saldoInicial,
            balanceBefore: Money.zero(wallet.currency),
            balanceAfter: saldoInicial,
          });
          await this.walletRepository.insertLedgerEntry(manager, entry);
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Já existe uma wallet para esse player nessa moeda');
      }
      throw error;
    }

    return wallet;
  }

  async buscar(walletId: string): Promise<Wallet> {
    const wallet = await this.walletRepository.findById(this.dataSource.manager, walletId);
    if (!wallet) {
      throw new NotFoundException('Wallet não encontrada');
    }
    return wallet;
  }

  async listarLedger(walletId: string, cursor: string | undefined, limit: number) {
    await this.buscar(walletId);

    const depoisDoSeq = cursor ? Buffer.from(cursor, 'base64url').toString() : undefined;
    const linhas = await this.walletRepository.listLedger(
      this.dataSource.manager,
      walletId,
      depoisDoSeq,
      limit,
    );

    const ultima = linhas[linhas.length - 1];
    return {
      items: linhas.map(({ entry }) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt,
      })),
      nextCursor:
        linhas.length === limit ? Buffer.from(String(ultima.seq)).toString('base64url') : null,
    };
  }
}