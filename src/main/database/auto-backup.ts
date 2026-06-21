import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getDb } from './db';

const MAX_BACKUPS = 7;
const BACKUP_SETTING_KEY = 'auto_backup_dir';

export type AutoBackupReason = 'startup' | 'hourly' | 'shutdown' | 'manual';

function getDefaultBackupDir() {
  return path.join(app.getPath('documents'), 'ERP-Store-Backups');
}

function readConfiguredBackupDir() {
  try {
    const db = getDb();

    const row = db
      .prepare(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`)
      .get(BACKUP_SETTING_KEY) as { value?: string } | undefined;

    const savedPath = String(row?.value || '').trim();

    return savedPath || getDefaultBackupDir();
  } catch {
    return getDefaultBackupDir();
  }
}

function saveConfiguredBackupDir(dirPath: string) {
  const db = getDb();

  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(BACKUP_SETTING_KEY, dirPath);
}

export function getAutoBackupDir() {
  return readConfiguredBackupDir();
}

export function setAutoBackupDir(dirPath: string) {
  const cleanPath = String(dirPath || '').trim();

  if (!cleanPath) {
    throw new Error('اختار مكان صحيح للنسخ التلقائي');
  }

  if (!fs.existsSync(cleanPath)) {
    fs.mkdirSync(cleanPath, { recursive: true });
  }

  const stat = fs.statSync(cleanPath);

  if (!stat.isDirectory()) {
    throw new Error('المسار المختار ليس فولدر');
  }

  saveConfiguredBackupDir(cleanPath);

  return getAutoBackupInfo();
}

function getBackupName(reason: AutoBackupReason) {
  const now = new Date();

  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('-');

  return `erp-auto-${reason}-${stamp}.db`;
}

function makeUniqueBackupPath(backupDir: string, reason: AutoBackupReason) {
  const baseName = getBackupName(reason);
  const parsed = path.parse(baseName);

  let backupPath = path.join(backupDir, baseName);
  let counter = 1;

  while (fs.existsSync(backupPath)) {
    backupPath = path.join(backupDir, `${parsed.name}-${counter}${parsed.ext}`);
    counter += 1;
  }

  return backupPath;
}

function listAutoBackupFiles(backupDir: string) {
  if (!fs.existsSync(backupDir)) {
    return [];
  }

  return fs
    .readdirSync(backupDir)
    .filter((file) => file.startsWith('erp-auto-') && file.endsWith('.db'))
    .map((file) => {
      const fullPath = path.join(backupDir, file);
      const stat = fs.statSync(fullPath);

      return {
        file,
        fullPath,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
        time: stat.mtime.getTime()
      };
    })
    .sort((a, b) => b.time - a.time);
}

function cleanupOldBackups(backupDir: string) {
  const files = listAutoBackupFiles(backupDir);
  const oldFiles = files.slice(MAX_BACKUPS);

  for (const item of oldFiles) {
    fs.unlinkSync(item.fullPath);
  }
}

export function getAutoBackupInfo() {
  const backupDir = getAutoBackupDir();

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const files = listAutoBackupFiles(backupDir).slice(0, MAX_BACKUPS);

  return {
    dir: backupDir,
    maxBackups: MAX_BACKUPS,
    files: files.map(({ time, ...file }) => file)
  };
}

export async function createAutoBackup(reason: AutoBackupReason = 'manual') {
  try {
    const backupDir = getAutoBackupDir();

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = makeUniqueBackupPath(backupDir, reason);
    const db = getDb();

    await db.backup(backupPath);

    cleanupOldBackups(backupDir);

    return {
      success: true,
      skipped: false,
      reason,
      path: backupPath,
      info: getAutoBackupInfo()
    };
  } catch (error) {
    console.error('Auto backup failed:', error);

    return {
      success: false,
      skipped: false,
      reason,
      message: error instanceof Error ? error.message : 'Auto backup failed'
    };
  }
}

// Alias مؤقت عشان أي استدعاء قديم في المشروع مايكسرش
export async function createDailyAutoBackup() {
  return createAutoBackup('manual');
}