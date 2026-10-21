import { LoggerService } from '@nestjs/common';

// escreve cada log como uma linha de JSON
export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string) {
    this.escrever('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string) {
    this.escrever('error', message, context);
  }

  warn(message: unknown, context?: string) {
    this.escrever('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.escrever('debug', message, context);
  }

  private escrever(level: string, message: unknown, context?: string) {
    const campos =
      typeof message === 'object' && message !== null
        ? message
        : { msg: message };
    console.log(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        context,
        ...campos,
      }),
    );
  }
}
