const crypto = require('node:crypto');

const LICENSE_SECRET = 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_ERP_STORE_2026';

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function formatCode(value) {
  return value.match(/.{1,4}/g)?.join('-') || value;
}

function generateActivationCode(deviceCode) {
  const cleanDeviceCode = normalizeCode(deviceCode);

  const hash = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(cleanDeviceCode)
    .digest('hex')
    .toUpperCase();

  const codeBody = hash.slice(0, 16);

  return `ERPS-${formatCode(codeBody)}`;
}

const deviceCode = process.argv[2];

if (!deviceCode) {
  console.error('Usage: node scripts/generate-activation-code.cjs DEVICE-CODE');
  process.exit(1);
}

console.log(generateActivationCode(deviceCode));