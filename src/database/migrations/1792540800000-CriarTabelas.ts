import { MigrationInterface, QueryRunner } from 'typeorm';

export class CriarTabelas1792540800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE wallets (
        id UUID PRIMARY KEY,
        player_id UUID NOT NULL,
        currency CHAR(3) NOT NULL,
        balance_cents BIGINT NOT NULL CHECK (balance_cents >= 0),
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (player_id, currency)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE wager_transactions (
        id UUID PRIMARY KEY,
        provider_id TEXT NOT NULL,
        external_transaction_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        player_id UUID NOT NULL,
        round_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
        currency CHAR(3) NOT NULL,
        reference_external_transaction_id TEXT,
        reference_transaction_id UUID REFERENCES wager_transactions(id),
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        failure_code TEXT,
        balance_after_cents BIGINT,
        attempts INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ,
        UNIQUE (provider_id, external_transaction_id),
        CHECK (kind NOT IN ('REFUND', 'ROLLBACK') OR reference_external_transaction_id IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_reversao_unica ON wager_transactions (reference_transaction_id, kind)
      WHERE status = 'PROCESSED' AND kind IN ('REFUND', 'ROLLBACK')
    `);

    await queryRunner.query(`
      CREATE INDEX ix_pending_reference ON wager_transactions (next_attempt_at)
      WHERE status = 'PENDING_REFERENCE'
    `);

    await queryRunner.query(`
      CREATE TABLE ledger_entries (
        id UUID PRIMARY KEY,
        seq BIGSERIAL UNIQUE,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        transaction_id UUID NOT NULL UNIQUE REFERENCES wager_transactions(id),
        direction TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
        amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
        balance_before_cents BIGINT NOT NULL CHECK (balance_before_cents >= 0),
        balance_after_cents BIGINT NOT NULL CHECK (balance_after_cents >= 0),
        currency CHAR(3) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (
          (direction = 'CREDIT' AND balance_after_cents = balance_before_cents + amount_cents) OR
          (direction = 'DEBIT' AND balance_after_cents = balance_before_cents - amount_cents)
        )
      )
    `);

    await queryRunner.query(`
      CREATE FUNCTION bloquear_alteracao_ledger() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ledger_entries não pode ser alterado nem apagado';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER ledger_imutavel
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_ledger()
    `);

    await queryRunner.query(`
      CREATE TABLE inbox_messages (
        consumer_name TEXT NOT NULL,
        message_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ,
        PRIMARY KEY (consumer_name, message_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE outbox_messages (
        id UUID PRIMARY KEY,
        aggregate_id UUID NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        attempts INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE INDEX ix_outbox_pendentes ON outbox_messages (next_attempt_at)
      WHERE published_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE outbox_messages`);
    await queryRunner.query(`DROP TABLE inbox_messages`);
    await queryRunner.query(`DROP TRIGGER ledger_imutavel ON ledger_entries`);
    await queryRunner.query(`DROP FUNCTION bloquear_alteracao_ledger`);
    await queryRunner.query(`DROP TABLE ledger_entries`);
    await queryRunner.query(`DROP TABLE wager_transactions`);
    await queryRunner.query(`DROP TABLE wallets`);
  }
}
