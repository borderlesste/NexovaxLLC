import './instrument';
import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { assertConfig, config } from './config';
import { LocalizedExceptionFilter } from './common/i18n-errors';
import { CatalogLocaleInterceptor } from './common/i18n-catalog';
import { clientIpMiddleware } from './common/client-ip';

async function bootstrap() {
  assertConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  // First middleware: the visitor's real IP for rate limits (ours and Supabase Auth's) and logs.
  app.use(clientIpMiddleware);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  // Don't advertise the framework, and basic hardening headers for a JSON/media API.
  const http = app.getHttpAdapter().getInstance();
  http.disable?.('x-powered-by');
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    // HTTPS only (api.nexovax.com sits behind Cloudflare/Render TLS); browsers skip plain HTTP for 2 years.
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });
  app.useGlobalFilters(new LocalizedExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.useGlobalInterceptors(new CatalogLocaleInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
      exceptionFactory: (errors) => {
        const { AppError } = require('./common/errors');
        // class-validator's default messages are English and technical ("status must be one of…").
        const DEFAULTS: Record<string, string> = {
          isIn: 'Selecciona una opción válida.', isEnum: 'Selecciona una opción válida.', isUuid: 'Identificador inválido.', isBoolean: 'Valor inválido.',
          isInt: 'Debe ser un número entero.', isNumber: 'Debe ser un número.', min: 'El valor es menor que el mínimo permitido.', max: 'El valor supera el máximo permitido.',
          isString: 'Debe ser un texto.', isObject: 'Valor inválido.', isArray: 'Valor inválido.', arrayMinSize: 'Agrega al menos un elemento.', arrayMaxSize: 'Hay demasiados elementos.',
          isEmail: 'Correo electrónico inválido.', minLength: 'El texto es demasiado corto.', maxLength: 'El texto es demasiado largo.', length: 'La longitud del texto no es válida.',
          matches: 'El formato no es válido.', whitelistValidation: 'Campo no permitido.', nestedValidation: 'Valor inválido.',
        };
        const spanish = (key: string, msg: string, prop: string) => (msg.startsWith(`${prop} `) || msg.startsWith('each value') ? DEFAULTS[key] ?? 'Valor inválido.' : msg);
        // Flatten nested DTO errors (e.g. address.phone, variants.0.price).
        const flat = (list: any[], prefix = ''): { field: string; errors: string[] }[] =>
          list.flatMap((e) => [
            ...(e.constraints ? [{ field: prefix + e.property, errors: Object.entries(e.constraints).map(([k, m]) => spanish(k, m as string, e.property)) }] : []),
            ...flat(e.children ?? [], `${prefix}${e.property}.`),
          ]);
        const fields = flat(errors);
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
  // The API map (every route, including admin ones) is only published outside production,
  // unless explicitly enabled with SWAGGER_ENABLED=true.
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true')
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  await app.listen(config.port);
  // Slow-client protection (slowloris): a whole request (headers + body) must arrive within
  // requestTimeout (Node's default is 5 min). keepAliveTimeout stays above the load balancer's idle
  // timeout, and headersTimeout above keepAliveTimeout, so the balancer never reuses a closed socket.
  const server = app.getHttpServer();
  server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 120_000); // uploads up to 64 MB
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}
bootstrap();
