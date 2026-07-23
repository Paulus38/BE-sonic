import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3001;
  const origins = config.get<string[]>('app.corsOrigins') ?? [
    'http://localhost:5173',
  ];

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerEnabled = config.get<boolean>('app.swaggerEnabled') ?? false;
  if (swaggerEnabled) {
    const swagger = new DocumentBuilder()
      .setTitle('Sonic Scribe API')
      .setDescription('Realtime speech-to-text backend')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swagger),
    );
  }

  await app.listen(port, '0.0.0.0');
  const logger = app.get(Logger);
  logger.log(`Sonic Scribe API listening on http://0.0.0.0:${port}`);
  if (swaggerEnabled) {
    logger.log(`Swagger docs: http://localhost:${port}/docs`);
  }
}

bootstrap();
