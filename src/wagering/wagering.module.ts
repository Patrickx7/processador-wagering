import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { WalletModule } from '../wallet/wallet.module';
import { WagerTransactionRepository } from './wager-transaction.repository';
import { WageringController } from './wagering.controller';
import { WageringService } from './wagering.service';

@Module({
  imports: [WalletModule, OutboxModule],
  controllers: [WageringController],
  providers: [WageringService, WagerTransactionRepository],
  exports: [WageringService, WagerTransactionRepository],
})
export class WageringModule {}
