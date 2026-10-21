import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { WagerTransactionStatus } from '../domain/wager-transaction';
import { SubmeterTransacaoDto } from './wagering.dto';
import { ResultadoTransacao, WageringService } from './wagering.service';

function paraResposta(resultado: ResultadoTransacao) {
  return {
    transactionId: resultado.transactionId,
    status: resultado.status,
    failureCode: resultado.failureCode,
    balance: resultado.balance.toJSON(),
    idempotentReplay: resultado.idempotentReplay,
  };
}

@Controller()
export class WageringController {
  constructor(private readonly wageringService: WageringService) {}

  @Post('wagering/transactions')
  async submeter(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() body: SubmeterTransacaoDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key é obrigatório');
    }

    const resultado = await this.wageringService.processar(
      idempotencyKey,
      body,
      {
        correlationId: correlationId ?? randomUUID(),
      },
    );

    // 200 processada, 202 esperando referencia, 422 recusada por regra de negocio
    if (resultado.status === WagerTransactionStatus.PendingReference) {
      res.status(202);
    } else if (resultado.status === WagerTransactionStatus.Rejected) {
      res.status(422);
    } else {
      res.status(200);
    }

    return paraResposta(resultado);
  }

  @Get('wagering/transactions/:transactionId')
  async buscar(@Param('transactionId', ParseUUIDPipe) transactionId: string) {
    return paraResposta(await this.wageringService.buscar(transactionId));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async buscarPorExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return paraResposta(
      await this.wageringService.buscarPorExternalId(
        providerId,
        externalTransactionId,
      ),
    );
  }
}
