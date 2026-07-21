# Firebase setup — project sonic-27ed5

Console: https://console.firebase.google.com/u/0/project/sonic-27ed5/overview

## Why recordings / files are missing

1. **Chưa có service account** → Firebase Storage + Firestore `ready: false`
2. Audio upload fails → bản ghi có thể lưu transcript nhưng `hasAudio=false`
3. Mỗi tài khoản chỉ thấy **bản ghi của chính mình** (JWT user)
4. Bản ghi kẹt status `recording` trước đây bị ẩn — đã sửa để tự hiện lại

## Bước bắt buộc (1 lần)

### 1) Bật Storage + **Firestore Database** trên Console (bắt buộc)

Firestore **phải được Create** — nếu chưa có DB, login/register sẽ lỗi `NOT_FOUND`.

1. Mở: https://console.firebase.google.com/project/sonic-27ed5/firestore  
2. **Create database** → chọn **Native mode**  
3. Location gợi ý: `asia-southeast1` (Singapore) hoặc multi-region  
4. Start in **production mode** (server dùng Admin SDK, rules client deny-all ok)

- Build → **Storage** → Get started (bắt buộc để upload audio lên cloud)
  - Link: https://console.firebase.google.com/project/sonic-27ed5/storage  
  - Project mới thường **cần Blaze billing** mới tạo được bucket.  
  - Nếu chưa bật được Storage: BE sẽ tạm lưu audio local (`STORAGE_ALLOW_LOCAL_FALLBACK=true`).

### 2) Tạo service account key
1. Project settings (⚙️) → **Service accounts**
2. **Generate new private key**
3. Lưu file vào:

```text
secrets/sonic-27ed5-firebase-adminsdk.json
```

File này **không commit git** (đã ignore trong `.gitignore`).

### 3) Deploy rules (optional, từ thư mục `be/`)

```bash
cd be
npx firebase deploy --only firestore:rules,storage
```

Config nằm trong `be/`: `.firebaserc`, `firebase.json`, `firestore.rules`, `storage.rules`.

### 4) Restart backend

```bash
cd be
npm run start:dev
```

Check: `GET http://localhost:3001/api/v1/health`

```json
"firebase": { "projectId": "sonic-27ed5", "ready": true }
```

### 5) Ghi âm lại
Bản ghi mới sẽ:
- Metadata (users, recordings, transcript, dictionary) → **Firestore**
- Audio → `gs://sonic-27ed5.firebasestorage.app/users/{userId}/recordings/...`

## Env

```env
FIREBASE_PROJECT_ID=sonic-27ed5
FIREBASE_STORAGE_BUCKET=sonic-27ed5.firebasestorage.app
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/sonic-27ed5-firebase-adminsdk.json
DB_PROVIDER=firestore
```

App data và audio đều lưu trên Firebase (Firestore + Storage). Không dùng SQLite làm nguồn chính nữa.
