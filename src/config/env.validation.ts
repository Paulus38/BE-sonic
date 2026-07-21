import { plainToInstance } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsOptional()
  @IsString()
  DB_TYPE?: string;

  @IsOptional()
  @IsString()
  DB_HOST?: string;

  @IsOptional()
  @IsString()
  DB_USER?: string;

  @IsOptional()
  @IsString()
  DB_PASSWORD?: string;

  @IsOptional()
  @IsString()
  DB_NAME?: string;

  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;

  @IsOptional()
  @IsString()
  DEEPGRAM_API_KEY?: string;

  @IsOptional()
  @IsString()
  FIREBASE_PROJECT_ID?: string;

  @IsOptional()
  @IsString()
  FIREBASE_STORAGE_BUCKET?: string;

  @IsOptional()
  @IsString()
  FIREBASE_SERVICE_ACCOUNT_PATH?: string;

  @IsOptional()
  @IsString()
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${messages}`);
  }

  const dbType = String(config.DB_TYPE ?? 'postgres');
  if (dbType === 'postgres') {
    for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      if (!config[key]) {
        throw new Error(`Environment validation failed: ${key} is required for postgres`);
      }
    }
  }

  return validated;
}
