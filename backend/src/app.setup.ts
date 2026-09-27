import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';

/** HTTP pipeline shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  // All routes are served under /api/v1/... (see PROJECT_CONTEXT.md).
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
