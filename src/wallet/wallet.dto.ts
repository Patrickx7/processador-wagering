import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, ValidateNested } from 'class-validator';

export class MoneyDto {
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;
}

export class CriarWalletDto {
  @IsUUID()
  playerId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
