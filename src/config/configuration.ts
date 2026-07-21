import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  name: process.env.APP_NAME ?? 'Sonic Scribe API',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
  speechProvider: process.env.SPEECH_PROVIDER ?? 'gemini',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? '',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  maxAudioMb: parseInt(process.env.MAX_AUDIO_MB ?? '50', 10),
  throttleTtlMs: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
  throttleLimit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  firebase: {
    enabled: process.env.FIREBASE_ENABLED !== 'false',
    projectId: process.env.FIREBASE_PROJECT_ID ?? 'sonic-27ed5',
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ??
      'sonic-27ed5.firebasestorage.app',
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '',
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  },
  db: {
    type: process.env.DB_TYPE ?? 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'sonic',
    password: process.env.DB_PASSWORD ?? 'sonic_secure_pass',
    database: process.env.DB_NAME ?? 'sonic_scribe',
    sqlitePath: process.env.DB_SQLITE_PATH ?? './data/sonic.sqlite',
    synchronize: process.env.DB_SYNC === 'true',
    logging: process.env.DB_LOGGING === 'true',
  },
}));
