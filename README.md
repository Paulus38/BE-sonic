# Sonic Scribe Backend

NestJS API for realtime speech-to-text, bilingual translation, recordings, and dictionary.

## Quick start

```bash
# 1. Configure env
cp .env.example .env
# Set JWT_SECRET (>= 32 chars), GEMINI_API_KEY
# Firebase (project sonic-27ed5):
#   - Console: https://console.firebase.google.com/u/0/project/sonic-27ed5/overview
#   - Enable Storage
#   - Project settings → Service accounts → Generate new private key
#   - Save JSON to be/secrets/sonic-27ed5-firebase-adminsdk.json
#   - Set FIREBASE_SERVICE_ACCOUNT_PATH in .env

# 2. Database
# Local default: DB_TYPE=sqlite (no Docker needed)
# Production: docker compose up -d && DB_TYPE=postgres

# 3. Install & run
npm install
npm run start:dev
```

- API: http://localhost:3001/api/v1/health
- Swagger: http://localhost:3001/docs
- Live WS: `ws://localhost:3001/live` (Socket.IO, JWT in `auth.token`)

## Security

- JWT Bearer auth on all protected routes and WebSocket
- bcrypt password hashing
- Helmet, CORS allowlist, global ValidationPipe (whitelist)
- Rate limiting (Throttler)
- Audio upload MIME + size checks, path traversal safe storage
- Soft delete for users/recordings/dictionary

## Cloud storage (Firebase)

| Env | Value |
|-----|--------|
| `FIREBASE_PROJECT_ID` | `sonic-27ed5` |
| `FIREBASE_STORAGE_BUCKET` | `sonic-27ed5.firebasestorage.app` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | path to Admin SDK JSON |

Object keys: `users/{userId}/recordings/{recordingId}/{uuid}.webm`

Media is **not** stored under `src/` or as primary files in `uploads/`.

## Speech / AI

Gemini is used for STT (default), summarize, and translate fallback.
See **[AI_SETUP.md](./AI_SETUP.md)** for which product features need AI vs free APIs.

| `SPEECH_PROVIDER` | Requires |
|-------------------|----------|
| `auto` (recommended) | Both keys preferred; picks fastest ready provider |
| `gemini` | `GEMINI_API_KEY` |
| `deepgram` | `DEEPGRAM_API_KEY` |

Also: [FIREBASE_SETUP.md](./FIREBASE_SETUP.md), [VERCEL_BLOB_SETUP.md](./VERCEL_BLOB_SETUP.md).

## Logging

| Mode | Where | How |
|------|--------|-----|
| App / HTTP | Vercel Runtime Logs / local stdout | `LOG_LEVEL`, `LOG_HTTP` (nestjs-pino JSON) |
| Audit trail | Firestore `audit_logs` + FE **Nhật ký** (admin) | Login, recording save/delete, AI summarize/retranscribe, admin user ops |

```bash
# Local verbose
LOG_LEVEL=debug
LOG_HTTP=true
```

Production: set `LOG_LEVEL=info` on Vercel. View audit in the app sidebar → **Nhật ký** (admin only), or `GET /api/v1/admin/logs`.
