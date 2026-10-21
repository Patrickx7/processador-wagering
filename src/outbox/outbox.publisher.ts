import { SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OutboxMessage } from '../domain/outbox-message';
import { contar } from '../metrics/metricas';
import { FILA_EVENTOS, sqs } from '../sqs/sqs';

// le a tabela outbox_messages e publica os eventos no SQS
@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: ReturnType<typeof setInterval>;
  private rodando = false;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    this.timer = setInterval(() => this.publicarPendentes(), 1000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async publicarPendentes() {
    if (this.rodando) {
      return;
    }
    this.rodando = true;

    try {
      await this.dataSource.transaction(async (manager) => {
        // SKIP LOCKED: se outra instancia pegou a linha, essa pula
        const rows = await manager.query(
          `SELECT * FROM outbox_messages
           WHERE published_at IS NULL AND next_attempt_at <= now()
           ORDER BY occurred_at
           LIMIT 20
           FOR UPDATE SKIP LOCKED`,
        );

        for (const row of rows) {
          const message = OutboxMessage.rehydrate({
            id: row.id,
            aggregateId: row.aggregate_id,
            eventType: row.event_type,
            payload: row.payload,
            occurredAt: row.occurred_at,
            attempts: row.attempts,
            nextAttemptAt: row.next_attempt_at,
            publishedAt: row.published_at ?? undefined,
          });

          try {
            await sqs.send(
              new SendMessageCommand({
                QueueUrl: FILA_EVENTOS,
                MessageBody: JSON.stringify(message.payload),
              }),
            );
            message.markPublished(new Date());
          } catch (error) {
            message.scheduleRetry(new Date());
            contar('retries');
            this.logger.warn(
              `falha ao publicar evento ${message.id}, tentativa ${message.attempts}`,
            );
          }

          await manager.query(
            `UPDATE outbox_messages SET attempts = $2, next_attempt_at = $3, published_at = $4 WHERE id = $1`,
            [
              message.id,
              message.attempts,
              message.nextAttemptAt,
              message.publishedAt ?? null,
            ],
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `erro no publicador da outbox: ${(error as Error).message}`,
      );
    } finally {
      this.rodando = false;
    }
  }
}
