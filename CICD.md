# CI/CD — Backend (BE-sonic)

## Pipeline

| Workflow | Khi chạy | Việc làm |
|----------|----------|----------|
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Push / PR → `main` | `npm ci` → typecheck → build |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Manual (`workflow_dispatch`) | Build gate → deploy Vercel (+ optional Firebase rules) |

## Khuyến nghị CD: Vercel Git Integration

1. Mở [Vercel Dashboard](https://vercel.com/dashboard) → **Add New Project**
2. Import repo `Paulus38/BE-sonic`
3. Framework: **NestJS** (đã có `vercel.json`)
4. Gắn Environment Variables (Production + Preview) từ `be/.env.example`:
   - `JWT_SECRET` (≥32 chars)
   - `CORS_ORIGINS` (URL FE production)
   - `BLOB_READ_WRITE_TOKEN`, `BLOB_ACCESS=private`
   - `FIREBASE_*`, `GEMINI_API_KEY`, `ADMIN_EMAILS`, …
5. Deploy — URL kiểu `https://be-sonic.vercel.app`

Mỗi push `main` sẽ auto-deploy. Preview deploy cho mỗi PR.

## Option: Deploy từ GitHub Actions

Chỉ dùng nếu không bật Git Integration (tránh deploy 2 lần).

### Secrets (Settings → Secrets and variables → Actions)

| Secret | Lấy từ |
|--------|--------|
| `VERCEL_TOKEN` | Vercel → Account → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` sau `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` |
| `FIREBASE_TOKEN` | `firebase login:ci` (chỉ khi deploy rules) |

### Variables

| Variable | Ví dụ |
|----------|--------|
| `DEPLOY_FIREBASE_RULES` | `true` để bật job deploy Firestore/Storage rules |

Rồi: **Actions → Deploy → Run workflow**.

Local lấy org/project id:

```bash
cd be
npx vercel link
cat .vercel/project.json
```

## Firebase rules

Rules nằm trong repo này (`firestore.rules`, `storage.rules`).

```bash
# local
npx firebase deploy --only firestore:rules,storage
```

Hoặc bật `DEPLOY_FIREBASE_RULES=true` + secret `FIREBASE_TOKEN` rồi chạy workflow Deploy.

## Lưu ý WebSocket / live

Live `/live` dùng Socket.IO + state in-memory. Trên Vercel Functions (Fluid):

- Client cần reconnect khi connection đóng
- Scale ngang nhiều instance → session Map không chia sẻ (cân nhắc Redis sau)

Nếu live không ổn định, cân nhắc host Nest dài hạn (Railway / Fly / Render) và giữ Vercel chỉ cho HTTP.
