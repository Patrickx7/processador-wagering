import { SQSClient } from '@aws-sdk/client-sqs';

const endpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:4566';

// localstack aceita qualquer credencial
export const sqs = new SQSClient({
  endpoint,
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

export const FILA_TRANSACOES = `${endpoint}/000000000000/wager-transactions.fifo`;
export const FILA_DLQ = `${endpoint}/000000000000/wager-transactions-dlq.fifo`;
export const FILA_EVENTOS = `${endpoint}/000000000000/wallet-events`;
