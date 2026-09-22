import fs from 'node:fs'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'

function getArg(name) {
  const index = process.argv.indexOf(name)

  if (index < 0 || !process.argv[index + 1]) {
    return ''
  }

  return String(process.argv[index + 1])
}

const privateKeyArg = getArg('--private-key')

if (!privateKeyArg) {
  console.error('استخدم --private-key وحدد مكان حفظ المفتاح الخاص خارج المشروع')

  process.exit(1)
}

const repoRoot = process.cwd()

const privateKeyPath = path.resolve(privateKeyArg)

const relative = path.relative(repoRoot, privateKeyPath)

const insideRepo =
  relative === '' ||
  (relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative))

if (insideRepo) {
  console.error('مرفوض: المفتاح الخاص يجب أن يكون خارج مجلد المشروع بالكامل')

  process.exit(1)
}

if (fs.existsSync(privateKeyPath)) {
  console.error(
    `المفتاح الخاص موجود بالفعل:\n${privateKeyPath}\nلن يتم استبداله حفاظًا على نسخ العملاء الحالية.`,
  )

  process.exit(1)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')

const privatePem = privateKey
  .export({
    type: 'pkcs8',
    format: 'pem',
  })
  .toString()

const publicPem = publicKey
  .export({
    type: 'spki',
    format: 'pem',
  })
  .toString()

fs.mkdirSync(path.dirname(privateKeyPath), {
  recursive: true,
})

fs.writeFileSync(privateKeyPath, privatePem, {
  encoding: 'utf8',
  mode: 0o600,
})

const publicKeyTsPath = path.join(
  repoRoot,
  'src',
  'main',
  'security',
  'support-signing-public-key.ts',
)

fs.writeFileSync(
  publicKeyTsPath,
  [
    '// Public key only.',
    '// Safe to ship with the application.',
    `export const SUPPORT_SIGNING_PUBLIC_KEY_PEM = ${JSON.stringify(publicPem)}`,
    '',
  ].join('\n'),
  'utf8',
)

console.log('\nتم إنشاء مفاتيح ERP Support Signing بنجاح.')

console.log(`\nPRIVATE KEY - احتفظ به سريًا وخارج المشروع:\n${privateKeyPath}`)

console.log(`\nPUBLIC KEY - تم وضعه داخل البرنامج:\n${publicKeyTsPath}`)
