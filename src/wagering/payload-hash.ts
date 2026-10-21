import { createHash } from 'crypto';
import { Money } from '../domain/money';
import { SubmeterTransacaoDto } from './wagering.dto';

// as chaves ficam em ordem alfabetica pra gerar sempre o mesmo JSON
export function calcularPayloadHash(dto: SubmeterTransacaoDto): string {
  const dados = {
    externalTransactionId: dto.externalTransactionId,
    gameId: dto.gameId,
    kind: dto.kind,
    money: Money.from(dto.money).toJSON(),
    playerId: dto.playerId,
    providerId: dto.providerId,
    referenceExternalTransactionId: dto.referenceExternalTransactionId ?? null,
    roundId: dto.roundId,
    walletId: dto.walletId,
  };

  return createHash('sha256').update(JSON.stringify(dados)).digest('hex');
}
