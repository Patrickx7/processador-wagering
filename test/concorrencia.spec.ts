import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'crypto';
import { Money } from '../src/domain/money';

// sobe 3 instancias de verdade da aplicacao, usando o mesmo Postgres do docker
const portas = [3101, 3102, 3103];
const processos: ReturnType<typeof Bun.spawn>[] = [];

async function esperarSubir(porta: number) {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://localhost:${porta}/wallets/${randomUUID()}`);
      return;
    } catch {
      await Bun.sleep(200);
    }
  }
  throw new Error(`instancia na porta ${porta} nao subiu`);
}

async function criarWallet(saldo: string) {
  const playerId = randomUUID();
  const resposta = await fetch(`http://localhost:${portas[0]}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId,
      initialBalance: { amount: saldo, currency: 'BRL' },
    }),
  });
  const wallet = await resposta.json();
  return { walletId: wallet.id as string, playerId };
}

async function apostar(
  porta: number,
  wallet: { walletId: string; playerId: string },
  externalId: string,
  valor: string,
) {
  const resposta = await fetch(
    `http://localhost:${porta}/wagering/transactions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `teste:${externalId}`,
      },
      body: JSON.stringify({
        providerId: 'teste',
        externalTransactionId: externalId,
        playerId: wallet.playerId,
        walletId: wallet.walletId,
        roundId: 'rodada-1',
        gameId: 'jogo-1',
        kind: 'BET',
        money: { amount: valor, currency: 'BRL' },
      }),
    },
  );
  return { status: resposta.status, body: await resposta.json() };
}

async function buscarSaldo(walletId: string) {
  const resposta = await fetch(
    `http://localhost:${portas[0]}/wallets/${walletId}`,
  );
  const wallet = await resposta.json();
  return wallet.balance.amount as string;
}

// soma o ledger inteiro pra comparar com o saldo da wallet
async function saldoPeloLedger(walletId: string) {
  const resposta = await fetch(
    `http://localhost:${portas[0]}/wallets/${walletId}/ledger?limit=100`,
  );
  const ledger = await resposta.json();

  let saldo = Money.zero('BRL');
  let debitos = 0;
  for (const item of ledger.items) {
    const valor = Money.from(item.money);
    if (item.direction === 'CREDIT') {
      saldo = saldo.add(valor);
    } else {
      saldo = saldo.subtract(valor);
      debitos++;
    }
  }
  return { saldo: saldo.toString(), debitos };
}

beforeAll(async () => {
  for (const porta of portas) {
    processos.push(
      Bun.spawn(['bun', 'src/main.ts'], {
        env: { ...process.env, PORT: String(porta) },
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    );
  }
  await Promise.all(portas.map(esperarSubir));
}, 30000);

afterAll(() => {
  for (const processo of processos) {
    processo.kill();
  }
});

describe('concorrencia', () => {
  it('mesma aposta 50 vezes em paralelo gera um debito so', async () => {
    const wallet = await criarWallet('100.00');
    const externalId = randomUUID();

    const respostas = await Promise.all(
      Array.from({ length: 50 }, () =>
        apostar(portas[0], wallet, externalId, '10.00'),
      ),
    );

    const novas = respostas.filter((r) => r.body.idempotentReplay === false);
    expect(novas.length).toBe(1);
    expect(await buscarSaldo(wallet.walletId)).toBe('90.00');

    const ledger = await saldoPeloLedger(wallet.walletId);
    expect(ledger.debitos).toBe(1);
    expect(ledger.saldo).toBe('90.00');
  }, 30000);

  it('saldo 100 e duas apostas de 80 ao mesmo tempo', async () => {
    const wallet = await criarWallet('100.00');

    const [a, b] = await Promise.all([
      apostar(portas[0], wallet, randomUUID(), '80.00'),
      apostar(portas[1], wallet, randomUUID(), '80.00'),
    ]);

    const status = [a.body.status, b.body.status].sort();
    expect(status).toEqual(['PROCESSED', 'REJECTED']);

    const rejeitada = a.body.status === 'REJECTED' ? a : b;
    expect(rejeitada.body.failureCode).toBe('INSUFFICIENT_FUNDS');

    expect(await buscarSaldo(wallet.walletId)).toBe('20.00');
    const ledger = await saldoPeloLedger(wallet.walletId);
    expect(ledger.debitos).toBe(1);
    expect(ledger.saldo).toBe('20.00');
  }, 30000);

  it('wallets diferentes em paralelo', async () => {
    const wallets = await Promise.all(
      Array.from({ length: 5 }, () => criarWallet('50.00')),
    );

    const respostas = await Promise.all(
      wallets.map((wallet) =>
        apostar(portas[0], wallet, randomUUID(), '30.00'),
      ),
    );

    for (const resposta of respostas) {
      expect(resposta.body.status).toBe('PROCESSED');
    }
    for (const wallet of wallets) {
      expect(await buscarSaldo(wallet.walletId)).toBe('20.00');
    }
  }, 30000);

  it('3 instancias apostando na mesma wallet', async () => {
    const wallet = await criarWallet('100.00');

    // 30 apostas de 10 espalhadas nas 3 instancias, so 10 podem passar
    const respostas = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        apostar(portas[i % 3], wallet, randomUUID(), '10.00'),
      ),
    );

    const processadas = respostas.filter((r) => r.body.status === 'PROCESSED');
    const rejeitadas = respostas.filter((r) => r.body.status === 'REJECTED');
    expect(processadas.length).toBe(10);
    expect(rejeitadas.length).toBe(20);

    expect(await buscarSaldo(wallet.walletId)).toBe('0.00');
    const ledger = await saldoPeloLedger(wallet.walletId);
    expect(ledger.saldo).toBe('0.00');
    expect(ledger.debitos).toBe(10);
  }, 30000);
});
