import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Wallet } from '../domain/wallet';
import { CriarWalletDto } from './wallet.dto';
import { WalletService } from './wallet.service';

function paraResposta(wallet: Wallet) {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  async criar(@Body() body: CriarWalletDto) {
    const wallet = await this.walletService.criar(body);
    return paraResposta(wallet);
  }

  @Get(':walletId')
  async buscar(@Param('walletId', ParseUUIDPipe) walletId: string) {
    const wallet = await this.walletService.buscar(walletId);
    return paraResposta(wallet);
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const limite = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.walletService.listarLedger(walletId, cursor, limite);
  }

  @Post(':walletId/reconciliation')
  @HttpCode(200)
  async reconciliar(@Param('walletId', ParseUUIDPipe) walletId: string) {
    return this.walletService.reconciliar(walletId);
  }
}
