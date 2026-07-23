# Cloudflare R2 — lưu audio (free tier ~10GB)

Ưu tiên hơn Vercel Blob cho demo/cuộc họp dài: browser **PUT thẳng lên R2** (presigned URL), không bị giới hạn ~4.5MB của Vercel Function.

## Lưu ý miễn phí

- R2 có **free tier** (~10GB storage / tháng).
- Cloudflare thường **yêu cầu gắn thẻ** để bật R2 — trong free tier **không bị trừ** nếu không vượt hạn mức.
- Docs: https://developers.cloudflare.com/r2/

## Cách nhanh (script)

```bash
cd be
npm run setup:r2
```

Script sẽ:
1. Mở trình duyệt đăng nhập Cloudflare (wrangler) nếu chưa login  
2. Tạo bucket `sonic-scribe-audio`  
3. In hướng dẫn tạo **R2 API Token** (Access Key + Secret)  
4. Gợi ý dòng `.env` cần dán  

## Thủ công (Dashboard)

1. https://dash.cloudflare.com → **R2 Object Storage** → Enable R2 (nếu hỏi thẻ)  
2. **Create bucket** tên: `sonic-scribe-audio`  
3. **Manage R2 API Tokens** → Create → permission **Object Read & Write** → chọn bucket  
4. Copy:
   - Account ID (trên overview R2)
   - Access Key ID
   - Secret Access Key  
5. **Settings → CORS** của bucket (hoặc để script/`ensureCors` set):

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://sonic-scribe-sigma.vercel.app"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## `.env` (local) + Vercel env (production BE)

```env
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_BUCKET=sonic-scribe-audio
# optional
# R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
# R2_PUBLIC_BASE_URL=

# Khi R2 sẵn sàng, app ưu tiên R2 cho upload lớn
STORAGE_ALLOW_LOCAL_FALLBACK=false
```

Trên Vercel project BE: Settings → Environment Variables → thêm các `R2_*` → Redeploy.

## Kiểm tra

```bash
curl https://be-sonic.vercel.app/api/v1/health
# storage.provider === "r2", storage.r2.ready === true
```

Luồng FE: `upload-info` → PUT `uploadUrl` → `confirm` `{ provider:'r2', key }` → `finalize`.
