# processador-wagering

Serviço que processa transações de apostas (BET, WIN, LOSS, REFUND e ROLLBACK) vindas de provedores de jogos, pela API HTTP ou por uma fila SQS. Cada jogador tem uma wallet e toda mudança de saldo fica registrada num ledger.

As decisões técnicas estão no [ARCHITECTURE.md](ARCHITECTURE.md).

## Tecnologias

- Bun
- TypeScript
- NestJS
- PostgreSQL
- TypeORM
- AWS SQS (LocalStack)
- Docker Compose

## Pré-requisitos

- [Bun](https://bun.sh) 1.x
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Como rodar

```bash
# instalar as dependencias
bun install

# subir o postgres e o localstack (as filas sao criadas sozinhas)
docker compose up -d

# criar as tabelas
bun run migration:run

# subir a aplicacao na porta 3000
bun run start:dev
```

Para desfazer a migration: `bun run migration:revert`

## Testes

Com o docker ligado:

```bash
bun test
```

Roda os testes da classe `Money` e os testes de concorrência, que sobem 3 instâncias da aplicação ao mesmo tempo.

## Endpoints

| Método | Rota | O que faz |
|---|---|---|
| POST | `/wallets` | cria uma wallet |
| GET | `/wallets/:walletId` | consulta a wallet |
| GET | `/wallets/:walletId/ledger?cursor=&limit=50` | extrato da wallet |
| POST | `/wallets/:walletId/reconciliation` | compara o saldo com o ledger |
| POST | `/wagering/transactions` | envia uma transação (precisa do header `Idempotency-Key`) |
| GET | `/wagering/transactions/:transactionId` | consulta uma transação |
| GET | `/providers/:providerId/wagering/transactions/:externalTransactionId` | consulta pelo id do provedor |
| GET | `/health/live` | processo está de pé |
| GET | `/health/ready` | postgres e sqs estão respondendo |
| GET | `/metrics` | contadores da aplicação |

### Exemplo

Criar uma wallet:

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'
```

Fazer uma aposta (troque o `walletId` pelo id que voltou acima):

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provider-a:transaction-123" \
  -d '{"providerId":"provider-a","externalTransactionId":"transaction-123","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"COLOQUE-O-ID-AQUI","roundId":"round-987","gameId":"fortune-chimp","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

Resposta:

```json
{
  "transactionId": "...",
  "status": "PROCESSED",
  "balance": { "amount": "975.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

Se mandar de novo com a mesma `Idempotency-Key`, volta o mesmo resultado com `idempotentReplay: true`.

### Enviando pela fila

```bash
docker exec wagering-localstack awslocal sqs send-message \
  --queue-url http://localhost:4566/000000000000/wager-transactions.fifo \
  --message-group-id COLOQUE-O-ID-DA-WALLET \
  --message-deduplication-id msg-1 \
  --message-body '{"messageId":"msg-1","type":"WagerTransactionRequested","occurredAt":"2026-10-21T15:00:00.000Z","data":{"providerId":"provider-a","externalTransactionId":"transaction-124","idempotencyKey":"provider-a:transaction-124","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"COLOQUE-O-ID-DA-WALLET","roundId":"round-987","gameId":"fortune-chimp","kind":"BET","money":{"amount":"10.00","currency":"BRL"}}}'
```

Os eventos gerados (outbox) são publicados na fila `wallet-events`.

## Variáveis de ambiente

Todas têm valor padrão igual ao `docker-compose.yml`, então não precisa configurar nada para rodar local.

| Variável | Padrão |
|---|---|
| `PORT` | `3000` |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `5432` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `wagering` |
| `SQS_ENDPOINT` | `http://localhost:4566` |
| `SQS_CONSUMER` | ligado (`off` desliga o consumidor da fila) |
