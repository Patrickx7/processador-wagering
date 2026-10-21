import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

// qualquer erro que nao for HTTP (banco fora, sqs fora...) vira 503,
// assim o provedor sabe que pode tentar de novo
@Catch()
export class InfraErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(InfraErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }

    this.logger.error({
      msg: 'erro de infraestrutura',
      erro: (error as Error).message,
    });
    response.status(503).json({
      statusCode: 503,
      error: 'TEMPORARY_FAILURE',
      message: 'Falha temporária, tente novamente',
    });
  }
}
