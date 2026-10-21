import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WagerTransactionRepository } from './wager-transaction.repository';
import { WageringService } from './wagering.service';

// de tempos em tempos tenta de novo as transacoes que estao esperando a referencia
@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private rodando = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionRepository: WagerTransactionRepository,
    private readonly wageringService: WageringService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.reprocessar(), 2000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async reprocessar() {
    if (this.rodando) {
      return;
    }
    this.rodando = true;

    try {
      const pendentes = await this.transactionRepository.findPendentes(
        this.dataSource.manager,
      );
      for (const pendente of pendentes) {
        await this.wageringService.reprocessarPendente(
          pendente.id,
          pendente.wallet_id,
          pendente.attempts,
        );
      }
    } catch (error) {
      this.logger.error(
        `erro reprocessando pendentes: ${(error as Error).message}`,
      );
    } finally {
      this.rodando = false;
    }
  }
}
