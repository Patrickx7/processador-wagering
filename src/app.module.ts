import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSource } from './database/data-source';
import { HealthModule } from './health/health.module';
import { SqsModule } from './sqs/sqs.module';
import { WageringModule } from './wagering/wagering.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(dataSource.options),
    WalletModule,
    WageringModule,
    SqsModule,
    HealthModule,
  ],
})
export class AppModule {}
