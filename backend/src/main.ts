import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { assertConfig, config } from './config';
import { LocalizedExceptionFilter } from './common/i18n-errors';
import { CatalogLocaleInterceptor } from './common/i18n-catalog';

async function bootstrap() {
  assertConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.useGlobalFilters(new LocalizedExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.useGlobalInterceptors(new CatalogLocaleInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
      exceptionFactory: (errors) => {
        const { AppError } = require('./common/errors');
        const fields = errors.map((e) => ({ field: e.property, errors: Object.values(e.constraints ?? {}) }));
        return new AppError('VALIDATION_FAILED', 'Revisa los datos del formulario.', 400, fields);
      },
    }),
  );
  const doc = new DocumentBuilder()
    .setTitle('NEXOVAX API')
    .setDescription('REST API of the NEXOVAX multi-vendor marketplace (NestJS + Supabase).')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  await app.listen(config.port);
}
bootstrap();
