import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DomainError } from '../domain/domain-error';
import { MoneyError } from '../domain/money';
import { SubmeterTransacaoDto } from '../wagering/wagering.dto';
import { WageringService } from '../wagering/wagering.service';
import { contar } from '../metrics/metricas';
import { FILA_DLQ, FILA_TRANSACOES, sqs } from './sqs';

const CONSUMER_NAME = 'wager-transactions-consumer';

@Injectable()
export class WagerConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerConsumer.name);
  private ativo = false;
  private loop?: Promise<void>;

  constructor(private readonly wageringService: WageringService) {}

  onModuleInit() {
    if (process.env.SQS_CONSUMER === 'off') {
      return;
    }
    this.ativo = true;
    this.loop = this.consumir();
  }

  // no SIGTERM espera terminar o que esta processando
  async onModuleDestroy() {
    this.ativo = false;
    await this.loop;
  }

  private async consumir() {
    while (this.ativo) {
      try {
        const resposta = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: FILA_TRANSACOES,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 2,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
        );

        const mensagens = resposta.Messages ?? [];
        for (let i = 0; i < mensagens.length; i++) {
          if (!this.ativo) {
            // desligando: devolve as que nem comecaram pra fila
            await this.devolverParaFila(mensagens.slice(i));
            break;
          }
          await this.tratar(mensagens[i]);
        }
      } catch (error) {
        this.logger.error(`erro lendo a fila: ${(error as Error).message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async tratar(mensagem: Message) {
    let corpo: any;
    try {
      corpo = JSON.parse(mensagem.Body ?? '');
    } catch {
      return this.mandarParaDlq(mensagem, 'JSON invalido');
    }

    const dto = plainToInstance(SubmeterTransacaoDto, corpo.data ?? {});
    const erros = await validate(dto);
    if (!corpo.messageId || !corpo.data?.idempotencyKey || erros.length > 0) {
      return this.mandarParaDlq(mensagem, 'payload invalido');
    }

    try {
      const resultado = await this.wageringService.processar(
        corpo.data.idempotencyKey,
        dto,
        { correlationId: corpo.messageId, causationId: corpo.messageId },
        { consumerName: CONSUMER_NAME, messageId: corpo.messageId },
      );
      this.logger.log({
        msg: 'mensagem da fila processada',
        messageId: corpo.messageId,
        status: resultado.status,
      });
      await this.apagar(mensagem);
    } catch (error) {
      // erro de negocio ou de payload nao adianta tentar de novo
      if (
        error instanceof HttpException ||
        error instanceof DomainError ||
        error instanceof MoneyError
      ) {
        return this.mandarParaDlq(mensagem, (error as Error).message);
      }
      // erro de infra (banco fora, etc): nao apaga e espera cada vez mais pra tentar de novo.
      // depois de 5 entregas o proprio SQS manda pra DLQ (maxReceiveCount)
      const tentativas = Number(
        mensagem.Attributes?.ApproximateReceiveCount ?? 1,
      );
      contar('retries');
      this.logger.warn({
        msg: 'erro temporario, vai tentar de novo',
        messageId: corpo.messageId,
        tentativa: tentativas,
      });
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: FILA_TRANSACOES,
          ReceiptHandle: mensagem.ReceiptHandle,
          VisibilityTimeout: Math.min(5 * 2 ** tentativas, 300),
        }),
      );
    }
  }

  private async mandarParaDlq(mensagem: Message, motivo: string) {
    contar('mensagens_dlq');
    this.logger.warn({
      msg: 'mensagem enviada para a DLQ',
      messageId: mensagem.MessageId,
      motivo,
    });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: FILA_DLQ,
        MessageBody: mensagem.Body ?? '',
        MessageGroupId: 'dlq',
        MessageDeduplicationId: mensagem.MessageId,
      }),
    );
    await this.apagar(mensagem);
  }

  private async apagar(mensagem: Message) {
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: FILA_TRANSACOES,
        ReceiptHandle: mensagem.ReceiptHandle,
      }),
    );
  }

  private async devolverParaFila(mensagens: Message[]) {
    for (const mensagem of mensagens) {
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: FILA_TRANSACOES,
          ReceiptHandle: mensagem.ReceiptHandle,
          VisibilityTimeout: 0,
        }),
      );
    }
  }
}
