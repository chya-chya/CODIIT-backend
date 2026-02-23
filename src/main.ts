import otelSDK from './tracing';
otelSDK.start();

import cookieParser from 'cookie-parser';
import * as express from 'express';
import { resolve } from 'path';
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { setupSentry } from './common/logger/sentry.config';
import { SentryGlobalFilter } from './common/logger/sentry.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';

// 콤마 구분 환경변수 파서
function parseCommaSeparatedEnv(keys: string[]): string[] {
  for (const envKey of keys) {
    const envValue = process.env[envKey];
    if (!envValue) continue;
    return envValue
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return [];
}

// 스킴 보정, 슬래시 제거, 도메인 판별
function normalizeOrigin(origin: string): string {
  let formatted = origin.trim();
  if (!formatted) return '';
  formatted = formatted.replace(/\/+$/, '');

  const hasScheme = /^https?:\/\//i.test(formatted);
  const isLocalhost =
    /^localhost(:\d+)?$/i.test(formatted) ||
    /^http:\/\/localhost(:\d+)?$/i.test(formatted);
  const isDomainPattern = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(formatted);

  if (!hasScheme) {
    if (isLocalhost) return `http://${formatted}`;
    if (isDomainPattern) return `https://${formatted}`;
  }
  return formatted;
}

// dev/prod 분기, 중복 제거, 기본 로컬 허용
function resolveAllowedOrigins(): string[] {
  const isProduction = process.env.NODE_ENV === 'production';
  const rawOriginList = parseCommaSeparatedEnv(
    isProduction
      ? ['CORS_ORIGINS_PROD', 'CORS_ORIGINS']
      : ['CORS_ORIGINS_DEV', 'CORS_ORIGINS'],
  );

  const normalizedOrigins = rawOriginList.map(normalizeOrigin).filter(Boolean);
  if (normalizedOrigins.length === 0) {
    normalizedOrigins.push('http://localhost:3000', 'http://localhost:3001');
  }
  return Array.from(new Set(normalizedOrigins));
}

// cors origin 검증 콜백
function createCorsOriginValidator() {
  const allowedOrigins = resolveAllowedOrigins();
  const isVercelWildcardEnabled =
    String(process.env.CORS_ALLOW_VERCEL_WILDCARD ?? '').toLowerCase() ===
    'true';
  const isDebug =
    process.env.CORS_DEBUG === 'true' || process.env.NODE_ENV !== 'production';

  return (
    requestOrigin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!requestOrigin) return callback(null, true);

    const isExactMatch = allowedOrigins.includes(requestOrigin);

    let isVercelPreviewAllowed = false;
    if (isVercelWildcardEnabled) {
      try {
        const hostname = new URL(requestOrigin).hostname;
        isVercelPreviewAllowed = /\.vercel\.app$/i.test(hostname);
      } catch (e) {
        if (isDebug) {
          console.warn(
            `[CORS] Invalid origin string (URL parse failed): "${requestOrigin}"`,
            String(e),
          );
        }
      }
    }

    const allowed = isExactMatch || isVercelPreviewAllowed;
    if (isDebug && !allowed) {
      console.warn(
        `[CORS] Denied origin: ${requestOrigin} (allowed: ${JSON.stringify(allowedOrigins)})`,
      );
    }
    callback(null, allowed);
  };
}

async function bootstrap() {
  setupSentry();

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  // cors
  app.enableCors({
    origin: createCorsOriginValidator(),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 204,
  });

  app.use(cookieParser());
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ limit: '5mb', extended: true }));

  const UPLOAD_DIR =
    process.env.UPLOAD_DIR || resolve(process.cwd(), 'uploads');
  app.use('/uploads', express.static(UPLOAD_DIR));
  console.log('[uploads] serving from:', UPLOAD_DIR);

  app.useGlobalFilters(new SentryGlobalFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CODI-IT')
    .setDescription('CODI-IT API 명세입니다.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
  console.log('Allowed Origins:', resolveAllowedOrigins());
}

bootstrap().catch((err) => {
  console.error('bootstrap failed: ', err);
  process.exit(1);
});
