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
   - Access: **Private** (khuyến nghị) — audio chỉ tải qua BE đã auth
4. Chọn project để gắn env (hoặc copy token thủ công)
5. Copy biến **`BLOB_READ_WRITE_TOKEN`** (dạng `vercel_blob_rw_...`)

Nếu chưa có project trên Vercel: tạo project trống (Import Git hoặc Create) rồi Create Blob store và gắn vào project — token sẽ hiện trong Project → Settings → Environment Variables.

## 2) Gắn vào Nest BE (`be/.env`)

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxx
# Phải khớp Access của store (Public store → public; Private store → private)
BLOB_ACCESS=public
STORAGE_ALLOW_LOCAL_FALLBACK=false
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
  "vercelBlob": { "ready": true, "access": "private" }
}
```

## 4) Luồng

### A) Client upload (khuyến nghị — cuộc họp dài / file > ~4.5MB)

Vercel Hobby Function chỉ nhận body ~**4.5MB**. File audio dài phải upload **trực tiếp từ trình duyệt → Vercel Blob**:

1. `GET /api/v1/recordings/:id/audio/upload-info` → pathname + access  
2. Browser `upload()` (`@vercel/blob/client`) → `POST .../audio/client-upload` (token) → Blob  
3. `POST .../audio/confirm` `{ url }` → Firestore `audioPath`  
4. `POST .../finalize` — **chỉ thành công khi đã có audio**

### B) Server multipart (file nhỏ / không có Blob)

1. `POST /api/v1/recordings/:id/audio` → `put()` lên Vercel Blob  
2. Firestore `audioPath` = blob URL  
3. `GET /api/v1/recordings/:id/audio` → BE tải từ Blob → stream cho FE  

Xem file trên dashboard: Storage → store → Browser (dán URL).

## Lưu ý

- Hobby ~1 GB — ghi âm dài sẽ đầy nhanh  
- Quá quota Hobby → bị tạm khóa tới kỳ sau  
- Token **không commit** git  
- `MAX_AUDIO_MB` mặc định **200** (cuộc họp) 
