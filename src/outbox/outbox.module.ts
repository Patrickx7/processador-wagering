import { Module } from '@nestjs/common';
import { OutboxPublisher } from './outbox.publisher';
import { OutboxRepository } from './outbox.repository';

@Module({
  providers: [OutboxRepository, OutboxPublisher],
  exports: [OutboxRepository],
})
export class OutboxModule {}
