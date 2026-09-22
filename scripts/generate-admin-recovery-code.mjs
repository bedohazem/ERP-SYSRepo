import fs from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'

function getArg(name) {
  const index = process.argv.indexOf(name)

  if (index < 0 || !process.argv[index + 1]) {
    return ''
  }

  return String(process.argv[index + 1])
}

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

const privateKeyPath = getArg('--private-key')

const deviceCode = normalizeCode(getArg('--device'))

const requestId = normalizeCode(getArg('--request'))

const username = getArg('--username').trim()

const minutesRaw = Number(getArg('--minutes') || 15)

if (!privateKeyPath || !deviceCode || !requestId || !username) {
  console.error(`
الاستخدام:

npm run support:recovery-code -- ^
  --private-key "C:\\ERP-Support-Keys\\admin-recovery-private.pem" ^
  --device "ABCD-EFGH-IJKL-MNOP" ^
  --request "1111-2222-3333-4444" ^
  --username "admin"
`)

  process.exit(1)
}

if (!Number.isFinite(minutesRaw) || minutesRaw < 1 || minutesRaw > 15) {
  console.error('مدة Recovery Code يجب أن تكون من 1 إلى 15 دقيقة')

  process.exit(1)
}

if (!fs.existsSync(privateKeyPath)) {
  console.error('المفتاح الخاص غير موجود')

  process.exit(1)
}

const privateKey = createPrivateKey(fs.readFileSync(privateKeyPath, 'utf8'))

if (privateKey.asymmetricKeyType !== 'ed25519') {
  console.error('المفتاح ليس Ed25519')

  process.exit(1)
}

const issuedAt = Math.floor(Date.now() / 1000)

const expiresAt = issuedAt + Math.floor(minutesRaw * 60)

const payload = {
  v: 1,

  purpose: 'admin_password_recovery',

  device_code: deviceCode,

  request_id: requestId,

  username,

  issued_at: issuedAt,

  expires_at: expiresAt,
}

const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8')

const signature = sign(null, payloadBuffer, privateKey)

const token = [
  'ERPR1',

  payloadBuffer.toString('base64url'),

  signature.toString('base64url'),
].join('.')

console.log('\nRecovery Code:\n')

console.log(token)

console.log('\nUsername:', username)

console.log('Expires:', new Date(expiresAt * 1000).toLocaleString())
