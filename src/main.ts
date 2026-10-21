import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainErrorFilter } from './http/domain-error.filter';
import { InfraErrorFilter } from './http/infra-error.filter';
import { JsonLogger } from './logger/json-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // a ordem importa: o ultimo filtro e checado primeiro
  app.useGlobalFilters(new InfraErrorFilter(), new DomainErrorFilter());
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
