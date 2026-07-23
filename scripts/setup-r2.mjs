#!/usr/bin/env node
/**
 * Semi-auto Cloudflare R2 setup for Sonic Scribe.
 * Usage: npm run setup:r2
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const beRoot = resolve(__dirname, '..');
const BUCKET = process.env.R2_BUCKET_NAME || 'sonic-scribe-audio';
const envPath = resolve(beRoot, '.env');

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, {
    cwd: beRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function runCapture(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: beRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function upsertEnv(vars) {
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, line);
    else text = `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envPath, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  console.log(`\nĐã cập nhật ${envPath}`);
}

console.log('=== Sonic Scribe · Cloudflare R2 setup ===');
console.log(`Bucket: ${BUCKET}`);
console.log(
  'Lưu ý: Cloudflare thường yêu cầu gắn thẻ để bật R2; free tier (~10GB) không bị trừ nếu không vượt hạn.',
);

const wranglerOk = runCapture('npx', ['--yes', 'wrangler', '--version']);
if (wranglerOk.status !== 0) {
  console.error('Không chạy được npx wrangler. Cần Node/npm.');
  process.exit(1);
}

let who = runCapture('npx', ['--yes', 'wrangler', 'whoami']);
if (
  who.status !== 0 ||
  /not logged in|Not logged in|not authenticated|Please run `wrangler login`/i.test(
    who.stdout + who.stderr,
  )
) {
  console.log('\nChưa login Cloudflare — mở trình duyệt để đăng nhập...');
  const login = run('npx', ['--yes', 'wrangler', 'login']);
  if (login.status !== 0) {
    console.error('Login thất bại. Chạy lại: npx wrangler login');
    process.exit(1);
  }
  who = runCapture('npx', ['--yes', 'wrangler', 'whoami']);
}

console.log('\n--- wrangler whoami ---');
console.log((who.stdout || who.stderr || '').trim());

const combined = `${who.stdout}\n${who.stderr}`;
const accountMatch =
  combined.match(/Account\s+ID\s*[|:]\s*([a-f0-9]{32})/i) ||
  combined.match(/\b([a-f0-9]{32})\b/);
const accountId =
  process.env.CLOUDFLARE_ACCOUNT_ID || accountMatch?.[1] || '';

const create = run('npx', [
  '--yes',
  'wrangler',
  'r2',
  'bucket',
  'create',
  BUCKET,
]);
if (create.status !== 0) {
  console.log('(Nếu báo already exists thì OK — tiếp tục.)');
}

const corsHint = [
  {
    AllowedOrigins: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://sonic-scribe-sigma.vercel.app',
    ],
    AllowedMethods: ['GET', 'PUT', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  },
];

console.log('\n=== Bước bắt buộc: tạo R2 API Token (S3 keys) ===');
console.log(
  'Wrangler tạo bucket được, nhưng Access Key/Secret phải tạo trên Dashboard:',
);
console.log('1) Mở: https://dash.cloudflare.com/?to=/:account/r2/api-tokens');
console.log(
  `2) Create API token → Object Read & Write → Apply to bucket: ${BUCKET}`,
);
console.log('3) Copy Access Key ID + Secret Access Key + Account ID');
console.log('\nCORS bucket (Settings → CORS) dán:');
console.log(JSON.stringify(corsHint, null, 2));

upsertEnv({
  ...(accountId ? { R2_ACCOUNT_ID: accountId } : {}),
  R2_BUCKET: BUCKET,
});

if (
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  (accountId || process.env.R2_ACCOUNT_ID)
) {
  upsertEnv({
    R2_ACCOUNT_ID: accountId || process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: BUCKET,
  });
  console.log('Đã ghi R2_ACCESS_KEY_* từ env của shell.');
}

console.log(`
Sau khi có Access Key, thêm vào be/.env:

R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ACCOUNT_ID=${accountId || '<từ dashboard R2 overview>'}
R2_BUCKET=${BUCKET}

Rồi: restart BE. Health phải hiện storage.provider = "r2".
Nhớ thêm cùng biến lên Vercel (project BE) → Redeploy.
Chi tiết: be/R2_SETUP.md
`);
