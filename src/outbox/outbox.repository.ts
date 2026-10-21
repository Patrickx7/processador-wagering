import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { IntegrationEvent } from '../domain/integration-events';
import { OutboxMessage } from '../domain/outbox-message';

@Injectable()
export class OutboxRepository {
  async add(
    manager: EntityManager,
    event: IntegrationEvent<unknown>,
  ): Promise<void> {
    const message = OutboxMessage.enqueue(event);
    await manager.query(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        message.id,
        message.aggregateId,
        message.eventType,
        JSON.stringify(message.payload),
        message.occurredAt,
      ],
    );
  }
}
