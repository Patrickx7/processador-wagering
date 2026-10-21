import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { DomainError } from '../domain/domain-error';
import { MoneyError } from '../domain/money';

@Catch(MoneyError, DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(error: MoneyError | DomainError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const code = error instanceof DomainError ? error.code : 'INVALID_MONEY';

    response.status(400).json({ statusCode: 400, error: code, message: error.message });
  }
}