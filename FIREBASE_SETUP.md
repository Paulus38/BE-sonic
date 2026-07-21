# Firebase setup — project sonic-27ed5

Console: https://console.firebase.google.com/u/0/project/sonic-27ed5/overview

## Why recordings / files are missing

1. **Chưa có service account** → Firebase Storage + Firestore `ready: false`
2. Audio upload fails → bản ghi có thể lưu transcript nhưng `hasAudio=false`
3. Mỗi tài khoản chỉ thấy **bản ghi của chính mình** (JWT user)
4. Bản ghi kẹt status `recording` trước đây bị ẩn — đã sửa để tự hiện lại

## Bước bắt buộc (1 lần)

### 1) Bật Storage + Firestore trên Console
- Build → **Storage** → Get started
- Build → **Firestore Database** → Create database (production mode ok; server dùng Admin SDK)

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
- Metadata → Firestore (khi `DB_PROVIDER=firestore`) hoặc SQLite tạm
- Audio → `gs://sonic-27ed5.firebasestorage.app/users/{userId}/recordings/...`

## Env

```env
FIREBASE_PROJECT_ID=sonic-27ed5
FIREBASE_STORAGE_BUCKET=sonic-27ed5.firebasestorage.app
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/sonic-27ed5-firebase-adminsdk.json
DB_PROVIDER=firestore
```

Cho đến khi có service account, backend tạm lưu audio local trong `be/uploads` để bạn vẫn nghe lại được — sau khi gắn key, bản ghi mới sẽ lên Firebase.
