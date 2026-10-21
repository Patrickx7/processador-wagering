import { Module } from '@nestjs/common';
import { WageringModule } from '../wagering/wagering.module';
import { WagerConsumer } from './wager.consumer';

@Module({
  imports: [WageringModule],
  providers: [WagerConsumer],
})
export class SqsModule {}
