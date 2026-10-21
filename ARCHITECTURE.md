# Arquitetura

Aqui eu explico as decisões que tomei no projeto, o que ficou de fora e por quê.

## Estrutura das pastas

```
src/
  domain/      regras de negocio (Money, Wallet, WagerTransaction, ledger, eventos)
  database/    conexao, migration e helpers do postgres
  wallet/      rotas e acesso ao banco da wallet
  wagering/    rotas, regras das apostas e worker de pendentes
  outbox/      gravacao e publicacao dos eventos
  sqs/         cliente do SQS e consumidor da fila
  health/      health checks e metricas
  http/        filtros de erro e o AuthGuard
  logger/      logger em JSON
```

A pasta `domain` não importa nada do NestJS nem do TypeORM. As classes de lá têm construtor `private` e são criadas pelas factories (`create`, `from`, `open`) ou pelo `rehydrate` quando vêm do banco.

## ORM e banco

Usei o **TypeORM** para a conexão, as transações (`dataSource.transaction`) e as migrations. As consultas eu escrevi em SQL usando `manager.query`, porque assim fica claro o que está acontecendo no banco, principalmente o lock. Não criei entities do TypeORM, o mapeamento linha → classe do domínio fica nos repositories.

Escolhi o TypeORM em vez do MikroORM porque tem mais material e exemplos, e eu já ia usar SQL direto de qualquer forma.

## Dinheiro (Money)

- O valor é guardado em **centavos** como `bigint` no TypeScript e `BIGINT` no Postgres. Nunca `number` ou `float`.
- A moeda fica numa coluna separada (`currency CHAR(3)`).
- Na entrada e na saída o valor é sempre string com 2 casas: `"25.00"`.
- O `Money.from` usa regex para recusar `NaN`, `Infinity`, `1e3`, negativo, vazio e mais de 2 casas.
- Operações com moedas diferentes lançam erro.

## Regras garantidas no banco

Coloquei as regras mais importantes direto no schema, para valer mesmo se o código tiver bug:

- `wallets.balance_cents >= 0` (saldo nunca negativo)
- `UNIQUE (player_id, currency)` (uma wallet por jogador e moeda)
- `UNIQUE (idempotency_key)` e `UNIQUE (provider_id, external_transaction_id)`
- `CHECK` que obriga REFUND e ROLLBACK a terem `reference_external_transaction_id`
- índice único parcial `ux_reversao_unica`: uma transação só pode ser revertida uma vez por tipo
- `ledger_entries.transaction_id UNIQUE` (no máximo um lançamento por transação)
- `CHECK` no ledger: `saldo_depois = saldo_antes ± valor`
- trigger `ledger_imutavel`: bloqueia `UPDATE` e `DELETE` no ledger
- `inbox_messages` com chave primária `(consumer_name, message_id)`

A migration tem `up` e `down` (`bun run migration:run` e `bun run migration:revert`).

## Concorrência

Usei **lock pessimista por wallet**: no começo da transação eu faço `SELECT ... FROM wallets WHERE id = $1 FOR UPDATE`. Se chegarem duas operações para a mesma wallet, a segunda espera a primeira terminar o commit. Wallets diferentes não se bloqueiam, então não existe lock global.

Escolhi esse jeito porque é o mais simples de entender e funciona com várias instâncias, já que quem controla o lock é o Postgres. A desvantagem é que uma wallet muito usada (hot wallet) fica numa fila de espera, mas as transações são curtas.

O `version` da wallet começa em 1 e sobe a cada mudança de saldo. Não usei ele para optimistic locking, ele serve como contador de versões (e vai no evento `WalletBalanceChanged`).

## Idempotência

- O header `Idempotency-Key` é obrigatório no HTTP. Na fila ele vem em `data.idempotencyKey`.
- O `payloadHash` é um **SHA-256** de um JSON com estes campos, nessa ordem (alfabética): `externalTransactionId`, `gameId`, `kind`, `money`, `playerId`, `providerId`, `referenceExternalTransactionId` (ou `null`), `roundId`, `walletId`. O `money` é normalizado pelo `Money` antes (`"25.5"` vira `"25.50"`). Headers e metadados de transporte não entram.
- Depois de pegar o lock da wallet eu procuro a key no banco:
  - se existe com o mesmo hash, devolvo o resultado original (status e saldo daquele momento, guardado em `balance_after_cents`) com `idempotentReplay: true`;
  - se existe com hash diferente, devolvo **409**.
- Como a busca é feita depois do lock, duas requisições iguais ao mesmo tempo não passam juntas. E se mesmo assim cair no `UNIQUE` do banco, devolvo 409.

## Regras das operações

| Operação | Saldo | Ledger |
|---|---|---|
| BET | debita (rejeita sem saldo) | DEBIT |
| WIN | credita | CREDIT |
| LOSS | não mexe | nenhum |
| REFUND | credita, só de BET | CREDIT |
| ROLLBACK | o contrário da referência (BET, WIN ou REFUND) | invertido |

Interpretações que eu fiz:
- A referência é buscada por `(providerId, referenceExternalTransactionId)` e precisa ser do mesmo player, wallet, rodada e moeda, ter o mesmo valor e estar `PROCESSED`.
- WIN pode ter referência, mas não é obrigatória. Se a BET referenciada não existir, o WIN é processado mesmo assim.
- LOSS não gera lançamento, mas gera o evento `WagerTransactionProcessed`.
- `OPENING` é criado só internamente, quando a wallet nasce com saldo maior que zero, na mesma transação da wallet.

### Estados

```
PENDING -> PROCESSED
PENDING -> REJECTED
PENDING -> PENDING_REFERENCE -> PROCESSED / REJECTED
```

`PROCESSED`, `REJECTED` e `FAILED` são finais: tentar mudar lança erro. O `FAILED` existe no modelo mas hoje nenhum fluxo usa ele, os erros de infra fazem rollback da transação inteira e a operação pode ser reenviada.

### Códigos de falha

| Código | Quando |
|---|---|
| `INSUFFICIENT_FUNDS` | BET sem saldo |
| `REVERSAL_INSUFFICIENT_FUNDS` | ROLLBACK que deixaria o saldo negativo |
| `CURRENCY_MISMATCH` | moeda diferente da wallet |
| `PLAYER_MISMATCH` | wallet não é do player |
| `REFERENCE_NOT_FOUND` | referência não chegou depois de todas as tentativas |
| `INVALID_REFERENCE` | referência de outra rodada, outro valor, tipo errado ou não processada |
| `ALREADY_REVERSED` | referência já foi revertida por esse tipo de operação |

### Referência fora de ordem

Se um REFUND ou ROLLBACK chega antes da transação referenciada, ele é salvo como `PENDING_REFERENCE` e a API devolve 202. Um worker (`PendingReferenceWorker`) roda a cada 2 segundos e tenta de novo, esperando cada vez mais: 5s, 10s, 20s, 40s... até no máximo 5 minutos entre tentativas. Depois de **10 tentativas** (mais ou menos 25 minutos) a transação vira `REJECTED` com `REFERENCE_NOT_FOUND` e o evento de rejeição é publicado. Escolhi esse tempo porque a referência normalmente chega em segundos, e 25 minutos já cobre uma fila atrasada.

## Status HTTP

| Situação | Status |
|---|---|
| processada | 200 |
| aceita, esperando referência | 202 |
| payload inválido | 400 |
| wallet ou transação não existe | 404 |
| conflito de idempotência ou wallet duplicada | 409 |
| rejeitada por regra de negócio | 422 (com `failureCode`) |
| falha temporária (banco fora, etc) | 503 |

Assim o provedor sabe: 503 pode reenviar, 409 e 400 precisa corrigir, 422 é resultado final.

## SQS

O consumidor (`WagerConsumer`) lê a fila `wager-transactions.fifo` e chama o **mesmo** `WageringService.processar` da API.

- **Inbox**: o `messageId` é gravado em `inbox_messages` dentro da mesma transação do saldo. Junto com a idempotency key isso evita processar duas vezes.
- A mensagem só é apagada da fila (**ack**) depois do commit.
- **Erro de negócio** (rejeição): é um resultado normal, apaga a mensagem.
- **Payload inválido, wallet inexistente, conflito**: manda direto para a DLQ (`wager-transactions-dlq.fifo`) e apaga.
- **Erro de infra** (banco fora): não apaga e aumenta o visibility timeout (5s, 10s, 20s...). Depois de 5 recebimentos o próprio SQS manda para a DLQ (`maxReceiveCount: 5`).
- **SIGTERM**: o Nest chama o `onModuleDestroy`, o consumidor termina a mensagem atual e devolve as outras do lote para a fila (visibility 0).

Não confio só no FIFO do SQS. A ordem e a deduplicação dele ajudam, mas quem garante a consistência é o banco (lock, unique e inbox).

## Outbox

Os eventos são gravados em `outbox_messages` na **mesma transação** que muda o saldo, então nunca existe saldo alterado sem evento, nem evento sem commit.

O `OutboxPublisher` roda a cada 1 segundo e faz `SELECT ... FOR UPDATE SKIP LOCKED`, assim várias instâncias podem rodar juntas sem pegar a mesma linha. Depois de enviar para a fila `wallet-events` marca `published_at`. Se der erro, agenda nova tentativa com espera crescente (2s, 4s, 8s... até 5 min).

Se o processo morrer depois de enviar e antes do commit, o evento é enviado de novo. Por isso todo evento tem `eventId` único, para quem consome conseguir ignorar repetido (entrega at-least-once).

Eventos: `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference` e `WalletBalanceChanged`. Todos herdam da classe abstrata `IntegrationEvent` e o `data` usa `{ amount, currency }` em string.

## Reconciliação

`POST /wallets/:walletId/reconciliation` soma o ledger (créditos menos débitos) e compara com o saldo salvo. Se for diferente, **não corrige**: loga como erro, soma na métrica `divergencias_reconciliacao` e devolve `consistent: false`.

## Observabilidade

- Logs em JSON (`JsonLogger`), uma linha por log, com `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId` quando existem. Não logo o payload inteiro da transação.
- `GET /metrics` devolve contadores: transações por status, duplicatas, conflitos, retries, mensagens na DLQ, divergências, latência média e máxima, e o lag da outbox (quantos eventos esperando e há quantos segundos).
- `GET /health/live` só diz que o processo está vivo. `GET /health/ready` testa o Postgres e o SQS e devolve 503 se algum estiver fora.

## Autenticação

**Não implementei.** O desafio diz que não vale pontos e eu preferi usar o tempo na parte financeira.

Deixei o ponto de extensão no código: `src/http/auth.guard.ts` (hoje sempre deixa passar) já está aplicado nos controllers de wallet e wagering. Health não tem guard.

Como eu faria:
1. Subir um **Keycloak** no docker compose.
2. Cada provedor seria um client com `client_credentials` e receberia um token JWT.
3. O `AuthGuard` validaria o token (assinatura pelo JWKS do Keycloak, expiração e audience).
4. O guard também conferiria se o `providerId` do body é o mesmo do token, para um provedor não mandar transação em nome de outro.

Mensagens da fila são tratadas como canal interno confiável, mas o `providerId` delas passa pelas mesmas validações de domínio.

## Testes

- `src/domain/money.spec.ts`: testes unitários da `Money`.
- `test/concorrencia.spec.ts`: sobe **3 instâncias** reais da aplicação (processos separados) usando o Postgres do docker e testa: mesma aposta 50 vezes, saldo 100 com duas apostas de 80, wallets diferentes em paralelo e 30 apostas divididas entre as 3 instâncias. Em todos confere que o saldo da wallet é igual à soma do ledger.
