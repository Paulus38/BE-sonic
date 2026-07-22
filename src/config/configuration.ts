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
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
  speechProvider: process.env.SPEECH_PROVIDER ?? 'gemini',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? '',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  maxAudioMb: parseInt(process.env.MAX_AUDIO_MB ?? '50', 10),
  throttleTtlMs: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
  throttleLimit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  /** Live WS soft limits (per connection) */
  liveAudioChunkPerSec: parseInt(process.env.LIVE_AUDIO_CHUNK_PER_SEC ?? '40', 10),
  liveUtterancePerSec: parseInt(process.env.LIVE_UTTERANCE_PER_SEC ?? '20', 10),
  liveSessionStartPerMin: parseInt(
    process.env.LIVE_SESSION_START_PER_MIN ?? '10',
    10,
  ),
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    endpoint: process.env.R2_ENDPOINT ?? '',
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? '',
  },
  vercelBlob: {
    token:
      process.env.BLOB_READ_WRITE_TOKEN ??
      process.env.VERCEL_BLOB_READ_WRITE_TOKEN ??
      '',
    access: process.env.BLOB_ACCESS ?? 'private',
  },
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
    /** firestore (cloud) — default. Legacy: sqlite | postgres via TypeORM (removed). */
    provider: process.env.DB_PROVIDER ?? 'firestore',
    type: process.env.DB_TYPE ?? 'sqlite',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'sonic',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'sonic_scribe',
    sqlitePath: process.env.DB_SQLITE_PATH ?? './data/sonic.sqlite',
    synchronize: process.env.DB_SYNC === 'true',
    logging: process.env.DB_LOGGING === 'true',
  },
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  swaggerEnabled:
    process.env.SWAGGER_ENABLED === 'true' ||
    (process.env.SWAGGER_ENABLED !== 'false' &&
      (process.env.NODE_ENV ?? 'development') !== 'production'),
}));
