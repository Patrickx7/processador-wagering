import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { WalletModule } from '../wallet/wallet.module';
import { PendingReferenceWorker } from './pending-reference.worker';
import { WagerTransactionRepository } from './wager-transaction.repository';
import { WageringController } from './wagering.controller';
import { WageringService } from './wagering.service';

@Module({
  imports: [WalletModule, OutboxModule],
  controllers: [WageringController],
  providers: [
    WageringService,
    WagerTransactionRepository,
    PendingReferenceWorker,
  ],
  exports: [WageringService, WagerTransactionRepository],
})
export class WageringModule {}
