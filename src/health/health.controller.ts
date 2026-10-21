import { ListQueuesCommand } from '@aws-sdk/client-sqs';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { metricas } from '../metrics/metricas';
import { sqs } from '../sqs/sqs';

@Controller()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready() {
    const resultado = { postgres: 'ok', sqs: 'ok' };

    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      resultado.postgres = 'fora';
    }

    try {
      await sqs.send(new ListQueuesCommand({}));
    } catch {
      resultado.sqs = 'fora';
    }

    if (resultado.postgres !== 'ok' || resultado.sqs !== 'ok') {
      throw new ServiceUnavailableException(resultado);
    }
    return { status: 'ok', ...resultado };
  }

  @Get('metrics')
  async metrics() {
    // outbox lag: quantos eventos esperando e ha quanto tempo o mais antigo esta la
    const rows = await this.dataSource.query(
      `SELECT count(*) AS pendentes,
              COALESCE(EXTRACT(EPOCH FROM now() - min(occurred_at)), 0) AS segundos
       FROM outbox_messages WHERE published_at IS NULL`,
    );

    const media =
      metricas.latencia_quantidade > 0
        ? Math.round(metricas.latencia_total_ms / metricas.latencia_quantidade)
        : 0;

    return {
      ...metricas,
      latencia_media_ms: media,
      outbox_pendentes: Number(rows[0].pendentes),
      outbox_lag_segundos: Math.round(Number(rows[0].segundos)),
    };
  }
}
