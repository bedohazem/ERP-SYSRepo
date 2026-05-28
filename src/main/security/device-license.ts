import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { app } from 'electron';
import { machineIdSync } from 'node-machine-id';

const TRIAL_DAYS = 7;

// غير السر ده قبل التسليم وخليه طويل وعشوائي جدًا
const LICENSE_SECRET = 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_ERP_STORE_2026';

const REG_PATH = 'HKCU\\Software\\ERPStore';
const REG_VALUE = 'LicenseData';

type LicenseRecord = {
  schema_version: number;
  machine_id_hash: string;
  device_code: string;
  trial_started_at: string;
  trial_expires_at: string;
  last_seen_at: string;
  activated: boolean;
  activated_at?: string | null;
  invalidated?: boolean;
  signature: string;
};

type LicenseStatus = {
  activated: boolean;
  trial_started_at: string;
  trial_days: number;
  trial_expires_at: string;
  days_left: number;
  expired: boolean;
  blocked: boolean;
  message: string;
  device_code: string;
};

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function hideFileIfWindows(filePath: string) {
  if (process.platform !== 'win32') return;

  try {
    execFileSync('attrib', ['+h', filePath], { windowsHide: true });
  } catch {
    // تجاهل
  }
}

function getUserLicensePath() {
  return path.join(app.getPath('userData'), 'license.dat');
}

function getProgramDataLicensePath() {
  const base =
    process.env.ProgramData ||
    path.join(process.env.SystemDrive || 'C:', 'ProgramData');

  return path.join(base, 'ERP Store', 'license.dat');
}

function getSecondUserLicensePath() {
  return path.join(app.getPath('appData'), 'Microsoft', 'ERP Store', 'system.dat');
}

function getLicensePaths() {
  return [
    getUserLicensePath(),
    getProgramDataLicensePath(),
    getSecondUserLicensePath()
  ];
}

function getMachineHash() {
  const machineId = machineIdSync(false);

  return crypto
    .createHash('sha256')
    .update(String(machineId))
    .digest('hex');
}

function getDeviceCodeFromHash(machineHash: string) {
  const raw = machineHash.slice(0, 16).toUpperCase();

  return raw.match(/.{1,4}/g)?.join('-') || raw;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeCode(value: string) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function formatCode(value: string) {
  return value.match(/.{1,4}/g)?.join('-') || value;
}

function generateActivationCodeForDevice(deviceCode: string) {
  const cleanDeviceCode = normalizeCode(deviceCode);

  const hash = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(cleanDeviceCode)
    .digest('hex')
    .toUpperCase();

  const codeBody = hash.slice(0, 16);

  return `ERPS-${formatCode(codeBody)}`;
}

function signLicense(data: Omit<LicenseRecord, 'signature'>) {
  return crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(JSON.stringify(data))
    .digest('hex');
}

function buildRecord(data: Omit<LicenseRecord, 'signature'>): LicenseRecord {
  return {
    ...data,
    signature: signLicense(data)
  };
}

function isValidSignature(record: LicenseRecord) {
  const { signature, ...payload } = record;

  return signature === signLicense(payload);
}

function parseRecord(raw: string): LicenseRecord | null {
  try {
    const record = JSON.parse(raw) as LicenseRecord;

    if (!record || !record.signature) return null;
    if (!isValidSignature(record)) return null;
    if (record.machine_id_hash !== getMachineHash()) return null;

    return record;
  } catch {
    return null;
  }
}

function readFileStore(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) {
      return { record: null as LicenseRecord | null, tampered: false };
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const record = parseRecord(raw);

    if (!record) {
      return { record: null, tampered: true };
    }

    return { record, tampered: false };
  } catch {
    return { record: null, tampered: true };
  }
}

function writeFileStore(filePath: string, record: LicenseRecord) {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  hideFileIfWindows(filePath);
}

function readRegistryStore() {
  if (process.platform !== 'win32') {
    return { record: null as LicenseRecord | null, tampered: false };
  }

  try {
    const output = execFileSync('reg', ['query', REG_PATH, '/v', REG_VALUE], {
      encoding: 'utf8',
      windowsHide: true
    });

    const line = output
      .split(/\r?\n/)
      .find((x) => x.includes(REG_VALUE) && x.includes('REG_SZ'));

    if (!line) {
      return { record: null, tampered: false };
    }

    const encoded = line.split('REG_SZ').pop()?.trim();

    if (!encoded) {
      return { record: null, tampered: true };
    }

    const raw = Buffer.from(encoded, 'base64').toString('utf8');
    const record = parseRecord(raw);

    if (!record) {
      return { record: null, tampered: true };
    }

    return { record, tampered: false };
  } catch {
    return { record: null, tampered: false };
  }
}

function writeRegistryStore(record: LicenseRecord) {
  if (process.platform !== 'win32') return;

  try {
    const raw = JSON.stringify(record);
    const encoded = Buffer.from(raw, 'utf8').toString('base64');

    execFileSync(
      'reg',
      ['add', REG_PATH, '/v', REG_VALUE, '/t', 'REG_SZ', '/d', encoded, '/f'],
      { windowsHide: true }
    );
  } catch {
    // تجاهل
  }
}

function readAllStores() {
  const fileResults = getLicensePaths().map((filePath) => ({
    name: filePath,
    ...readFileStore(filePath)
  }));

  const registryResult = {
    name: 'registry',
    ...readRegistryStore()
  };

  return [...fileResults, registryResult];
}

function writeAllStores(record: LicenseRecord) {
  for (const filePath of getLicensePaths()) {
    try {
      writeFileStore(filePath, record);
    } catch {
      // تجاهل
    }
  }

  writeRegistryStore(record);
}

function createTrialRecord() {
  const now = new Date();
  const machineHash = getMachineHash();
  const deviceCode = getDeviceCodeFromHash(machineHash);
  const expiresAt = addDays(now, TRIAL_DAYS);

  const record = buildRecord({
    schema_version: 1,
    machine_id_hash: machineHash,
    device_code: deviceCode,
    trial_started_at: now.toISOString(),
    trial_expires_at: expiresAt.toISOString(),
    last_seen_at: now.toISOString(),
    activated: false,
    activated_at: null,
    invalidated: false
  });

  writeAllStores(record);

  return record;
}

function minDateIso(values: string[]) {
  return values
    .filter(Boolean)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
}

function maxDateIso(values: string[]) {
  return values
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

function mergeRecords(records: LicenseRecord[]) {
  const machineHash = getMachineHash();
  const deviceCode = getDeviceCodeFromHash(machineHash);

  const trialStartedAt = minDateIso(records.map((x) => x.trial_started_at));
  const trialExpiresAt = minDateIso(records.map((x) => x.trial_expires_at));
  const lastSeenAt = maxDateIso(records.map((x) => x.last_seen_at));

  const newestRecord = [...records].sort((a, b) => {
    return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
  })[0];

  const activated = Boolean(newestRecord?.activated);
  const activatedAt =
    minDateIso(records.map((x) => x.activated_at || '').filter(Boolean)) || null;

  const invalidated = records.some((x) => x.invalidated);

  return buildRecord({
    schema_version: 1,
    machine_id_hash: machineHash,
    device_code: deviceCode,
    trial_started_at: trialStartedAt,
    trial_expires_at: trialExpiresAt,
    last_seen_at: lastSeenAt,
    activated,
    activated_at: activatedAt,
    invalidated
  });
}

function blockedStatus(message: string): LicenseStatus {
  const machineHash = getMachineHash();
  const deviceCode = getDeviceCodeFromHash(machineHash);

  return {
    activated: false,
    trial_started_at: '',
    trial_days: TRIAL_DAYS,
    trial_expires_at: '',
    days_left: 0,
    expired: true,
    blocked: true,
    message,
    device_code: deviceCode
  };
}

export function getDeviceLicenseStatus(): LicenseStatus {
  const now = new Date();
  const results = readAllStores();

  const validRecords = results
    .map((x) => x.record)
    .filter(Boolean) as LicenseRecord[];

  const tampered = results.some((x) => x.tampered);

  // لو مفيش ولا نسخة صحيحة، وفيه ملف متلاعب فيه، اقفل البرنامج
  if (tampered && validRecords.length === 0) {
    return blockedStatus('تم اكتشاف تلاعب في ملفات التفعيل');
  }

  // لو فيه نسخة صحيحة، نصلّح باقي الأماكن بدل ما نقفل
  let record = validRecords.length ? mergeRecords(validRecords) : createTrialRecord();

  if (tampered && validRecords.length > 0) {
    writeAllStores(record);
  }

  if (record.invalidated) {
    return blockedStatus('تم إلغاء صلاحية التجربة على هذا الجهاز');
  }

  const lastSeen = new Date(record.last_seen_at);
  const clockRollbackDetected = now.getTime() + 60_000 < lastSeen.getTime();

  if (clockRollbackDetected) {
    const invalidRecord = buildRecord({
      ...record,
      invalidated: true,
      last_seen_at: record.last_seen_at
    });

    writeAllStores(invalidRecord);

    return blockedStatus('تم اكتشاف تغيير في تاريخ الجهاز');
  }

  const expiresAt = new Date(record.trial_expires_at);
  const expired = !record.activated && now.getTime() > expiresAt.getTime();

  const daysLeft = record.activated
    ? TRIAL_DAYS
    : Math.max(
        0,
        Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );

  record = buildRecord({
    ...record,
    last_seen_at: now.toISOString()
  });

  writeAllStores(record);

  return {
    activated: record.activated,
    trial_started_at: record.trial_started_at,
    trial_days: TRIAL_DAYS,
    trial_expires_at: record.trial_expires_at,
    days_left: daysLeft,
    expired,
    blocked: false,
    message: '',
    device_code: record.device_code
  };
}

export function activateDevice(code: string) {
  const status = getDeviceLicenseStatus();
  const expectedCode = generateActivationCodeForDevice(status.device_code);

  console.log('DEVICE CODE:', status.device_code);
  console.log('EXPECTED CODE:', expectedCode);
  console.log('INPUT CODE:', code);
  console.log('NORMALIZED EXPECTED:', normalizeCode(expectedCode));
  console.log('NORMALIZED INPUT:', normalizeCode(code));

  if (normalizeCode(code) !== normalizeCode(expectedCode)) {
    return {
      success: false,
      message: 'كود التفعيل غير صحيح'
    };
  }

  const now = new Date();
  const machineHash = getMachineHash();
  const deviceCode = getDeviceCodeFromHash(machineHash);

  const record = buildRecord({
    schema_version: 1,
    machine_id_hash: machineHash,
    device_code: deviceCode,
    trial_started_at: status.trial_started_at || now.toISOString(),
    trial_expires_at: status.trial_expires_at || addDays(now, TRIAL_DAYS).toISOString(),
    last_seen_at: now.toISOString(),
    activated: true,
    activated_at: now.toISOString(),
    invalidated: false
  });

  writeAllStores(record);

  return {
    success: true,
    message: 'تم تفعيل البرنامج بنجاح',
    status: getDeviceLicenseStatus()
  };
}

export function deactivateDevice() {
  const status = getDeviceLicenseStatus();
  const now = new Date();
  const machineHash = getMachineHash();
  const deviceCode = getDeviceCodeFromHash(machineHash);

  const record = buildRecord({
    schema_version: 1,
    machine_id_hash: machineHash,
    device_code: deviceCode,
    trial_started_at: status.trial_started_at || now.toISOString(),
    trial_expires_at: status.trial_expires_at || addDays(now, TRIAL_DAYS).toISOString(),
    last_seen_at: now.toISOString(),
    activated: false,
    activated_at: null,
    invalidated: false
  });

  writeAllStores(record);
  console.log('DEACTIVATE STATUS:', getDeviceLicenseStatus());

  return {
    success: true,
    message: 'تم إلغاء تفعيل البرنامج',
    status: getDeviceLicenseStatus()
  };
}

export function generateActivationCodeForDisplay(deviceCode: string) {
  return generateActivationCodeForDevice(deviceCode);
}