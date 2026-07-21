# Vercel Blob — lưu audio (Hobby free)

Hobby: ~**1 GB** storage, thường **không cần thẻ**. Docs: [Vercel Blob](https://vercel.com/storage/blob)

Firestore Firestore chỉ lưu **URL file** (`audioPath`), ví dụ:

```text
https://xxxxx.public.blob.vercel-storage.com/users/.../recording.webm
```

## 1) Tạo Blob store trên account của bạn

1. Đăng nhập: https://vercel.com/login  
2. Mở Storage / Blob: https://vercel.com/dashboard/stores  
   (hoặc từ team `pala3`: Storage → Create → **Blob**)  
3. **Create Database / Create Blob store**
   - Name: `sonic-audio` (tuỳ chọn)
   - Access: **Public** (đơn giản cho demo) hoặc Private
4. Chọn project để gắn env (hoặc copy token thủ công)
5. Copy biến **`BLOB_READ_WRITE_TOKEN`** (dạng `vercel_blob_rw_...`)

Nếu chưa có project trên Vercel: tạo project trống (Import Git hoặc Create) rồi Create Blob store và gắn vào project — token sẽ hiện trong Project → Settings → Environment Variables.

## 2) Gắn vào Nest BE (`be/.env`)

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxx
# public | private — phải khớp loại store
BLOB_ACCESS=public
STORAGE_ALLOW_LOCAL_FALLBACK=true
```

## 3) Restart BE

```bash
cd be
npm run start:dev
```

Check: `GET http://localhost:3001/api/v1/health`

```json
"storage": {
  "provider": "vercel-blob",
  "vercelBlob": { "ready": true, "access": "public" }
}
```

## 4) Luồng

1. `POST /api/v1/recordings/:id/audio` → `put()` lên Vercel Blob  
2. Firestore `audioPath` = blob URL  
3. `GET /api/v1/recordings/:id/audio` → BE tải từ Blob → stream cho FE  

Xem file trên dashboard: Storage → store → Browser (dán URL).

## Lưu ý

- Hobby ~1 GB — ghi âm dài sẽ đầy nhanh  
- Quá quota Hobby → bị tạm khóa tới kỳ sau  
- Token **không commit** git  
